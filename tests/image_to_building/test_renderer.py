from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PIL import Image

from image_to_building.catalog import iter_locked_components, load_json
from image_to_building.renderer import (
    DESIGN_W,
    PreviewAssets,
    RenderOptions,
    alpha_bounds,
    apply_paper_to_image,
    compare_rgba,
    floor_snug_in_mask,
    js_round,
    js_trunc,
    native_half_delta,
    opaque_diamond_vertices,
    render_paper,
)
from image_to_building.schema import RENDERER_VERSION

UIDS = ROOT / "data" / "building_pack_uids.json"
CASES = ROOT / "tests" / "fixtures" / "image_to_building" / "renderer" / "cases.json"


def _assets() -> PreviewAssets:
    return PreviewAssets()


def _game_ok(assets: PreviewAssets) -> bool:
    base = assets.base_by_no(1)
    if not base:
        return False
    try:
        floor = assets.load_base_image(base)
    except (FileNotFoundError, OSError):
        return False
    return bool(floor.width)


def test_js_integer_rules():
    assert js_round(0.5) == 1
    assert js_round(1.5) == 2
    assert js_round(-0.5) == 0
    assert js_trunc(-1.9) == -1
    assert native_half_delta(1690, 220) == int((1690 - 220) / 2)
    assert native_half_delta(1030, 231) == int((1030 - 231) / 2)
    assert js_round((max(DESIGN_W, 220) - 220) / 2) == 175


def test_opaque_diamond_and_snug_on_synthetic():
    mask = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    floor = Image.new("RGBA", (20, 12), (0, 0, 0, 0))
    mp = mask.load()
    fp = floor.load()
    for x in range(10, 31):
        mp[x, 30] = (10, 80, 10, 255)
    mp[20, 8] = (10, 80, 10, 255)
    mp[5, 20] = (10, 80, 10, 255)
    mp[35, 20] = (10, 80, 10, 255)
    for x in range(4, 17):
        fp[x, 10] = (120, 80, 40, 255)
    fp[10, 1] = (120, 80, 40, 255)
    diamond = opaque_diamond_vertices(mask, 32)
    assert diamond["bottom"]["y"] == 30
    snug = floor_snug_in_mask(floor, mask)
    floor_bottom = opaque_diamond_vertices(floor, 96)["bottom"]
    assert snug["x"] == diamond["bottom"]["x"] - floor_bottom["x"]
    assert snug["y"] == diamond["bottom"]["y"] - floor_bottom["y"]


def test_alpha_bounds_match_preview_hit():
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    px = image.load()
    px[2, 3] = (1, 2, 3, 1)
    px[4, 5] = (9, 9, 9, 2)
    bounds = alpha_bounds(image)
    assert bounds == {"left": 4, "top": 5, "right": 5, "bottom": 6}


def test_renderer_skips_mat0_and_keeps_record_order():
    if not _game_ok(_assets()):
        return
    assets = _assets()
    catalog = load_json(ROOT / "data" / "editor_catalog.json")
    uid_doc = load_json(UIDS)
    rows = list(iter_locked_components(catalog, uid_doc, load_json(ROOT / "data" / "building_uid_map.json")))
    first = next(row for row in rows if row["category"] == "装饰")
    second = next(row for row in rows if row["category"] == "墙壁")
    records = [
        {"mat": 0, "x": 10, "y": 10, "state": 0},
        {"mat": first["mat"], "x": 180, "y": 220, "state": 0},
        {"mat": second["mat"], "x": 200, "y": 230, "state": 0},
        {"mat": first["mat"], "x": 190, "y": 225, "state": 1},
    ]
    trace = render_paper(
        records,
        RenderOptions(base_no=1, coordinate_space="editor", include_mask_grass=False, trace_instances=True),
        assets,
    )
    assert 0 not in trace.z_order
    assert trace.z_order == [1, 2, 3]
    assert trace.unresolved == []
    assert RENDERER_VERSION == "desk-renderPaper-v1"
    later = trace.instance_visible_masks[3]
    earlier = trace.instance_amodal_masks[1]
    assert later.getbbox()
    assert earlier.getbbox()


def test_empty_house_ground_anchor_inside_bitmap():
    if not _game_ok(_assets()):
        return
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    assets = _assets()
    for base_no in cases["bases"]:
        if not assets.base_by_no(base_no):
            continue
        editor = render_paper([], RenderOptions(base_no=base_no, coordinate_space="editor"), assets)
        native = render_paper([], RenderOptions(base_no=base_no, coordinate_space="native"), assets)
        gx, gy = editor.ground_anchor
        assert 0 <= gx < editor.image.width
        assert 0 <= gy < editor.image.height
        assert editor.image.width >= 1 and editor.image.height >= 1
        ng = native.ground_anchor
        assert 0 <= ng[0] < native.image.width
        assert editor.content_offset != native.content_offset or editor.image.size == native.image.size


def test_cafe_and_fence_uids_render():
    if not _game_ok(_assets()):
        return
    assets = _assets()
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    cafe = render_paper(
        [cases["cafe"]],
        RenderOptions(base_no=1, coordinate_space="editor", trace_instances=True),
        assets,
    )
    fence = render_paper(
        [cases["fence"]],
        RenderOptions(base_no=1, coordinate_space="editor", trace_instances=True),
        assets,
    )
    assert cafe.unresolved == []
    assert fence.unresolved == []
    assert cafe.z_order == [0]
    assert fence.z_order == [0]
    solved_cafe = assets.resolve_component(14124)
    solved_fence = assets.resolve_component(8101)
    assert solved_cafe["packKey"] == "bazaar" and solved_cafe["local"] == 124
    assert solved_fence["packKey"] == "flower2" and solved_fence["local"] == 101
    matrix = cafe.paper_to_image
    ix, iy = apply_paper_to_image(cases["cafe"]["x"], cases["cafe"]["y"], matrix)
    box = cafe.bboxes[0]
    assert box[0] - 1 <= ix <= box[2] + 1
    assert box[1] - 1 <= iy <= box[3] + 1


def test_bookshop_and_locked_pack_samples():
    if not _game_ok(_assets()):
        return
    assets = _assets()
    bookshop = json.loads((ROOT / "tests" / "fixtures" / "bookshop-layout.json").read_text(encoding="utf-8"))
    trace = render_paper(
        bookshop["records"],
        RenderOptions(base_no=1, coordinate_space="editor", trace_instances=True),
        assets,
    )
    assert trace.unresolved == []
    assert len(trace.z_order) == len(bookshop["records"])
    again = render_paper(
        bookshop["records"],
        RenderOptions(base_no=1, coordinate_space="editor"),
        assets,
    )
    metrics = compare_rgba(trace.image, again.image)
    assert metrics["sameSize"]
    assert metrics["rgbMae"] == 0
    assert metrics["edgeF1"] == 1.0

    catalog = load_json(ROOT / "data" / "editor_catalog.json")
    uid_doc = load_json(UIDS)
    uid_map = load_json(ROOT / "data" / "building_uid_map.json")
    picked: dict[str, list[dict]] = {}
    for row in iter_locked_components(catalog, uid_doc, uid_map):
        bucket = picked.setdefault(row["pack"], [])
        if sum(1 for item in bucket if item["category"] == row["category"]) < 2:
            bucket.append(row)
    assert len(picked) == 22
    records = []
    x, y = 160, 200
    for _pack, rows in sorted(picked.items()):
        for index, row in enumerate(rows[:2]):
            records.append({"mat": row["mat"], "x": x, "y": y, "state": 0 if index == 0 else 1})
            x += 18
            y += 6
            if x > 420:
                x = 160
                y += 20
    mixed = render_paper(
        records,
        RenderOptions(base_no=8, coordinate_space="editor", include_mask_grass=True),
        assets,
    )
    assert mixed.unresolved == []
    assert len(mixed.z_order) == len(records)
    for box in mixed.bboxes.values():
        assert box[2] - box[0] >= 1
        assert box[3] - box[1] >= 1


def test_alias_decodes_but_mapping_stays_canonical():
    assets = _assets()
    uid_doc = load_json(UIDS)
    assert "6" not in uid_doc["mapping"]
    assert uid_doc["aliases"]["6"] == "toy"
    toy = next((pack for pack in assets.packs.values() if pack.get("key") == "toy"), None)
    if not toy:
        return
    local = next(
        (int(row.get("id") or 0) for row in toy.get("components") or [] if row.get("kind") == "sprite"),
        0,
    )
    if not local:
        return
    solved = assets.resolve_component(6000 + local)
    assert solved is not None
    assert solved["packKey"] == "toy"
    assert assets.resolve_component(14124)["packKey"] == "bazaar"
