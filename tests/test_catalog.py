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


if __name__ == "__main__":
    tests = [value for key, value in list(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print("ok", test.__name__)
    print("all", len(tests))
