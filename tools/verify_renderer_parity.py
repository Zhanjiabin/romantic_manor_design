#!/usr/bin/env python3
"""Compare Python render_paper against optional browser/golden PNG traces."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402

from image_to_building.catalog import iter_locked_components, load_json  # noqa: E402
from image_to_building.renderer import (  # noqa: E402
    PreviewAssets,
    RenderOptions,
    compare_rgba,
    render_paper,
)
from image_to_building.schema import RENDERER_VERSION  # noqa: E402

DEFAULT_CASES = ROOT / "tests" / "fixtures" / "image_to_building" / "renderer" / "cases.json"


def _load_cases(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _pack_samples(assets: PreviewAssets) -> list[dict]:
    catalog = assets.catalog
    uid_map_path = ROOT / "data" / "building_uid_map.json"
    uid_map = load_json(uid_map_path) if uid_map_path.is_file() else {"packs": []}
    picked: dict[str, list[dict]] = {}
    for row in iter_locked_components(catalog, assets.uid_doc, uid_map):
        bucket = picked.setdefault(row["pack"], [])
        if sum(1 for item in bucket if item["category"] == row["category"]) < 2:
            bucket.append(row)
    records = []
    x, y = 160, 200
    for rows in (picked[key] for key in sorted(picked)):
        for index, row in enumerate(rows[:2]):
            records.append({"mat": row["mat"], "x": x, "y": y, "state": 0 if index == 0 else 1})
            x += 18
            y += 6
            if x > 420:
                x = 160
                y += 20
    return records


def _case_records(spec: dict, assets: PreviewAssets) -> list[tuple[str, int, str, list[dict]]]:
    cases = []
    for base_no in spec.get("bases") or []:
        cases.append((f"empty-base-{base_no}", int(base_no), "editor", []))
    cafe = spec.get("cafe")
    if cafe:
        cases.append(("cafe-14124", 1, "editor", [cafe]))
    fence = spec.get("fence")
    if fence:
        cases.append(("fence-8101", 1, "editor", [fence]))
    bookshop_rel = spec.get("bookshop")
    if bookshop_rel:
        bookshop = json.loads((ROOT / bookshop_rel).read_text(encoding="utf-8"))
        cases.append(("bookshop", 1, "editor", bookshop.get("records") or []))
    cases.append(("locked-pack-samples", 8, "editor", _pack_samples(assets)))
    cases.append(("empty-native-1", 1, "native", []))
    return cases


def _write_trace(trace, out_dir: Path, name: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    png_path = out_dir / f"{name}.png"
    meta_path = out_dir / f"{name}.json"
    trace.image.save(png_path)
    payload = {
        "name": name,
        "rendererVersion": RENDERER_VERSION,
        "baseNo": trace.base_no,
        "size": [trace.image.width, trace.image.height],
        "groundAnchor": list(trace.ground_anchor),
        "contentOffset": list(trace.content_offset),
        "unresolved": trace.unresolved,
        "zOrder": trace.z_order,
        "bboxes": {str(key): list(box) for key, box in trace.bboxes.items()},
        "paperToImage": trace.paper_to_image,
    }
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def _compare_goldens(name: str, trace, golden_dir: Path, gates: dict) -> dict:
    png_path = golden_dir / f"{name}.png"
    meta_path = golden_dir / f"{name}.json"
    result = {"name": name, "ok": True, "errors": []}
    if meta_path.is_file():
        gold = json.loads(meta_path.read_text(encoding="utf-8"))
        if gold.get("size") != [trace.image.width, trace.image.height]:
            result["ok"] = False
            result["errors"].append(f"size {gold.get('size')} != {[trace.image.width, trace.image.height]}")
        g_anchor = gold.get("groundAnchor") or [0, 0]
        if abs(g_anchor[0] - trace.ground_anchor[0]) > gates.get("groundAnchorPx", 1):
            result["ok"] = False
            result["errors"].append("groundAnchor x")
        if abs(g_anchor[1] - trace.ground_anchor[1]) > gates.get("groundAnchorPx", 1):
            result["ok"] = False
            result["errors"].append("groundAnchor y")
    if png_path.is_file():
        other = Image.open(png_path).convert("RGBA")
        metrics = compare_rgba(trace.image, other)
        result["metrics"] = metrics
        if not metrics["sameSize"]:
            result["ok"] = False
            result["errors"].append("png size")
        if metrics["edgeF1"] < gates.get("edgeF1", 0.995):
            result["ok"] = False
            result["errors"].append(f"edgeF1 {metrics['edgeF1']:.4f}")
        if metrics["rgbMae"] > gates.get("rgbMae", 2):
            result["ok"] = False
            result["errors"].append(f"rgbMae {metrics['rgbMae']:.3f}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "image_to_building" / "jobs" / "renderer-parity")
    parser.add_argument("--golden", type=Path, default=None, help="directory of reference PNG/JSON from a previous run or browser dump")
    parser.add_argument("--write", action="store_true", help="write Python traces to --out")
    args = parser.parse_args()
    spec = _load_cases(args.cases)
    gates = spec.get("gates") or {}
    assets = PreviewAssets()
    report = {
        "rendererVersion": RENDERER_VERSION,
        "ok": True,
        "cases": [],
    }
    for name, base_no, space, records in _case_records(spec, assets):
        trace = render_paper(records, RenderOptions(base_no=base_no, coordinate_space=space, trace_instances=True), assets)
        row = {
            "name": name,
            "baseNo": base_no,
            "coordinateSpace": space,
            "recordCount": len(records),
            "unresolved": trace.unresolved,
            "size": [trace.image.width, trace.image.height],
            "groundAnchor": list(trace.ground_anchor),
        }
        if args.write:
            _write_trace(trace, args.out, name)
        if args.golden:
            check = _compare_goldens(name, trace, args.golden, gates)
            row["golden"] = check
            if not check["ok"]:
                report["ok"] = False
        if trace.unresolved:
            report["ok"] = False
            row["errors"] = ["unresolved mats"]
        report["cases"].append(row)
        print(f"{name}: {trace.image.width}x{trace.image.height} unresolved={len(trace.unresolved)}")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {args.out / 'report.json'} ok={report['ok']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
