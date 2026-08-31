# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from saves import (
    clear_building_papers,
    delete_building_paper,
    delete_terrain_version,
    load_building_bundle,
    load_building_papers,
    load_terrain_bundle,
    save_building_bundle,
    save_building_papers,
    save_terrain_draft,
    save_terrain_version,
    safe_save_id,
)


def test_safe_save_id():
    assert safe_save_id("abc-12_3") == "abc-12_3"
    assert safe_save_id("../etc") is None
    assert safe_save_id("") is None


def test_terrain_and_building_roundtrip():
    tmp = tempfile.mkdtemp(prefix="manor-saves-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        draft = {"id": "a1b2c", "name": "草稿", "savedAt": 10, "stamps": [{"kind": "A", "x": 1, "y": 2}]}
        save_terrain_draft(draft)
        version = {"id": "v-99", "name": "快照", "savedAt": 20, "stamps": []}
        save_terrain_version(version)
        bundle = load_terrain_bundle()
        assert bundle["draft"]["id"] == "v-99"
        assert bundle["versions"][0]["id"] == "v-99"
        assert delete_terrain_version("v-99")
        assert load_terrain_bundle()["versions"] == []

        save_building_bundle({"session": {"v": 1, "records": []}, "customs": {"items": [1], "folders": ["x"]}})
        built = load_building_bundle()
        assert built["session"]["v"] == 1
        assert built["customs"]["folders"] == ["x"]
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_building_paper_library_roundtrip_dedupes_and_deletes():
    tmp = tempfile.mkdtemp(prefix="manor-paper-library-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        paper = {"name": "花园/测试图纸.txt", "data": "VjE7dGVzdA=="}
        assert save_building_papers([paper]) == 1
        first = load_building_papers()["papers"]
        assert len(first) == 1
        assert first[0]["name"] == paper["name"]
        assert first[0]["data"] == paper["data"]

        # Content hashes are stable: uploading the same bytes updates one row
        # rather than duplicating it.
        assert save_building_papers([{"name": "重命名.txt", "data": paper["data"]}]) == 1
        second = load_building_papers()["papers"]
        assert len(second) == 1
        assert second[0]["name"] == "重命名.txt"

        assert delete_building_paper(second[0]["id"])
        assert load_building_papers()["papers"] == []

        save_building_papers([paper, {"name": "另一张.txt", "data": "VjE7b3RoZXI="}])
        assert clear_building_papers() == 2
        assert load_building_papers()["papers"] == []
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev
