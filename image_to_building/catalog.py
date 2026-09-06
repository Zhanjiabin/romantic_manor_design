"""Locked-UID browsable sprites. Missing locals stay missing."""

from __future__ import annotations

import json
import re
from pathlib import Path

HIDDEN_FILE = re.compile(r"^try\d+$", re.I)


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


def locked_uid_by_pack(uid_doc: dict) -> dict[str, int]:
    mapping = uid_doc.get("mapping") or {}
    return {str(pack): int(uid) for uid, pack in mapping.items()}


def locals_for_pack(uid_map: dict, pack_key: str) -> set[int]:
    for pack in uid_map.get("packs") or []:
        if pack.get("pack") == pack_key:
            return {int(key) for key in (pack.get("mapping") or {})}
    return set()


def frame_count(component: dict) -> int:
    asset = component.get("asset") or {}
    table = asset.get("frameTable") or []
    declared = int(asset.get("frames") or 0)
    return max(1, declared, len(table))


def frame_geometry(component: dict, frame: int) -> dict:
    table = ((component.get("asset") or {}).get("frameTable")) or []
    if 0 <= frame < len(table):
        row = table[frame]
        return {
            "width": int(row.get("width") or component.get("asset", {}).get("width") or 16),
            "height": int(row.get("height") or component.get("asset", {}).get("height") or 16),
            "anchorX": int(row.get("anchorX") or 0),
            "anchorY": int(row.get("anchorY") or 0),
            "valueA": int(row.get("valueA") or 0),
            "valueB": int(row.get("valueB") or 0),
        }
    asset = component.get("asset") or {}
    return {
        "width": int(asset.get("width") or 16),
        "height": int(asset.get("height") or 16),
        "anchorX": 0,
        "anchorY": 0,
        "valueA": 0,
        "valueB": 0,
    }


def iter_locked_components(catalog: dict, uid_doc: dict, uid_map: dict | None = None):
    mapping = locked_uid_by_pack(uid_doc)
    for pack in catalog.get("building", {}).get("packs") or []:
        key = str(pack.get("key") or "")
        uid = mapping.get(key)
        if uid is None:
            continue
        known_locals = locals_for_pack(uid_map or {}, key)
        for component in pack.get("components") or []:
            if not is_browsable(component):
                continue
            local = int(component.get("id") or 0)
            if known_locals and local not in known_locals:
                continue
            yield {
                "pack": key,
                "uid": uid,
                "local": local,
                "mat": uid * 1000 + local,
                "category": component.get("category") or "装饰",
                "file": component.get("file"),
                "component": component,
            }


def skip_counts(catalog: dict, uid_doc: dict, uid_map: dict | None = None) -> dict[str, int]:
    mapping = locked_uid_by_pack(uid_doc)
    skipped_unmapped = 0
    skipped_missing_local = 0
    for pack in catalog.get("building", {}).get("packs") or []:
        key = str(pack.get("key") or "")
        uid = mapping.get(key)
        if uid is None:
            skipped_unmapped += 1
            continue
        known_locals = locals_for_pack(uid_map or {}, key)
        for component in pack.get("components") or []:
            if not is_browsable(component):
                continue
            local = int(component.get("id") or 0)
            if known_locals and local not in known_locals:
                skipped_missing_local += 1
    return {
        "skippedUnmappedPacks": skipped_unmapped,
        "skippedMissingLocal": skipped_missing_local,
    }
