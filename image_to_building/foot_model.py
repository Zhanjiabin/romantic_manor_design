"""Desk-compatible sprite foot offset.

Matches ``web/building.js`` ``stampFootOffset`` / ``cacheSpriteOpaqueBounds``:

- opaque pixels have alpha > 16 (``SPRITE_ALPHA_HIT``)
- foot is the bottom-center of the opaque box, raised by 8% of opaque height
"""

from __future__ import annotations

from .schema import ALPHA_HIT, FOOT_MODEL_VERSION


def opaque_bounds(image, alpha_hit: int = ALPHA_HIT) -> dict | None:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.getdata()
    left = width
    top = height
    right = -1
    bottom = -1
    for index, pixel in enumerate(pixels):
        if pixel[3] <= alpha_hit:
            continue
        x = index % width
        y = index // width
        if x < left:
            left = x
        if x > right:
            right = x
        if y < top:
            top = y
        if y > bottom:
            bottom = y
    if right < left or bottom < top:
        return None
    return {
        "x": left,
        "y": top,
        "width": right - left + 1,
        "height": bottom - top + 1,
    }


def compute_foot_offset(opaque: dict | None, geometry: dict | None = None) -> tuple[float, float]:
    if opaque and opaque.get("width", 0) > 1 and opaque.get("height", 0) > 1:
        width = float(opaque["width"])
        height = float(opaque["height"])
        return (
            float(opaque["x"]) + width / 2.0,
            float(opaque["y"]) + height - max(1.0, height * 0.08),
        )
    geometry = geometry or {}
    width = float(geometry.get("width") or 16)
    height = float(geometry.get("height") or 16)
    return width / 2.0, height * 0.8


def foot_offset_from_image(image, geometry: dict | None = None) -> tuple[float, float]:
    return compute_foot_offset(opaque_bounds(image), geometry or {"width": image.size[0], "height": image.size[1]})


def opaque_bbox_xyxy(opaque: dict | None, width: int, height: int) -> list[int]:
    if not opaque:
        return [0, 0, int(width), int(height)]
    return [
        int(opaque["x"]),
        int(opaque["y"]),
        int(opaque["x"] + opaque["width"]),
        int(opaque["y"] + opaque["height"]),
    ]


__all__ = [
    "ALPHA_HIT",
    "FOOT_MODEL_VERSION",
    "compute_foot_offset",
    "foot_offset_from_image",
    "opaque_bbox_xyxy",
    "opaque_bounds",
]
