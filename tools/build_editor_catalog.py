# -*- coding: utf-8 -*-
"""Compile the original terrain/building desk data into one evidence catalog.

The source tree is the authority.  This script does not invent fallback assets:
every referenced file is resolved against the unpacked game tree and unresolved
references are written to the report.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME

SOURCE = GAME / "sourceCode" / "leo"
RCSYS = SOURCE / "rcsys"
RCEX = SOURCE / "rcex"

MAP_DESIGN = RCSYS / "svr" / "mapdesign"
MAP_TILE = RCEX / "maps" / "tile"
BUILD_DESIGN = RCSYS / "svr" / "bdesign"
BUILD_RUNTIME = RCEX / "svr" / "bdesign"

OUT = ROOT / "data" / "editor_catalog.json"
REPORT = ROOT / "data" / "editor_catalog_report.json"

sys.path.insert(0, str(ROOT))
from codec.ale import AleError, parse_ale  # noqa: E402

ADDKIND_RE = re.compile(
    r"^addkind\s*=\s*(?P<walk>\d+)\s*,\s*(?P<code>[^,]+)\s*,\s*"
    r"(?P<type>[^,]+)\s*,\s*(?P<file>.+?)\s*$",
    re.I,
)
LINKALL_RE = re.compile(
    r"^linkall\s*=\s*(?P<from>.+?)\s*,\s*(?P<to>.+?)\s*,\s*(?P<file>.+?)\s*$",
    re.I,
)
PUT_RE = re.compile(r"SetPut\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)")
CFG_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")
CFG_ENTRY_RE = re.compile(r"^\s*([^=;\r\n]+?)\s*=\s*(.*?)\s*$")
FRAME_RE = re.compile(r"(?:^|[?&])f=(\d+)", re.I)


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("catalog", raw, 0, len(raw), f"cannot decode {path}")


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(GAME.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_tab(path: Path) -> list[list[str]]:
    lines = read_text(path).splitlines()
    rows: list[list[str]] = []
    for line in lines[2:]:
        if not line.strip():
            continue
        rows.append(next(csv.reader(StringIO(line))))
    return rows


def parse_simple_cfg(path: Path) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    section = ""
    sections[section] = {}
    for raw_line in read_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "//", ";")):
            continue
        match = CFG_SECTION_RE.match(line)
        if match:
            section = match.group(1).strip()
            sections.setdefault(section, {})
            continue
        match = CFG_ENTRY_RE.match(line)
        if match:
            sections[section][match.group(1).strip()] = match.group(2).strip()
    return sections


def split_values(value: str) -> list[str]:
    value = value.strip()
    if value.startswith("(") and value.endswith(")"):
        value = value[1:-1]
    return [part.strip().strip("'\"") for part in value.split(",") if part.strip()]


def parse_material_expr(value: str) -> list[dict]:
    parts = split_values(value)
    result = []
    for index in range(0, len(parts) - 1, 2):
        try:
            count = int(parts[index + 1])
        except ValueError:
            count = 0
        result.append({"name": parts[index], "count": count})
    return result


def resolve_asset(reference: str, roots: list[Path], current: Path | None = None) -> Path | None:
    clean = reference.strip().strip("'\"").replace("\\", "/")
    clean = clean.split("?", 1)[0]
    candidates: list[Path] = []
    if current is not None:
        candidates.append(current / clean)
    for root in roots:
        candidates.append(root / clean)
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def image_info(path: Path) -> dict:
    info = {"path": rel(path), "bytes": path.stat().st_size}
    suffix = path.suffix.lower()
    if suffix == ".ale":
        try:
            doc = parse_ale(path.read_bytes())
            info.update(
                {
                    "format": doc["format"],
                    "frames": doc["frames"],
                    "kind": doc.get("kind"),
                    "width": doc["width"],
                    "height": doc["height"],
                    "encrypted": doc.get("encrypted", False),
                    "decodable": doc.get("decodable", False),
                }
            )
            if doc.get("frameTable"):
                info["frameTable"] = doc["frameTable"]
            if doc["format"] == "ALE":
                info.update(
                    {
                        "version": doc["version"],
                    }
                )
        except (AleError, OSError, ValueError) as exc:
            info.update({"format": "ALE", "decodable": False, "error": str(exc)})
        return info
    try:
        from PIL import Image

        with Image.open(path) as image:
            info.update(
                {
                    "format": image.format or suffix.lstrip(".").upper(),
                    "width": image.width,
                    "height": image.height,
                    "frames": getattr(image, "n_frames", 1),
                    "decodable": True,
                }
            )
    except Exception as exc:  # Pillow is optional for catalog generation.
        info.update({"format": suffix.lstrip(".").upper(), "decodable": False, "error": str(exc)})
    return info


def terrain_catalog(missing: list[dict], decode_errors: list[dict]) -> dict:
    ini_files = sorted(MAP_TILE.glob("*.ini"))
    palettes = []
    all_kinds = []
    all_links = []
    effects = []

    for ini_path in ini_files:
        entry = {
            "name": ini_path.stem,
            "source": rel(ini_path),
            "kinds": [],
            "links": [],
            "effects": {},
        }
        for raw_line in read_text(ini_path).splitlines():
            line = raw_line.strip()
            if not line or line.startswith(("#", ";", "//")):
                continue
            match = ADDKIND_RE.match(line)
            if match:
                row = {
                    "index": len(entry["kinds"]),
                    "walk": int(match.group("walk")),
                    "code": match.group("code").strip(),
                    "type": match.group("type").strip(),
                    "texture": match.group("file").strip().replace("\\", "/"),
                }
                asset = resolve_asset(row["texture"], [MAP_TILE])
                if asset:
                    row["asset"] = image_info(asset)
                    if not row["asset"].get("decodable", True):
                        decode_errors.append(
                            {"owner": rel(ini_path), "reference": row["texture"], **row["asset"]}
                        )
                else:
                    row["asset"] = None
                    missing.append({"owner": rel(ini_path), "reference": row["texture"]})
                entry["kinds"].append(row)
                all_kinds.append({"palette": ini_path.stem, **row})
                continue
            match = LINKALL_RE.match(line)
            if match:
                row = {
                    "from": [part.strip() for part in match.group("from").split(":") if part.strip()],
                    "to": [part.strip() for part in match.group("to").split(":") if part.strip()],
                    "file": match.group("file").strip().replace("\\", "/"),
                }
                asset = resolve_asset(row["file"], [MAP_TILE])
                if asset:
                    row["asset"] = image_info(asset)
                    if not row["asset"].get("decodable", True):
                        decode_errors.append(
                            {"owner": rel(ini_path), "reference": row["file"], **row["asset"]}
                        )
                else:
                    row["asset"] = None
                    missing.append({"owner": rel(ini_path), "reference": row["file"]})
                entry["links"].append(row)
                all_links.append({"palette": ini_path.stem, **row})
                continue
            lowered = line.lower()
            if lowered.startswith(("mask=", "light=", "水动画=")):
                key, value = line.split("=", 1)
                refs = [part.strip().replace("\\", "/") for part in value.split(",") if part.strip()]
                resolved = []
                for reference in refs[1:] if key == "水动画" else refs:
                    asset = resolve_asset(reference, [MAP_TILE])
                    if asset:
                        resolved.append(image_info(asset))
                    else:
                        resolved.append(None)
                        missing.append({"owner": rel(ini_path), "reference": reference})
                effect = {"references": refs, "assets": resolved}
                entry["effects"][key] = effect
                effects.append({"palette": ini_path.stem, "kind": key, **effect})
        palettes.append(entry)

    mapdata_path = MAP_DESIGN / "basedata" / "mapdata.tab"
    brushes = []
    by_code: dict[str, list[dict]] = {}
    for terrain_kind in all_kinds:
        by_code.setdefault(terrain_kind["code"], []).append(terrain_kind)
    for columns in parse_tab(mapdata_path):
        if len(columns) < 8 or not columns[0].strip().strip('"').isdigit():
            continue
        icon_ref = columns[5].strip()
        icon_path, _, query = icon_ref.partition("?")
        frame_match = FRAME_RE.search("?" + query) if query else None
        matches = by_code.get(columns[3].strip(), [])
        brushes.append(
            {
                "index": int(columns[0].strip().strip('"')),
                "systemName": columns[1],
                "name": columns[2],
                "code": columns[3].strip(),
                "stampSize": int(columns[4]),
                "icon": {"file": icon_path, "frame": int(frame_match.group(1)) if frame_match else 0},
                "price": int(columns[6]),
                "type": columns[7],
                "paletteMatches": [
                    {"palette": row["palette"], "index": row["index"], "texture": row["texture"]}
                    for row in matches
                ],
            }
        )

    sizes = []
    mapsize_path = MAP_DESIGN / "basedata" / "mapsize.tab"
    for columns in parse_tab(mapsize_path):
        if len(columns) < 4 or not columns[0].strip().strip('"').isdigit():
            continue
        sizes.append(
            {
                "size": int(columns[0].strip().strip('"')),
                "level": columns[1],
                "basePrice": int(columns[2]),
                "description": columns[3],
            }
        )

    return {
        "uiSource": file_evidence(MAP_DESIGN / "design.cfg"),
        "brushSource": file_evidence(mapdata_path),
        "sizeSource": file_evidence(mapsize_path),
        "brushes": brushes,
        "sizes": sizes,
        "palettes": palettes,
        "kindCount": len(all_kinds),
        "linkCount": len(all_links),
        "effects": effects,
    }


def parse_base_table(path: Path, missing: list[dict], decode_errors: list[dict]) -> list[dict]:
    result = []
    roots = [BUILD_RUNTIME, BUILD_DESIGN, BUILD_DESIGN / "imgs"]
    for columns in parse_tab(path):
        if not columns or not columns[0].strip().strip('"').isdigit():
            continue
        row = {
            "no": int(columns[0]),
            "kind": int(columns[1]) if columns[1] else 0,
            "name": columns[2],
        }
        if path.name == "base.tab":
            if len(columns) < 21:
                continue
            row.update(
                {
                    "paper": columns[3],
                    "experience": {
                        "paper": int(columns[4] or 0),
                        "built": int(columns[5] or 0),
                        "design": int(columns[6] or 0),
                    },
                    "rating": {
                        "base": int(columns[7] or 0),
                        "extra": int(columns[8] or 0),
                    },
                    "insideSpace": columns[9],
                    "outsideSpace": columns[10],
                    "upgradeMoney": int(columns[11] or 0),
                    "anchor": [int(columns[12] or 0), int(columns[13] or 0)],
                    "baseImage": columns[14],
                    "maskImage": columns[15],
                    "workImage": columns[16],
                    "map": columns[17],
                    "command": columns[18],
                    "baseMaterials": parse_material_expr(columns[19]),
                    "baseWork": columns[20],
                }
            )
        else:
            if len(columns) < 15:
                continue
            row.update(
                {
                    "paper": columns[3],
                    "experience": {"paper": int(columns[4] or 0), "built": int(columns[5] or 0)},
                    "upgradeMoney": int(columns[6] or 0),
                    "anchor": [int(columns[7] or 0), int(columns[8] or 0)],
                    "baseImage": columns[9],
                    "maskImage": columns[10],
                    "workImage": columns[11],
                    "command": columns[12],
                    "baseMaterials": parse_material_expr(columns[13]),
                    "baseWork": columns[14],
                }
            )
        match = PUT_RE.search(row.get("command", ""))
        row["footprint"] = [int(match.group(1)), int(match.group(2))] if match else None
        assets = {}
        for key in ("baseImage", "maskImage", "workImage"):
            reference = row.get(key)
            if not reference:
                assets[key] = None
                continue
            asset = resolve_asset(reference, roots)
            if asset:
                assets[key] = image_info(asset)
                if not assets[key].get("decodable", True):
                    decode_errors.append(
                        {"owner": rel(path), "reference": reference, **assets[key]}
                    )
            else:
                assets[key] = None
                missing.append({"owner": rel(path), "reference": reference})
        row["assets"] = assets
        result.append(row)
    return result


def parse_build_pack(path: Path, missing: list[dict], decode_errors: list[dict]) -> dict:
    sections = parse_simple_cfg(path)
    basic = sections.get("基本信息", {})
    source_kind = "theme" if "res" in path.parts else "item"
    materials = sections.get("材料", {})
    workloads = sections.get("工作量", {})
    components = []
    for key, reference in sections.get("素材", {}).items():
        if not key.isdigit():
            continue
        component_id = int(key)
        component = {
            "id": component_id,
            "category": component_category(component_id),
            "materials": parse_material_expr(materials.get(key, "")),
            "work": int(workloads.get(key, "0") or 0),
        }
        if reference.upper().startswith("V1;"):
            component.update(
                {
                    "kind": "kit",
                    "paper": reference,
                    "recordCount": len([part for part in reference[3:].split(";") if part]),
                    "asset": None,
                }
            )
        else:
            asset = resolve_asset(reference, [path.parent], current=path.parent)
            asset_info = image_info(asset) if asset else None
            component.update({"kind": "sprite", "file": reference, "asset": asset_info})
            if asset is None:
                missing.append({"owner": rel(path), "reference": reference})
            elif not asset_info.get("decodable", True):
                decode_errors.append({"owner": rel(path), "reference": reference, **asset_info})
        components.append(component)

    templates = []
    for key, value in sections.get("模板", {}).items():
        chunks = value.split("@")
        paper = chunks[0].strip()
        templates.append(
            {
                "index": int(key) if key.isdigit() else key,
                "paper": paper,
                "materials": parse_material_expr(chunks[1]) if len(chunks) > 1 else [],
                "work": int(chunks[2]) if len(chunks) > 2 and chunks[2].isdigit() else 0,
                "level": int(chunks[3]) if len(chunks) > 3 and chunks[3].isdigit() else None,
                "name": chunks[4] if len(chunks) > 4 else "",
                "recordCount": max(0, len([part for part in paper[3:].split(";") if part]))
                if paper.upper().startswith("V1;")
                else 0,
            }
        )

    frame_value = basic.get("框架", "")
    frames = [] if frame_value.upper() == "N" else [
        int(item) for item in split_values(frame_value) if item.isdigit()
    ]
    return {
        "kind": source_kind,
        "key": path.parent.name,
        "name": basic.get("名称", path.parent.name),
        "frames": frames,
        "source": file_evidence(path),
        "components": components,
        "templates": templates,
    }


def component_category(component_id: int) -> str:
    return {
        1: "装饰",
        2: "门窗",
        3: "地面",
        4: "屋顶",
        5: "墙壁",
        6: "套件",
    }.get(component_id // 100, "其他")


def cfg_sections(path: Path) -> list[str]:
    return [
        match.group(1).strip()
        for line in read_text(path).splitlines()
        if (match := CFG_SECTION_RE.match(line))
    ]


def file_evidence(path: Path) -> dict:
    result = {
        "path": rel(path),
        "exists": path.is_file(),
    }
    if path.is_file():
        result.update(
            {
                "bytes": path.stat().st_size,
                "sha256": sha256(path),
            }
        )
        if path.suffix.lower() == ".cfg":
            result["sections"] = cfg_sections(path)
    return result


def building_catalog(missing: list[dict], decode_errors: list[dict]) -> dict:
    base_path = BUILD_DESIGN / "imgs" / "base.tab"
    custom_path = BUILD_DESIGN / "item" / "customroot.tab"
    pack_paths = sorted((BUILD_RUNTIME / "res").glob("*/mat.cfg"))
    pack_paths += sorted((BUILD_RUNTIME / "item").glob("*/mat.cfg"))
    packs = [parse_build_pack(path, missing, decode_errors) for path in pack_paths]
    return {
        "uiSources": {
            "building": file_evidence(BUILD_DESIGN / "builddesign.cfg"),
            "advanced": file_evidence(BUILD_DESIGN / "adorndesign.cfg"),
            "item": file_evidence(BUILD_DESIGN / "itemdesign.cfg"),
            "guide": file_evidence(BUILD_DESIGN / "script" / "svr_designguide.txt"),
        },
        "baseSource": file_evidence(base_path),
        "customBaseSource": file_evidence(custom_path),
        "bases": parse_base_table(base_path, missing, decode_errors),
        "customBases": parse_base_table(custom_path, missing, decode_errors),
        "packs": packs,
        "packCount": len(packs),
        "componentCount": sum(len(pack["components"]) for pack in packs),
        "templateCount": sum(len(pack["templates"]) for pack in packs),
    }


def build_catalog() -> tuple[dict, dict]:
    missing: list[dict] = []
    decode_errors: list[dict] = []
    payload = {
        "schema": 1,
        "authority": "unpacked original game files",
        "gameRoot": GAME.as_posix(),
        "terrain": terrain_catalog(missing, decode_errors),
        "building": building_catalog(missing, decode_errors),
        "nativeGaps": [
            "GTile import/variant selection and final blit implementation",
            "GDesignLayer coordinate, anchor, clipping, z-order and record-flag semantics",
            "GDesignInsideView and advanced passability-grid serialization",
        ],
    }
    missing = unique_issues(missing)
    decode_errors = unique_issues(decode_errors)
    report = {
        "schema": 1,
        "missingCount": len(missing),
        "decodeErrorCount": len(decode_errors),
        "missing": missing,
        "decodeErrors": decode_errors,
        "summary": {
            "terrainBrushes": len(payload["terrain"]["brushes"]),
            "terrainPalettes": len(payload["terrain"]["palettes"]),
            "terrainKinds": payload["terrain"]["kindCount"],
            "terrainLinks": payload["terrain"]["linkCount"],
            "buildingBases": len(payload["building"]["bases"]),
            "customBases": len(payload["building"]["customBases"]),
            "buildingPacks": payload["building"]["packCount"],
            "buildingComponents": payload["building"]["componentCount"],
            "buildingTemplates": payload["building"]["templateCount"],
        },
    }
    return payload, report


def unique_issues(issues: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for issue in issues:
        key = (issue.get("owner"), issue.get("reference"), issue.get("error"))
        if key in seen:
            continue
        seen.add(key)
        result.append(issue)
    return result


def main() -> None:
    payload, report = build_catalog()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"missing={report['missingCount']} decode_errors={report['decodeErrorCount']}")
    print(f"wrote {OUT}")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
