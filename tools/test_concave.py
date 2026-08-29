# -*- coding: utf-8 -*-
"""Verify pebble-ring clip + inner-only AO (concave, no bottom leak)."""
from __future__ import annotations

import sys
from collections import deque
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
P2S = {}
for i, p in enumerate(LINK_PATTERNS):
    P2S.setdefault(p, i)


def in_diamond(x, y):
    return 0 <= y < 33 and SRCX[y] <= x < SRCX[y] + WIDTHS[y]


def pad_rgba(im):
    canvas = Image.new("RGBA", (im.size[0] + 64, im.size[1] + 64), (0, 0, 0, 0))
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


def is_pebble(p):
    r, g, b, a = p
    return a >= 40 and r > 110 and g > 100 and b > 80 and abs(r - g) < 40


def compose(grass, dirt, ale, dilate=2):
    ap, dp, gp = ale.load(), dirt.load(), grass.load()
    pebble = [[0] * 65 for _ in range(33)]
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            if is_pebble(ap[x, y]):
                pebble[y][x] = 1
    barrier = [row[:] for row in pebble]
    for _ in range(dilate):
        nxt = [row[:] for row in barrier]
        for y in range(33):
            for p in range(WIDTHS[y]):
                x = SRCX[y] + p
                if barrier[y][x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if in_diamond(nx, ny) and barrier[ny][nx]:
                        nxt[y][x] = 1
                        break
        barrier = nxt

    outside = [[0] * 65 for _ in range(33)]
    q = deque()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            if ap[x, y][3] < 40 and not barrier[y][x]:
                outside[y][x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not in_diamond(nx, ny) or outside[ny][nx] or barrier[ny][nx]:
                continue
            outside[ny][nx] = 1
            q.append((nx, ny))

    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op = out.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            pr = ap[x, y]
            if pebble[y][x]:
                op[x, y] = (pr[0], pr[1], pr[2], 255)
                continue
            if outside[y][x] or pr[3] < 40:
                op[x, y] = gp[x, y]
            else:
                d = dp[x, y]
                # inner AO: dirt next to barrier (stones), never grass
                near = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)):
                    nx, ny = x + dx, y + dy
                    if in_diamond(nx, ny) and barrier[ny][nx]:
                        near = True
                        break
                if near:
                    op[x, y] = (d[0] * 72 // 100, d[1] * 72 // 100, d[2] * 72 // 100, 255)
                else:
                    op[x, y] = d
    return out


def main():
    ale = ale_to_rgba((TILE / "mask" / "clink014.ale").read_bytes(), 0)
    atlas = pad_rgba(ale)
    dirt = terrain_diamond(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    sand = terrain_diamond(Image.open(TILE / "maptexture" / "100001.gif").convert("RGBA")) if False else dirt
    grass = terrain_diamond(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))

    canvas = Image.new("RGBA", (360, 240), (30, 90, 40, 255))
    # grass plane under
    for du in range(-2, 3):
        for dv in range(-2, 3):
            canvas.paste(grass, (180 + (du - dv) * 32 - 32, 110 + (du + dv) * 16 - 16), grass)

    for (du, dv), pat in OFFSETS.items():
        if pat == 0xF:
            tile = dirt.copy()
        else:
            tile = compose(grass, dirt, crop_cell(atlas, LINK_CELLS[P2S[pat]]))
        canvas.paste(tile, (180 + (du - dv) * 32 - 32, 110 + (du + dv) * 16 - 16), tile)
    path = OUT / "_verify_concave.png"
    canvas.save(path)
    print("wrote", path.name)

    px = canvas.load()
    # bottom of patch around y=140-160
    dirt_n = grass_n = 0
    for y in range(145, 175):
        for x in range(140, 220):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            if g > r + 20 and g > b + 20:
                grass_n += 1
            elif r > g:
                dirt_n += 1
    print("bottom band dirt", dirt_n, "grass", grass_n)


if __name__ == "__main__":
    main()
