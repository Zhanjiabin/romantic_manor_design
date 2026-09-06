from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.validate_semantic_building_styles import validate_document  # noqa: E402

CONFIG = ROOT / "data" / "semantic_building_styles.json"
UIDS = ROOT / "data" / "building_pack_uids.json"
UID_MAP = ROOT / "data" / "building_uid_map.json"
VALIDATOR = ROOT / "tools" / "validate_semantic_building_styles.py"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def references() -> tuple[dict, dict]:
    return load(UIDS), load(UID_MAP)


def test_checked_in_semantic_styles_validate():
    uid_doc, uid_map = references()
    document = load(CONFIG)

    assert validate_document(document, uid_doc, uid_map) == []
    assert document["schema"] == 1
    assert {"bazaar-bookshop", "europe-classic"} <= set(document["styles"])


def test_bookshop_prioritizes_fixture_verified_bazaar_materials():
    document = load(CONFIG)
    style = document["styles"]["bazaar-bookshop"]
    expected = {
        "ground": (301, 0),
        "back-wall": (501, 1),
        "front-wall": (508, 0),
        "window": (201, 1),
        "sign": (101, 0),
    }

    assert load(UIDS)["mapping"]["14"] == "bazaar"
    for role_name, (local, state) in expected.items():
        first = style["roles"][role_name]["candidates"][0]
        assert first == {"pack": "bazaar", "local": local, "states": [state]}

    assert style["roles"]["door"] == {
        "label": "入口",
        "optional": True,
        "fallback": "window",
        "candidates": [],
    }
    assert style["roles"]["roof"] == {
        "label": "屋顶",
        "optional": True,
        "fallback": None,
        "candidates": [],
    }


def test_every_candidate_local_comes_from_building_uid_map():
    document = load(CONFIG)
    uid_doc, uid_map = references()
    locked_packs = set(uid_doc["mapping"].values())
    locals_by_pack = {
        row["pack"]: {int(local) for local in row["mapping"]}
        for row in uid_map["packs"]
    }

    for style in document["styles"].values():
        for role in style["roles"].values():
            for candidate in role["candidates"]:
                assert candidate["pack"] in locked_packs
                assert candidate["local"] in locals_by_pack[candidate["pack"]]


def test_validator_rejects_alias_pack_missing_local_and_invalid_state():
    uid_doc, uid_map = references()
    base = load(CONFIG)

    alias_pack = copy.deepcopy(base)
    alias_pack["styles"]["europe-classic"]["roles"]["ground"]["candidates"][0][
        "pack"
    ] = "toy"
    assert any(
        "not in the locked UID mapping"
        in error
        for error in validate_document(alias_pack, uid_doc, uid_map)
    )

    missing_local = copy.deepcopy(base)
    missing_local["styles"]["bazaar-bookshop"]["roles"]["ground"]["candidates"][0][
        "local"
    ] = 399
    assert any(
        "missing local bazaar:399" in error
        for error in validate_document(missing_local, uid_doc, uid_map)
    )

    invalid_state = copy.deepcopy(base)
    invalid_state["styles"]["bazaar-bookshop"]["roles"]["sign"]["candidates"][0][
        "states"
    ] = [64]
    assert any(
        "must be between 0 and 63" in error
        for error in validate_document(invalid_state, uid_doc, uid_map)
    )


def test_validator_rejects_malformed_or_implicit_roles():
    uid_doc, uid_map = references()
    base = load(CONFIG)

    required_without_candidates = copy.deepcopy(base)
    role = required_without_candidates["styles"]["europe-classic"]["roles"]["wall"]
    role["candidates"] = []
    assert any(
        "is required and must have candidates" in error
        for error in validate_document(required_without_candidates, uid_doc, uid_map)
    )

    missing_fallback = copy.deepcopy(base)
    del missing_fallback["styles"]["bazaar-bookshop"]["roles"]["roof"]["fallback"]
    assert any(
        ".fallback must be explicit" in error
        for error in validate_document(missing_fallback, uid_doc, uid_map)
    )

    unknown_facade_role = copy.deepcopy(base)
    unknown_facade_role["styles"]["europe-classic"]["facade"]["layers"][0][
        "role"
    ] = "unknown"
    assert any(
        ".role must reference a declared role" in error
        for error in validate_document(unknown_facade_role, uid_doc, uid_map)
    )


def test_validator_cli_accepts_checked_in_config():
    result = subprocess.run(
        [sys.executable, str(VALIDATOR)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "validated 2 semantic building styles" in result.stdout
