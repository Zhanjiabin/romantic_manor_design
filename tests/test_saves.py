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
    load_building_paper,
    load_building_papers,
    load_paper_thumb,
    load_terrain_bundle,
    save_building_bundle,
    save_building_papers,
    save_paper_library_meta,
    save_paper_thumb,
    save_terrain_draft,
    save_terrain_version,
    safe_save_id,
    set_save_user,
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
        listed = load_building_papers()["papers"]
        assert len(listed) == 1
        assert listed[0]["name"] == paper["name"]
        assert "data" not in listed[0]
        first = load_building_papers(include_data=True)["papers"]
        assert len(first) == 1
        assert first[0]["name"] == paper["name"]
        assert first[0]["data"] == paper["data"]

        # Content hashes are stable: uploading the same bytes updates one row
        # rather than duplicating it.
        assert save_building_papers([{"name": "重命名.txt", "data": paper["data"]}]) == 1
        second = load_building_papers(include_data=True)["papers"]
        assert len(second) == 1
        assert second[0]["name"] == "重命名.txt"

        assert delete_building_paper(second[0]["id"])
        assert load_building_papers()["papers"] == []

        save_building_papers([paper, {"name": "另一张.txt", "data": "VjE7b3RoZXI="}])
        assert clear_building_papers() == 2
        assert load_building_papers()["papers"] == []

        save_building_papers([{
            "name": "户型.txt",
            "data": "VjE7ZGVzaw==",
            "kind": "desk",
            "group": "g1",
        }])
        save_paper_library_meta([{"id": "g1", "name": "咖啡馆"}])
        bundled = load_building_papers()
        assert bundled["groups"] == [{"id": "g1", "name": "咖啡馆"}]
        assert bundled["papers"][0]["kind"] == "desk"
        assert bundled["papers"][0]["group"] == "g1"
        save_building_papers([{"name": "地形.txt", "data": "dGVycmFpbg==", "kind": "terrain"}])
        mixed = load_building_papers()
        assert len(mixed["papers"]) == 2
        assert mixed["groups"] == [{"id": "g1", "name": "咖啡馆"}]
        assert {item["kind"] for item in mixed["papers"]} == {"desk", "terrain"}
        assert clear_building_papers() == 2
        assert load_building_papers()["groups"] == [{"id": "g1", "name": "咖啡馆"}]
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_paper_library_index_omits_blobs_and_stores_thumbs():
    tmp = tempfile.mkdtemp(prefix="manor-paper-thumbs-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        assert save_building_papers([{
            "name": "花园/亭子.txt",
            "data": "VjE7aHV0",
            "kind": "desk",
            "count": 12,
            "meta": "12 件素材 · 3 种材料",
        }]) == 1
        listed = load_building_papers()["papers"]
        assert len(listed) == 1
        assert "data" not in listed[0]
        assert listed[0]["hasThumb"] is False
        assert listed[0]["count"] == 12
        assert listed[0]["meta"] == "12 件素材 · 3 种材料"
        ident = listed[0]["id"]
        paper = load_building_paper(ident)
        assert paper["data"] == "VjE7aHV0"

        jpeg = b"\xff\xd8\xff\xd9" + b"\x00" * 16
        save_paper_thumb(ident, jpeg)
        listed = load_building_papers()["papers"]
        assert listed[0]["hasThumb"] is True
        thumb, ctype = load_paper_thumb(ident)
        assert ctype == "image/jpeg"
        assert thumb.startswith(b"\xff\xd8")

        assert delete_building_paper(ident)
        assert load_paper_thumb(ident) is None
        assert load_building_paper(ident) is None
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_building_papers_list_newest_first():
    import time

    tmp = tempfile.mkdtemp(prefix="manor-paper-sort-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        assert save_building_papers([{"name": "aaa.txt", "data": "VjE7YQ=="}]) == 1
        time.sleep(0.05)
        assert save_building_papers([{"name": "zzz.txt", "data": "VjE7eg=="}]) == 1
        names = [item["name"] for item in load_building_papers()["papers"]]
        assert names == ["zzz.txt", "aaa.txt"]
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_building_paper_keeps_id_when_content_changes():
    tmp = tempfile.mkdtemp(prefix="manor-paper-overwrite-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        assert save_building_papers([{"name": "a.txt", "data": "VjE7YQ=="}]) == 1
        ident = load_building_papers()["papers"][0]["id"]
        assert save_building_papers([{
            "id": ident,
            "name": "b.txt",
            "data": "VjE7Yg==",
        }]) == 1
        listed = load_building_papers(include_data=True)["papers"]
        assert len(listed) == 1
        assert listed[0]["id"] == ident
        assert listed[0]["name"] == "b.txt"
        assert listed[0]["data"] == "VjE7Yg=="
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_saves_are_isolated_per_user_and_primary_inherits_legacy():
    tmp = tempfile.mkdtemp(prefix="manor-saves-users-")
    prev = os.environ.get("MANOR_SAVES")
    prev_user = os.environ.get("MANOR_USER")
    os.environ["MANOR_SAVES"] = tmp
    os.environ["MANOR_USER"] = "ada"
    try:
        set_save_user("")
        save_terrain_draft({"id": "legacy", "name": "旧草稿", "savedAt": 1, "stamps": []})
        save_building_papers([{"name": "shared.txt", "data": "VjE7bGVnYWN5"}])

        set_save_user("ada")
        ada_draft = load_terrain_bundle()["draft"]
        assert ada_draft and ada_draft["id"] == "legacy"
        assert load_building_papers()["papers"][0]["name"] == "shared.txt"
        save_terrain_draft({"id": "ada-new", "name": "Ada", "savedAt": 2, "stamps": []})

        set_save_user("zed")
        assert load_terrain_bundle()["draft"] is None
        assert load_building_papers()["papers"] == []
        save_terrain_draft({"id": "zed-only", "name": "Zed", "savedAt": 3, "stamps": []})
        save_building_papers([{"name": "zed.txt", "data": "VjE7emVk"}])

        set_save_user("ada")
        assert load_terrain_bundle()["draft"]["id"] == "ada-new"
        names = [item["name"] for item in load_building_papers()["papers"]]
        assert "shared.txt" in names
        assert "zed.txt" not in names

        set_save_user("zed")
        assert load_terrain_bundle()["draft"]["id"] == "zed-only"
        assert [item["name"] for item in load_building_papers()["papers"]] == ["zed.txt"]
    finally:
        set_save_user("")
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev
        if prev_user is None:
            os.environ.pop("MANOR_USER", None)
        else:
            os.environ["MANOR_USER"] = prev_user
