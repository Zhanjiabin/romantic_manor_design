# -*- coding: utf-8 -*-
"""Decode furniture ALEs and build contact sheets like _shuizu/all_tanks.png."""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME

from codec.ale import AleError, ale_to_rgba, parse_ale  # noqa: E402

BASE = GAME / "sourceCode" / "leo" / "rcitem"
OUT = ROOT / "data" / "_all_furn"
SHEET_DIR = OUT / "sheets"

SKIP_TOP = {
    "animal",
    "pc",
    "paint",
    "face",
    "sys",
    "svr",
    "maps",
}
SKIP_ITEM_S = {
    "002letter",
    "110car",
    "114moto",
}
SKIP_NAME_PARTS = (
    "thumb",
    "地形",
    "塔罗",
    "配方图",
    "礼包",
    "晶石",
    "占卜之水",
    "图纸",
    "功能卡",
    "代币建材",
    "元素精华",
    "动态配方",
)
SKIP_ITEM_SUBDIRS = {
    "floorpaint",
    "lanterns",
    "ququ",
    "christmastrain",
}

CELL_W, CELL_H = 168, 198
THUMB = 140
COLS = 8
ROWS_PER_SHEET = 12  # 96 items / sheet
BG = (32, 36, 44, 255)
FG = (255, 255, 255, 255)
FG2 = (180, 200, 220, 255)
ERR = (80, 32, 32, 255)


def _norm(p: Path) -> str:
    return str(p.as_posix())


def group_key(rel: Path) -> str:
    parts = rel.parts
    if parts[0] == "item_s":
        return f"item_s/{parts[1]}" if len(parts) > 1 else "item_s"
    if parts[0] == "tmp":
        return f"tmp/{parts[1]}" if len(parts) > 2 else "tmp/_root"
    if parts[0] == "item":
        # item/foo.ale is a file, not a series folder
        if len(parts) == 2:
            return "item/_root"
        return f"item/{parts[1]}"
    return parts[0]


def should_keep(rel: Path) -> bool:
    parts = rel.parts
    if not parts:
        return False
    top = parts[0]
    if top in SKIP_TOP:
        return False
    name = rel.stem
    low = name.lower()
    if any(s in name or s in low for s in SKIP_NAME_PARTS):
        return False
    if top == "item_s":
        if len(parts) > 1 and parts[1] in SKIP_ITEM_S:
            return False
        return True
    if top == "tmp":
        return True
    if top == "item":
        if len(parts) > 1 and parts[1] in SKIP_ITEM_SUBDIRS:
            return False
        return True
    return False


def collect() -> list[Path]:
    files = []
    for p in BASE.rglob("*.ale"):
        rel = p.relative_to(BASE)
        if should_keep(rel):
            files.append(p)
    files.sort(key=lambda x: str(x.relative_to(BASE)).lower())
    return files


def load_fonts():
    from PIL import ImageFont

    windir = Path(r"C:\Windows\Fonts")
    for name in ("msyh.ttc", "msyh.ttf", "msyhbd.ttc", "simhei.ttf", "simsun.ttc"):
        path = windir / name
        try:
            target = str(path if path.is_file() else name)
            return ImageFont.truetype(target, 13), ImageFont.truetype(target, 11)
        except OSError:
            continue
    d = ImageFont.load_default()
    return d, d


def fit_thumb(im, size: int):
    from PIL import Image

    bbox = im.getbbox()
    cropped = im.crop(bbox) if bbox else im
    thumb = cropped.copy()
    thumb.thumbnail((size, size), Image.Resampling.LANCZOS)
    return thumb, cropped.size


def decode_one(path: Path):
    raw = path.read_bytes()
    doc = parse_ale(raw)
    n = int(doc.get("frames") or 1)
    im = ale_to_rgba(raw, 0)
    thumb, icon_size = fit_thumb(im, THUMB)
    return thumb, n, icon_size, doc.get("format")


def draw_cell(sheet, draw, fonts, x, y, name, note, n, thumb, ok: bool):
    font, font2 = fonts
    if not ok:
        from PIL import Image

        sheet.paste(Image.new("RGBA", (CELL_W - 8, CELL_H - 8), ERR), (x + 4, y + 4))
    elif thumb is not None:
        px = x + (CELL_W - thumb.width) // 2
        py = y + 6
        sheet.paste(thumb, (px, py), thumb)
    title = name if len(name) <= 12 else name[:11] + "…"
    sub = f"{note}  {n}帧" if n else note
    if len(sub) > 18:
        sub = sub[:17] + "…"
    draw.text((x + 6, y + CELL_H - 36), title, fill=FG, font=font)
    draw.text((x + 6, y + CELL_H - 18), sub, fill=FG2, font=font2)


def note_for(rel: Path) -> str:
    parts = rel.parts
    if parts[0] == "item_s" and len(parts) >= 3:
        return "/".join(parts[1:-1])
    if parts[0] == "tmp" and len(parts) >= 2:
        return parts[1] if len(parts) > 2 else "tmp"
    if parts[0] == "item":
        return "item动态" if "动态" in rel.stem else "item"
    return str(rel.parent).replace("\\", "/")


def save_sheet(group: str, page: int, pages: int, cells, fonts):
    from PIL import Image, ImageDraw

    n = len(cells)
    cols = COLS
    rows = (n + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * CELL_W, rows * CELL_H + 28), BG)
    draw = ImageDraw.Draw(sheet)
    font, _ = fonts
    title = group if pages <= 1 else f"{group}  ({page}/{pages})"
    draw.text((8, 6), f"{title}  ·  {n}件", fill=FG, font=font)
    y0 = 28
    for i, cell in enumerate(cells):
        x = (i % cols) * CELL_W
        y = y0 + (i // cols) * CELL_H
        draw_cell(sheet, draw, fonts, x, y, *cell)
    safe = group.replace("/", "_").replace("\\", "_")
    suffix = "" if pages <= 1 else f"_{page:02d}"
    dest = SHEET_DIR / f"{safe}{suffix}.png"
    sheet.save(dest, optimize=False)
    return dest, sheet.size


def chunk(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def write_html(groups, sheets, fails, total):
    lines = [
        "<!doctype html><meta charset=utf-8>",
        "<title>浪漫庄园 全部家具对照</title>",
        "<style>body{background:#20242c;color:#e8eef4;font:14px/1.45 'Microsoft YaHei',sans-serif;margin:16px}",
        "a{color:#9ec5ff} img{max-width:100%;height:auto;background:#282c34;margin:8px 0}",
        "input{width:min(480px,90%);padding:8px 10px;font-size:15px;border-radius:6px;border:0}",
        "li{margin:2px 0} .miss{color:#f6a} .nav a{margin-right:10px;display:inline-block}</style>",
        f"<h1>全部家具对照  {total} 件</h1>",
        "<p>按系列做成多张图，样式和水族那张一样。浏览器 Ctrl+F 可搜名字。"
        " 车体/信件/材料已排除；活动家具在 tmp 目录。</p>",
        "<p><input id=q placeholder='搜索家具名…' oninput='flt()'></p>",
        "<div class=nav>",
    ]
    for g in groups:
        lines.append(f"<a href='#{g}'>{g}</a>")
    lines.append("</div>")
    if fails:
        lines.append(f"<h2>解码失败 {len(fails)}</h2><ul class=miss>")
        for name, err in fails:
            lines.append(f"<li>{name} — {err}</li>")
        lines.append("</ul>")
    cur = None
    for path, group, names in sheets:
        rel = path.relative_to(OUT).as_posix()
        if group != cur:
            lines.append(f"<h2 id='{group}'>{group}</h2>")
            cur = group
        lines.append(f"<p><img src='{rel}' alt='{group}'></p>")
        lines.append("<ul>")
        for nm in names:
            lines.append(f"<li>{nm}</li>")
        lines.append("</ul>")
    lines.append(
        "<script>function flt(){const q=document.getElementById('q').value;"
        "document.querySelectorAll('li').forEach(li=>{"
        "li.style.display=li.textContent.includes(q)?'':'none'})}</script>"
    )
    (OUT / "index.html").write_text("\n".join(lines), encoding="utf-8")


def write_list(rows):
    lines = ["name\tgroup\tframes\tpath\tok"]
    for r in rows:
        lines.append("\t".join(str(x) for x in r))
    (OUT / "list.tsv").write_text("\n".join(lines), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    files = collect()
    print("collect", len(files), "ales from", BASE)
    grouped = defaultdict(list)
    for p in files:
        grouped[group_key(p.relative_to(BASE))].append(p)

    fonts = load_fonts()
    fails = []
    rows = []
    sheets_meta = []
    per_group_ok = {}

    keys = sorted(grouped)
    done = 0
    for gi, key in enumerate(keys, 1):
        cells = []
        names_all = []
        for p in grouped[key]:
            rel = p.relative_to(BASE)
            name = p.stem
            note = note_for(rel)
            done += 1
            try:
                thumb, n, icon_size, fmt = decode_one(p)
                cells.append((name, note, n, thumb, True))
                names_all.append(f"{name}  ({note}, {n}帧)")
                rows.append((name, key, n, rel.as_posix(), "ok"))
            except Exception as exc:
                cells.append((name, note, 0, None, False))
                names_all.append(f"{name}  [失败]")
                fails.append((rel.as_posix(), type(exc).__name__ + ": " + str(exc)[:80]))
                rows.append((name, key, 0, rel.as_posix(), "fail"))
            if done % 50 == 0:
                print(f"  {done}/{len(files)}  last={name}", flush=True)
        per_group_ok[key] = sum(1 for c in cells if c[4])
        parts = list(chunk(cells, COLS * ROWS_PER_SHEET))
        pages = len(parts)
        name_i = 0
        for page, part in enumerate(parts, 1):
            dest, size = save_sheet(key, page, pages, part, fonts)
            part_names = names_all[name_i : name_i + len(part)]
            name_i += len(part)
            sheets_meta.append((dest, key, part_names))
            print(f"sheet {dest.name} {size} items={len(part)} [{gi}/{len(keys)}]", flush=True)

    write_html(keys, sheets_meta, fails, len(files))
    write_list(rows)
    print("DONE files", len(files), "sheets", len(sheets_meta), "fail", len(fails))
    print("OUT", OUT)
    for k in keys:
        print(f"  {k:28} {len(grouped[k]):4}  ok={per_group_ok.get(k)}")


if __name__ == "__main__":
    main()
