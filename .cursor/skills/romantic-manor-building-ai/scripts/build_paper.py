#!/usr/bin/env python3
"""Build and validate an AI-authored Romantic Manor design-desk paper."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from codec.building import DESK_COORD_MASK, dumps_gbk, loads_gbk  # noqa: E402

MAX_LAYOUT_COORD = 2047


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_project_data() -> tuple[dict[str, str], dict[str, set[int]]]:
    uid_doc = read_json(ROOT / "data" / "building_pack_uids.json")
    if not uid_doc.get("locked"):
        raise ValueError("building pack UID mapping is not marked locked")
    pack_to_uid = {str(pack): int(uid) for uid, pack in uid_doc["mapping"].items()}

    catalog = read_json(ROOT / "data" / "building_uid_map.json")
    locals_by_pack: dict[str, set[int]] = {}
    for pack in catalog.get("packs", []):
        locals_by_pack[str(pack["pack"])] = {int(key) for key in pack.get("mapping", {})}
    return pack_to_uid, locals_by_pack


def checked_int(value: object, name: str, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not low <= number <= high:
        raise ValueError(f"{name} must be in {low}..{high}, got {number}")
    return number


def header_from_spec(spec: dict, spec_path: Path) -> dict:
    if spec.get("seedPaper"):
        seed = (spec_path.parent / str(spec["seedPaper"])).resolve()
        doc = loads_gbk(seed.read_bytes(), kind="desk")
        header = next((row for row in doc["records"] if int(row.get("mat", -1)) == 0), None)
        if not header:
            raise ValueError(f"seed paper has no mat=0 header: {seed}")
        return {
            "mode": "desk",
            "x": int(header["x"]),
            "y": int(header["y"]),
            "mat": 0,
            "state": int(header.get("state", 0)),
        }
    raw = spec.get("header")
    if not isinstance(raw, dict):
        raise ValueError("game-ready specs require header or seedPaper")
    return {
        "mode": "desk",
        "x": checked_int(raw.get("x"), "header.x", 0, DESK_COORD_MASK),
        "y": checked_int(raw.get("y"), "header.y", 0, DESK_COORD_MASK),
        "mat": 0,
        "state": checked_int(raw.get("state"), "header.state", 0, 63),
    }


def encoded_mat(
    raw: dict,
    pack_to_uid: dict[str, int],
    locals_by_pack: dict[str, set[int]],
    local_pack: str | None,
) -> int:
    if raw.get("mat") is not None:
        return checked_int(raw["mat"], "record.mat", 1, 64**3 - 1)
    pack = str(raw.get("pack") or "")
    if not pack:
        raise ValueError("record needs either mat or pack/local")
    local = checked_int(raw.get("local"), f"{pack}.local", 1, 999)
    known = locals_by_pack.get(pack)
    if known is None:
        raise ValueError(f"unknown building pack: {pack}")
    if local not in known:
        raise ValueError(f"missing material local {local} in pack {pack}")
    uid = pack_to_uid.get(pack)
    if uid is not None:
        return uid * 1000 + local
    if local_pack != pack:
        raise ValueError(
            f"pack {pack} has no locked UID; set localPack={pack!r} and use it as the only local pack"
        )
    return local


def records_from_spec(spec: dict, spec_path: Path) -> list[dict]:
    pack_to_uid, locals_by_pack = load_project_data()
    local_pack = str(spec.get("localPack") or "") or None
    rows = []
    for index, raw in enumerate(spec.get("records") or []):
        if not isinstance(raw, dict):
            raise ValueError(f"records[{index}] must be an object")
        rows.append(
            {
                "mode": "desk",
                "x": checked_int(raw.get("x"), f"records[{index}].x", 0, MAX_LAYOUT_COORD),
                "y": checked_int(raw.get("y"), f"records[{index}].y", 0, MAX_LAYOUT_COORD),
                "mat": encoded_mat(raw, pack_to_uid, locals_by_pack, local_pack),
                "state": checked_int(raw.get("state", 0), f"records[{index}].state", 0, 63),
                "_depth": float(raw.get("depth", 0)),
                "_index": index,
            }
        )
    if not rows:
        raise ValueError("spec contains no material records")
    if spec.get("sort", "preserve") == "depth":
        rows.sort(key=lambda row: (row["_depth"], row["y"], row["x"], row["_index"]))
    elif spec.get("sort", "preserve") != "preserve":
        raise ValueError("sort must be 'preserve' or 'depth'")
    for row in rows:
        row.pop("_depth", None)
        row.pop("_index", None)
    return [header_from_spec(spec, spec_path), *rows]


def validate_round_trip(records: list[dict], payload: bytes) -> dict:
    parsed = loads_gbk(payload, kind="desk")
    expected = [(row["x"], row["y"], row["mat"], row["state"]) for row in records]
    actual = [(row["x"], row["y"], row["mat"], row["state"]) for row in parsed["records"]]
    if actual != expected:
        raise ValueError("building paper failed encode/decode round-trip")
    duplicates = len(actual) - len(set(actual))
    return {
        "records": len(actual),
        "materials": max(0, len(actual) - 1),
        "duplicates": duplicates,
        "bytes": len(payload),
    }


def build(spec_path: Path, out_path: Path) -> None:
    spec = read_json(spec_path)
    records = records_from_spec(spec, spec_path)
    payload = dumps_gbk(records, kind="desk")
    report = validate_round_trip(records, payload)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(payload)
    print(json.dumps({"ok": True, "output": str(out_path), **report}, ensure_ascii=False))


def check(paper_path: Path) -> None:
    payload = paper_path.read_bytes()
    doc = loads_gbk(payload, kind="desk")
    report = validate_round_trip(doc["records"], dumps_gbk(doc["records"], kind="desk"))
    print(json.dumps({"ok": True, "paper": str(paper_path), **report}, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path, help="layout JSON to build")
    parser.add_argument("--out", type=Path, help="output V1 building paper")
    parser.add_argument("--check", type=Path, help="validate an existing building paper")
    args = parser.parse_args()
    try:
        if args.check:
            check(args.check)
        elif args.spec and args.out:
            build(args.spec.resolve(), args.out.resolve())
        else:
            parser.error("use --spec ... --out ... or --check ...")
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

