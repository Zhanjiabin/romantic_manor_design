# -*- coding: utf-8 -*-
"""Rasterize the design-desk favicon for browsers that still want ICO/PNG."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def _rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def render_icon(size: int, *, rounded: bool = True) -> Image.Image:
    scale = max(8, size * 4)
    img = Image.new("RGBA", (scale, scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(scale):
        t = y / max(1, scale - 1)
        r = round(90 + (22 - 90) * t)
        g = round(170 + (61 - 170) * t)
        b = round(120 + (44 - 120) * t)
        draw.line((0, y, scale, y), fill=(r, g, b, 255))
    if rounded:
        mask = _rounded_mask(scale, max(8, round(scale * 0.25)))
        img.putalpha(mask)
    glow = Image.new("RGBA", (scale, scale), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (-scale * 0.15, -scale * 0.25, scale * 0.72, scale * 0.62),
        fill=(215, 243, 226, 110),
    )
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)
    s = scale / 32
    roof = [(6.2 * s, 16.6 * s), (16 * s, 8.2 * s), (25.8 * s, 16.6 * s)]
    body = [9.1 * s, 15.5 * s, 22.9 * s, 26.1 * s]
    door = [14.15 * s, 20.35 * s, 17.85 * s, 26.1 * s]
    window = [19.35 * s, 18.2 * s, 21.9 * s, 20.75 * s]
    draw.polygon(roof, fill=(255, 246, 230, 255))
    draw.rectangle(body, fill=(255, 253, 248, 255))
    draw.rectangle(door, fill=(36, 94, 68, 255))
    draw.rounded_rectangle(window, radius=max(1, round(0.45 * s)), fill=(243, 207, 99, 255))
    out = img.resize((size, size), Image.Resampling.LANCZOS)
    if rounded:
        mask = _rounded_mask(size, max(2, round(size * 0.25)))
        out.putalpha(mask)
    return out


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    render_icon(32).save(WEB / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    render_icon(180, rounded=False).save(WEB / "apple-touch-icon.png", format="PNG")
    print("wrote", WEB / "favicon.ico")
    print("wrote", WEB / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
