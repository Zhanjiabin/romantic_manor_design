# -*- coding: utf-8 -*-
"""Verify: ALE green marks farmland interior; transparent = grass outside."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from codec.ale import ale_to_rgba
from game_paths import TILE
OUT = ROOT / "data"
LINK_CELLS = [37, 30, 34, 25, 18, 28, 8, 32, 35, 20, 1, 29, 6, 13, 4, 5, 11, 10]
LINK_PATTERNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 9, 3, 6, 12]
OFFSETS = {
    (0, 0): 0xF,
    (-1, 0): 0x6,
    (1, 0): 0x9,
    (0, -1): 0xC,
    (0, 1): 0x3,
    (-1, -1): 0x4,
    (1, 1): 0x1,
    (1, -1): 0x8,
    (-1, 1): 0x2,
}


def iso_widths():
    widths = [0] * 33
    v, i, j = 1, 0, 32
    while v < 0x45:
        widths[i] = v
        widths[j] = v
        v += 4
        i += 1
        j -= 1
    return widths, [32 - (w >> 1) for w in widths]


WIDTHS, SRCX = iso_widths()
PAT_TO_SLOT = {}
for idx, pat in enumerate(LINK_PATTERNS):
    PAT_TO_SLOT.setdefault(pat, idx)


def pad_rgba(im, fill=(0, 0, 0, 0)):
    canvas = Image.new("RGBA", (im.size[0] + 64, im.size[1] + 64), fill)
    canvas.paste(im, (32, 32))
    return canvas


def crop_cell(atlas, cell):
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    opx, ap = out.load(), atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            opx[SRCX[y] + p, y] = ap[sx + 32 + SRCX[y] + p, sy + 32 + y]
    return out


def terrain_diamond(tex):
    atlas = pad_rgba(tex)
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    opx, ap = out.load(), atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            opx[SRCX[y] + p, y] = ap[32 + SRCX[y] + p, 32 + y]
    return out


def is_green(p):
    r, g, b, a = p
    return a >= 40 and g > r + 25 and g > b + 25


def is_stone(p):
    r, g, b, a = p
    return a >= 40 and not is_green(p)


def compose_green_as_dirt(grass, dirt, ale):
    """Transparent ALE -> grass; green ALE -> dirt; stone -> stone."""
    out = grass.copy()
    op, gp, dp, ap = out.load(), grass.load(), dirt.load(), ale.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            pixel = ap[x, y]
            if pixel[3] < 40:
                op[x, y] = gp[x, y]
            elif is_green(pixel):
                op[x, y] = dp[x, y]
            else:
                op[x, y] = (pixel[0], pixel[1], pixel[2], 255)
    return out


def main():
    ale = ale_to_rgba((TILE / "mask" / "clink014.ale").read_bytes(), 0)
    ale_atlas = pad_rgba(ale)
    dirt = terrain_diamond(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    grass = terrain_diamond(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))
    canvas = Image.new("RGBA", (360, 240), (36, 90, 36, 255))
    for (du, dv), pat in OFFSETS.items():
        if pat == 0xF:
            tile = dirt.copy()
        else:
            link = crop_cell(ale_atlas, LINK_CELLS[PAT_TO_SLOT[pat]])
            tile = compose_green_as_dirt(grass, dirt, link)
        x = 180 + (du - dv) * 32 - 32
        y = 110 + (du + dv) * 16 - 16
        canvas.paste(tile, (x, y), tile)
    path = OUT / "_test_green_as_dirt.png"
    canvas.save(path)
    print("wrote", path)

    # sample inside/outside stone ring roughly
    px = canvas.load()
    for name, pts in {
        "center": [(180, 110)],
        "inner": [(170, 110), (190, 110), (180, 100), (180, 120)],
        "outer_tips": [(140, 110), (220, 110), (180, 80), (180, 140)],
    }.items():
        cols = [px[x, y] for x, y in pts]
        print(name, cols)


if __name__ == "__main__":
    main()
