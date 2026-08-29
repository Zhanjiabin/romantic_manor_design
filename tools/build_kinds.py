# -*- coding: utf-8 -*-
"""Build data/kinds.json from mapdata.tab + 00changgui.ini + yewai.ini."""
from __future__ import annotations

import csv
import json
import re
import sys
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME

TILE_DIR = GAME / "sourceCode" / "leo" / "rcex" / "maps" / "tile"
MAPDATA = GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "mapdesign" / "basedata" / "mapdata.tab"
MAPSIZE = GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "mapdesign" / "basedata" / "mapsize.tab"
BASE_TAB = GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "bdesign" / "imgs" / "base.tab"
OUT = ROOT / "data" / "kinds.json"

from codec.b64 import ALPHABET, encode

ADDKIND_RE = re.compile(r"^addkind\s*=\s*(\d+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*(.+?)\s*$")
LINKALL_RE = re.compile(r"^linkall\s*=\s*(.+?)\s*,\s*(.+?)\s*,\s*(.+?)\s*$", re.I)
PUT_RE = re.compile(r"SetPut\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)")
KIND36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise RuntimeError("cannot decode %s" % path)


def parse_linkall(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    for line in read_text(path).splitlines():
        m = LINKALL_RE.match(line.strip())
        if not m:
            continue
        left, right, ale = m.group(1).strip(), m.group(2).strip(), m.group(3).strip().replace("\\", "/")
        stem = Path(ale).stem.lower()
        if not ale.lower().endswith(".ale"):
            continue
        rows.append(
            {
                "from": [p.strip() for p in left.split(":") if p.strip()],
                "to": [p.strip() for p in right.split(":") if p.strip()],
                "ale": stem,
                "file": ale,
            }
        )
    return rows


def parse_addkind(path: Path) -> list[dict]:
    rows = []
    for line in read_text(path).splitlines():
        m = ADDKIND_RE.match(line.strip())
        if not m:
            continue
        walk, code, typ, tex = m.group(1), m.group(2).strip(), m.group(3).strip(), m.group(4).strip()
        tex = tex.replace("\\", "/")
        rows.append(
            {
                "index": len(rows),
                "walk": int(walk),
                "code": code,
                "type": typ,
                "texture": tex,
                "char": encode(len(rows), 1),
            }
        )
    return rows


def parse_tab_data(path: Path) -> list[list[str]]:
    rows = []
    for line in read_text(path).splitlines()[2:]:
        line = line.strip()
        if not line:
            continue
        rows.append(next(csv.reader(StringIO(line))))
    return rows


def main():
    changgui = parse_addkind(TILE_DIR / "00changgui.ini")
    yewai = parse_addkind(TILE_DIR / "yewai.ini")
    links = []
    for ini in sorted(TILE_DIR.glob("00*.ini")) + [TILE_DIR / "yewai.ini"]:
        links.extend(parse_linkall(ini))
    by_code = {}
    for src in (yewai, changgui):
        for row in src:
            by_code.setdefault(row["code"], row)

    tiles = []
    for row in changgui:
        rec = dict(row)
        rec["calibrated"] = True
        rec["source"] = "00changgui.ini#addkind"
        tiles.append(rec)

    brushes = []
    for cols in parse_tab_data(MAPDATA):
        if len(cols) < 8:
            continue
        key = cols[0].strip().strip('"')
        if not key.isdigit():
            continue
        idx = int(key)
        code = cols[3].strip()
        linked = by_code.get(code)
        paper = KIND36[idx] if 0 <= idx < len(KIND36) else None
        brushes.append(
            {
                "mapdataIndex": idx,
                "sysName": cols[1],
                "name": cols[2],
                "code": code,
                "stampSize": int(cols[4]),
                "icon": cols[5],
                "price": int(cols[6]),
                "type": cols[7],
                "char": linked["char"] if linked else None,
                "paperChar": paper,
                "texture": linked["texture"] if linked else None,
                "calibrated": bool(linked),
            }
        )

    sizes = []
    for cols in parse_tab_data(MAPSIZE):
        if len(cols) < 4:
            continue
        key = cols[0].strip().strip('"')
        if not key.isdigit():
            continue
        sizes.append(
            {
                "size": int(cols[0].strip('"')),
                "level": cols[1].strip('"'),
                "basePrice": int(cols[2]),
                "desc": cols[3].strip('"'),
            }
        )
    sizes = [s for s in sizes if s["size"] < 4160]
    for s in sizes:
        if s["size"] == 3880:
            s["level"] = "110级以上庄园"
            s["desc"] = "地形面积3880*3880, 适用于声望110级以上的庄园"
    sizes.sort(key=lambda s: s["size"], reverse=True)

    bases = []
    for cols in parse_tab_data(BASE_TAB):
        if len(cols) < 19:
            continue
        if not cols[0].strip().strip('"').isdigit():
            continue
        cmd = cols[18]
        m = PUT_RE.search(cmd)
        footprint = [int(m.group(1)), int(m.group(2))] if m else [3, 3]
        base_image = cols[14].replace("\\", "/")
        mask_image = cols[15].replace("\\", "/")
        work_image = cols[16].replace("\\", "/")
        bases.append(
            {
                "no": int(cols[0]),
                "kind": int(cols[1]) if cols[1] else 0,
                "name": cols[2],
                "cx": int(cols[12]) if cols[12] else 0,
                "cy": int(cols[13]) if cols[13] else 0,
                "baseImage": base_image,
                "maskImage": mask_image,
                "workImage": work_image,
                "mask": mask_image,
                "footprint": footprint,
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "alphabet": ALPHABET,
        "kindAlphabet": KIND36,
        "tileIndexNote": "模板= 种类字符 = mapdata.tab 序号，用 0-9A-Z（A=10）。不是 00changgui.ini 的 addkind。每种地形还带 1/3/5 格笔刷。坐标仍是 64 进制。",
        "tiles": tiles,
        "brushes": brushes,
        "mapSizes": sizes,
        "bases": bases,
        "links": links,
        "unmappedChars": [],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT, "tiles", len(tiles), "brushes", len(brushes), "bases", len(bases), "links", len(links))


if __name__ == "__main__":
    main()
