# -*- coding: utf-8 -*-
"""Classify link ALE pixels and preview water/snow/flower compositing."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from codec.ale import ale_to_rgba
from game_paths import TILE
OUT = ROOT / "data"
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
    if b > r + 20 and b > g + 10:
        return "blue"
    if r > 180 and g > 180 and b > 180:
        return "white"
    if max(r, g, b) - min(r, g, b) < 18:
        return "gray"
    if r > g + 15 and r > b + 10:
        return "brown"
    return "other"


def pad(im):
    c = Image.new("RGBA", (im.size[0] + 64, im.size[1] + 64), (0, 0, 0, 0))
    c.paste(im, (32, 32))
    return c


def crop_cell(atlas, cell):
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap = out.load(), atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[sx + 32 + SRCX[y] + p, sy + 32 + y]
    return out


def terr(name):
    return pad(Image.open(TILE / name).convert("RGBA"))


def diamond(tex):
    at = pad(tex) if tex.mode else tex
    if tex.size[0] > 70:
        at = pad(tex)
    else:
        at = tex
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap = out.load(), at.load()
    ox0 = 32 if at.size[0] > 65 else 0
    oy0 = 32 if at.size[1] > 33 else 0
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[ox0 + SRCX[y] + p, oy0 + y]
    return out


def stats(im, label):
    px = im.load()
    c = Counter()
    samples = {k: [] for k in ["green", "blue", "white", "gray", "brown", "other"]}
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            p = px[x, y]
            k = classify(p)
            c[k] += 1
            if k in samples and len(samples[k]) < 3:
                samples[k].append(p[:3])
    parts = " ".join(f"{k}={c[k]}" for k in ["trans", "green", "blue", "white", "gray", "brown", "other"] if c[k])
    extra = " ".join(f"{k}{v}" for k, v in samples.items() if v)
    print(f"{label:18s} {im.size[0]}x{im.size[1]}  {parts}  {extra}")
    return c


def paint_chroma(from_d, to_d, ale, mode="green_from"):
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, fp, tp, ap = out.load(), from_d.load(), to_d.load(), ale.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            r, g, b, a = ap[x, y]
            if a < 40:
                op[x, y] = tp[x, y]
            elif mode == "green_from" and g > r + 25 and g > b + 25:
                op[x, y] = fp[x, y]
            elif mode == "overlay":
                op[x, y] = (r, g, b, 255)
            else:
                op[x, y] = (r, g, b, 255)
    return out


def main():
    OUT.mkdir(exist_ok=True)
    ales = [
        "clink014",
        "clink013",
        "clink012",
        "wlink014",
        "wlink012",
        "slink02",
        "slink014",
        "slink015",
        "980100",
        "980205",
    ]
    lines = []
    for name in ales:
        path = TILE / "mask" / f"{name}.ale"
        if not path.exists():
            path = TILE / "mask" / f"{name}.png"
        if not path.exists():
            print("missing", name)
            continue
        if path.suffix.lower() == ".ale":
            im = ale_to_rgba(path.read_bytes(), 0)
        else:
            im = Image.open(path).convert("RGBA")
        c = stats(im, name)
        im.save(OUT / f"_ale_{name}.png")
        # crop pattern 3 (bottom edge) and 12
        atlas = pad(im)
        for pat in (3, 12, 1, 8):
            cell = crop_cell(atlas, LINK_CELLS[P2S[pat]])
            cell.save(OUT / f"_ale_{name}_p{pat}.png")

    grass = diamond(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))
    dirt = diamond(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    snow = diamond(Image.open(TILE / "maptexture" / "s01.jpg").convert("RGBA"))
    water = diamond(Image.open(TILE / "water" / "189902.jpg").convert("RGBA"))
    flower = diamond(Image.open(TILE / "maptexture" / "h011.jpg").convert("RGBA"))
    wild = diamond(Image.open(TILE / "maptexture" / "h021.jpg").convert("RGBA"))
    for name, im in [("grass", grass), ("dirt", dirt), ("snow", snow), ("water", water), ("flower", flower), ("wild", wild)]:
        stats(im, "tex " + name)
        im.save(OUT / f"_tex_{name}.png")

    # Compose stamp-ring previews
    def ring(from_d, to_d, ale_name, mode):
        path = TILE / "mask" / f"{ale_name}.ale"
        ale = ale_to_rgba(path.read_bytes(), 0)
        atlas = pad(ale)
        canvas = Image.new("RGBA", (280, 200), (30, 80, 30, 255))
        offsets = {
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
        for (du, dv), pat in offsets.items():
            if pat == 0xF:
                tile = from_d.copy()
            else:
                cell = crop_cell(atlas, LINK_CELLS[P2S[pat]])
                tile = paint_chroma(from_d, to_d, cell, mode)
            x = 140 + (du - dv) * 32 - 32
            y = 100 + (du + dv) * 16 - 16
            canvas.paste(tile, (x, y), tile)
        canvas.save(OUT / f"_ring_{ale_name}_{mode}.png")
        print("wrote", f"_ring_{ale_name}_{mode}.png")

    ring(dirt, grass, "clink014", "green_from")
    ring(water, grass, "wlink014", "green_from")
    ring(water, grass, "wlink014", "overlay")
    ring(snow, grass, "clink013", "green_from")
    ring(snow, grass, "clink013", "overlay")
    ring(water, snow, "slink02", "green_from")
    ring(water, snow, "slink02", "overlay")


if __name__ == "__main__":
    main()
