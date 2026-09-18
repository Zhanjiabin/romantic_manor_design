# -*- coding: utf-8 -*-
"""Native item-remodel desk facts from itemdesign.cfg / customroot.tab.

The remodel desk is a separate GDesignLayer from the house desk.  Canvas size
is still 570×550.  Papers are the same V1; nine-character records.  Bases come
from customroot.tab and are selected by:

    GetBaseIndex(kind, "SetPut(" + putw + "," + puth + ")")

from svr_designguide.txt Item_物件设计向导.Design().  Do not guess sizes.
"""
from __future__ import annotations

import csv
import json
import re
from io import StringIO
from pathlib import Path

from codec.building import format_v1

ROOT = Path(__file__).resolve().parents[1]

# rc3.exe GetClipboard 0x669740 copies chars >= 0x20, stops at CR/LF, max 0x4FFF.
NATIVE_CLIP_MAX = 0x4FFF
DESK_COORD_MIN = -0x4000
DESK_COORD_MAX = 0x3FFF

KIND_LABELS = {
    0: "装饰",
    1: "家具",
    2: "椅子",
    3: "床",
}

# svr_designguide.txt Item_物件设计向导.LoadAgv
PACKET_BY_KIND = {
    0: "装饰素材包",
    1: "家具素材包",
    2: "家具素材包",
    3: "家具素材包",
}
FAMILY_BY_KIND = {
    0: "ornament",
    1: "furniture",
    2: "furniture",
    3: "furniture",
}
ITEM_UIDS_PATH = ROOT / "data" / "item_pack_uids.json"

PUT_RE = re.compile(r"SetPut\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)")
DESIGN_W = 570
DESIGN_H = 550


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("remodel", raw, 0, 1, str(path))


def parse_put(command: str | None) -> tuple[int, int] | None:
    match = PUT_RE.search(str(command or ""))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def scale_mode_for_kind(kind: int) -> int:
    """itemdesign 向导: furniture / chair / bed set OUTIMG.scalemode=2."""
    return 2 if int(kind) >= 1 else 0


def user_action_for_kind(kind: int) -> str:
    """Chairs AddUser('坐椅子'); beds AddUser('躺'); others hide 显示人物."""
    kind = int(kind)
    if kind == 2:
        return "坐椅子"
    if kind == 3:
        return "躺"
    return ""


def show_person_for_kind(kind: int) -> bool:
    return int(kind) in (2, 3)


def get_base_index(bases: list[dict], kind: int, putw: int, puth: int) -> dict | None:
    """Native GetBaseIndex(kind, 'SetPut(putw,puth)')."""
    needle = f"SetPut({int(putw)},{int(puth)})"
    kind = int(kind)
    for base in bases:
        if int(base.get("kind") or 0) != kind:
            continue
        command = str(base.get("command") or "")
        if needle in command.replace(" ", ""):
            return base
    return None


def load_custom_bases(catalog_path: Path | None = None) -> list[dict]:
    path = catalog_path or (ROOT / "data" / "editor_catalog.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    bases = data.get("building", {}).get("customBases") or []
    if bases:
        return bases
    return load_custom_bases_from_tab()


def load_custom_bases_from_tab(tab_path: Path | None = None) -> list[dict]:
    from game_paths import GAME

    path = tab_path or (
        GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "bdesign" / "item" / "customroot.tab"
    )
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in read_text(path).splitlines()[2:]:
        if not line.strip():
            continue
        columns = next(csv.reader(StringIO(line)))
        if len(columns) < 13 or not columns[0].strip().strip('"').isdigit():
            continue
        command = columns[12]
        put = parse_put(command)
        rows.append(
            {
                "no": int(columns[0]),
                "kind": int(columns[1] or 0),
                "name": columns[2],
                "paper": columns[3],
                "anchor": [int(columns[7] or 0), int(columns[8] or 0)],
                "baseImage": columns[9],
                "maskImage": columns[10],
                "workImage": columns[11],
                "command": command,
                "footprint": [put[0], put[1]] if put else None,
            }
        )
    return rows


def pack_family_for_kind(kind: int) -> str:
    return FAMILY_BY_KIND.get(int(kind), "ornament")


def packet_name_for_kind(kind: int) -> str:
    return PACKET_BY_KIND.get(int(kind), "装饰素材包")


def load_item_pack_uids(path: Path | None = None) -> dict:
    uid_path = path or ITEM_UIDS_PATH
    if not uid_path.is_file():
        return {"packs": []}
    return json.loads(uid_path.read_text(encoding="utf-8"))


def item_pack_meta(key: str, uids: dict | None = None) -> dict | None:
    needle = str(key or "").casefold()
    for row in (uids or load_item_pack_uids()).get("packs") or []:
        if str(row.get("key") or "").casefold() == needle:
            return row
    return None


def item_paper_mat(local: int, pack_key: str, uids: dict | None = None) -> int:
    """Native 0x658d1b: live mat = 合成时间 * 1000 + mat.cfg local."""
    local_id = max(0, int(local or 0))
    row = item_pack_meta(pack_key, uids)
    if not row or local_id <= 0:
        return local_id
    return int(row["uid"]) * 1000 + local_id


def load_item_formula_packs(tab_path: Path | None = None) -> list[dict]:
    from game_paths import GAME

    path = tab_path or (GAME / "sourceCode" / "leo" / "rcsys" / "playerdata" / "formula.tab")
    if not path.is_file():
        return []
    rows: list[dict] = []
    for columns in csv.reader(StringIO(read_text(path))):
        if len(columns) < 8:
            continue
        packet = columns[0].strip().strip('"')
        if packet == "装饰素材包":
            family = "ornament"
        elif packet == "家具素材包":
            family = "furniture"
        else:
            continue
        folder = columns[3].strip().strip('"')
        if not folder:
            continue
        try:
            uid = int(columns[7])
        except ValueError:
            continue
        rows.append(
            {
                "uid": uid,
                "key": folder.casefold(),
                "folder": folder,
                "name": columns[1].strip().strip('"'),
                "family": family,
                "packet": packet,
            }
        )
    return rows


def _clip_coord(value) -> int:
    try:
        number = int(round(float(value or 0)))
    except (TypeError, ValueError):
        number = 0
    return max(DESK_COORD_MIN, min(DESK_COORD_MAX, number))


def format_native_clip(records) -> str:
    """GDesignLayer TxtExport(flag=0) text that SetClipboard writes as CF_TEXT.

    Native CopyToClipBoard (0x669a14) calls TxtExport 0x6689b0 with flag=0
    (selected only).  TxtExport writes ``V1`` then ``;`` + nine-character desk
    records: packed s15 x/y (0x4252f0, 5 chars), mat (0x4250f0, 3 chars),
    state (0x4250c0, 1 char).  Itemdesign outimg is 570×550 with no
    SetAutoSize, so coordinates stay in that layer.
    """
    rows = []
    for row in records or []:
        if not isinstance(row, dict):
            continue
        if row.get("hidden"):
            continue
        state = int(row.get("state", row.get("flip", 0)) or 0)
        rows.append(
            {
                "mode": "desk",
                "x": _clip_coord(row.get("x")),
                "y": _clip_coord(row.get("y")),
                "mat": max(0, int(row.get("mat") or 0)),
                "state": max(0, min(63, state)),
            }
        )
    if not rows:
        return ""
    text = format_v1(rows, kind="desk")
    if any(ord(ch) < 0x20 for ch in text):
        raise ValueError("native GetClipboard stops at control characters")
    if len(text) > NATIVE_CLIP_MAX:
        raise ValueError("native clipboard max is 0x4FFF")
    return text


def native_get_clipboard(text: str) -> str:
    """Filter CF_TEXT the way rc3 GetClipboard 0x669740 does."""
    out: list[str] = []
    for ch in str(text or ""):
        code = ord(ch)
        if code in (0x0A, 0x0D):
            break
        if code >= 0x20:
            out.append(ch)
        if len(out) >= NATIVE_CLIP_MAX:
            break
    return "".join(out)
