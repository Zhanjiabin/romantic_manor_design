from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from image_to_building.asset_manifest import build_manifest, verify_manifest, write_manifest
from image_to_building.catalog import is_browsable
from image_to_building.schema import SCHEMA_VERSION
from image_to_building.state_map import build_state_map, resolved_frame

UIDS = ROOT / "data" / "building_pack_uids.json"


def test_manifest_limit_uses_locked_uids_and_all_attempted_frames(tmp_path):
    uids = {int(uid): pack for uid, pack in json.loads(UIDS.read_text(encoding="utf-8"))["mapping"].items()}
    doc = build_manifest(limit=12, write_frames=False, out_dir=tmp_path)
    errors = verify_manifest(doc)
    assert errors == []
    assert doc["summary"]["schemaVersion"] == SCHEMA_VERSION
    assert doc["summary"]["frameBorrow"] is False
    assert doc["summary"]["entryCount"] == len(doc["entries"]) == 12
    frames_by_asset: dict[str, set[int]] = {}
    for entry in doc["entries"]:
        assert entry["canonicalMat"] == entry["uid"] * 1000 + entry["local"]
        assert uids[entry["uid"]] == entry["pack"]
        assert entry["local"] < 600
        assert is_browsable(
            {
                "kind": "sprite",
                "id": entry["local"],
                "category": entry["category"],
                "file": entry["file"],
            }
        )
        assert entry["rgbaSha256"]
        assert entry["exactPixelGroup"].startswith("px:")
        assert len(entry["footOffset"]) == 2
        key = f"{entry['pack']}:{entry['local']}"
        frames_by_asset.setdefault(key, set()).add(entry["frame"])
    write_manifest(doc, tmp_path)
    assert (tmp_path / "manifest.jsonl").is_file()
    again = build_manifest(limit=12, write_frames=False, out_dir=tmp_path)
    first = [row["rgbaSha256"] for row in doc["entries"]]
    second = [row["rgbaSha256"] for row in again["entries"]]
    assert first == second


def test_manifest_decodes_more_than_two_frames_when_ale_has_them(tmp_path):
    from image_to_building.catalog import frame_count, iter_locked_components, load_json

    catalog = load_json(ROOT / "data" / "editor_catalog.json")
    uid_doc = load_json(UIDS)
    uid_map = load_json(ROOT / "data" / "building_uid_map.json")
    multi = None
    for row in iter_locked_components(catalog, uid_doc, uid_map):
        if frame_count(row["component"]) >= 3:
            multi = row
            break
    if multi is None:
        return
    doc = build_manifest(only=(multi["pack"], multi["local"]), write_frames=False, out_dir=tmp_path)
    frames = [entry["frame"] for entry in doc["entries"]]
    assert max(frames, default=-1) >= 2
    assert sorted(set(frames)) == list(range(max(frames) + 1))


def test_state_map_uses_preview_modulo_and_stays_unverified():
    entries = [
        {"pack": "bazaar", "local": 501, "canonicalMat": 14501, "frame": 0, "exactPixelGroup": "px:a"},
        {"pack": "bazaar", "local": 501, "canonicalMat": 14501, "frame": 1, "exactPixelGroup": "px:b"},
        {"pack": "bazaar", "local": 501, "canonicalMat": 14501, "frame": 2, "exactPixelGroup": "px:c"},
    ]
    doc = build_state_map(entries)
    assert doc["verifiedDefault"] is False
    asset = doc["assets"][0]
    assert asset["frameCount"] == 3
    assert asset["verified"] is False
    assert resolved_frame(0, 3) == 0
    assert resolved_frame(3, 3) == 0
    assert resolved_frame(4, 3) == 1
    assert asset["states"]["4"]["resolvedFrame"] == 1
    assert asset["states"]["4"]["visualGroup"] == "px:b"
