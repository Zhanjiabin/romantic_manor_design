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
    load_terrain_index,
    load_terrain_version,
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
        index = load_terrain_index()
        assert index["versions"][0]["id"] == "v-99"
        assert index["versions"][0]["stampCount"] == 0
        assert "stamps" not in index["versions"][0]
        assert load_terrain_version("v-99")["name"] == "快照"
        save_terrain_draft({"id": "stale-draft", "savedAt": 15, "stamps": [{"kind": "B"}]})
        save_terrain_draft({"id": "same-time-other", "savedAt": 20, "stamps": [{"kind": "C"}]})
        save_terrain_version({"id": "stale-version", "name": "迟到快照", "savedAt": 12, "stamps": []})
        assert load_terrain_bundle()["draft"]["id"] == "v-99"
        assert load_terrain_version("stale-version")["name"] == "迟到快照"
        assert delete_terrain_version("v-99")
        assert [row["id"] for row in load_terrain_bundle()["versions"]] == ["stale-version"]

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


def test_building_paper_keeps_desk_layers_across_upsert():
    tmp = tempfile.mkdtemp(prefix="manor-paper-layers-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        layers = [
            {"mat": 14101, "group": "g-wall", "groupName": "墙", "label": "", "locked": True, "hidden": False},
            {"mat": 14102, "group": "g-wall", "groupName": "墙", "label": "柱", "locked": False, "hidden": False},
        ]
        assert save_building_papers([{
            "name": "成组图纸.txt",
            "data": "VjE7ZGVzaw==",
            "kind": "desk",
            "deskLayers": layers,
        }]) == 1
        ident = load_building_papers()["papers"][0]["id"]
        paper = load_building_paper(ident)
        assert paper["deskLayers"][0]["group"] == "g-wall"
        assert paper["deskLayers"][0]["locked"] is True
        assert paper["deskLayers"][1]["groupName"] == "墙"
        assert "deskLayers" not in load_building_papers()["papers"][0]

        assert save_building_papers([{
            "id": ident,
            "name": "成组图纸.txt",
            "kind": "desk",
            "count": 2,
        }]) == 1
        kept = load_building_paper(ident)
        assert kept["deskLayers"][0]["group"] == "g-wall"
        assert kept["deskLayers"][1]["label"] == "柱"
        assert save_building_papers([{
            "id": ident,
            "name": "成组图纸.txt",
            "kind": "desk",
            "deskDocument": {
                "v": 1,
                "records": [
                    {"x": 10, "y": 20, "mat": 14101, "state": 1, "packKey": "bazaar", "group": "g-wall", "groupName": "墙", "locked": True},
                    {"x": 11, "y": 21, "mat": 14102, "state": 0, "group": "g-wall", "groupName": "墙"},
                ],
                "baseNo": 212,
                "baseName": "巨型建筑",
                "paperLayout": False,
                "keepFoundation": True,
                "layerCollapsed": ["g-wall"],
                "smartBuilder": {
                    "styleId": "bazaar-bookshop",
                    "mode": "door",
                    "walls": [{
                        "a": {"x": 100, "y": 120},
                        "b": {"x": 220, "y": 180},
                        "openings": [{"kind": "door", "t": 0.5, "width": 30}],
                    }],
                    "props": [{"role": "sign", "x": 160, "y": 110}],
                },
            },
        }]) == 1
        full = load_building_paper(ident)
        assert full["deskDocument"]["baseNo"] == 212
        assert full["deskDocument"]["paperLayout"] is False
        assert full["deskDocument"]["records"][0]["group"] == "g-wall"
        assert full["deskDocument"]["layerCollapsed"] == ["g-wall"]
        assert full["deskDocument"]["smartBuilder"]["styleId"] == "bazaar-bookshop"
        assert full["deskDocument"]["smartBuilder"]["walls"][0]["openings"][0]["kind"] == "door"
        assert save_building_papers([{
            "id": ident,
            "name": "成组图纸.txt",
            "kind": "desk",
            "meta": "2 件素材",
        }]) == 1
        still = load_building_paper(ident)
        assert still["deskDocument"]["records"][0]["packKey"] == "bazaar"
        assert still["deskDocument"]["baseName"] == "巨型建筑"
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_terrain_paper_keeps_exact_project_snapshot_across_upsert():
    tmp = tempfile.mkdtemp(prefix="manor-terrain-paper-project-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        project = {
            "v": 2,
            "id": "project-1",
            "savedAt": 1234,
            "name": "保存图纸",
            "mapSize": 100,
            "mapflag": 1,
            "stamps": [{"kind": "A", "x": 10, "y": 20}],
            "buildings": [{"item": 9, "x": 30, "y": 40, "dir": 2}],
            "previewBuildings": [{
                "id": "preview-1",
                "sourceType": "paper",
                "name": "咖啡馆",
                "x": 100,
                "y": 120,
                "records": [{"mat": 14101, "x": 1, "y": 2, "state": 0}],
            }],
            "sourcePaper": {"id": "paper-1", "name": "9月6日.txt"},
            "terrainSource": {"text": "large native source"},
            "buildingSource": {"text": "large building source"},
        }
        assert save_building_papers([{
            "id": "paper-1",
            "name": "9月6日.txt",
            "data": "xA==",
            "kind": "terrain",
            "terrainDocument": project,
        }]) == 1
        full = load_building_paper("paper-1")
        assert full["terrainDocument"]["stamps"] == project["stamps"]
        assert full["terrainDocument"]["previewBuildings"][0]["records"][0]["mat"] == 14101
        assert "terrainSource" not in full["terrainDocument"]
        assert "buildingSource" not in full["terrainDocument"]

        assert save_building_papers([{
            "id": "paper-1",
            "name": "9月6日重命名.txt",
            "kind": "terrain",
            "count": 1,
        }]) == 1
        kept = load_building_paper("paper-1")
        assert kept["terrainDocument"]["previewBuildings"][0]["name"] == "咖啡馆"
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_paper_save_rejects_stale_body_and_thumbnail():
    tmp = tempfile.mkdtemp(prefix="manor-paper-revision-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        ident = "paper-revision"
        assert save_building_papers([{
            "id": ident,
            "name": "新版.txt",
            "data": "bmV3",
            "kind": "desk",
            "savedAt": 200,
            "revision": "rev-new",
            "deskDocument": {"v": 1, "records": [{"mat": 14101, "x": 1, "y": 2}]},
        }]) == 1
        jpeg = b"\xff\xd8\xff\xd9" + b"\x00" * 16
        save_paper_thumb(ident, jpeg, expected_revision="rev-new")
        assert load_paper_thumb(ident) is not None

        assert save_building_papers([{
            "id": ident,
            "name": "迟到旧版.txt",
            "data": "b2xk",
            "kind": "desk",
            "savedAt": 100,
            "revision": "rev-old",
            "deskDocument": {"v": 1, "records": [{"mat": 8101, "x": 9, "y": 9}]},
        }]) == 0
        kept = load_building_paper(ident)
        assert kept["name"] == "新版.txt"
        assert kept["data"] == "bmV3"
        assert kept["revision"] == "rev-new"

        try:
            save_paper_thumb(ident, jpeg, expected_revision="rev-old")
        except ValueError as exc:
            assert "changed" in str(exc)
        else:
            raise AssertionError("stale thumbnail upload should fail")

        assert save_building_papers([{
            "id": ident,
            "name": "强制写回.txt",
            "data": "Zm9yY2U=",
            "kind": "terrain",
            "savedAt": 50,
            "revision": "rev-forced",
            "force": True,
            "terrainDocument": {
                "stamps": [{"kind": "H", "x": 1, "y": 2}, {"kind": "G", "x": 3, "y": 4}],
                "previewBuildings": [{"id": "preview-keep", "name": "咖啡馆"}],
                "mapSize": 80,
            },
        }]) == 1
        forced = load_building_paper(ident)
        assert forced["data"] == "Zm9yY2U="
        assert forced["name"] == "强制写回.txt"
        assert forced["terrainDocument"]["stamps"][1]["kind"] == "G"
        assert forced["terrainDocument"]["previewBuildings"][0]["id"] == "preview-keep"
        try:
            save_building_papers([{
                "id": "huge-paper",
                "name": "过大.txt",
                "data": "A" * (4 * 1024 * 1024 + 1),
            }])
        except ValueError as exc:
            assert "too large" in str(exc)
        else:
            raise AssertionError("oversized paper should fail")
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


def test_building_paper_rename_by_id_keeps_saved_at():
    import time

    tmp = tempfile.mkdtemp(prefix="manor-paper-rename-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        assert save_building_papers([{"name": "旧名字.txt", "data": "VjE7YQ=="}]) == 1
        first = load_building_papers()["papers"][0]
        ident = first["id"]
        saved_at = first["savedAt"]
        time.sleep(0.05)
        assert save_building_papers([{
            "id": ident,
            "name": "2026/8/30新名字.txt",
        }]) == 1
        listed = load_building_papers()["papers"]
        assert len(listed) == 1
        assert listed[0]["id"] == ident
        assert listed[0]["name"] == "2026/8/30新名字.txt"
        assert listed[0]["savedAt"] == saved_at
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_building_paper_archive_and_restore_keeps_id():
    tmp = tempfile.mkdtemp(prefix="manor-paper-archive-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    try:
        assert save_building_papers([{"name": "花园.txt", "data": "VjE7YQ=="}]) == 1
        first = load_building_papers()["papers"][0]
        ident = first["id"]
        assert first.get("archived") is False
        assert save_building_papers([{
            "id": ident,
            "name": first["name"],
            "archived": True,
        }]) == 1
        archived = load_building_papers()["papers"][0]
        assert archived["id"] == ident
        assert archived["archived"] is True
        assert archived["archivedAt"] > 0
        assert save_building_papers([{
            "id": ident,
            "name": first["name"],
            "archived": False,
        }]) == 1
        restored = load_building_papers()["papers"][0]
        assert restored["id"] == ident
        assert restored["archived"] is False
        assert restored["archivedAt"] == 0
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
        save_paper_thumb(ident, b"\xff\xd8\xff\xd9" + b"\x00" * 16)
        assert load_paper_thumb(ident) is not None
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
        assert load_paper_thumb(ident) is None
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
