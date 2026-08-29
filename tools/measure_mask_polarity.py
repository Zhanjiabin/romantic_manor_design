# -*- coding: utf-8 -*-
"""Measure 989802 polarity vs LINK_PATTERNS and render dirt-on-sand previews."""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import TILE
OUT = ROOT / "data"
LINK_CELLS = [37, 30, 34, 25, 18, 28, 8, 32, 35, 20, 1, 29, 6, 13, 4, 5, 11, 10]
LINK_PATTERNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 9, 3, 6, 12]
# Iso diamond corners: 0 top, 1 right, 2 bottom, 3 left
CORNER_XY = [(32, 4), (58, 16), (32, 28), (6, 16)]
STAMP_EDGE = {
    (0, -1): 0x3,
    (0, 1): 0xC,
    (-1, 0): 0x9,
    (1, 0): 0x6,
    (-1, -1): 0x1,
    (1, 1): 0x4,
    (1, -1): 0x2,
    (-1, 1): 0x8,
}


def iso():
    widths = [0] * 33
    v, i, j = 1, 0, 32
    while v < 0x45:
        widths[i] = v
        widths[j] = v
        v += 4
        i += 1
        j -= 1
    return widths, [32 - (w >> 1) for w in widths]


WIDTHS, SRCX = iso()
P2S = {}
for i, p in enumerate(LINK_PATTERNS):
    P2S.setdefault(p, i)


def pad(im, fill=0):
    mode = "L" if im.mode == "L" else "RGBA"
    fill = 0 if mode == "L" else (0, 0, 0, 0)
    c = Image.new(mode, (im.size[0] + 64, im.size[1] + 64), fill)
    c.paste(im, (32, 32))
    return c


def crop_mask(atlas, cell):
    row = cell // 3
    sx = 64 * (cell % 3) - (32 if row & 1 else 0)
    sy = 16 * row
    out = Image.new("L", (65, 33), 0)
    op, ap = out.load(), atlas.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[sx + 32 + SRCX[y] + p, sy + 32 + y]
    return out


def terr(tex):
    at = pad(tex)
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap = out.load(), at.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            op[SRCX[y] + p, y] = ap[32 + SRCX[y] + p, 32 + y]
    return out


def corner_mean(mask, cx, cy, rad=4):
    mp = mask.load()
    acc, n = 0, 0
    for y in range(max(0, cy - rad), min(33, cy + rad + 1)):
        for x in range(max(0, cx - rad), min(65, cx + rad + 1)):
            ox = SRCX[y]
            if x < ox or x >= ox + WIDTHS[y]:
                continue
            acc += mp[x, y]
            n += 1
    return acc / n if n else 0


def blend(a, b, mask, invert=False):
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap, bp, mp = out.load(), a.load(), b.load(), mask.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            m = mp[x, y] >> 3
            if invert:
                m = 31 - m
            aa, bb = ap[x, y], bp[x, y]
            if m >= 30:
                pix = aa
            else:
                n = 32 - m
                pix = (
                    (aa[0] * m + bb[0] * n) >> 5,
                    (aa[1] * m + bb[1] * n) >> 5,
                    (aa[2] * m + bb[2] * n) >> 5,
                    255,
                )
            op[x, y] = pix
    return out


def replay(stamps):
    cells = defaultdict(lambda: [None, None, None, None])
    for (u, v), kind in stamps:
        radius = 0
        writes = [
            (u - 1, v - 1, 0x4),
            (u + 1, v + 1, 0x1),
            (u + 1, v - 1, 0x8),
            (u - 1, v + 1, 0x2),
            (u - 1, v, 0x6),
            (u, v - 1, 0xC),
            (u, v, 0xF),
            (u + 1, v, 0x9),
            (u, v + 1, 0x3),
        ]
        for uu, vv, mask in writes:
            c = cells[(uu, vv)]
            for i in range(4):
                if mask & (1 << i):
                    c[i] = kind
    return cells


def pattern_of(corners, kind):
    p = 0
    for i, c in enumerate(corners):
        if c == kind:
            p |= 1 << i
    return p


def main():
    OUT.mkdir(exist_ok=True)
    mask_atlas = pad(Image.open(TILE / "mask" / "989802.jpg").convert("L"))
    dirt = terr(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    sand = terr(Image.open(TILE / "maptexture" / "170200.jpg").convert("RGBA"))
    sprites = {"dirt": dirt, "sand": sand}

    lines = ["pattern slot cell | c0 c1 c2 c3 | pat_mean opp_mean | dark_on_pat"]
    sheet = Image.new("RGB", (16 * 70, 80), (40, 40, 40))
    for pat in range(1, 15):
        slot = P2S[pat]
        cell = LINK_CELLS[slot]
        m = crop_mask(mask_atlas, cell)
        means = [corner_mean(m, *xy) for xy in CORNER_XY]
        pat_ids = [i for i in range(4) if pat & (1 << i)]
        opp_ids = [i for i in range(4) if not (pat & (1 << i))]
        pat_m = sum(means[i] for i in pat_ids) / len(pat_ids)
        opp_m = sum(means[i] for i in opp_ids) / len(opp_ids) if opp_ids else 0
        dark = pat_m < opp_m
        lines.append(
            f"{pat:2d} {slot:2d} {cell:2d} | "
            + " ".join(f"{v:5.1f}" for v in means)
            + f" | {pat_m:5.1f} {opp_m:5.1f} | {dark}"
        )
        vis = m.convert("RGB").resize((65, 33), Image.NEAREST)
        sheet.paste(vis, ((pat - 1) * 70, 8))
    (OUT / "_mask_polarity.txt").write_text("\n".join(lines), encoding="utf-8")
    sheet.save(OUT / "_mask_cells_gray.png")
    print("\n".join(lines))

    # Isolated dirt stamp on a sand field, then a 4x3 dirt rect on sand.
    sand_field = [((u, v), "sand") for u in range(-4, 5) for v in range(-4, 5)]
    one = sand_field + [((0, 0), "dirt")]
    rect = sand_field + [((u, v), "dirt") for u in range(0, 4) for v in range(0, 3)]

    modes = [
        ("raw_Afrom", False, True),
        ("inv_Afrom", True, True),
        ("raw_Ato", False, False),
        ("inv_Ato", True, False),
    ]
    for name, stamps in [("one", one), ("rect", rect)]:
        cells = replay(stamps)
        for mode, invert, a_is_from in modes:
            canvas = Image.new("RGBA", (420, 280), (40, 100, 40, 255))
            items = []
            for (u, v), corners in cells.items():
                kinds = {c for c in corners if c}
                if not kinds:
                    continue
                if len(kinds) == 1:
                    spr = sprites[next(iter(kinds))].copy()
                else:
                    ranked = sorted(kinds, key=lambda k: (-corners.count(k), k))
                    from_k, to_k = ranked[0], ranked[1]
                    pat = pattern_of(corners, from_k)
                    if not pat or pat == 0xF or pat not in P2S:
                        spr = sprites[from_k].copy()
                    else:
                        mw = crop_mask(mask_atlas, LINK_CELLS[P2S[pat]])
                        a = sprites[from_k] if a_is_from else sprites[to_k]
                        b = sprites[to_k] if a_is_from else sprites[from_k]
                        spr = blend(a, b, mw, invert)
                x = 210 + (u - v) * 32 - 32
                y = 140 + (u + v) * 16 - 16
                items.append((u + v, u - v, x, y, spr, len(kinds) > 1))
            # match editor: solid first, mixed last
            items.sort(key=lambda t: (1 if t[5] else 0, t[0], t[1]))
            for *_, x, y, spr, _m in items:
                canvas.paste(spr, (x, y), spr)
            path = OUT / f"_gg_{name}_{mode}.png"
            canvas.save(path)
            print("wrote", path.name)


if __name__ == "__main__":
    main()
