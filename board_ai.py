# -*- coding: utf-8 -*-
"""OpenRouterX image models for the HD billboard desk. Reuses cloth_ai image routes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from cloth_ai import (
    ClothAiError,
    generate_image,
    list_image_models,
    public_error,
)

ROOT = Path(__file__).resolve().parent
PROMPTS_PATH = ROOT / "data" / "board_ai_prompts.json"
REFS_PATH = ROOT / "data" / "board_ai_refs.json"
REF_DIR = ROOT / "data" / "board" / "refs"
KIND = "billboard-hd"
AI_SIZE = (720, 480)
COLS = 36
ROWS = 24
DARK = 50
REF_BG = (12, 14, 18)


def load_builtin_prompts() -> list[dict]:
    try:
        raw = PROMPTS_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("templates") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out = []
    for row in items:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("id") or "").strip()
        kind = str(row.get("kind") or KIND).strip() or KIND
        prompt = str(row.get("prompt") or "").strip()
        if not ident or not prompt:
            continue
        out.append({
            "id": ident,
            "kind": kind,
            "name": str(row.get("name") or ident),
            "prompt": prompt,
            "builtin": True,
        })
    return out


def _rect(page: list[int], x: int, y: int, w: int, h: int, color: int) -> None:
    for yy in range(max(0, y), min(ROWS, y + h)):
        for xx in range(max(0, x), min(COLS, x + w)):
            page[yy * COLS + xx] = color


def _disk(page: list[int], cx: int, cy: int, radius: int, color: int) -> None:
    rr = radius * radius
    for yy in range(max(0, cy - radius), min(ROWS, cy + radius + 1)):
        for xx in range(max(0, cx - radius), min(COLS, cx + radius + 1)):
            if (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= rr:
                page[yy * COLS + xx] = color


def _blank(fill: int = DARK) -> list[int]:
    return [fill] * (COLS * ROWS)


def builtin_ref_pages() -> list[dict]:
    sun = _blank()
    _rect(sun, 0, 0, COLS, 16, DARK)
    _disk(sun, 18, 7, 4, 7)
    _disk(sun, 10, 20, 9, 21)
    _disk(sun, 26, 21, 8, 16)
    _rect(sun, 0, 21, COLS, 3, 42)

    shop = _blank()
    _rect(shop, 2, 2, 32, 8, 2)
    _rect(shop, 2, 2, 32, 1, 12)
    _rect(shop, 2, 9, 32, 1, 12)
    _rect(shop, 2, 2, 1, 8, 12)
    _rect(shop, 33, 2, 1, 8, 12)
    _rect(shop, 4, 11, 28, 12, 21)
    _rect(shop, 15, 14, 6, 9, 16)
    _disk(shop, 7, 12, 1, 12)
    _disk(shop, 28, 12, 1, 12)

    festival = _blank()
    _disk(festival, 18, 11, 5, 2)
    _rect(festival, 17, 5, 2, 3, 12)
    _disk(festival, 8, 6, 2, 12)
    _disk(festival, 28, 7, 2, 12)
    _rect(festival, 0, 21, COLS, 3, 21)

    bird = _blank(27)
    _rect(bird, 0, 18, COLS, 6, 21)
    _disk(bird, 16, 12, 4, 12)
    _disk(bird, 12, 12, 2, 7)
    _rect(bird, 20, 12, 3, 2, 7)
    bird[11 * COLS + 18] = 45

    neon = _blank()
    for x in range(4, 33):
        y = 14 - int(5 * ((x - 18) / 14) ** 2)
        _rect(neon, x, y, 1, 2, 42)
    _disk(neon, 10, 8, 3, 27)
    neon[8 * COLS + 10] = DARK
    neon[7 * COLS + 10] = 27
    neon[9 * COLS + 10] = 27
    neon[8 * COLS + 9] = 27
    neon[8 * COLS + 11] = 27
    _disk(neon, 26, 16, 2, 12)
    _disk(neon, 31, 18, 1, 12)

    return [
        {
            "id": "sun-hills",
            "name": "太阳小山",
            "file": "sun-hills.png",
            "promptId": "builtin:billboard-hd:default",
            "page": sun,
        },
        {
            "id": "shop-sign",
            "name": "店铺招牌",
            "file": "shop-sign.png",
            "promptId": "builtin:billboard-hd:shop",
            "page": shop,
        },
        {
            "id": "festival-lantern",
            "name": "节日灯笼",
            "file": "festival-lantern.png",
            "promptId": "builtin:billboard-hd:festival",
            "page": festival,
        },
        {
            "id": "pixel-bird",
            "name": "像素小鸟",
            "file": "pixel-bird.png",
            "promptId": "builtin:billboard-hd:pixel",
            "page": bird,
        },
        {
            "id": "neon-night",
            "name": "夜市霓虹",
            "file": "neon-night.png",
            "promptId": "builtin:billboard-hd:neon",
            "page": neon,
        },
    ]


def render_ref_image(page: list[int]):
    from PIL import Image

    from codec.board_ani import palette_rgb

    rgb = palette_rgb()
    image = Image.new("RGB", (COLS, ROWS), REF_BG)
    pixels = image.load()
    src = page or []
    for y in range(ROWS):
        for x in range(COLS):
            index = y * COLS + x
            frame = int(src[index]) if index < len(src) else DARK
            if 0 <= frame < len(rgb):
                pixels[x, y] = rgb[frame]
            else:
                pixels[x, y] = REF_BG
    return image.resize(AI_SIZE, Image.Resampling.NEAREST)


def write_builtin_ref_images() -> list[dict]:
    REF_DIR.mkdir(parents=True, exist_ok=True)
    catalog = []
    for row in builtin_ref_pages():
        image = render_ref_image(row["page"])
        dest = REF_DIR / row["file"]
        image.save(dest, format="PNG", optimize=True)
        catalog.append({
            "id": row["id"],
            "name": row["name"],
            "file": row["file"],
            "url": f"/data/board/refs/{row['file']}",
            "promptId": row["promptId"],
            "kind": KIND,
        })
    REFS_PATH.write_text(
        json.dumps({"v": 1, "kind": KIND, "templates": catalog}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return catalog


def load_builtin_refs() -> list[dict]:
    try:
        raw = REFS_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    items = data.get("templates") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out = []
    for row in items:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("id") or "").strip()
        name = str(row.get("name") or ident).strip()
        file_name = str(row.get("file") or "").strip()
        if not ident or not file_name:
            continue
        url = str(row.get("url") or f"/data/board/refs/{file_name}").strip()
        out.append({
            "id": ident,
            "name": name or ident,
            "file": file_name,
            "url": url,
            "promptId": str(row.get("promptId") or ""),
            "kind": str(row.get("kind") or KIND),
        })
    return out


def generate_board_image(
    *,
    api_key: str,
    model: str,
    prompt: str,
    reference_png: str | None = None,
    mask_png: str | None = None,
    base_url: str | None = None,
    **_: Any,
) -> str:
    return generate_image(
        api_key=api_key,
        model=model,
        prompt=prompt,
        kind=KIND,
        width=AI_SIZE[0],
        height=AI_SIZE[1],
        reference_png=reference_png,
        mask_png=mask_png,
        uv_map_png=None,
        use_uv_map=False,
        base_url=base_url,
    )


__all__ = [
    "AI_SIZE",
    "ClothAiError",
    "KIND",
    "generate_board_image",
    "list_image_models",
    "load_builtin_prompts",
    "load_builtin_refs",
    "builtin_ref_pages",
    "public_error",
    "render_ref_image",
    "write_builtin_ref_images",
]
