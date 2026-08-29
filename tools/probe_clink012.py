# -*- coding: utf-8 -*-
from pathlib import Path
from collections import Counter
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codec.ale import ale_to_rgba
from game_paths import TILE
OUT = Path(__file__).resolve().parents[1] / "data"
LINK_CELLS = [37, 30, 34, 25, 18, 28, 8, 32, 35, 20, 1, 29, 6, 13, 4, 5, 11, 10]
LINK_PATTERNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 9, 3, 6, 12]
WIDTHS = [0] * 33
v, i, j = 1, 0, 32
while v < 0x45:
    WIDTHS[i] = v
    WIDTHS[j] = v
    v += 4
    i += 1
    j -= 1
SRCX = [32 - (w >> 1) for w in WIDTHS]
P2S = {}
for idx, p in enumerate(LINK_PATTERNS):
    P2S.setdefault(p, idx)


def classify(p):
    r, g, b, a = p
    if a < 40:
        return "trans"
    if g > r + 25 and g > b + 25:
        return "green"
    lum = max(r, g, b)
    if lum < 35:
        return "black"
    if max(r, g, b) - min(r, g, b) < 18:
        return "dgray" if lum < 90 else "lgray"
    if r > g + 10 and r > b + 5:
        return "brown"
    return "other"


def pad(im):
    c = Image.new("RGBA", (im.size[0] + 64, im.size[1] + 64), (0, 0, 0, 0))
    c.paste(im, (32, 32))
    return c


def crop(atlas, cell):
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap = out.load(), atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[sx + 32 + SRCX[y] + p, sy + 32 + y]
    return out


def diamond(tex):
    at = pad(tex)
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap = out.load(), at.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[32 + SRCX[y] + p, 32 + y]
    return out


for name in ["clink012", "clink014"]:
    im = ale_to_rgba((TILE / "mask" / f"{name}.ale").read_bytes(), 0)
    c = Counter()
    samples = {}
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            p = im.getpixel((x, y))
            k = classify(p)
            c[k] += 1
            samples.setdefault(k, p[:4])
    print(name, dict(c))
    for k, v in samples.items():
        print(" ", k, v)

grass = diamond(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))
stone = diamond(Image.open(TILE / "maptexture" / "100001.gif").convert("RGBA"))
brick = diamond(Image.open(TILE / "maptexture" / "100102.jpg").convert("RGBA"))


def compose(fill, grass_d, ale, mode="copy"):
    out = grass_d.copy()
    op, fp, gp, ap = out.load(), fill.load(), grass_d.load(), ale.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            r, g, b, a = ap[x, y]
            if a < 40:
                op[x, y] = gp[x, y]
            elif g > r + 25 and g > b + 25:
                op[x, y] = fp[x, y]
            elif mode == "skipdark" and max(r, g, b) < 55:
                op[x, y] = gp[x, y]
            elif mode == "softcurb" and max(r, g, b) < 55:
                # dark fringe: keep grass (outer) so only tan lip remains
                op[x, y] = gp[x, y]
            else:
                op[x, y] = (r, g, b, 255)
    return out


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


def ring(fill, ale_name, mode, tag):
    ale = ale_to_rgba((TILE / "mask" / f"{ale_name}.ale").read_bytes(), 0)
    atlas = pad(ale)
    canvas = Image.new("RGBA", (320, 220), (40, 110, 40, 255))
    for (du, dv), pat in OFFSETS.items():
        if pat == 0xF:
            tile = fill.copy()
        else:
            tile = compose(fill, grass, crop(atlas, LINK_CELLS[P2S[pat]]), mode)
        x = 160 + (du - dv) * 32 - 32
        y = 110 + (du + dv) * 16 - 16
        canvas.paste(tile, (x, y), tile)
    path = OUT / f"_ring_{ale_name}_{tag}.png"
    canvas.save(path)
    print("wrote", path)


ring(stone, "clink012", "copy", "copyall")
ring(stone, "clink012", "skipdark", "skipdark")
ring(brick, "clink012", "skipdark", "brick_skipdark")
ring(stone, "clink014", "copy", "wrong014")
