"""Build lossless UV coverage from the game's exported clothing meshes.

The preview manifest preserves native CMZ UVs. V already runs down the image;
flipping it here would swap front/back islands. Only the clothing slot uses the
user's texture; skin, head and hair belong to different atlases.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/cloth/preview/manifest.json"
OUTPUT = ROOT / "data/cloth/uv-masks"


def mesh_coverage(parts: list[dict], width: int, height: int) -> Image.Image:
    scale = 4
    coverage = Image.new("L", (width * scale, height * scale))
    draw = ImageDraw.Draw(coverage)
    for part in parts:
        if part["slot"] != "cloth":
            continue
        uv, indices = part["uvs"], part["indices"]
        for start in range(0, len(indices), 3):
            points = [(uv[i * 2] * width * scale, uv[i * 2 + 1] * height * scale)
                      for i in indices[start:start + 3]]
            (ax, ay), (bx, by), (cx, cy) = points
            if abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) < 1e-6:
                continue
            draw.polygon(points, fill=255)
    return coverage.resize((width, height), Image.Resampling.BOX).point(lambda p: 255 if p >= 128 else 0)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for kind, info in manifest["kinds"].items():
        mask = Image.new("RGBA", (256, 256), (255, 255, 255, 0))
        mask.putalpha(mesh_coverage(info["body"], 256, 256))
        mask.save(OUTPUT / f"{kind}.png", optimize=True)
        print(f"{kind}: native UV mask 256x256")


if __name__ == "__main__":
    main()
