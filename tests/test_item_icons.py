from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.build_item_icons import parse_item_icon_ref


def test_parse_item_icon_ref_frame_query():
    parsed = parse_item_icon_ref("item/产品.ale?f=179")
    assert parsed == {"file": "item/产品.ale", "frame": 179}


def test_parse_item_icon_ref_plain_ale():
    parsed = parse_item_icon_ref("plant/flower/normal/s1/after/野花.ale")
    assert parsed == {"file": "plant/flower/normal/s1/after/野花.ale", "frame": 0}


def test_desk_materials_use_itemdef_icons():
    path = ROOT / "data" / "item_icons.json"
    assert path.is_file(), "run tools/build_item_icons.py first"
    payload = json.loads(path.read_text(encoding="utf-8"))
    icons = payload["icons"]
    assert icons["木头"] == {"file": "item/产品.ale", "frame": 179}
    assert icons["木材"] == {"file": "item/产品.ale", "frame": 178}
    assert icons["石材"] == {"file": "item/产品.ale", "frame": 208}
    assert icons["岩石"] == {"file": "item/地形.ale", "frame": 61}
    assert icons["帆布"] == {"file": "item/产品.ale", "frame": 224}
    assert payload["count"] >= 200
    assert payload["missingCount"] <= 1


if __name__ == "__main__":
    tests = [value for key, value in list(globals().items()) if key.startswith("test_")]
    for test in tests:
        test()
        print("ok", test.__name__)
    print("all", len(tests))
