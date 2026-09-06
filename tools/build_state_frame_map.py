#!/usr/bin/env python3
"""Build state->frame map from a schema-2 sprite manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from image_to_building.state_map import build_state_map, write_state_map  # noqa: E402


def load_entries(manifest: Path) -> list[dict]:
    jsonl = manifest / "manifest.jsonl" if manifest.is_dir() else manifest
    if jsonl.suffix == ".jsonl":
        return [json.loads(line) for line in jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
    doc = json.loads(Path(manifest).read_text(encoding="utf-8"))
    return doc.get("entries") or []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=ROOT / "data" / "image_to_building" / "manifests" / "v2",
        help="manifest directory or jsonl file",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "data" / "image_to_building" / "state_maps" / "state_frame_map.json",
    )
    args = parser.parse_args()
    entries = load_entries(args.manifest)
    if not entries:
        raise SystemExit(f"no manifest entries in {args.manifest}")
    doc = build_state_map(entries)
    write_state_map(doc, args.out)
    print(f"wrote {args.out} assets={doc['assetCount']} verifiedDefault={doc['verifiedDefault']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
