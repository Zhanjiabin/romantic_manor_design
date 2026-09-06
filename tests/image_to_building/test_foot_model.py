from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PIL import Image

from image_to_building.foot_model import compute_foot_offset, foot_offset_from_image, opaque_bounds
from image_to_building.schema import FOOT_MODEL_VERSION


def test_foot_offset_matches_desk_formula():
    assert FOOT_MODEL_VERSION == "desk-stampFootOffset-v1"
    offset = compute_foot_offset({"x": 4, "y": 6, "width": 40, "height": 50}, {"width": 48, "height": 64})
    assert offset == (4 + 40 / 2, 6 + 50 - max(1.0, 50 * 0.08))
    fallback = compute_foot_offset(None, {"width": 20, "height": 30})
    assert fallback == (10.0, 24.0)


def test_opaque_bounds_use_alpha_hit_16():
    image = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    pixels = image.load()
    pixels[2, 3] = (10, 20, 30, 16)
    pixels[4, 5] = (10, 20, 30, 17)
    pixels[7, 8] = (10, 20, 30, 255)
    bounds = opaque_bounds(image)
    assert bounds == {"x": 4, "y": 5, "width": 4, "height": 4}
    foot = foot_offset_from_image(image, {"width": 10, "height": 10})
    assert abs(foot[0] - (4 + 4 / 2)) < 1e-9
    assert abs(foot[1] - (5 + 4 - max(1.0, 4 * 0.08))) < 1e-9
