# -*- coding: utf-8 -*-
"""Offline sand/farmland 2x2 checkerboard blends."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import TILE
OUT = ROOT / "data"
LINK_CELLS = [37, 30, 34, 25, 18, 28, 8, 32, 35, 20, 1, 29, 6, 13, 4, 5, 11, 10]
LINK_PATTERNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 9, 3, 6, 12]


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


def blend(a, b, mask, invert=False, tighten=False):
    out = Image.new("RGBA", (65, 33), (0, 0, 0, 0))
    op, ap, bp, mp = out.load(), a.load(), b.load(), mask.load()
    for y in range(33):
        for p in range(WIDTHS[y]):
            x = SRCX[y] + p
            m = mp[x, y] >> 3
            if invert:
                m = 31 - m
            if tighten:
                if m <= 10:
                    m = 0
                elif m >= 20:
                    m = 31
                else:
                    m = ((m - 10) * 31) // 10
            aa, bb = ap[x, y], bp[x, y]
            if m >= 30:
                pix = aa
            else:
                n = 32 - m
                pix = ((aa[0] * m + bb[0] * n) >> 5, (aa[1] * m + bb[1] * n) >> 5, (aa[2] * m + bb[2] * n) >> 5, 255)
            op[x, y] = pix
    return out


def main():
    dirt = terr(Image.open(TILE / "maptexture" / "120000.jpg").convert("RGBA"))
    sand = terr(Image.open(TILE / "maptexture" / "170200.jpg").convert("RGBA"))
    grass = terr(Image.open(TILE / "maptexture" / "c01.jpg").convert("RGBA"))
    mask = pad(Image.open(TILE / "mask" / "989802.jpg").convert("L"))

    # Checkerboard screen layout: sand top/bottom, dirt left/right in a 2x2 of cells.
    # Approximate with 4 cells at offsets, each with a 2-corner pattern.
    # Top cell sand vs dirt: pattern toward bottom = bits for bottom corners of top cell...
    # Simpler: build 4 tiles with patterns 3,6,9,12 style halves.
    layouts = {
        # uv offset -> (base fill kind sprite, A=sand pattern into dirt) 
        (0, -1): ("sand", 0x3),  # top: sand with bottom edge toward center? use pattern for dirt intrusion
        (0, 1): ("sand", 0xC),
        (-1, 0): ("dirt", 0x6),
        (1, 0): ("dirt", 0x9),
    }
    # Actually for checkerboard full tiles of alternating kinds, interior shared edges:
    # Each adjacent pair shares edge - cells are FULL one kind. Transition only on boundary cells?
    # In corner model, adjacent full sand and full dirt stamps: the neighbor cells of each get edge bits.
    # For display: four full tiles - T sand, B sand, L dirt, R dirt - no mixed cells if each is 0xf of one kind!
    # The soft blend in game appears ON the shared edge BETWEEN tiles - so the edge cells of each stamp's neighborhood write shared corners into BOTH tiles?
    # Actually when you stamp sand then dirt adjacent, the shared cells get mixed corners.
    # For a 2x2 where TL=sand, TR=dirt, BL=dirt, BR=sand (or T/B sand L/R dirt):
    # Looking at game image: top and bottom sand, left and right dirt.
    # So positions: (0,-1)=sand 0xf, (0,1)=sand 0xf, (-1,0)=dirt 0xf, (1,0)=dirt 0xf
    # Soft blend at center would require the CENTER junction cells to be MIXED - but if each of 4 is full 0xf, they'd be hard diamonds meeting with seams!
    # Unless the game blends at draw time based on neighbors, OR the 4 cells themselves have mixed corners from overlapping stamp writes.
    # With stamp size 1, each stamp writes center 0xf and neighbors partial. So two adjacent stamps:
    # Sand at (0,-1), dirt at (-1,0): both write into various cells.
    # The cell at (0,0) if empty gets nothing from centers... wait centers are the stamped cells.
    # Stamp sand at logical (0,-1): writes (0,-1)=0xf sand
    # Stamp dirt at (-1,0): writes (-1,0)=0xf dirt
    # They also write edge bits to neighbors including toward (0,0).
    # So (0,0) might get bits from both if it's a neighbor of both - for radius 0, neighbors of (0,-1) include (0,0) with mask 0x3 (bottom of above? writeCorners(u, v+1, 0x3) for stamp at u,v).
    # Stamp at (0,-1): write (0,0) with 0x3 (top corners of (0,0) = sand)
    # Stamp at (-1,0): write (0,0) with 0x6? write (u+r+1, vv)=(0,0) with 0x9 for stamp at (-1,0)... 
    # From replayNativeStamp stamp (u,v)=(-1,0): writeCorners(u+1, v, 0x9) = (0,0) with 0x9
    # So (0,0) has sand bits 0x3 and dirt bits 0x9 = mixed pattern 0xB - three corners! Goes to corner covers or two-way if only 2 kinds.
    # bits 0x3|0x9 = 0xB = 1011 - corners 0,1,3 = three corners - if two are sand and one dirt or vice versa depending on which bits.

    modes = [
        ("raw", False, False),
        ("inv", True, False),
        ("inv_tight", True, True),
        ("raw_tight", False, True),
    ]
    for name, inv, tight in modes:
        canvas = Image.new("RGBA", (280, 200), (40, 100, 40, 255))
        # grass under
        for du in range(-2, 3):
            for dv in range(-2, 3):
                canvas.paste(grass, (140 + (du - dv) * 32 - 32, 100 + (du + dv) * 16 - 16), grass)
        # four full tiles
        tiles = {
            (0, -1): sand,
            (0, 1): sand,
            (-1, 0): dirt,
            (1, 0): dirt,
        }
        for (du, dv), spr in tiles.items():
            canvas.paste(spr, (140 + (du - dv) * 32 - 32, 100 + (du + dv) * 16 - 16), spr)
        # center cross cells with edge blends - simulate mixed cells at junctions
        # Mid-edge between top sand and left dirt: cell roughly (-0.5?) use patterns
        # Put blended overlays at the four mid-edges and center using patterns
        edge = [
            ((0, 0), 0x6, sand, dirt),  # center-ish: sand bits vs dirt - try pattern 6
            ((0, 0), 0x9, dirt, sand),
        ]
        # Better: one center tile with pattern 0x5 (diagonal) sand vs dirt
        m = crop_mask(mask, LINK_CELLS[P2S[5]])  # pattern 5 = 0101 diagonal
        blended = blend(sand, dirt, m, inv, tight)
        canvas.paste(blended, (140 - 32, 100 - 16), blended)
        # Also edge patterns 3 and 12 between T-B and L-R
        for pat, pos, a, b in [
            (3, (0, 0), sand, dirt),
            (12, (0, 0), dirt, sand),
        ]:
            pass
        path = OUT / f"_soil_{name}.png"
        canvas.save(path)
        print("wrote", path.name)

    # Cleaner: 2x2 of MIXED edge tiles only forming soft cross like the game
    for name, inv, tight in modes:
        canvas = Image.new("RGBA", (280, 200), (40, 100, 40, 255))
        for du in range(-2, 3):
            for dv in range(-2, 3):
                canvas.paste(grass, (140 + (du - dv) * 32 - 32, 100 + (du + dv) * 16 - 16), grass)
        # Top: mostly sand, bottom edge dirt → pattern for dirt = 0x3 (bottom)
        # Actually game top cell is sand - full. Softness is IN the adjacent meeting.
        # Recreate with four FULL tiles + four edge-blend overlays is wrong.
        # Instead each of 4 cells is full kind; soft look comes from shared EDGE cells that are the midpoints.
        # In iso 2x2 of diamonds, they share edges - the blend is within each diamond near the shared edge if corners differ.
        # For FULL 0xf tiles of different kinds, corners are uniform - NO blend inside tile, hard edge between diamonds!
        # So soft game blend means the cells are NOT uniform 0xf - they have mixed corners from overlapping stamps.
        # Model: T cell corners all sand; but wait...
        # If stamps only write their centers as 0xf and neighbors get edge bits, then:
        # Sand stamp at T: T is 0xf sand. Dirt stamp at L: L is 0xf dirt.
        # Cell between them on the shared edge - there is no separate cell; T's SW corner and L's NE corner are adjacent in screen space.
        # Soft blend in game across the shared edge means either sub-tile blending OR the visual is just texture similarity.
        # Looking at game screenshot description again: "soft cross-shaped gradient in the center" - the CENTER where four tiles meet has soft blend. That implies the four tiles' INNER corners are blending - so each tile's inner corner might still be its own color with soft mask toward neighbors via 989802 on a HIGHER level, OR each of the four tiles has mixed corners.
        #
        # When you place 4 stamps in checkerboard, the CENTER of the 2x2 isn't a fifth cell - the four cells meet at a point. Soft X means each tile blends toward neighbors at its inward edges.
        # That requires each of the 4 tiles to NOT be pure 0xf - they need neighbor influence.
        # replayNativeStamp for adjacent stamps: later stamp overwrites shared EDGE neighbor cells, but the STAMP CENTER cells stay 0xf of their kind.
        # So T stays pure sand, L stays pure dirt - hard edge between T and L diamonds!
        # Unless... drawing uses neighbor-aware blending beyond corner storage? Or stamp size causes overlap of 0xf regions? radius 0 only one cell 0xf.
        # OR the "soft blend" in the game screenshot is just 989802 on cells that have 2-corner patterns along a diagonal of a larger paint.
        #
        # Re-read game image: 2x2 with stone ring around ALL four - so outer edge is grass transition with pebbles. Interior sand/soil meet with soft blend.
        # For interior meeting of full cells, GBox might blend at render using adjacent tile types even for 0xf cells - we don't do that.
        # OR placing them writes into each other: when dirt is stamped next to sand, does PaintTileEx modify the sand cell's corners?
        # From disasm: writes to center 0xf and neighbors with edge bits - does NOT modify already-painted neighbor centers' full bits from a new adjacent stamp... 
        # writeCorners(u+offset, v+offset) for interior - only the stamp's interior.
        # Neighbor sand cell at (0,-1) when we stamp dirt at (-1,0): is (0,-1) a neighbor of (-1,0)?
        # Neighbors of (-1,0): (u-1,v)=(-2,0), (u+1,v)=(0,0), (u,v-1)=(-1,-1), (u,v+1)=(-1,1), and diagonals.
        # (0,-1) is diagonal: writeCorners(u+r+1, v-r-1)= (0,-1) with 0x8!
        # So stamping dirt at (-1,0) writes ONE corner of the sand cell (0,-1) to dirt! That turns pure sand into mixed 1-corner dirt - soft blend via 989802 on the sand cell!
        # That's the mechanism! Adjacent different stamps contaminate one corner of each other → soft blend.

        # Simulate: T sand 0xf, then dirt stamp at L contaminates T with one corner → pattern 1 or 8 etc.
        configs = [
            ((0, -1), sand, dirt, 1),   # top sand with 1 dirt corner
            ((0, 1), sand, dirt, 4),
            ((-1, 0), dirt, sand, 2),
            ((1, 0), dirt, sand, 8),
        ]
        for (du, dv), base, other, pat in configs:
            m = crop_mask(mask, LINK_CELLS[P2S[pat]])
            # A = other (intruding), B = base
            tile = blend(other, base, m, inv, tight)
            canvas.paste(tile, (140 + (du - dv) * 32 - 32, 100 + (du + dv) * 16 - 16), tile)
        path = OUT / f"_check_{name}.png"
        canvas.save(path)
        print("wrote", path.name)


if __name__ == "__main__":
    main()
