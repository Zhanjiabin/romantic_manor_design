# -*- coding: utf-8 -*-
"""Copy native clothing UV templates and write data/cloth_catalog.json.

Source is the user-verified 服装设计 folder (UV unwraps), plus the single
face-ornament board. Finished papers in 衣服设计图纸大全 are not copied.
"""
from __future__ import annotations

import json
import shutil
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT_DIR = DATA / "cloth" / "templates"
CATALOG = DATA / "cloth_catalog.json"

SRC_ROOTS = [
    Path(r"C:\Users\Corona\Desktop\衣服设计\服装设计"),
    Path(r"D:\Users\Corona\Desktop\衣服设计\服装设计"),
]
FACE_SOURCES = [
    Path(r"C:\Users\Corona\Desktop\衣服设计\衣服设计图纸大全\图纸\图纸\个性衣服\面饰.jpg"),
    Path(r"D:\Users\Corona\Desktop\衣服设计\衣服设计图纸大全\图纸\图纸\个性衣服\面饰.jpg"),
]

KINDS = [
    {
        "id": "female-short",
        "label": "短款女装",
        "shop": "短款个性女装",
        "gender": "female",
        "diyType": "cloth",
        "width": 256,
        "height": 256,
        "folder": "女短",
        "price": 400,
        "designFee": 8000,
    },
    {
        "id": "female-long",
        "label": "长款女装",
        "shop": "长款个性女装",
        "gender": "female",
        "diyType": "cloth",
        "width": 256,
        "height": 256,
        "folder": "女长",
        "price": 400,
        "designFee": 8000,
    },
    {
        "id": "female-skirt",
        "label": "女款长裙",
        "shop": "个性女款长裙",
        "gender": "female",
        "diyType": "cloth",
        "width": 256,
        "height": 256,
        "folder": "女裙",
        "price": 400,
        "designFee": 10000,
    },
    {
        "id": "male-short",
        "label": "短款男装",
        "shop": "短款个性男装",
        "gender": "male",
        "diyType": "cloth",
        "width": 256,
        "height": 256,
        "folder": "男短",
        "price": 400,
        "designFee": 8000,
    },
    {
        "id": "male-long",
        "label": "长款男装",
        "shop": "长款个性男装",
        "gender": "male",
        "diyType": "cloth",
        "width": 256,
        "height": 256,
        "folder": "男长",
        "price": 400,
        "designFee": 8000,
    },
    {
        "id": "expression",
        "label": "表情",
        "shop": "个性表情",
        "gender": "both",
        "diyType": "biaoqing",
        "width": 256,
        "height": 256,
        "folder": "表情",
        "price": 150,
        "designFee": 1000,
        "moods": ["微笑", "开心", "调皮", "惊呆", "藐视", "沮丧", "睡觉", "愤怒", "委屈", "伤心", "无知"],
    },
    {
        "id": "face",
        "label": "面饰",
        "shop": "个性面饰",
        "gender": "both",
        "diyType": "face",
        "width": 256,
        "height": 256,
        "folder": None,
        "price": 150,
        "designFee": 1000,
    },
    {
        "id": "hair",
        "label": "头巾",
        "shop": "个性头巾",
        "gender": "both",
        "diyType": "fair",
        "width": 512,
        "height": 256,
        "folder": "头巾",
        "price": 200,
        "designFee": 2000,
    },
]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
ONE_PER_KIND = True
KEEP_PREFERRED = {
    "female-short": ["短款白-1.jpg", "女短白-2.jpg", "女短橙-1.jpg"],
    "female-long": ["女长白-1.jpg"],
    "female-skirt": ["长裙白-1.jpg"],
    "male-short": ["男短白-1.jpg"],
    "male-long": ["男长白-1.jpg"],
    "expression": ["脸形-1.jpg", "脸型-1.jpg", "q表情.jpg"],
    "face": ["面饰.jpg"],
    "hair": ["发型-1.jpg"],
}


def find_src_root() -> Path | None:
    for path in SRC_ROOTS:
        if path.is_dir():
            return path
    return None


def find_face() -> Path | None:
    for path in FACE_SOURCES:
        if path.is_file():
            return path
    return None


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            return width, height
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            i += 2
            continue
        if i + 4 > len(data):
            break
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if length < 2:
            break
        i += 2 + length
    return None


def png_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def gif_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10 or data[:6] not in {b"GIF87a", b"GIF89a"}:
        return None
    width, height = struct.unpack("<HH", data[6:10])
    return width, height


def image_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return jpeg_size(data)
    if suffix == ".png":
        return png_size(data)
    if suffix == ".gif":
        return gif_size(data)
    return jpeg_size(data) or png_size(data) or gif_size(data)


def copy_file(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size == src.stat().st_size:
        return
    shutil.copy2(src, dest)


def template_entry(kind: dict, src: Path, dest: Path, index: int) -> dict:
    size = image_size(dest if dest.is_file() else src) or (kind["width"], kind["height"])
    rel = dest.relative_to(DATA).as_posix()
    return {
        "id": f"{kind['id']}:{src.stem}",
        "name": src.stem,
        "file": src.name,
        "url": "/data/" + rel,
        "width": size[0],
        "height": size[1],
        "index": index,
    }


def collect_folder(kind: dict, src_root: Path) -> list[dict]:
    folder = kind.get("folder")
    if not folder:
        return []
    src_dir = src_root / folder
    if not src_dir.is_dir():
        return []
    dest_dir = OUT_DIR / kind["id"]
    files = sorted(
        (path for path in src_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES),
        key=lambda path: path.name.lower(),
    )
    templates = []
    for index, src in enumerate(files):
        dest = dest_dir / src.name
        copy_file(src, dest)
        templates.append(template_entry(kind, src, dest, index))
    return templates


def pick_keep(kind_id: str, files: list[Path]) -> Path | None:
    if not files:
        return None
    by_name = {path.name: path for path in files}
    for name in KEEP_PREFERRED.get(kind_id, []):
        if name in by_name:
            return by_name[name]
    return files[0]


def keep_one_template(kind: dict, templates: list[dict]) -> list[dict]:
    if not ONE_PER_KIND or not templates:
        return templates
    dest_dir = OUT_DIR / kind["id"]
    files = sorted(
        (path for path in dest_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES),
        key=lambda path: path.name.lower(),
    ) if dest_dir.is_dir() else []
    keep = pick_keep(kind["id"], files)
    if keep is None:
        return templates[:1]
    for path in files:
        if path.resolve() != keep.resolve():
            path.unlink()
    kept = next((row for row in templates if row.get("file") == keep.name), None)
    if kept is None:
        kept = template_entry(kind, keep, keep, 0)
    kept["index"] = 0
    kept["name"] = "默认 UV"
    dest_uv = dest_dir / "uv.jpg"
    if keep.is_file() and keep.resolve() != dest_uv.resolve():
        copy_file(keep, dest_uv)
        keep.unlink()
    kept["file"] = "uv.jpg"
    kept["url"] = f"/data/cloth/templates/{kind['id']}/uv.jpg?v=3"
    return [kept]


def collect_face(kind: dict) -> list[dict]:
    src = find_face()
    if src is None:
        return []
    dest = OUT_DIR / kind["id"] / src.name
    copy_file(src, dest)
    return [template_entry(kind, src, dest, 0)]


def main() -> None:
    src_root = find_src_root()
    if src_root is None and not any((OUT_DIR / kind["id"]).is_dir() for kind in KINDS):
        raise SystemExit("找不到衣服设计模板目录：C:\\Users\\Corona\\Desktop\\衣服设计\\服装设计")

    kinds = []
    for kind in KINDS:
        templates = collect_face(kind) if kind["id"] == "face" else collect_folder(kind, src_root) if src_root else []
        if not templates:
            existing = OUT_DIR / kind["id"]
            if existing.is_dir():
                files = sorted(
                    (path for path in existing.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES),
                    key=lambda path: path.name.lower(),
                )
                templates = [template_entry(kind, path, path, index) for index, path in enumerate(files)]
        templates = keep_one_template(kind, templates)
        row = {key: value for key, value in kind.items() if key != "folder"}
        row["templateCount"] = len(templates)
        row["templates"] = templates
        kinds.append(row)

    catalog = {
        "v": 1,
        "native": {
            "window": [500, 480],
            "fairWindow": [760, 500],
            "paint": [256, 256],
            "fairPaint": [512, 256],
            "diyTypes": ["cloth", "fair", "face", "biaoqing"],
            "source": "svr/cloth/design.cfg GPaintObj",
        },
        "kinds": kinds,
        "templateCount": sum(kind["templateCount"] for kind in kinds),
    }
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", CATALOG.relative_to(ROOT), "templates", catalog["templateCount"])


if __name__ == "__main__":
    main()
