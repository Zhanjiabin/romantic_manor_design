# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from codec.building import format_v1, parse_v1
from codec.remodel import (
    DESIGN_H,
    DESIGN_W,
    KIND_LABELS,
    NATIVE_CLIP_MAX,
    format_native_clip,
    get_base_index,
    item_paper_mat,
    load_custom_bases,
    load_item_formula_packs,
    load_item_pack_uids,
    native_get_clipboard,
    pack_family_for_kind,
    packet_name_for_kind,
    parse_put,
    scale_mode_for_kind,
    show_person_for_kind,
    user_action_for_kind,
)
from saves import (
    load_building_bundle,
    load_building_papers,
    load_remodel_bundle,
    papers_folder,
    save_building_bundle,
    save_building_papers,
    save_remodel_bundle,
    set_save_user,
)


def test_customroot_has_46_unique_kind_puts():
    bases = load_custom_bases()
    assert len(bases) == 46
    keys = []
    for base in bases:
        put = parse_put(base["command"])
        assert put, base
        assert base["footprint"] == [put[0], put[1]]
        keys.append((int(base["kind"]), put))
    assert len(set(keys)) == 46
    for kind, label in KIND_LABELS.items():
        assert any(int(base["kind"]) == kind for base in bases), label


def test_get_base_index_matches_native_setput():
    bases = load_custom_bases()
    deco_11 = get_base_index(bases, 0, 1, 1)
    furn_11 = get_base_index(bases, 1, 1, 1)
    assert deco_11["no"] == 1
    assert deco_11["name"] == "装饰基座1×1"
    assert furn_11["no"] == 9
    assert furn_11["name"] == "家具基座1×1"
    assert deco_11["baseImage"] != furn_11["baseImage"]
    long = get_base_index(bases, 0, 2, 1)
    assert long["name"] == "装饰基座1×2"
    assert long["command"] == "SetPut(2,1)"
    chair = get_base_index(bases, 2, 3, 2)
    assert chair and chair["paper"] == "椅子模型"
    bed = get_base_index(bases, 3, 6, 4)
    assert bed is None
    assert get_base_index(bases, 0, 6, 6)["name"] == "装饰基座6×6"


def test_item_packets_split_decoration_and_furniture():
    assert packet_name_for_kind(0) == "装饰素材包"
    assert packet_name_for_kind(1) == "家具素材包"
    assert packet_name_for_kind(2) == "家具素材包"
    assert packet_name_for_kind(3) == "家具素材包"
    assert pack_family_for_kind(0) == "ornament"
    assert pack_family_for_kind(1) == "furniture"
    uids = load_item_pack_uids()
    packs = uids["packs"]
    assert any(row["key"] == "o_china03" and row["uid"] == 2 and row["family"] == "ornament" for row in packs)
    assert any(row["key"] == "i_xmas03" and row["uid"] == 10 and row["family"] == "furniture" for row in packs)
    q02 = next(row for row in packs if row["key"] == "o_q02")
    tool02 = next(row for row in packs if row["key"] == "i_tool02")
    assert q02["uid"] == tool02["uid"] == 7
    assert q02["family"] != tool02["family"]
    assert item_paper_mat(101, "i_xmas03") == 10101
    assert item_paper_mat(101, "i_tool02") == 7101
    assert item_paper_mat(101, "o_china03") == 2101
    ornament = [row["key"] for row in packs if row["family"] == "ornament"]
    furniture = [row["key"] for row in packs if row["family"] == "furniture"]
    assert all(key.startswith("o_") for key in ornament)
    assert all(key.startswith("i_") for key in furniture)
    assert "i_xmas03" not in ornament
    assert "o_china03" not in furniture
    assert len(ornament) == 8
    assert len(furniture) == 11
    formula = load_item_formula_packs()
    if formula:
        by_key = {(row["family"], row["key"]): row["uid"] for row in formula}
        for row in packs:
            assert by_key[(row["family"], row["key"])] == row["uid"], row


def test_scale_mode_and_person_follow_itemdesign_guide():
    assert scale_mode_for_kind(0) == 0
    assert scale_mode_for_kind(1) == 2
    assert scale_mode_for_kind(2) == 2
    assert scale_mode_for_kind(3) == 2
    assert user_action_for_kind(2) == "坐椅子"
    assert user_action_for_kind(3) == "躺"
    assert user_action_for_kind(0) == ""
    assert show_person_for_kind(2) is True
    assert show_person_for_kind(1) is False
    assert DESIGN_W == 570
    assert DESIGN_H == 550


def test_remodel_v1_roundtrip_is_desk_paper():
    records = [{"mode": "desk", "x": 120, "y": 80, "mat": 101, "state": 1}]
    text = format_v1(records, kind="desk")
    assert text.startswith("V1;")
    back = parse_v1(text, kind="desk")
    assert back["records"][0]["mat"] == 101
    assert back["records"][0]["x"] == 120


def test_native_clip_matches_txt_export_desk_v1():
    sample = "V1;0Mk2s07s1;0Tk2u07s0"
    records = parse_v1(sample, kind="desk")["records"]
    text = format_native_clip(records)
    assert text == sample
    assert "\r" not in text and "\n" not in text
    assert all(ord(ch) >= 0x20 for ch in text)
    assert len(text) <= NATIVE_CLIP_MAX
    assert native_get_clipboard(text) == text
    recs = text[3:].split(";")
    assert recs and all(len(row) == 9 for row in recs)
    back = parse_v1(text, kind="desk")
    assert back["kind"] == "desk"
    assert back["records"][0]["x"] == 182
    assert back["records"][0]["y"] == 184
    assert back["records"][0]["mat"] == 504
    assert back["records"][0]["state"] == 1
    assert format_native_clip([]) == ""
    assert format_native_clip([{"mode": "desk", "x": 10, "y": 20, "mat": 7, "state": 2, "hidden": True}]) == ""
    signed = format_native_clip([{"mode": "desk", "x": -1, "y": -2, "mat": 1, "state": 0}])
    assert native_get_clipboard(signed + "\r\nV1;junk") == signed
    assert parse_v1(signed, kind="desk")["records"][0]["x"] == -1


def test_custom_base_art_lives_in_item_folder():
    from game_paths import BDESIGN_ITEM

    folder = BDESIGN_ITEM / "baseimg"
    if not folder.is_dir():
        return
    missing = []
    for base in load_custom_bases():
        for key in ("baseImage", "maskImage", "workImage"):
            name = Path(str(base.get(key) or "")).name
            if name and not (folder / name).is_file():
                missing.append((base["name"], key, name))
    assert missing == []


def test_remodel_saves_are_isolated_from_building():
    tmp = tempfile.mkdtemp(prefix="manor-remodel-saves-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    set_save_user("")
    try:
        save_building_bundle({"session": {"v": 1, "desk": "building", "baseNo": 212}})
        save_remodel_bundle({"session": {"v": 1, "desk": "remodel", "baseNo": 1}})
        save_building_bundle({"customs": {"v": 1, "items": [{"id": "b1", "name": "house-custom"}]}})
        save_remodel_bundle({"customs": {"v": 1, "items": [{"id": "r1", "name": "item-custom"}]}})
        building = load_building_bundle()
        remodel = load_remodel_bundle()
        assert building["session"]["desk"] == "building"
        assert remodel["session"]["desk"] == "remodel"
        assert building["customs"]["items"][0]["id"] == "b1"
        assert remodel["customs"]["items"][0]["id"] == "r1"
        assert (Path(tmp) / "building-customs.json").is_file()
        assert (Path(tmp) / "remodel-customs.json").is_file()
        save_building_papers(
            [{"id": "bldpaper1", "name": "house.txt", "data": "VjE7QUFB", "kind": "desk"}]
        )
        with papers_folder("remodel-papers"):
            save_building_papers(
                [{"id": "rempaper1", "name": "chair.txt", "data": "VjE7QkJC", "kind": "desk"}]
            )
            remodel_papers = load_building_papers()
        building_papers = load_building_papers()
        building_ids = {item["id"] for item in building_papers["papers"]}
        remodel_ids = {item["id"] for item in remodel_papers["papers"]}
        assert "bldpaper1" in building_ids
        assert "rempaper1" not in building_ids
        assert "rempaper1" in remodel_ids
        assert "bldpaper1" not in remodel_ids
        assert (Path(tmp) / "building-session.json").is_file()
        assert (Path(tmp) / "remodel-session.json").is_file()
        assert (Path(tmp) / "building-papers" / "bldpaper1.json").is_file()
        assert (Path(tmp) / "remodel-papers" / "rempaper1.json").is_file()
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev
