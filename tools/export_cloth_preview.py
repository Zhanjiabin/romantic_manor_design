# -*- coding: utf-8 -*-
"""Export native CMZ try-on meshes + default textures into data/cloth/preview/."""
from __future__ import annotations

import json
import math
import shutil
import struct
from pathlib import Path

from cmz_parse import parse_cmz

GAME = Path(r"D:\game\浪漫庄园")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "cloth" / "preview"

KIND_BODY = {
    "female-short": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_1\g_yifu.cmz",
    "female-long": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_2\g_yifu.cmz",
    "female-skirt": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_3\g_yifu.cmz",
    "male-short": GAME / r"sourceCode\leo\rcitem\pc\b_cmz\body\diy_1\b_yifu.cmz",
    "male-long": GAME / r"sourceCode\leo\rcitem\pc\b_cmz\body\diy_2\b_yifu.cmz",
}

SHARED = {
    "female-head": GAME / r"sourceCode\leo\rcex\act\g_cmz\head\nol\g_head.cmz",
    "female-hair": GAME / r"sourceCode\leo\rcex\act\g_cmz\toushi\nol\g_toushi_c.cmz",
    "male-head": GAME / r"sourceCode\leo\rcex\act\b_cmz\head\nol\b_head.cmz",
    "male-hair": GAME / r"sourceCode\leo\rcex\act\b_cmz\toushi\nol\b_toushi_c.cmz",
}

TEXTURES = {
    "female-skin": GAME / r"sourceCode\leo\rcex\act\g_cmz\g_pifu_0.jpg",
    "female-head": GAME / r"sourceCode\leo\rcex\act\g_cmz\g_tou_bq_1_00.jpg",
    "female-hair": GAME / r"sourceCode\leo\rcex\act\g_cmz\toushi\nol\g_toushi_0.jpg",
    "male-skin": GAME / r"sourceCode\leo\rcex\act\b_cmz\b_pifu_0.jpg",
    "male-head": GAME / r"sourceCode\leo\rcex\act\b_cmz\b_tou_bq_1_00.jpg",
    "male-hair": GAME / r"sourceCode\leo\rcex\act\b_cmz\toushi\nol\b_toushi_0.jpg",
    "bk": GAME / r"sourceCode\leo\rcsys\basesvr\equip\imgs\bk_visu1.png",
}

KIND_CLOTH_TEX = {
    "female-short": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_1\g_yifu.jpg",
    "female-long": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_2\g_yifu.jpg",
    "female-skirt": GAME / r"sourceCode\leo\rcitem\pc\g_cmz\body\diy_3\g_yifu.jpg",
    "male-short": GAME / r"sourceCode\leo\rcitem\pc\b_cmz\body\diy_1\b_yifu.jpg",
    "male-long": GAME / r"sourceCode\leo\rcitem\pc\b_cmz\body\diy_2\b_yifu.jpg",
}


def pack_sub(sub, slot: str, texture: str) -> dict:
    pos = []
    nrm = []
    uv = []
    for p, n, t in zip(sub.positions, sub.normals, sub.uvs):
        pos.extend(round(x, 4) for x in p)
        nrm.extend(round(x, 4) for x in n)
        uv.extend(round(x, 5) for x in t)
    idx = [i for face in sub.faces for i in face]
    return {
        "slot": slot,
        "name": sub.name,
        "texture": texture,
        "positions": pos,
        "normals": nrm,
        "uvs": uv,
        "indices": idx,
    }


def body_parts(path: Path, gender: str) -> list[dict]:
    model = parse_cmz(path)
    parts = []
    for mesh in model.meshes:
        key = mesh.name.lower()
        if "pifu" in key:
            parts.append(pack_sub(mesh.submeshes[0], "skin", f"{gender}-skin.jpg"))
        elif "yifu" in key:
            parts.append(pack_sub(mesh.submeshes[0], "cloth", "cloth"))
        else:
            parts.append(pack_sub(mesh.submeshes[0], "other", f"{gender}-skin.jpg"))
    return parts


def shared_part(path: Path, slot: str, texture: str) -> dict:
    model = parse_cmz(path)
    return pack_sub(model.meshes[0].submeshes[0], slot, texture)


def write_png_preview(parts: list[dict], textures: dict[str, Path], dest: Path, yaw: float = 0.0) -> None:
    """Tiny z-buffer rasterizer so we can inspect bind-pose silhouettes."""
    try:
        from PIL import Image
    except ImportError:
        print("no Pillow, skip raster", dest)
        return

    w, h = 220, 300
    img = Image.new("RGB", (w, h), (18, 18, 28))
    zbuf = [1e9] * (w * h)
    pix = img.load()
    tex_cache = {}

    def load_tex(key: str):
        if key in tex_cache:
            return tex_cache[key]
        path = textures.get(key)
        if not path or not path.exists():
            tex_cache[key] = None
            return None
        im = Image.open(path).convert("RGB")
        tex_cache[key] = im
        return im

    cy, cz = math.cos(yaw), math.sin(yaw)
    # Camera: look from +Y, Z up, character origin at feet.
    cam_y = 220.0
    cam_z = 80.0
    scale = 1.55

    def project(x, y, z):
        xr = x * cy - y * math.sin(yaw)
        yr = x * math.sin(yaw) + y * cy
        # simple perspective from +Y
        depth = cam_y - yr
        if depth < 8:
            return None
        px = xr * scale * (180.0 / depth)
        py = (z - cam_z) * scale * (180.0 / depth)
        sx = int(w * 0.5 + px)
        sy = int(h * 0.62 - py)
        return sx, sy, depth

    def sample(tex, u, v):
        if tex is None:
            return (200, 180, 160)
        u = u - math.floor(u)
        v = 1.0 - (v - math.floor(v))
        x = min(tex.size[0] - 1, max(0, int(u * tex.size[0])))
        y = min(tex.size[1] - 1, max(0, int(v * tex.size[1])))
        return tex.getpixel((x, y))

    def draw_tri(p0, p1, p2, uv0, uv1, uv2, tex, shade):
        xs = [p0[0], p1[0], p2[0]]
        ys = [p0[1], p1[1], p2[1]]
        minx, maxx = max(0, min(xs)), min(w - 1, max(xs))
        miny, maxy = max(0, min(ys)), min(h - 1, max(ys))
        area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
        if area <= 1:
            return
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                w0 = (p1[0] - p0[0]) * (y - p0[1]) - (p1[1] - p0[1]) * (x - p0[0])
                w1 = (p2[0] - p1[0]) * (y - p1[1]) - (p2[1] - p1[1]) * (x - p1[0])
                w2 = (p0[0] - p2[0]) * (y - p2[1]) - (p0[1] - p2[1]) * (x - p2[0])
                if w0 < 0 or w1 < 0 or w2 < 0:
                    continue
                a = w0 / area
                b = w1 / area
                c = 1 - a - b
                z = p0[2] * c + p1[2] * a + p2[2] * b
                i = y * w + x
                if z >= zbuf[i]:
                    continue
                zbuf[i] = z
                u = uv0[0] * c + uv1[0] * a + uv2[0] * b
                v = uv0[1] * c + uv1[1] * a + uv2[1] * b
                r, g, bl = sample(tex, u, v)
                pix[x, y] = (
                    min(255, int(r * shade)),
                    min(255, int(g * shade)),
                    min(255, int(bl * shade)),
                )

    order = {"skin": 0, "cloth": 1, "head": 2, "hair": 3}
    for part in sorted(parts, key=lambda p: order.get(p["slot"], 9)):
        tex_key = part["texture"]
        tex = load_tex(tex_key)
        pos = part["positions"]
        nrm = part["normals"]
        uvs = part["uvs"]
        idx = part["indices"]
        nvert = len(pos) // 3
        projected = []
        for i in range(nvert):
            pr = project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
            projected.append(pr)
        for t in range(0, len(idx), 3):
            i0, i1, i2 = idx[t], idx[t + 1], idx[t + 2]
            if i0 >= nvert or i1 >= nvert or i2 >= nvert:
                continue
            p0, p1, p2 = projected[i0], projected[i1], projected[i2]
            if not p0 or not p1 or not p2:
                continue
            nx = nrm[i0 * 3]
            # rotate normal xz-ish lighting from camera +Y
            ny = nrm[i0 * 3 + 1]
            shade = 0.45 + 0.55 * max(0.0, ny * cy + nx * math.sin(yaw) * 0.15 + 0.35)
            draw_tri(
                p0,
                p1,
                p2,
                (uvs[i0 * 2], uvs[i0 * 2 + 1]),
                (uvs[i1 * 2], uvs[i1 * 2 + 1]),
                (uvs[i2 * 2], uvs[i2 * 2 + 1]),
                tex,
                shade,
            )
    img.save(dest)
    print("wrote", dest)


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for key, src in TEXTURES.items():
        dest = OUT / ("bk_visu1.png" if key == "bk" else f"{key}.jpg" if src.suffix.lower() == ".jpg" else src.name)
        if key == "bk":
            dest = OUT / "bk_visu1.png"
        shutil.copy2(src, dest)
        print("tex", dest.name, src.stat().st_size)

    for kind, src in KIND_CLOTH_TEX.items():
        dest = OUT / f"{kind}-default.jpg"
        shutil.copy2(src, dest)

    shared = {
        "female-head": shared_part(SHARED["female-head"], "head", "female-head.jpg"),
        "female-hair": shared_part(SHARED["female-hair"], "hair", "female-hair.jpg"),
        "male-head": shared_part(SHARED["male-head"], "head", "male-head.jpg"),
        "male-hair": shared_part(SHARED["male-hair"], "hair", "male-hair.jpg"),
    }

    kinds = {}
    for kind, path in KIND_BODY.items():
        gender = "female" if kind.startswith("female") else "male"
        parts = body_parts(path, gender)
        kinds[kind] = {
            "gender": gender,
            "body": parts,
            "head": f"{gender}-head",
            "hair": f"{gender}-hair",
            "defaultCloth": f"{kind}-default.jpg",
        }
        print(kind, [p["slot"] for p in parts], [len(p["positions"]) // 3 for p in parts])

    manifest = {
        "v": 1,
        "viewport": [220, 300],
        "up": "z",
        "kinds": kinds,
        "shared": shared,
        "slotKinds": {
            "hair": "hair",
            "face": "head",
            "expression": "head",
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("manifest", (OUT / "manifest.json").stat().st_size)

    tex_map_base = {
        "female-skin.jpg": OUT / "female-skin.jpg",
        "female-head.jpg": OUT / "female-head.jpg",
        "female-hair.jpg": OUT / "female-hair.jpg",
        "male-skin.jpg": OUT / "male-skin.jpg",
        "male-head.jpg": OUT / "male-head.jpg",
        "male-hair.jpg": OUT / "male-hair.jpg",
    }
    shots = OUT / "shots"
    shots.mkdir()
    for kind, info in kinds.items():
        gender = info["gender"]
        parts = list(info["body"]) + [shared[f"{gender}-head"], shared[f"{gender}-hair"]]
        tex_map = dict(tex_map_base)
        tex_map["cloth"] = OUT / info["defaultCloth"]
        write_png_preview(parts, tex_map, shots / f"{kind}-front.png", yaw=0.0)
        write_png_preview(parts, tex_map, shots / f"{kind}-back.png", yaw=math.pi)


if __name__ == "__main__":
    main()
