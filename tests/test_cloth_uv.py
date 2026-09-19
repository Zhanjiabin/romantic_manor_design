import json
from pathlib import Path

from PIL import Image

from tools.build_cloth_uv_masks import mesh_coverage

ROOT = Path(__file__).resolve().parents[1]


def components(mask):
    width, height = mask.size
    pixels = mask.tobytes()
    seen, areas = set(), []
    for start, value in enumerate(pixels):
        if not value or start in seen:
            continue
        stack, area = [start], 0
        seen.add(start)
        while stack:
            p = stack.pop()
            area += 1
            x, y = p % width, p // width
            for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                n = yy * width + xx
                if 0 <= xx < width and 0 <= yy < height and pixels[n] and n not in seen:
                    seen.add(n)
                    stack.append(n)
        areas.append(area)
    return areas


def test_native_masks_match_clothing_meshes_and_keep_separate_islands():
    manifest = json.loads((ROOT / "data/cloth/preview/manifest.json").read_text())
    expected_islands = {"female-short": 8, "female-long": 9, "female-skirt": 4,
                        "male-short": 6, "male-long": 6}
    for kind, count in expected_islands.items():
        mask = Image.open(ROOT / f"data/cloth/uv-masks/{kind}.png").getchannel("A")
        assert mask.size == (256, 256)
        assert set(mask.tobytes()) == {0, 255}
        assert mask.tobytes() == mesh_coverage(manifest["kinds"][kind]["body"], 256, 256).tobytes()
        islands = components(mask)
        assert len(islands) == count, kind
        assert min(islands) > 100, kind  # No stray JPEG pixels or lines.


def test_short_female_layout_matches_native_front_back_skirt_and_shoes():
    mask = Image.open(ROOT / "data/cloth/uv-masks/female-short.png").getchannel("A")
    for point in [(60, 60), (60, 180), (190, 80), (190, 215), (200, 20), (190, 150), (128, 136), (241, 155)]:
        assert mask.getpixel(point) == 255, point
    for point in [(165, 20), (165, 40), (210, 133), (100, 130), (220, 151), (154, 135)]:
        assert mask.getpixel(point) == 0, point
