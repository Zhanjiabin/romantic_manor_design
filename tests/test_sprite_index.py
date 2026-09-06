from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.build_sprite_index import GRAY_SIZE, is_browsable  # noqa: E402

INDEX = ROOT / "data" / "building_sprite_index.json"
UIDS = ROOT / "data" / "building_pack_uids.json"
UID_MAP = ROOT / "data" / "building_uid_map.json"
GOLD = ROOT / "tests" / "fixtures" / "bookshop-layout.json"
BUILD_PAPER = ROOT / ".cursor" / "skills" / "romantic-manor-building-ai" / "scripts" / "build_paper.py"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_sprite_index_fields_and_locked_uids():
    assert INDEX.is_file(), "run python tools/build_sprite_index.py"
    doc = load(INDEX)
    uids = {int(uid): pack for uid, pack in load(UIDS)["mapping"].items()}
    locals_by_pack = {
        pack["pack"]: {int(key) for key in pack.get("mapping", {})}
        for pack in load(UID_MAP)["packs"]
    }
    assert doc["schema"] == 1
    assert doc["graySize"] == GRAY_SIZE
    assert doc["entryCount"] == len(doc["entries"])
    assert doc["entryCount"] > 1000
    categories = {"装饰", "门窗", "地面", "屋顶", "墙壁"}
    for entry in doc["entries"]:
        assert entry["mat"] == entry["uid"] * 1000 + entry["local"]
        assert uids[entry["uid"]] == entry["pack"]
        known = locals_by_pack[entry["pack"]]
        assert entry["local"] in known
        assert entry["local"] < 600
        assert entry["category"] in categories
        assert entry["frame"] in (0, 1)
        assert len(entry["phash"]) == 16
        assert entry["gray"]
        assert len(entry["mean"]) == 3
        assert len(entry["edges"]) == 8


def test_kits_are_not_indexed():
    for entry in load(INDEX)["entries"]:
        assert is_browsable(
            {
                "kind": "sprite",
                "id": entry["local"],
                "category": entry["category"],
                "file": entry["file"],
            }
        )


def test_bookshop_layout_round_trip(tmp_path):
    out = tmp_path / "bookshop.txt"
    result = subprocess.run(
        [sys.executable, str(BUILD_PAPER), "--spec", str(GOLD), "--out", str(out)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["materials"] >= 5
    spec = load(GOLD)
    cats = [row["group"] for row in spec["records"]]
    assert "地面" in cats
    assert "后墙" in cats and "前墙" in cats
    assert "门窗" in cats or "装饰" in cats
    assert not all(group.endswith("墙") for group in cats)
    check = subprocess.run(
        [sys.executable, str(BUILD_PAPER), "--check", str(out)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert check.returncode == 0, check.stderr
    from codec.building import loads_gbk

    paper = loads_gbk(out.read_bytes(), kind="desk")
    mats = [int(row["mat"]) for row in paper["records"]]
    assert 0 not in mats
    assert all(mat >= 1000 for mat in mats)
    assert not all(14000 + 500 <= mat <= 14000 + 599 for mat in mats)
