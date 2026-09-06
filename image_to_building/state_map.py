"""state 0-63 -> resolved ALE frame using current preview modulo behavior.

verified=false until a native game replay confirms the mapping.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from image_to_building.schema import STATE_MAP_VERSION


def resolved_frame(state: int, frame_count: int) -> int:
    count = max(1, int(frame_count) or 1)
    return int(state) % count


def build_state_map(entries: list[dict]) -> dict:
    by_asset: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        key = f"{entry['pack']}:{entry['local']}"
        by_asset[key].append(entry)

    assets = []
    for asset_id, rows in sorted(by_asset.items()):
        rows = sorted(rows, key=lambda item: int(item["frame"]))
        count = len(rows)
        visual = {int(row["frame"]): row.get("exactPixelGroup") or row.get("rgbaSha256") for row in rows}
        states = {}
        for state in range(64):
            frame = resolved_frame(state, count)
            states[str(state)] = {
                "resolvedFrame": frame,
                "visualGroup": visual.get(frame),
            }
        assets.append(
            {
                "schemaVersion": STATE_MAP_VERSION,
                "assetId": asset_id,
                "pack": rows[0]["pack"],
                "local": rows[0]["local"],
                "canonicalMat": rows[0]["canonicalMat"],
                "frameCount": count,
                "states": states,
                "evidence": "preview-modulo",
                "verified": False,
            }
        )
    return {
        "schemaVersion": STATE_MAP_VERSION,
        "evidence": "preview-modulo-and-paper-replay",
        "verifiedDefault": False,
        "assetCount": len(assets),
        "assets": assets,
    }


def write_state_map(doc: dict, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
