# -*- coding: utf-8 -*-
"""Offline 1-cell farmland stamp composites for visual verification."""
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
    srcx = [32 - (w >> 1) for w in widths]
    return widths, srcx


WIDTHS, SRCX = iso_widths()
PAT_TO_SLOT = {}
for idx, pat in enumerate(LINK_PATTERNS):
    PAT_TO_SLOT.setdefault(pat, idx)


def pad_rgba(im: Image.Image, fill=(0, 0, 0, 0)) -> Image.Image:
    canvas = Image.new("RGBA", (im.size[0] + 64, im.size[1] + 64), fill)
    canvas.paste(im, (32, 32))
    return canvas


def crop_cell(atlas: Image.Image, cell: int) -> Image.Image:
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    opx = out.load()
    ap = atlas.load()
    ox0, oy0 = sx + 32, sy + 32
    for y in range(33):
        for p in range(WIDTHS[y]):
            opx[SRCX[y] + p, y] = ap[ox0 + SRCX[y] + p, oy0 + y]
    return out


def terrain_diamond(tex: Image.Image) -> Image.Image:
    atlas = pad_rgba(tex)
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    opx = out.load()
    ap = atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            opx[SRCX[y] + p, y] = ap[32 + SRCX[y] + p, 32 + y]
    return out


def is_stone(pixel) -> bool:
    r, g, b, a = pixel
    if a < 40:
        return False
    # Grass-green baked into clink014 — skip those, keep pebbles/curbs.
    if g > r + 25 and g > b + 25:
        return False
    return True


def overlay(base: Image.Image, ale: Image.Image, mode: str) -> Image.Image:
    out = base.copy()
    op = out.load()
    ap = ale.load()
    for y in range(33):
        for x in range(65):
            pixel = ap[x, y]
            if pixel[3] < 40:
                continue
            if mode == "all" or (mode == "stone" and is_stone(pixel)):
                op[x, y] = (pixel[0], pixel[1], pixel[2], 255)
    return out


def blend_989802(dirt: Image.Image, grass: Image.Image, mask: Image.Image, cell: int) -> Image.Image:
    mpad = Image.new("L", (mask.size[0] + 64, mask.size[1] + 64), 0)
    mpad.paste(mask, (32, 32))
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, mp, dp, gp = out.load(), mpad.load(), dirt.load(), grass.load()
    ox0, oy0 = sx + 32, sy + 32
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            m = mp[ox0 + SRCX[y] + p, oy0 + y] >> 3
            d, g = dp[x, y], gp[x, y]
            if m >= 30:
                op[x, y] = d
            else:
                n = 32 - m
                op[x, y] = (
                    (d[0] * m + g[0] * n) >> 5,
                    (d[1] * m + g[1] * n) >> 5,
                    (d[2] * m + g[2] * n) >> 5,
                    255,
                )
    return out


def main() -> None:
    ale = ale_to_rgba((TILE / "mask" / "clink014.ale").read_bytes(), 0)
    ale_atlas = pad_rgba(ale)
    dirt = terrain_diamond(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    grass = terrain_diamond(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))
    mask = Image.open(TILE / "mask" / "989802.jpg").convert("L")

    modes = {
        "dirt_allale": ("dirt", "all"),
        "dirt_stone": ("dirt", "stone"),
        "grass_allale": ("grass", "all"),
        "mask_allale": ("mask", "all"),
        "mask_stone": ("mask", "stone"),
    }

    for name, (base_mode, ale_mode) in modes.items():
        canvas = Image.new("RGBA", (360, 240), (36, 90, 36, 255))
        for (du, dv), pat in OFFSETS.items():
            if pat == 0xF:
                tile = dirt.copy()
            else:
                slot = PAT_TO_SLOT[pat]
                cell = LINK_CELLS[slot]
                link = crop_cell(ale_atlas, cell)
                if base_mode == "dirt":
                    base = dirt.copy()
                elif base_mode == "grass":
                    base = grass.copy()
                else:
                    base = blend_989802(dirt, grass, mask, cell)
                tile = overlay(base, link, ale_mode)
            x = 180 + (du - dv) * 32 - 32
            y = 110 + (du + dv) * 16 - 16
            canvas.paste(tile, (x, y), tile)
        path = OUT / f"_test_{name}.png"
        canvas.save(path)
        print("wrote", path.name)


if __name__ == "__main__":
    main()
