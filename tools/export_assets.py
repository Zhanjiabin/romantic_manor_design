# -*- coding: utf-8 -*-
"""Export terrain icons + manor portal sprite for the web desk."""
from __future__ import annotations

import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME

from codec.ale import ale_to_rgba, parse_ale

TERRAIN_ALE = GAME / "sourceCode" / "leo" / "rcitem" / "item" / "地形.ale"
# GMapDesign default cmap: MapBtn uses ornament/comm/tocity.ale at pixel (385,339).
TOCITY_ALE = (
    GAME / "sourceCode" / "leo" / "rcex" / "maps" / "ornament" / "comm" / "tocity.ale"
)
OUT = ROOT / "data"
ICON_DIR = OUT / "terrain_frames"
FRAME_W = FRAME_H = 32
ICON_COLS = 10


def crop_frame(im, index: int):
    x = (index % ICON_COLS) * FRAME_W
    y = (index // ICON_COLS) * FRAME_H
    return im.crop((x, y, x + FRAME_W, y + FRAME_H))


def export_terrain_icons():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    raw = TERRAIN_ALE.read_bytes()
    doc = parse_ale(raw)
    frames = max(1, int(doc.get("frames") or 1))
    for i in range(frames):
        ale_to_rgba(raw, i).save(ICON_DIR / ("f%03d.png" % i))
    # Optional sheet for debugging; each cell is one native 32x32 frame.
    from PIL import Image

    cols = ICON_COLS
    rows = (frames + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * FRAME_W, rows * FRAME_H), (0, 0, 0, 0))
    for i in range(frames):
        cell = Image.open(ICON_DIR / ("f%03d.png" % i))
        sheet.paste(cell, ((i % cols) * FRAME_W, (i // cols) * FRAME_H))
    sheet.save(OUT / "terrain_icons.png")
    print("terrain icons", frames, "->", ICON_DIR)


def export_portal():
    if not TOCITY_ALE.is_file():
        raise FileNotFoundError(TOCITY_ALE)
    raw = TOCITY_ALE.read_bytes()
    doc = parse_ale(raw)
    frames = max(1, int(doc.get("frames") or 1))
    table = doc.get("frameTable") or []
    first = ale_to_rgba(raw, 0)
    first.save(OUT / "manor_exit_sign.png")
    print("tocity.ale frame0", first.size, "-> manor_exit_sign.png")
    if frames > 1:
        ale_to_rgba(raw, 1).save(OUT / "manor_exit_sign_1.png")
        print("tocity.ale frame1 -> manor_exit_sign_1.png")
    if table:
        print("tocity anchors", [(f.get("anchorX"), f.get("anchorY")) for f in table[:2]])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    export_terrain_icons()
    export_portal()


if __name__ == "__main__":
    main()
