# -*- coding: utf-8 -*-
"""Native HD billboard ALE (AEX) for GNeonLightObj / GScaleExAle::SaveAni."""
from __future__ import annotations

import io
import json
from pathlib import Path

from codec.ale import AleError, PLAIN_KEY, ale_to_rgba, parse_ale, write_aex

ROOT = Path(__file__).resolve().parents[1]
HIGHLIGHT_PATH = ROOT / "data" / "board_highlight.png"
NATIVE_PATH = ROOT / "data" / "board_native.json"
COLS = 36
ROWS = 24
CELL = 18
DARK = 50
MAX_PAGES = 10
KIND = 3

_highlight = None
_palette_rgb: list[tuple[int, int, int]] | None = None


def _native() -> dict:
    try:
        return json.loads(NATIVE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}


def highlight_image():
    global _highlight
    if _highlight is None:
        from PIL import Image

        if not HIGHLIGHT_PATH.is_file():
            raise AleError("missing data/board_highlight.png")
        _highlight = Image.open(HIGHLIGHT_PATH).convert("RGBA")
    return _highlight


def palette_rgb() -> list[tuple[int, int, int]]:
    global _palette_rgb
    if _palette_rgb is not None:
        return _palette_rgb
    spec = _native().get("palette") or []
    out = []
    for item in spec[:DARK]:
        text = str(item or "").replace("#", "")
        if len(text) == 3:
            text = "".join(ch * 2 for ch in text)
        if len(text) < 6:
            out.append((0, 0, 0))
            continue
        out.append((int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)))
    while len(out) < DARK:
        out.append((0, 0, 0))
    _palette_rgb = out
    return _palette_rgb


def bulb_frame(index: int):
    sheet = highlight_image()
    cols, rows = 5, 11
    cell_w, cell_h = sheet.size[0] // cols, sheet.size[1] // rows
    frame = max(0, min(cols * rows - 1, int(index)))
    col, row = frame % cols, frame // cols
    return sheet.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))


def normalize_page(page) -> list[int]:
    out = [DARK] * (COLS * ROWS)
    src = page or []
    for i in range(min(len(out), len(src))):
        try:
            value = int(src[i])
        except (TypeError, ValueError):
            value = DARK
        if value < 0 or value > DARK:
            value = DARK
        out[i] = value
    return out


GBOX_ALPHA = "".join(
    chr(i + 0x30) if i < 10 else chr(i + 0x37) if i < 0x24 else chr(i + 0x3B)
    for i in range(64)
)
GBOX_INDEX = {ch: i for i, ch in enumerate(GBOX_ALPHA)}


def gbox_itoa(value: int) -> str:
    if int(value) < 0:
        return ""
    number = int(value) & 0xFFFFFFFF
    chars = []
    while True:
        chars.append(GBOX_ALPHA[number & 63])
        number >>= 6
        if number == 0:
            break
    chars.reverse()
    return "".join(chars)


def gbox_atoi(text: str) -> int:
    raw = str(text or "").strip()
    if not raw:
        return -1
    acc = 0
    for ch in raw:
        index = GBOX_INDEX.get(ch)
        if index is None:
            return -1
        acc = (acc << 6) + index
    return acc


def encode_page_clip(page) -> str:
    cells = normalize_page(page)
    parts = []
    for i, frame in enumerate(cells):
        if i:
            parts.append(",")
        if frame >= 0:
            parts.append(gbox_itoa(frame))
    return "".join(parts)


def decode_page_clip(text: str) -> list[int]:
    out = [DARK] * (COLS * ROWS)
    tokens = str(text or "").split(",")
    for i in range(min(len(out), len(tokens))):
        value = gbox_atoi(tokens[i])
        if value < 0 or value > DARK:
            value = DARK
        out[i] = value
    return out


def encode_all_clip(pages) -> str:
    rows = list(pages or [])[:MAX_PAGES] or [[DARK] * (COLS * ROWS)]
    inner = ",".join("'" + encode_page_clip(page) + "'" for page in rows)
    return "(" + inner + ")"


def decode_board_clip(text: str) -> list[list[int]]:
    raw = str(text or "").strip()
    if raw.startswith("(") and raw.endswith(")"):
        inner = raw[1:-1]
        pages = []
        i = 0
        while i < len(inner) and len(pages) < MAX_PAGES:
            while i < len(inner) and inner[i] in " \t":
                i += 1
            if i >= len(inner):
                break
            if inner[i] != "'":
                return [decode_page_clip(raw)]
            j = inner.find("'", i + 1)
            if j < 0:
                break
            pages.append(decode_page_clip(inner[i + 1 : j]))
            i = j + 1
            if i < len(inner) and inner[i] == ",":
                i += 1
        return pages or [decode_page_clip(raw)]
    return [decode_page_clip(raw)]


def compose_page(page) -> "Image.Image":
    from PIL import Image

    cells = normalize_page(page)
    image = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (0, 0, 0, 0))
    cache = {}
    for y in range(ROWS):
        for x in range(COLS):
            frame = cells[y * COLS + x]
            if frame < 0:
                continue
            if frame not in cache:
                sprite = bulb_frame(frame)
                cache[frame] = sprite if sprite.size == (CELL, CELL) else sprite.resize((CELL, CELL))
            image.paste(cache[frame], (x * CELL, y * CELL), cache[frame])
    return image


def _is_dark_page(page: list[int]) -> bool:
    return all(int(value) == DARK for value in page)


def encode_board_ani(pages, *, interval_ms: int = 1000) -> bytes:
    del interval_ms  # native ALE does not store delay; item uses 设置时间.
    frames = [compose_page([DARK] * (COLS * ROWS))]
    source = list(pages or [])[:MAX_PAGES] or [[DARK] * (COLS * ROWS)]
    for page in source:
        frames.append(compose_page(page))
    return write_aex(frames, key=PLAIN_KEY, kind=KIND)


def _cell_size(width: int, height: int) -> tuple[int, int] | None:
    if width < COLS or height < ROWS:
        return None
    if width % COLS or height % ROWS:
        return None
    cell_w, cell_h = width // COLS, height // ROWS
    if cell_w <= 0 or cell_h <= 0:
        return None
    return cell_w, cell_h


def _nearest_frame(r: int, g: int, b: int, a: int) -> int:
    if a < 24:
        return DARK
    palette = palette_rgb()
    dark = (0x75, 0x75, 0x75)
    best = DARK
    dist = (r - dark[0]) ** 2 + (g - dark[1]) ** 2 + (b - dark[2]) ** 2
    for index, (pr, pg, pb) in enumerate(palette):
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < dist:
            dist = d
            best = index
    return best


def quantize_image(image) -> list[int]:
    from PIL import Image

    rgba = image.convert("RGBA")
    cells = _cell_size(*rgba.size)
    page = [DARK] * (COLS * ROWS)
    if cells:
        cell_w, cell_h = cells
        pix = rgba.load()
        for y in range(ROWS):
            for x in range(COLS):
                sample = pix[x * cell_w + cell_w // 2, y * cell_h + cell_h // 2]
                page[y * COLS + x] = _nearest_frame(*sample)
        return page
    small = rgba.resize((COLS, ROWS), Image.BILINEAR)
    pix = small.load()
    for y in range(ROWS):
        for x in range(COLS):
            page[y * COLS + x] = _nearest_frame(*pix[x, y])
    return page


def _pages_from_gif(data: bytes) -> list[list[int]]:
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    pages = []
    index = 0
    while True:
        pages.append(quantize_image(image.convert("RGBA")))
        index += 1
        if index >= MAX_PAGES:
            break
        try:
            image.seek(index)
        except EOFError:
            break
    return pages or [[DARK] * (COLS * ROWS)]


def decode_board_ani(data: bytes) -> dict:
    raw = data or b""
    if raw.startswith(b"GIF8"):
        pages = _pages_from_gif(raw)
        return {"pages": pages, "cols": COLS, "rows": ROWS, "kind": "billboard-hd"}
    if raw[:3] in (b"\xff\xd8\xff", b"\x89PN") or raw.startswith(b"RIFF"):
        from PIL import Image

        image = Image.open(io.BytesIO(raw))
        return {
            "pages": [quantize_image(image)],
            "cols": COLS,
            "rows": ROWS,
            "kind": "billboard-hd",
        }
    doc = parse_ale(raw)
    pages = []
    count = int(doc.get("frames") or 0)
    for index in range(count):
        try:
            frame = ale_to_rgba(raw, frame=index)
        except Exception:
            continue
        pages.append(quantize_image(frame))
        if len(pages) > MAX_PAGES:
            break
    # Native playback uses m_nStart=1 (dummy frame 0) and GetFrameMax()/2-1 pages.
    if len(pages) >= 2:
        if _is_dark_page(pages[0]) or sum(1 for value in pages[0] if int(value) == DARK) >= (COLS * ROWS) * 0.9:
            pages = pages[1:]
    pages = pages[:MAX_PAGES] or [[DARK] * (COLS * ROWS)]
    return {"pages": pages, "cols": COLS, "rows": ROWS, "kind": "billboard-hd"}


def safe_ani_filename(name: str) -> str:
    text = "".join(ch for ch in str(name or "").strip() if ch not in '\\/:*?"<>|')
    text = text.strip(". ") or "高清电子广告牌"
    if not text.lower().endswith(".ale"):
        text += ".ale"
    return text[:80]
