"""Pillow renderer matching ``web/building-preview.js`` ``renderPaper``.

Integer rules copy JavaScript: ``Math.trunc``, ``Math.round`` (half toward +inf),
``Math.floor`` / ``Math.ceil``. Record order is paint order; do not depth-sort.
Aliases may decode existing papers. Do not invent ``mat=0``.
"""

from __future__ import annotations

import math
import re as _re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

from PIL import Image, ImageChops, ImageFilter

from codec.ale import AleError, ale_to_rgba
from game_paths import BDESIGN_IMGS, BDESIGN_RES, GAME
from image_to_building.catalog import frame_count, frame_geometry, load_json
from image_to_building.foot_model import foot_offset_from_image
from image_to_building.schema import RENDERER_VERSION
from image_to_building.state_map import resolved_frame

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "editor_catalog.json"
UID_PATH = ROOT / "data" / "building_pack_uids.json"

DESIGN_W = 570
DESIGN_H = 550
NATIVE_LAYER_W = 1690
NATIVE_LAYER_H = 1030
DEFAULT_GRASS = "glsbg.gif"
MARGIN = 8
ALPHA_CROP = 2
_TRY_FILE = _re.compile(r"^try\d+$", _re.I)

CoordinateSpace = Literal["editor", "native", "paper"]


def js_round(value: float) -> int:
    """ES ``Math.round``: half toward +Infinity."""
    return int(math.floor(float(value) + 0.5))


def js_trunc(value: float) -> int:
    return int(math.trunc(float(value)))


def native_half_delta(a: float, b: float) -> int:
    return js_trunc((float(a) - float(b)) / 2.0)


def _max_channel_alpha(r: int, g: int, b: int, a: int) -> float:
    return (max(r, g, b) * a) / 255.0


def opaque_diamond_vertices(image: Image.Image, threshold: int = 32) -> dict | None:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    def solid(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        return _max_channel_alpha(r, g, b, a) >= threshold

    def mid_run_y(y: int):
        left = -1
        right = -1
        for x in range(width):
            if not solid(x, y):
                continue
            if left < 0:
                left = x
            right = x
        if left < 0:
            return None
        return {"x": (left + right) >> 1, "y": y}

    def mid_run_x(x: int):
        top = -1
        bottom = -1
        for y in range(height):
            if not solid(x, y):
                continue
            if top < 0:
                top = y
            bottom = y
        if top < 0:
            return None
        return {"x": x, "y": (top + bottom) >> 1}

    top = None
    bottom = None
    left_x = -1
    right_x = -1
    for y in range(height):
        for x in range(width):
            if not solid(x, y):
                continue
            if top is None:
                top = mid_run_y(y)
            bottom = {"x": x, "y": y}
            if left_x < 0 or x < left_x:
                left_x = x
            if x > right_x:
                right_x = x
    if top is None or bottom is None:
        return None
    bottom = mid_run_y(bottom["y"]) or bottom
    return {
        "top": top,
        "right": mid_run_x(right_x) or {"x": right_x, "y": bottom["y"]} if right_x >= 0 else {"x": width - 1, "y": bottom["y"]},
        "bottom": bottom,
        "left": mid_run_x(left_x) or {"x": left_x, "y": bottom["y"]} if left_x >= 0 else {"x": 0, "y": bottom["y"]},
    }


def opaque_bottom_vertex(image: Image.Image, threshold: int = 32) -> dict | None:
    diamond = opaque_diamond_vertices(image, threshold)
    return diamond["bottom"] if diamond else None


def floor_quad_from_diamond(diamond: dict | None) -> dict | None:
    if not diamond or not diamond.get("bottom"):
        return None
    front = diamond["bottom"]

    def rel(point: dict) -> dict:
        return {"x": point["x"] - front["x"], "y": point["y"] - front["y"]}

    return {
        "top": rel(diamond["top"]),
        "right": rel(diamond["right"]),
        "bottom": {"x": 0, "y": 0},
        "left": rel(diamond["left"]),
    }


def floor_snug_in_mask(floor: Image.Image, mask: Image.Image | None) -> dict:
    floor_w, floor_h = floor.size
    if mask is not None:
        mask_w, mask_h = mask.size
    else:
        mask_w, mask_h = floor_w, floor_h
    mask_bottom = opaque_bottom_vertex(mask, 32) if mask is not None else None
    floor_bottom = opaque_bottom_vertex(floor, 96)
    if mask_bottom and floor_bottom:
        return {"x": mask_bottom["x"] - floor_bottom["x"], "y": mask_bottom["y"] - floor_bottom["y"]}
    return {
        "x": js_round((mask_w - floor_w) / 2.0),
        "y": max(0, mask_h - floor_h),
    }


def alpha_bounds(image: Image.Image, hit: int = ALPHA_CROP) -> dict:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    extrema = rgba.getchannel("A").getextrema()
    if extrema[1] < hit:
        return {"left": 0, "top": 0, "right": width, "bottom": height}
    bbox = rgba.getchannel("A").point(lambda a: 255 if a >= hit else 0).getbbox()
    if not bbox:
        return {"left": 0, "top": 0, "right": width, "bottom": height}
    left, top, right, bottom = bbox
    return {"left": left, "top": top, "right": right, "bottom": bottom}


def translation_matrix(dx: float, dy: float) -> list[list[float]]:
    return [[1.0, 0.0, float(dx)], [0.0, 1.0, float(dy)], [0.0, 0.0, 1.0]]


@dataclass(frozen=True)
class RenderOptions:
    base_no: int
    coordinate_space: CoordinateSpace = "native"
    include_mask_grass: bool = True
    include_floor: bool = True
    trace_instances: bool = False
    local_pack_key: str = ""
    grass_name: str = DEFAULT_GRASS


@dataclass
class RenderTrace:
    image: Image.Image
    instance_visible_masks: dict[int, Image.Image] = field(default_factory=dict)
    instance_amodal_masks: dict[int, Image.Image] = field(default_factory=dict)
    bboxes: dict[int, tuple[int, int, int, int]] = field(default_factory=dict)
    footpoints: dict[int, tuple[float, float]] = field(default_factory=dict)
    z_order: list[int] = field(default_factory=list)
    paper_to_image: list[list[float]] = field(default_factory=lambda: translation_matrix(0, 0))
    ground_anchor: tuple[float, float] = (0.0, 0.0)
    content_offset: tuple[float, float] = (0.0, 0.0)
    floor_quad: dict | None = None
    unresolved: list[int] = field(default_factory=list)
    base_no: int = 0
    footprint: list[int] = field(default_factory=lambda: [3, 3])
    renderer_version: str = RENDERER_VERSION


class PreviewAssets:
    """Catalog + on-disk ALE/GIF decode using the same crop flags as ``server.py``."""

    def __init__(self, catalog: dict | None = None, uid_doc: dict | None = None, game_root: Path | None = None):
        self.catalog = catalog or load_json(CATALOG_PATH)
        self.uid_doc = uid_doc or load_json(UID_PATH)
        self.game = Path(game_root) if game_root else GAME
        self.imgs = self.game / "sourceCode" / "leo" / "rcsys" / "svr" / "bdesign" / "imgs"
        self.res = self.game / "sourceCode" / "leo" / "rcex" / "svr" / "bdesign"
        if not self.imgs.is_dir():
            self.imgs = BDESIGN_IMGS
        if not self.res.is_dir():
            self.res = BDESIGN_RES
        self.mapping = {str(k): v for k, v in (self.uid_doc.get("mapping") or {}).items()}
        self.aliases = {str(k): v for k, v in (self.uid_doc.get("aliases") or {}).items()}
        self.packs = {str(pack.get("key") or ""): pack for pack in (self.catalog.get("building") or {}).get("packs") or []}
        self.bases = {(int(base.get("no") or 0)): base for base in (self.catalog.get("building") or {}).get("bases") or []}
        self._images: dict[tuple, Image.Image] = {}

    def base_by_no(self, base_no: int) -> dict | None:
        return self.bases.get(int(base_no))

    def resolve_component(self, mat, local_pack_key: str = "") -> dict | None:
        value = max(0, int(js_round(float(mat or 0))))
        if not value:
            return None
        local = value if value < 1000 else value % 1000
        uid = 0 if value < 1000 else value // 1000
        pack_key = local_pack_key if value < 1000 else self.mapping.get(str(uid)) or self.aliases.get(str(uid)) or ""
        pack = self.packs.get(pack_key)
        if not pack:
            return None
        component = next(
            (
                row
                for row in (pack.get("components") or [])
                if row.get("kind") == "sprite" and int(row.get("id") or 0) == local
            ),
            None,
        )
        if not component:
            return None
        stem = str(component.get("file") or "").lower().replace(".ale", "")
        if _TRY_FILE.match(stem):
            return None
        return {"component": component, "pack": pack, "packKey": pack_key, "local": local, "uid": uid, "mat": value}

    def _game_file(self, rel: str) -> Path:
        return self.game / str(rel).replace("\\", "/")

    def load_ale(self, path: Path, frame: int = 0) -> Image.Image:
        key = ("ale", str(path), int(frame))
        cached = self._images.get(key)
        if cached is not None:
            return cached.copy()
        image = ale_to_rgba(path.read_bytes(), frame=frame).convert("RGBA")
        self._images[key] = image
        return image.copy()

    def load_bitmap(self, path: Path) -> Image.Image:
        key = ("file", str(path), 0)
        cached = self._images.get(key)
        if cached is not None:
            return cached.copy()
        image = Image.open(path)
        image.load()
        image = image.convert("RGBA")
        self._images[key] = image
        return image.copy()

    def load_base_image(self, base: dict) -> Image.Image:
        rel = ((base.get("assets") or {}).get("baseImage") or {}).get("path")
        if rel:
            path = self._game_file(rel)
            if path.is_file():
                return self.load_ale(path, 0)
        name = str(base.get("baseImage") or "")
        path = self.imgs / name
        if path.suffix.lower() == ".ale" and path.is_file():
            return self.load_ale(path, 0)
        raise FileNotFoundError(f"missing baseimg for {base.get('no')}")

    def load_mask_image(self, base: dict) -> Image.Image | None:
        rel = ((base.get("assets") or {}).get("maskImage") or {}).get("path")
        if rel:
            path = self._game_file(rel)
            if path.is_file():
                if path.suffix.lower() == ".ale":
                    return self.load_ale(path, 0)
                return self.load_bitmap(path)
        name = str(base.get("maskImage") or "")
        if not name:
            return None
        path = self.imgs / name
        if not path.is_file():
            return None
        if path.suffix.lower() == ".ale":
            return self.load_ale(path, 0)
        return self.load_bitmap(path)

    def load_grass(self, name: str = DEFAULT_GRASS) -> Image.Image | None:
        path = self.imgs / name
        if path.is_file():
            return self.load_bitmap(path)
        return None

    def load_sprite(self, component: dict, state_value: int = 0) -> tuple[Image.Image, dict]:
        count = frame_count(component)
        frame = resolved_frame(int(state_value or 0), count)
        geometry = frame_geometry(component, frame)
        rel = str((component.get("asset") or {}).get("path") or "")
        path = self._game_file(rel) if rel else None
        if path is None or not path.is_file():
            pack_file = str(component.get("file") or "")
            raise FileNotFoundError(f"missing sprite {pack_file}")
        image = self.load_ale(path, frame)
        width = int(geometry.get("width") or image.width)
        height = int(geometry.get("height") or image.height)
        if image.size != (width, height) and width > 0 and height > 0:
            image = image.resize((width, height), Image.Resampling.BILINEAR)
        return image, geometry


@lru_cache(maxsize=1)
def default_assets() -> PreviewAssets:
    return PreviewAssets()


def _fit_sprite(image: Image.Image, width: int, height: int) -> Image.Image:
    if image.size == (width, height) or width <= 0 or height <= 0:
        return image
    return image.resize((width, height), Image.Resampling.BILINEAR)


def _alpha_composite_at(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    if src.width < 1 or src.height < 1:
        return
    dx, dy = int(x), int(y)
    sx = sy = 0
    if dx < 0:
        sx = -dx
        dx = 0
    if dy < 0:
        sy = -dy
        dy = 0
    width = min(src.width - sx, dst.width - dx)
    height = min(src.height - sy, dst.height - dy)
    if width <= 0 or height <= 0:
        return
    piece = src if sx == 0 and sy == 0 and width == src.width and height == src.height else src.crop((sx, sy, sx + width, sy + height))
    dst.alpha_composite(piece, dest=(dx, dy))


def draw_mask_grass(target: Image.Image, mask: Image.Image, grass: Image.Image | None, x: int, y: int) -> None:
    layer = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    if grass is not None and grass.width and grass.height:
        gw, gh = grass.size
        tiled = Image.new("RGBA", mask.size, (0, 0, 0, 0))
        for yy in range(0, mask.height, gh):
            for xx in range(0, mask.width, gw):
                tiled.paste(grass, (xx, yy))
        layer = tiled
    else:
        layer = Image.new("RGBA", mask.size, (47, 106, 56, 255))
    wash = Image.new("RGBA", mask.size, (255, 255, 220, 20))
    layer = Image.alpha_composite(layer.convert("RGBA"), wash)
    mask_a = mask.convert("RGBA").getchannel("A")
    layer_a = ImageChops.multiply(layer.getchannel("A"), mask_a)
    layer.putalpha(layer_a)
    _alpha_composite_at(target, layer, x, y)


def _paste(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    _alpha_composite_at(dst, src, x, y)


def _expand_rect(box: list[float], x: float, y: float, w: float, h: float) -> None:
    box[0] = min(box[0], x)
    box[1] = min(box[1], y)
    box[2] = max(box[2], x + w)
    box[3] = max(box[3], y + h)


def normalize_record(row: dict, assets: PreviewAssets | None = None) -> dict:
    record = dict(row)
    mat = int(record.get("mat") or 0)
    if not mat:
        pack = str(record.get("pack") or "")
        local = int(record.get("local") or 0)
        if pack and local:
            uid_by_pack = {pack_key: int(uid) for uid, pack_key in (assets or default_assets()).mapping.items()}
            uid = uid_by_pack.get(pack)
            if uid is not None:
                mat = uid * 1000 + local
                record["mat"] = mat
    record["x"] = float(record.get("x") or 0)
    record["y"] = float(record.get("y") or 0)
    record["state"] = int(record.get("state") if record.get("state") is not None else record.get("flip") or 0)
    record["mat"] = int(record.get("mat") or 0)
    return record


def render_paper(records: list[dict], options: RenderOptions, assets: PreviewAssets | None = None) -> RenderTrace:
    assets = assets or default_assets()
    base = assets.base_by_no(options.base_no)
    if not base:
        raise ValueError("必须先选择建筑户型")
    floor = assets.load_base_image(base)
    mask = assets.load_mask_image(base)
    grass = assets.load_grass(options.grass_name) if options.include_mask_grass else None
    if not floor.width:
        raise ValueError(f"户型「{base.get('name') or base.get('no')}」的地基图片无法读取")

    floor_w, floor_h = floor.size
    mask_w, mask_h = mask.size if mask is not None else (floor_w, floor_h)
    snug = floor_snug_in_mask(floor, mask)
    frame = ((base.get("assets") or {}).get("baseImage") or {}).get("frameTable") or [{}]
    frame0 = frame[0] if frame else {}
    anchor = base.get("anchor") if isinstance(base.get("anchor"), list) else [0, 0]
    native_mask_x = native_half_delta(NATIVE_LAYER_W, mask_w)
    native_mask_y = native_half_delta(NATIVE_LAYER_H, mask_h)
    native_floor_x = native_mask_x + float(anchor[0] or 0) + float(frame0.get("anchorX") or 0)
    native_floor_y = native_mask_y + float(anchor[1] or 0) + float(frame0.get("anchorY") or 0)
    design_mask_x = js_round((max(DESIGN_W, mask_w) - mask_w) / 2.0)
    design_mask_y = js_round((max(DESIGN_H, mask_h) - mask_h) / 2.0)
    from_editor = options.coordinate_space == "editor"
    content_dx = -design_mask_x if from_editor else snug["x"] - native_floor_x
    content_dy = -design_mask_y if from_editor else snug["y"] - native_floor_y

    unresolved: list[int] = []
    visible: list[dict] = []
    for index, raw in enumerate(records or []):
        record = normalize_record(raw, assets)
        mat = int(record.get("mat") or 0)
        if not mat:
            continue
        solved = assets.resolve_component(mat, options.local_pack_key)
        if not solved:
            unresolved.append(mat)
            continue
        try:
            image, geometry = assets.load_sprite(solved["component"], record["state"])
        except (FileNotFoundError, AleError, OSError):
            unresolved.append(mat)
            continue
        width = int(geometry.get("width") or image.width)
        height = int(geometry.get("height") or image.height)
        image = _fit_sprite(image, width, height)
        visible.append(
            {
                "index": index,
                "record": record,
                "image": image,
                "width": width,
                "height": height,
                "solved": solved,
            }
        )

    box = [math.inf, math.inf, -math.inf, -math.inf]
    if options.include_mask_grass:
        _expand_rect(box, 0, 0, mask_w, mask_h)
    _expand_rect(box, snug["x"], snug["y"], floor_w, floor_h)
    for row in visible:
        _expand_rect(
            box,
            float(row["record"]["x"]) + content_dx,
            float(row["record"]["y"]) + content_dy,
            row["width"],
            row["height"],
        )
    if not math.isfinite(box[0]):
        _expand_rect(box, snug["x"], snug["y"], floor_w, floor_h)

    origin_x = math.floor(box[0]) - MARGIN
    origin_y = math.floor(box[1]) - MARGIN
    scene_w = max(1, math.ceil(box[2]) - origin_x + MARGIN)
    scene_h = max(1, math.ceil(box[3]) - origin_y + MARGIN)
    scene = Image.new("RGBA", (scene_w, scene_h), (0, 0, 0, 0))
    if options.include_mask_grass and mask is not None:
        draw_mask_grass(scene, mask, grass, -origin_x, -origin_y)
    if options.include_floor:
        _paste(scene, floor, int(snug["x"] - origin_x), int(snug["y"] - origin_y))

    amodal: dict[int, Image.Image] = {}
    bboxes: dict[int, tuple[int, int, int, int]] = {}
    feet: dict[int, tuple[float, float]] = {}
    z_order: list[int] = []
    for row in visible:
        dx = float(row["record"]["x"]) + content_dx - origin_x
        dy = float(row["record"]["y"]) + content_dy - origin_y
        px = int(dx) if dx == int(dx) else js_trunc(dx)
        py = int(dy) if dy == int(dy) else js_trunc(dy)
        stamp = Image.new("RGBA", scene.size, (0, 0, 0, 0))
        _alpha_composite_at(stamp, row["image"], px, py)
        _paste(scene, row["image"], px, py)
        key = int(row["index"])
        z_order.append(key)
        alpha = stamp.getchannel("A")
        bbox = alpha.point(lambda a: 255 if a >= ALPHA_CROP else 0).getbbox()
        if bbox:
            bboxes[key] = bbox
        foot = foot_offset_from_image(row["image"], {"width": row["width"], "height": row["height"]})
        feet[key] = (px + foot[0], py + foot[1])
        if options.trace_instances:
            amodal[key] = alpha.point(lambda a: 255 if a >= ALPHA_CROP else 0)

    floor_diamond = opaque_diamond_vertices(floor, 96)
    floor_front = (floor_diamond or {}).get("bottom") or opaque_bottom_vertex(floor, 96) or {
        "x": js_round(floor_w / 2.0),
        "y": floor_h - 1,
    }
    raw_ground = {
        "x": snug["x"] + floor_front["x"] - origin_x,
        "y": snug["y"] + floor_front["y"] - origin_y,
    }
    bounds = alpha_bounds(scene)
    bounds["left"] = min(bounds["left"], math.floor(raw_ground["x"]))
    bounds["top"] = min(bounds["top"], math.floor(raw_ground["y"]))
    bounds["right"] = max(bounds["right"], math.ceil(raw_ground["x"]) + 1)
    bounds["bottom"] = max(bounds["bottom"], math.ceil(raw_ground["y"]) + 1)
    if options.include_floor or not options.include_mask_grass:
        bounds["left"] = min(bounds["left"], math.floor(snug["x"] - origin_x))
        bounds["top"] = min(bounds["top"], math.floor(snug["y"] - origin_y))
        bounds["right"] = max(bounds["right"], math.ceil(snug["x"] - origin_x + floor_w))
        bounds["bottom"] = max(bounds["bottom"], math.ceil(snug["y"] - origin_y + floor_h))

    crop = (
        int(bounds["left"]),
        int(bounds["top"]),
        int(bounds["right"]),
        int(bounds["bottom"]),
    )
    bitmap = scene.crop(crop)
    if bitmap.width < 1 or bitmap.height < 1:
        bitmap = Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    crop_dx = float(bounds["left"])
    crop_dy = float(bounds["top"])
    visible_masks: dict[int, Image.Image] = {}
    cropped_amodal: dict[int, Image.Image] = {}
    cropped_boxes: dict[int, tuple[int, int, int, int]] = {}
    cropped_feet: dict[int, tuple[float, float]] = {}
    occupied = Image.new("L", bitmap.size, 0) if options.trace_instances else None
    for key in reversed(z_order):
        full = amodal.get(key)
        if full is not None:
            piece = full.crop(crop)
            cropped_amodal[key] = piece
            if occupied is not None:
                free = occupied.point(lambda a: 255 if a == 0 else 0)
                vis = ImageChops.multiply(piece, free)
                visible_masks[key] = vis
                occupied = ImageChops.lighter(occupied, piece)
        box = bboxes.get(key)
        if box:
            cropped_boxes[key] = (
                box[0] - crop[0],
                box[1] - crop[1],
                box[2] - crop[0],
                box[3] - crop[1],
            )
        foot = feet.get(key)
        if foot:
            cropped_feet[key] = (foot[0] - crop_dx, foot[1] - crop_dy)

    paper_dx = content_dx - origin_x - crop_dx
    paper_dy = content_dy - origin_y - crop_dy
    return RenderTrace(
        image=bitmap,
        instance_visible_masks=visible_masks,
        instance_amodal_masks=cropped_amodal,
        bboxes=cropped_boxes,
        footpoints=cropped_feet,
        z_order=z_order,
        paper_to_image=translation_matrix(paper_dx, paper_dy),
        ground_anchor=(raw_ground["x"] - crop_dx, raw_ground["y"] - crop_dy),
        content_offset=(content_dx, content_dy),
        floor_quad=floor_quad_from_diamond(floor_diamond),
        unresolved=unresolved,
        base_no=int(base.get("no") or options.base_no),
        footprint=list(base.get("footprint") or [3, 3]),
    )


def apply_paper_to_image(x: float, y: float, matrix: list[list[float]]) -> tuple[float, float]:
    return x * matrix[0][0] + y * matrix[0][1] + matrix[0][2], x * matrix[1][0] + y * matrix[1][1] + matrix[1][2]


def edge_mask(alpha: Image.Image, hit: int = ALPHA_CROP) -> Image.Image:
    binary = alpha.point(lambda a: 255 if a >= hit else 0)
    eroded = binary.filter(ImageFilter.MinFilter(3))
    return ImageChops.difference(binary, eroded)


def _count_nonzero(image: Image.Image) -> int:
    hist = image.histogram()
    return int(sum(hist[1:]))


def compare_rgba(left: Image.Image, right: Image.Image) -> dict:
    a = left.convert("RGBA")
    b = right.convert("RGBA")
    same_size = a.size == b.size
    width = min(a.width, b.width)
    height = min(a.height, b.height)
    if width < 1 or height < 1:
        return {"sameSize": same_size, "widthDelta": b.width - a.width, "heightDelta": b.height - a.height, "rgbMae": 255.0, "edgeF1": 0.0}
    aa = a.crop((0, 0, width, height))
    bb = b.crop((0, 0, width, height))
    pa = aa.tobytes()
    pb = bb.tobytes()
    mae = 0.0
    count = 0
    for index in range(0, len(pa), 4):
        a1 = pa[index + 3]
        a2 = pb[index + 3]
        if a1 < ALPHA_CROP and a2 < ALPHA_CROP:
            continue
        mae += abs(pa[index] - pb[index]) + abs(pa[index + 1] - pb[index + 1]) + abs(pa[index + 2] - pb[index + 2])
        count += 3
    rgb_mae = (mae / count) if count else 0.0
    ea = edge_mask(aa.getchannel("A"))
    eb = edge_mask(bb.getchannel("A"))
    va = ea.point(lambda v: 255 if v else 0)
    vb = eb.point(lambda v: 255 if v else 0)
    inter = ImageChops.multiply(va, vb)
    tp = _count_nonzero(inter)
    pred = _count_nonzero(vb)
    gold = _count_nonzero(va)
    precision = tp / pred if pred else 1.0
    recall = tp / gold if gold else 1.0
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    return {
        "sameSize": same_size,
        "widthDelta": b.width - a.width,
        "heightDelta": b.height - a.height,
        "rgbMae": rgb_mae,
        "edgeF1": f1,
        "anchorReady": True,
    }


__all__ = [
    "DESIGN_H",
    "DESIGN_W",
    "NATIVE_LAYER_H",
    "NATIVE_LAYER_W",
    "PreviewAssets",
    "RenderOptions",
    "RenderTrace",
    "alpha_bounds",
    "apply_paper_to_image",
    "compare_rgba",
    "default_assets",
    "floor_snug_in_mask",
    "js_round",
    "js_trunc",
    "native_half_delta",
    "normalize_record",
    "opaque_diamond_vertices",
    "render_paper",
]
