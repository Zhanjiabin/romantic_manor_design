#!/usr/bin/env python3
"""Build schema-2 full-frame sprite manifest for image-to-building."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from image_to_building.asset_manifest import build_manifest, verify_manifest, write_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "data" / "image_to_building" / "manifests" / "v2",
        help="directory for manifest.json / manifest.jsonl / quarantine.json",
    )
    parser.add_argument("--limit", type=int, default=0, help="debug: stop after N frame entries")
    parser.add_argument("--write-frames", action="store_true", help="also write RGBA/alpha PNGs")
    parser.add_argument("--verify", action="store_true", help="fail if UID/mat/size checks fail")
    args = parser.parse_args()
    doc = build_manifest(limit=args.limit or None, write_frames=args.write_frames, out_dir=args.out)
    write_manifest(doc, args.out)
    errors = verify_manifest(doc)
    summary = doc["summary"]
    print(
        f"wrote {args.out} entries={summary['entryCount']} "
        f"quarantine={summary['quarantineCount']} missing={len(summary['missingFiles'])}"
    )
    if args.verify or errors:
        for error in errors:
            print("verify:", error)
        if errors:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
