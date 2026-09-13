# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / "data" / "cloth" / "preview"


def test_tryon_manifest_covers_all_body_kinds():
    doc = json.loads((PREVIEW / "manifest.json").read_text(encoding="utf-8"))
    assert doc["viewport"] == [220, 300]
    for kind in ("female-short", "female-long", "female-skirt", "male-short", "male-long"):
        row = doc["kinds"][kind]
        slots = {part["slot"] for part in row["body"]}
        assert slots == {"skin", "cloth"}
        cloth = next(part for part in row["body"] if part["slot"] == "cloth")
        nvert = len(cloth["positions"]) // 3
        assert nvert > 100
        assert max(cloth["indices"]) < nvert
        assert (PREVIEW / row["defaultCloth"]).is_file()
    for name in (
        "female-head.jpg",
        "female-hair.jpg",
        "female-skin.jpg",
        "male-head.jpg",
        "male-hair.jpg",
        "male-skin.jpg",
        "bk_visu1.png",
    ):
        assert (PREVIEW / name).is_file(), name
    assert "female-skirt" in doc["kinds"]
    assert "male-skirt" not in doc["kinds"]
    assert doc["slotKinds"]["hair"] == "hair"
    assert doc["slotKinds"]["expression"] == "head"
    assert doc["slotKinds"]["face"] == "head"
