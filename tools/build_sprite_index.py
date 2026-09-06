#!/usr/bin/env python3
"""Build a compact building-sprite fingerprint index for image-to-building.

Only browsable sprites with a locked pack UID are recorded. Missing locals stay
missing (no cross-pack frame borrow). Pixel decode uses codec.ale.dumps_png
with crop=False, trim=True — the same path as the desk ``&thumb=1`` endpoint.

The JSON stores a 16x16 gray patch plus an 8x8 average-hash computed from that
patch. The 16x16 itself is downsampled from a 64x64 luminance image so the
fingerprint matches the plan without shipping 64x64 blobs.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from game_paths import GAME  # noqa: E402

OUT_DEFAULT = ROOT / "data" / "building_sprite_index.json"
CATALOG_PATH = ROOT / "data" / "editor_catalog.json"
UID_PATH = ROOT / "data" / "building_pack_uids.json"
UID_MAP_PATH = ROOT / "data" / "building_uid_map.json"

HIDDEN_FILE = re.compile(r"^try\d+$", re.I)
GRAY_SIZE = 16
PHASH_SIZE = 8
SOURCE_SIZE = 64


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def is_browsable(component: dict) -> bool:
    if not component or component.get("kind") != "sprite":
        return False
    if component.get("category") in {"套件", "自定义"}:
        return False
    if int(component.get("id") or 0) >= 600:
        return False
    stem = str(component.get("file") or "").lower().replace(".ale", "")
    return not HIDDEN_FILE.match(stem)


def luminance(r: int, g: int, b: int) -> int:
    return int(round(0.299 * r + 0.587 * g + 0.114 * b))


def gray16_from_image(image) -> bytes:
    rgba = image.convert("RGBA").resize((SOURCE_SIZE, SOURCE_SIZE))
    small = rgba.resize((GRAY_SIZE, GRAY_SIZE))
    out = bytearray(GRAY_SIZE * GRAY_SIZE)
    for index, pixel in enumerate(small.getdata()):
        r, g, b, a = pixel
        out[index] = 0 if a < 16 else luminance(r, g, b)
    return bytes(out)


def phash_from_gray16(gray: bytes) -> str:
    cells = []
    for y in range(PHASH_SIZE):
        for x in range(PHASH_SIZE):
            total = 0
            for dy in range(2):
                for dx in range(2):
                    total += gray[(y * 2 + dy) * GRAY_SIZE + (x * 2 + dx)]
            cells.append(total / 4)
    mean = sum(cells) / len(cells)
    bits = 0
    for index, value in enumerate(cells):
        if value > mean:
            bits |= 1 << (63 - index)
    return f"{bits:016x}"


def mean_rgb(image) -> list[int]:
    pixels = image.convert("RGBA").getdata()
    total = [0, 0, 0]
    count = 0
    for r, g, b, a in pixels:
        if a < 40:
            continue
        total[0] += r
        total[1] += g
        total[2] += b
        count += 1
    if not count:
        return [0, 0, 0]
    return [int(round(channel / count)) for channel in total]


def edge_histogram(gray: bytes) -> list[int]:
    bins = [0] * 8
    size = GRAY_SIZE
    for y in range(1, size - 1):
        for x in range(1, size - 1):
            right = gray[y * size + x + 1]
            left = gray[y * size + x - 1]
            down = gray[(y + 1) * size + x]
            up = gray[(y - 1) * size + x]
            gx = right - left
            gy = down - up
            if gx == 0 and gy == 0:
                continue
            angle = (math.atan2(gy, gx) + math.pi) / (2 * math.pi)
            bins[min(7, int(angle * 8))] += 1
    return bins


def fingerprint_image(image) -> dict:
    gray = gray16_from_image(image)
    return {
        "phash": phash_from_gray16(gray),
        "gray": base64.b64encode(gray).decode("ascii"),
        "mean": mean_rgb(image),
        "edges": edge_histogram(gray),
    }


def locals_for_pack(uid_map: dict, pack_key: str) -> set[int]:
    for pack in uid_map.get("packs") or []:
        if pack.get("pack") == pack_key:
            return {int(key) for key in (pack.get("mapping") or {})}
    return set()


def frame_info(component: dict, frame: int) -> dict:
    table = ((component.get("asset") or {}).get("frameTable")) or []
    if 0 <= frame < len(table):
        row = table[frame]
        return {
            "width": int(row.get("width") or component.get("asset", {}).get("width") or 16),
            "height": int(row.get("height") or component.get("asset", {}).get("height") or 16),
            "anchorX": int(row.get("anchorX") or 0),
            "anchorY": int(row.get("anchorY") or 0),
        }
    asset = component.get("asset") or {}
    return {
        "width": int(asset.get("width") or 16),
        "height": int(asset.get("height") or 16),
        "anchorX": 0,
        "anchorY": 0,
    }


def decode_frame(ale_path: Path, frame: int):
    from codec.ale import AleError, ale_to_rgba, trim_opaque

    try:
        image = ale_to_rgba(ale_path.read_bytes(), frame=frame)
    except AleError as exc:
        raise RuntimeError(f"{ale_path}: {exc}") from exc
    return trim_opaque(image, pad=2)


def build_index(limit: int | None = None) -> dict:
    if not CATALOG_PATH.is_file():
        raise SystemExit(f"missing catalog: {CATALOG_PATH}")
    if not UID_PATH.is_file():
        raise SystemExit(f"missing UID map: {UID_PATH}")
    catalog = load_json(CATALOG_PATH)
    uid_doc = load_json(UID_PATH)
    uid_map = load_json(UID_MAP_PATH) if UID_MAP_PATH.is_file() else {"packs": []}
    mapping = {str(pack): int(uid) for uid, pack in (uid_doc.get("mapping") or {}).items()}
    if not mapping:
        raise SystemExit("locked UID mapping is empty")

    missing_files: list[str] = []
    decode_errors: list[str] = []
    entries: list[dict] = []
    skipped_unmapped = 0
    skipped_missing_local = 0

    for pack in catalog.get("building", {}).get("packs") or []:
        key = str(pack.get("key") or "")
        uid = mapping.get(key)
        if uid is None:
            skipped_unmapped += 1
            continue
        known_locals = locals_for_pack(uid_map, key)
        for component in pack.get("components") or []:
            if not is_browsable(component):
                continue
            local = int(component.get("id") or 0)
            if known_locals and local not in known_locals:
                skipped_missing_local += 1
                continue
            rel = str((component.get("asset") or {}).get("path") or "")
            ale_path = (GAME / rel) if rel else None
            if not ale_path or not ale_path.is_file():
                missing_files.append(f"{key}/{component.get('file')}")
                continue
            frames = max(1, int((component.get("asset") or {}).get("frames") or 1))
            face_count = min(2, frames)
            for frame in range(face_count):
                try:
                    image = decode_frame(ale_path, frame)
                except Exception as exc:  # noqa: BLE001 — report and fail later
                    decode_errors.append(f"{key}/{component.get('file')}#f{frame}: {exc}")
                    continue
                if image is None or not getattr(image, "size", (0, 0))[0]:
                    decode_errors.append(f"{key}/{component.get('file')}#f{frame}: empty")
                    continue
                geometry = frame_info(component, frame)
                entry = {
                    "pack": key,
                    "local": local,
                    "uid": uid,
                    "mat": uid * 1000 + local,
                    "category": component.get("category") or "装饰",
                    "file": component.get("file"),
                    "frame": frame,
                    **geometry,
                    **fingerprint_image(image),
                }
                entries.append(entry)
                if len(entries) % 200 == 0:
                    print(f"indexed {len(entries)} frames...", flush=True)
                if limit and len(entries) >= limit:
                    break
            if limit and len(entries) >= limit:
                break
        if limit and len(entries) >= limit:
            break

    if missing_files and not entries:
        sample = "\n".join(missing_files[:12])
        raise SystemExit(
            "no game ALE files decoded. Set MANOR_GAME_ROOT or config.json gameRoot.\n"
            f"GAME={GAME}\n{sample}"
        )
    if not entries:
        raise SystemExit("sprite index is empty — no browsable locked-UID sprites")
    if decode_errors and not any(row.get("phash") for row in entries):
        raise SystemExit("ALE decode produced no fingerprints:\n" + "\n".join(decode_errors[:20]))

    return {
        "schema": 1,
        "graySize": GRAY_SIZE,
        "phashSize": PHASH_SIZE,
        "sourceSize": SOURCE_SIZE,
        "gameRoot": str(GAME),
        "entryCount": len(entries),
        "missingFiles": missing_files,
        "decodeErrors": decode_errors[:40],
        "skippedUnmappedPacks": skipped_unmapped,
        "skippedMissingLocal": skipped_missing_local,
        "entries": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-o", "--output", type=Path, default=OUT_DEFAULT)
    parser.add_argument("--limit", type=int, default=0, help="debug: stop after N entries")
    args = parser.parse_args()
    doc = build_index(limit=args.limit or None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"wrote {args.output} entries={doc['entryCount']} "
        f"missing={len(doc['missingFiles'])} decode_errors={len(doc['decodeErrors'])}"
    )
    if doc["missingFiles"] and not doc["entryCount"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
