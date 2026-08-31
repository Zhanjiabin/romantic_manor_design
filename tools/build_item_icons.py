# -*- coding: utf-8 -*-
"""Map design-desk material names to GItemShow icons from itemdef.tab.

Native builddesign.cfg RefreshCurNeed / RefreshNeed calls GItemShow.SetAsInt(name.id).
The bag icon is itemdef.tab column ``icon`` (e.g. item/产品.ale?f=179).
itemdef.tab in the unpack is often still an MSCF cabinet.
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
import tempfile
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME

from tools.build_editor_catalog import parse_material_expr, parse_tab, read_text

SOURCE = GAME / "sourceCode" / "leo"
ITEMDEF = SOURCE / "rcitem" / "itemdef.tab"
RCITEM = SOURCE / "rcitem"
CATALOG = ROOT / "data" / "editor_catalog.json"
OUT = ROOT / "data" / "item_icons.json"

BUILD_RUNTIME = SOURCE / "rcex" / "svr" / "bdesign"
BUILD_DESIGN = SOURCE / "rcsys" / "svr" / "bdesign"


def parse_item_icon_ref(value: str) -> dict | None:
    clean = (value or "").strip().strip("'\"").replace("\\", "/")
    if not clean:
        return None
    path, _, query = clean.partition("?")
    path = path.split("#", 1)[0].strip()
    if not path:
        return None
    frame = 0
    if query:
        for part in query.split("&"):
            key, _, val = part.partition("=")
            if key.strip().lower() == "f":
                try:
                    frame = max(0, int(val))
                except ValueError:
                    frame = 0
    return {"file": path, "frame": frame}


def expand_cab(cab_bytes: bytes) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        cab = tmp_dir / "blob.cab"
        out = tmp_dir / "blob.out"
        cab.write_bytes(cab_bytes)
        result = subprocess.run(["expand", str(cab), str(out)], capture_output=True)
        if not out.is_file():
            err = (result.stderr or result.stdout or b"").decode("gbk", errors="replace")
            raise RuntimeError(f"expand failed for itemdef.tab: {err.strip() or result.returncode}")
        return out.read_bytes()


def itemdef_text(path: Path = ITEMDEF) -> str:
    if not path.is_file():
        raise FileNotFoundError(path)
    raw = path.read_bytes()
    if raw.startswith(b"MSCF"):
        raw = expand_cab(raw)
    elif raw.startswith((b"XY20", b"!CD1")):
        sys.path.insert(0, str(GAME.parent / "庄园地形设计器"))
        from unpack_kapct import decode_text_blob  # type: ignore

        raw = decode_text_blob(raw, Path(tempfile.mkdtemp()), "itemdef")
        if raw.startswith(b"MSCF"):
            raw = expand_cab(raw)
    if not raw.startswith(b"GBTB"):
        raise RuntimeError(f"itemdef.tab is not a GBTB table (head={raw[:8]!r})")
    for encoding in ("gbk", "gb18030", "utf-8-sig", "utf-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("itemdef", raw, 0, len(raw), "cannot decode itemdef.tab")


def parse_itemdef_icons(text: str) -> dict[str, dict]:
    lines = text.splitlines()
    if len(lines) < 3:
        return {}
    header = next(csv.reader(StringIO(lines[2])))
    try:
        name_i = header.index("name")
        sys_i = header.index("sysname")
        icon_i = header.index("icon")
    except ValueError as exc:
        raise RuntimeError(f"itemdef.tab missing columns: {exc}") from exc
    icons: dict[str, dict] = {}
    for line in lines[3:]:
        if not line.strip():
            continue
        row = next(csv.reader(StringIO(line)))
        if icon_i >= len(row):
            continue
        parsed = parse_item_icon_ref(row[icon_i])
        if not parsed:
            continue
        for index in (name_i, sys_i):
            if index >= len(row):
                continue
            key = row[index].strip()
            if key and key not in icons:
                icons[key] = parsed
    return icons


def catalog_material_names(catalog: dict) -> set[str]:
    names: set[str] = set()
    building = catalog.get("building") or {}
    for base in list(building.get("bases") or []) + list(building.get("customBases") or []):
        for item in base.get("baseMaterials") or []:
            if item.get("name"):
                names.add(item["name"])
    for pack in building.get("packs") or []:
        for component in pack.get("components") or []:
            for item in component.get("materials") or []:
                if item.get("name"):
                    names.add(item["name"])
        for template in pack.get("templates") or []:
            for item in template.get("materials") or []:
                if item.get("name"):
                    names.add(item["name"])
    return names


def scan_desk_material_names() -> set[str]:
    names: set[str] = set()
    if CATALOG.is_file():
        names |= catalog_material_names(json.loads(CATALOG.read_text(encoding="utf-8")))
        return names
    base_path = BUILD_DESIGN / "imgs" / "base.tab"
    if base_path.is_file():
        for row in parse_tab(base_path):
            blob = row[19] if len(row) > 19 else (row[13] if len(row) > 13 else "")
            for item in parse_material_expr(blob):
                if item.get("name"):
                    names.add(item["name"])
    for cfg in sorted((BUILD_RUNTIME / "res").glob("*/mat.cfg")) + sorted(
        (BUILD_RUNTIME / "item").glob("*/mat.cfg")
    ):
        in_materials = False
        for line in read_text(cfg).splitlines():
            stripped = line.strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                in_materials = stripped == "[材料]"
                continue
            if not in_materials or "=" not in stripped:
                continue
            _, _, value = stripped.partition("=")
            for item in parse_material_expr(value):
                if item.get("name"):
                    names.add(item["name"])
    return names


def fallback_icon_file(name: str) -> dict | None:
    if not name:
        return None
    for rel in (f"item/{name}.ale", f"item/{name}.gif", f"item/{name}.png"):
        if (RCITEM / rel).is_file():
            return {"file": rel, "frame": 0}
    return None


def build_item_icons() -> dict:
    all_icons = parse_itemdef_icons(itemdef_text())
    names = scan_desk_material_names()
    selected = {}
    missing = []
    for name in sorted(names):
        icon = all_icons.get(name) or fallback_icon_file(name)
        if icon:
            selected[name] = icon
        else:
            missing.append(name)
    return {
        "schema": 1,
        "source": "sourceCode/leo/rcitem/itemdef.tab icon",
        "native": "GItemShow.SetAsInt(mat.id) in builddesign.cfg RefreshNeed/RefreshCurNeed",
        "count": len(selected),
        "missingCount": len(missing),
        "missing": missing,
        "icons": selected,
    }


def main() -> None:
    payload = build_item_icons()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("item icons", payload["count"], "missing", payload["missingCount"], "->", OUT)


if __name__ == "__main__":
    main()
