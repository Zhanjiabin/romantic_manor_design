"""Full-frame locked-UID sprite manifest (schema 2).

Decodes every ALE frame. Does not borrow frames across packs. Writes hashes even
when PNG files are omitted.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from codec.ale import AleError, ale_to_rgba, parse_ale
from game_paths import GAME
from image_to_building.catalog import (
    frame_count,
    frame_geometry,
    iter_locked_components,
    load_json,
    skip_counts,
)
from image_to_building.foot_model import foot_offset_from_image, opaque_bbox_xyxy, opaque_bounds
from image_to_building.hashing import bytes_sha256, file_sha256
from image_to_building.schema import CATEGORIES, FOOT_MODEL_VERSION, SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "editor_catalog.json"
UID_PATH = ROOT / "data" / "building_pack_uids.json"
UID_MAP_PATH = ROOT / "data" / "building_uid_map.json"


def _luminance(r: int, g: int, b: int) -> int:
    return int(round(0.299 * r + 0.587 * g + 0.114 * b))


def near_visual_group(image) -> str:
    rgba = image.convert("RGBA").resize((16, 16))
    bits = 0
    cells = []
    for r, g, b, a in rgba.getdata():
        cells.append(0 if a <= 16 else _luminance(r, g, b))
    mean = sum(cells) / max(1, len(cells))
    for index, value in enumerate(cells):
        if value > mean:
            bits |= 1 << (255 - index)
    return f"nv:{bits:064x}"


def _ale_frame_count(raw: bytes, declared: int) -> int:
    try:
        doc = parse_ale(raw)
    except AleError:
        return max(1, declared)
    parsed = int(doc.get("frames") or 0)
    table = len(doc.get("frameTable") or [])
    return max(1, declared, parsed, table)


def decode_all_frames(ale_path: Path, declared_frames: int) -> tuple[bytes, str, list]:
    raw = ale_path.read_bytes()
    ale_sha = bytes_sha256(raw)
    count = _ale_frame_count(raw, declared_frames)
    frames = []
    for frame in range(count):
        image = ale_to_rgba(raw, frame=frame)
        frames.append(image.convert("RGBA"))
    return raw, ale_sha, frames


def build_equivalence_groups(entries: list[dict]) -> None:
    exact: dict[str, list[str]] = defaultdict(list)
    near: dict[str, list[str]] = defaultdict(list)
    for entry in entries:
        exact[entry["exactPixelGroup"]].append(entry["assetId"])
        near[entry["nearVisualGroup"]].append(entry["assetId"])
    for entry in entries:
        entry["exactPixelSiblings"] = [item for item in exact[entry["exactPixelGroup"]] if item != entry["assetId"]]
        entry["nearVisualSiblings"] = [item for item in near[entry["nearVisualGroup"]] if item != entry["assetId"]]


def build_manifest(
    *,
    limit: int | None = None,
    write_frames: bool = False,
    out_dir: Path | None = None,
    game_root: Path | None = None,
    only: tuple[str, int] | None = None,
) -> dict:
    if not CATALOG_PATH.is_file():
        raise SystemExit(f"missing catalog: {CATALOG_PATH}")
    if not UID_PATH.is_file():
        raise SystemExit(f"missing UID map: {UID_PATH}")
    catalog = load_json(CATALOG_PATH)
    uid_doc = load_json(UID_PATH)
    uid_map = load_json(UID_MAP_PATH) if UID_MAP_PATH.is_file() else {"packs": []}
    mapping = uid_doc.get("mapping") or {}
    if not mapping:
        raise SystemExit("locked UID mapping is empty")
    if uid_doc.get("native", {}).get("frameBorrow") is not False:
        raise SystemExit("native.frameBorrow must stay false")

    game = Path(game_root) if game_root else GAME
    out_dir = Path(out_dir) if out_dir else ROOT / "data" / "image_to_building" / "manifests" / "v2"
    frame_dir = out_dir.parent.parent / "frames"
    alpha_dir = out_dir.parent.parent / "alpha"

    entries: list[dict] = []
    quarantine: list[dict] = []
    missing_files: list[str] = []
    stats = skip_counts(catalog, uid_doc, uid_map)

    for row in iter_locked_components(catalog, uid_doc, uid_map):
        if only and (row["pack"], row["local"]) != only:
            continue
        component = row["component"]
        rel = str((component.get("asset") or {}).get("path") or "")
        ale_path = (game / rel) if rel else None
        if not ale_path or not ale_path.is_file():
            missing_files.append(f"{row['pack']}/{row['file']}")
            quarantine.append(
                {
                    "pack": row["pack"],
                    "local": row["local"],
                    "file": row["file"],
                    "reason": "missing_file",
                }
            )
            continue
        declared = frame_count(component)
        try:
            _raw, ale_sha, images = decode_all_frames(ale_path, declared)
        except Exception as exc:  # noqa: BLE001 — quarantine every decode failure
            quarantine.append(
                {
                    "pack": row["pack"],
                    "local": row["local"],
                    "file": row["file"],
                    "reason": f"decode:{exc}",
                }
            )
            continue
        for frame, image in enumerate(images):
            if image is None or not image.size[0] or not image.size[1]:
                quarantine.append(
                    {
                        "pack": row["pack"],
                        "local": row["local"],
                        "file": row["file"],
                        "frame": frame,
                        "reason": "empty_frame",
                    }
                )
                continue
            geometry = frame_geometry(component, frame)
            opaque = opaque_bounds(image)
            foot = foot_offset_from_image(image, geometry)
            rgba_bytes = image.tobytes()
            rgba_sha = bytes_sha256(rgba_bytes)
            alpha_area = sum(1 for pixel in image.getdata() if pixel[3] > 16)
            asset_id = f"{row['pack']}:{row['local']}:{frame}"
            rgba_rel = f"frames/{row['pack']}/{row['local']}/{frame}.png"
            alpha_rel = f"alpha/{row['pack']}/{row['local']}/{frame}.png"
            if write_frames:
                png_path = frame_dir / row["pack"] / str(row["local"]) / f"{frame}.png"
                png_path.parent.mkdir(parents=True, exist_ok=True)
                image.save(png_path, format="PNG")
                alpha = image.getchannel("A")
                a_path = alpha_dir / row["pack"] / str(row["local"]) / f"{frame}.png"
                a_path.parent.mkdir(parents=True, exist_ok=True)
                alpha.save(a_path, format="PNG")
            if row["category"] not in CATEGORIES:
                quarantine.append(
                    {
                        "pack": row["pack"],
                        "local": row["local"],
                        "file": row["file"],
                        "frame": frame,
                        "reason": f"bad_category:{row['category']}",
                    }
                )
                continue
            entries.append(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "assetId": asset_id,
                    "pack": row["pack"],
                    "uid": row["uid"],
                    "local": row["local"],
                    "canonicalMat": row["mat"],
                    "decodeOnlyAliasMats": [],
                    "category": row["category"],
                    "file": row["file"],
                    "aleSha256": ale_sha,
                    "frame": frame,
                    "width": image.size[0],
                    "height": image.size[1],
                    "catalogWidth": geometry["width"],
                    "catalogHeight": geometry["height"],
                    "anchorX": geometry["anchorX"],
                    "anchorY": geometry["anchorY"],
                    "opaqueBbox": opaque_bbox_xyxy(opaque, image.size[0], image.size[1]),
                    "footOffset": [round(foot[0], 4), round(foot[1], 4)],
                    "alphaArea": alpha_area,
                    "rgbaPath": rgba_rel if write_frames else None,
                    "alphaPath": alpha_rel if write_frames else None,
                    "rgbaSha256": rgba_sha,
                    "exactPixelGroup": f"px:{image.size[0]}x{image.size[1]}:{rgba_sha}",
                    "nearVisualGroup": near_visual_group(image),
                    "legalStates": [frame],
                    "footModelVersion": FOOT_MODEL_VERSION,
                }
            )
            if limit and len(entries) >= limit:
                break
        if limit and len(entries) >= limit:
            break

    build_equivalence_groups(entries)
    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "footModelVersion": FOOT_MODEL_VERSION,
        "uidMappingSha256": file_sha256(UID_PATH),
        "editorCatalogSha256": file_sha256(CATALOG_PATH),
        "gameRoot": str(game),
        "entryCount": len(entries),
        "quarantineCount": len(quarantine),
        "missingFiles": missing_files[:80],
        "frameBorrow": False,
        **stats,
    }
    return {"summary": summary, "entries": entries, "quarantine": quarantine, "outDir": out_dir}


def write_manifest(doc: dict, out_dir: Path | None = None) -> Path:
    out_dir = Path(out_dir or doc["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "manifest.json"
    jsonl_path = out_dir / "manifest.jsonl"
    quarantine_path = out_dir / "quarantine.json"
    summary_path.write_text(json.dumps(doc["summary"], ensure_ascii=False, indent=2), encoding="utf-8")
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for entry in doc["entries"]:
            handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    quarantine_path.write_text(json.dumps(doc["quarantine"], ensure_ascii=False, indent=2), encoding="utf-8")
    return summary_path


def verify_manifest(doc: dict) -> list[str]:
    errors = []
    summary = doc["summary"]
    entries = doc["entries"]
    if summary["entryCount"] != len(entries):
        errors.append("entryCount mismatch")
    if summary.get("frameBorrow") is not False:
        errors.append("frameBorrow must be false")
    seen = set()
    for entry in entries:
        if entry["canonicalMat"] != entry["uid"] * 1000 + entry["local"]:
            errors.append(f"{entry['assetId']} mat mismatch")
        if entry["local"] >= 600:
            errors.append(f"{entry['assetId']} kit local")
        if entry["category"] not in CATEGORIES:
            errors.append(f"{entry['assetId']} bad category")
        if entry["assetId"] in seen:
            errors.append(f"duplicate {entry['assetId']}")
        seen.add(entry["assetId"])
        if entry["width"] <= 0 or entry["height"] <= 0:
            errors.append(f"{entry['assetId']} empty size")
        if len(entry["footOffset"]) != 2:
            errors.append(f"{entry['assetId']} foot")
    if not entries:
        errors.append("manifest is empty")
    return errors
