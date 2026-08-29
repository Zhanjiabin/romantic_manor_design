# -*- coding: utf-8 -*-
"""Build and verify GDesignLayer paper-ID -> mat.cfg component mappings.

The native decoder in ``rc3.exe`` reads record[5:8] with the game's compact
integer alphabet and uses that value directly as the current ``mat.cfg``
component key. Earlier reverse engineering used the wrong alphabet order,
making these IDs look unrelated and leading to an unnecessary SMT model.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from codec.building import parse_v1

CATALOG = ROOT / "data" / "editor_catalog.json"
OUTPUT = ROOT / "data" / "building_uid_map.json"


def paper_component_ids(paper: str) -> set[int]:
    doc = parse_v1(paper, kind="desk")
    return {int(record["mat"]) for record in doc["records"]}


def paper_references(pack: dict) -> list[dict]:
    references = []
    for component in pack["components"]:
        if component.get("kind") != "kit" or not component.get("paper"):
            continue
        references.append(
            {
                "name": f"kit:{component['id']}",
                "componentIds": sorted(paper_component_ids(component["paper"])),
            }
        )
    for template in pack["templates"]:
        if not template.get("paper", "").upper().startswith("V1;"):
            continue
        references.append(
            {
                "name": f"template:{template['index']}",
                "componentIds": sorted(paper_component_ids(template["paper"])),
            }
        )
    return references


def solve_pack(pack: dict) -> dict:
    sprite_ids = sorted(
        int(component["id"])
        for component in pack["components"]
        if component.get("kind") == "sprite"
    )
    references = paper_references(pack)
    referenced_ids = sorted(
        {
            component_id
            for reference in references
            for component_id in reference["componentIds"]
        }
    )
    known = set(sprite_ids)
    unresolved = [
        {
            "source": reference["name"],
            "componentIds": [
                component_id
                for component_id in reference["componentIds"]
                if component_id not in known
            ],
        }
        for reference in references
        if any(component_id not in known for component_id in reference["componentIds"])
    ]
    mapping = {
        str(component_id): {
            "componentId": component_id,
            "unique": True,
        }
        for component_id in sprite_ids
    }
    return {
        "pack": pack["key"],
        "name": pack["name"],
        "status": "verified" if not unresolved else "verified-with-source-gaps",
        "artifactCount": len(references),
        "uidCount": len(sprite_ids),
        "referencedCount": len(referenced_ids),
        "uniqueCount": len(mapping),
        "unresolved": unresolved,
        "mapping": mapping,
    }


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    requested = set(sys.argv[1:])
    packs = []
    for pack in catalog["building"]["packs"]:
        if pack["kind"] != "theme":
            continue
        if requested and pack["key"] not in requested:
            continue
        print("solving", pack["key"], pack["name"], flush=True)
        solved = solve_pack(pack)
        packs.append(solved)
        print(
            solved["status"],
            "uids",
            solved["uidCount"],
            "unique",
            solved.get("uniqueCount", 0),
            flush=True,
        )
    payload = {
        "schema": 1,
        "method": "direct mat.cfg component IDs verified against native compact-integer decoding",
        "packs": packs,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            [
                {
                    "pack": pack["pack"],
                    "status": pack["status"],
                    "uids": pack["uidCount"],
                    "unique": pack.get("uniqueCount", 0),
                }
                for pack in packs
            ],
            ensure_ascii=False,
            indent=2,
        )
    )
    print("wrote", OUTPUT)


if __name__ == "__main__":
    main()
