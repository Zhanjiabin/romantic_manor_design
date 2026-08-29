# -*- coding: utf-8 -*-
"""Map GDesignLayer paper pack UIDs to mat.cfg folders.

Paper material IDs are ``合成时间 * 1000 + local mat.cfg key``.  The native
loader at ``rc3.exe`` ``0x658d1b`` does ``lea/shl`` to multiply the packet UID
by 1000 before adding the ``mat.cfg`` component number.

Packet UIDs come from ``GetDirectIntVal(..., "合成时间")`` in
``svr_designguide.txt``.  They are *not* ``formula.tab`` ``名称ID`` and are not
the row order in ``exhibit.tab``.  Those guesses produce valid but unrelated
sprites, which is much worse than a missing sprite.

LOCKED 2026-08-30: user confirmed this table against the in-game café
screenshot. Do not remap existing UIDs, do not invent 框架 borrow, and do not
replace this list with ``formula.tab`` / ``exhibit.tab`` order.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import BDESIGN_RES, GAME

RCSYS = GAME / "sourceCode" / "leo" / "rcsys"
CATALOG = ROOT / "data" / "editor_catalog.json"
OUTPUT = ROOT / "data" / "building_pack_uids.json"

# Packet IDs proven from the user's mixed café paper.  Representative exact
# matches: 15/512=supermarket wall13, 19/160=giant bow, 20/129=japan
# adornment29, 21/161=tds adornment62, 26/102=shiqi adornment02.
PROVEN_PACKETS = [
    (1, "europe", "欧洲风格", "legacy packet table"),
    (2, "egypt", "埃及风格", "legacy packet table"),
    (3, "greece", "希腊风格", "legacy packet table"),
    (4, "park", "园林风格", "legacy packet table"),
    (5, "q", "Q版风格", "mixed paper exact ground match"),
    (7, "toy", "玩具天地", "legacy packet table"),
    (8, "flower1", "花卉风格", "legacy packet table"),
    (9, "flower2", "植物风格", "legacy packet table"),
    (10, "candy", "糖果乐园", "exact mixed-paper wall match"),
    (13, "space", "太空幻想", "mixed paper glass-wall match"),
    (14, "bazaar", "商业建筑", "mixed café paper geometry and ALE match"),
    (15, "supermarket", "超市建筑", "exact ALE screenshot matches"),
    (16, "antique", "古韵建筑", "vendor packet table"),
    (19, "giant", "巨人国度", "exact giant ribbon/star matches"),
    (20, "japan", "唐韵和风", "exact repeated trim matches"),
    (21, "tds", "奇幻之塔", "exact repeated roof-edge match"),
    (25, "rose", "玫瑰风情", "exact flower/ground matches"),
    (26, "shiqi", "石器时代", "exact ALE screenshot matches"),
    (27, "snow", "冰雪风格", "mixed paper match"),
    (28, "muguang", "暮光之城", "unique locals 244 and 326"),
]


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("pack-uid", raw, 0, 1, str(path))


def catalog_keys() -> set[str]:
    if not CATALOG.is_file():
        return set()
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    return {pack["key"] for pack in data["building"]["packs"]}


def folder_to_key(folder: str, keys: set[str]) -> str | None:
    raw = folder.strip().strip('"')
    if not raw:
        return None
    candidates = [raw, raw.lower(), raw.lower().replace("putong", "putong")]
    for candidate in candidates:
        if candidate in keys:
            return candidate
    return None


def proven_uids(keys: set[str]) -> list[dict]:
    return [
        {
            "uid": uid,
            "key": key if key in keys else None,
            "folder": key,
            "name": name,
            "source": source,
        }
        for uid, key, name, source in PROVEN_PACKETS
    ]


def mat_cfg_frames(keys: set[str]) -> dict[str, list[int]]:
    """Read 框架=(uid,...) from each theme mat.cfg."""
    frames: dict[str, list[int]] = {}
    root = BDESIGN_RES / "res"
    if not root.is_dir():
        return frames
    for folder in sorted(p.name for p in root.iterdir() if p.is_dir()):
        key = folder_to_key(folder, keys)
        if not key:
            continue
        path = root / folder / "mat.cfg"
        if not path.is_file():
            continue
        # Headers are UTF-8; tolerate mixed body bytes.
        text = path.read_bytes().decode("utf-8", errors="replace")
        match = re.search(r"^框架=\(([^)]*)\)", text, re.MULTILINE)
        if not match:
            continue
        uids = [int(part) for part in re.findall(r"\d+", match.group(1))]
        seen = set()
        ordered = []
        for uid in uids:
            if uid in seen:
                continue
            seen.add(uid)
            ordered.append(uid)
        frames[key] = ordered
    return frames


def main() -> None:
    keys = catalog_keys()
    entries = proven_uids(keys)
    mapping = {}
    for entry in entries:
        if entry["key"] is None:
            continue
        mapping[str(entry["uid"])] = entry["key"]
    frames = mat_cfg_frames(keys)
    payload = {
        "schema": 3,
        "locked": True,
        "method": "合成时间 * 1000 + mat.cfg local id",
        "native": {
            "packet": "svr_designguide.txt GetMatInfoOk uid=GetDirectIntVal(合成时间) folder=配方成品",
            "encode": "rc3.exe 0x658d1b uid*1000 + local",
            "decode": "rc3.exe 0x656bd0 magic 0x10624dd3 div 1000",
            "frameBorrow": False,
            "frameMeaning": "mat.cfg 框架 lists compatible building frames, not packet UIDs",
        },
        "mapping": mapping,
        "frames": frames,
        "packs": entries,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUTPUT)
    print("mapping", json.dumps(mapping, ensure_ascii=False))
    print("frames", len(frames), "packs")


if __name__ == "__main__":
    main()
