from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.build_editor_catalog import component_category


def load_json(name: str) -> dict:
    path = ROOT / "data" / name
    assert path.is_file(), f"run tools/build_editor_catalog.py first: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_catalog_contains_original_desk_inventory():
    catalog = load_json("editor_catalog.json")
    assert len(catalog["terrain"]["brushes"]) == 30
    assert len(catalog["terrain"]["sizes"]) == 16
    assert len(catalog["terrain"]["palettes"]) == 41
    assert len(catalog["building"]["bases"]) == 80
    assert len(catalog["building"]["customBases"]) == 46
    assert catalog["building"]["packCount"] == 32
    assert catalog["building"]["componentCount"] == 2980
    assert catalog["building"]["templateCount"] == 86
    assert load_json("editor_catalog_report.json")["decodeErrorCount"] == 0


def test_inline_v1_components_are_kits_not_missing_files():
    catalog = load_json("editor_catalog.json")
    suite_components = [
        component
        for pack in catalog["building"]["packs"]
        for component in pack["components"]
        if component["id"] // 100 == 6
    ]
    kits = [component for component in suite_components if component["kind"] == "kit"]
    assert kits
    assert all(component["paper"].startswith("V1;") for component in kits)
    assert all(
        component["kind"] == "kit"
        for component in suite_components
        if "paper" in component and component["paper"].startswith("V1;")
    )
    report = load_json("editor_catalog_report.json")
    assert not any(issue["reference"].startswith("V1;") for issue in report["missing"])


def test_component_categories_match_original_hundreds():
    assert component_category(101) == "装饰"
    assert component_category(201) == "门窗"
    assert component_category(301) == "地面"
    assert component_category(401) == "屋顶"
    assert component_category(501) == "墙壁"
    assert component_category(601) == "套件"


def test_building_paper_ids_are_direct_component_ids():
    uid_map = load_json("building_uid_map.json")
    antique = next(pack for pack in uid_map["packs"] if pack["pack"] == "antique")
    assert antique["status"] == "verified"
    assert antique["uidCount"] == 112
    assert all(
        int(paper_id) == row["componentId"] and row["unique"]
        for paper_id, row in antique["mapping"].items()
    )
    gaps = {
        pack["pack"]: {
            component_id
            for unresolved in pack["unresolved"]
            for component_id in unresolved["componentIds"]
        }
        for pack in uid_map["packs"]
        if pack["unresolved"]
    }
    assert gaps == {"flower1": {513}, "flower2": {512}, "japan": {172}}


def test_building_pack_uids_match_proven_mixed_paper_packets():
    pack_uids = load_json("building_pack_uids.json")
    assert pack_uids.get("locked") is True
    mapping = pack_uids["mapping"]
    assert mapping["1"] == "europe"
    assert mapping["7"] == "toy"
    assert mapping["10"] == "candy"
    assert mapping["13"] == "space"
    assert mapping["14"] == "bazaar"
    assert mapping["15"] == "supermarket"
    assert mapping["19"] == "giant"
    assert mapping["20"] == "japan"
    assert mapping["21"] == "tds"
    assert mapping["26"] == "shiqi"
    assert mapping["28"] == "muguang"
    catalog = load_json("editor_catalog.json")
    keys = {pack["key"] for pack in catalog["building"]["packs"]}
    assert set(mapping.values()) <= keys
    assert pack_uids["native"]["frameBorrow"] is False


def test_mixed_cafe_paper_resolves_directly_without_frame_borrow():
    from codec.building import loads_gbk
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    from game_paths import GAME

    paper = GAME / "图代码" / "建筑.txt"
    if not paper.is_file():
        return
    pack_uids = load_json("building_pack_uids.json")
    catalog = load_json("editor_catalog.json")
    packs = {pack["key"]: pack for pack in catalog["building"]["packs"]}
    mapping = {int(k): v for k, v in pack_uids["mapping"].items()}

    def resolve(mat: int):
        uid, local = divmod(mat, 1000)
        key = mapping.get(uid)
        if not key:
            return None
        pack = packs[key]
        if any(c["kind"] == "sprite" and c["id"] == local for c in pack["components"]):
            return key
        return None

    doc = loads_gbk(paper.read_bytes(), kind="desk")
    mats = [r["mat"] for r in doc["records"] if r.get("mat", 0) >= 1000]
    assert 14124 in mats
    assert resolve(14124) == "bazaar"
    assert resolve(13518) == "space"
    assert resolve(15512) == "supermarket"
    assert resolve(19160) == "giant"
    assert resolve(20129) == "japan"
    assert resolve(21161) == "tds"
    missing = [mat for mat in mats if resolve(mat) is None]
    assert not missing


if __name__ == "__main__":
    tests = [value for key, value in list(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print("ok", test.__name__)
    print("all", len(tests))
