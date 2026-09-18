# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import board_ai
import cloth_ai
from saves import load_board_bundle, load_cloth_bundle, save_board_bundle, save_cloth_bundle, set_save_user


def test_board_prompts_and_kind():
    rows = board_ai.load_builtin_prompts()
    assert rows
    assert all(row["kind"] == "billboard-hd" for row in rows)
    assert all("36×24" in row["prompt"] or "720×480" in row["prompt"] for row in rows)
    assert any(row["id"] == "builtin:billboard-hd:beads" for row in rows)
    assert any("白格" in row["prompt"] and "关灯" in row["prompt"] for row in rows)
    assert board_ai.KIND == "billboard-hd"
    assert board_ai.AI_SIZE == (720, 480)


def test_board_saves_are_isolated_from_cloth():
    tmp = tempfile.mkdtemp(prefix="manor-board-saves-")
    prev = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = tmp
    set_save_user("")
    try:
        save_cloth_bundle({"designs": {"items": [{"id": "c1", "name": "裙", "png": "x", "savedAt": 1}]}})
        save_board_bundle({
            "designs": {
                "items": [{
                    "id": "b1",
                    "name": "灯牌",
                    "pages": [[50] * (36 * 24)],
                    "png": "y",
                    "savedAt": 1,
                }]
            }
        })
        cloth = load_cloth_bundle()
        board = load_board_bundle()
        assert cloth["designs"]["items"][0]["name"] == "裙"
        assert board["designs"]["items"][0]["name"] == "灯牌"
        save_board_bundle({"designs": {"items": []}})
        still = load_board_bundle()["designs"]
        assert still["items"][0]["name"] == "灯牌"
        save_board_bundle({
            "designs": {
                "savedAt": 400,
                "items": [{"id": "b1", "name": "夜市", "savedAt": 400}],
            }
        })
        renamed = load_board_bundle()["designs"]["items"][0]
        assert renamed["name"] == "夜市"
        assert renamed.get("pages")
        assert renamed.get("png") == "y"
        save_board_bundle({"designs": {"savedAt": 500, "items": [], "removeIds": ["b1"]}})
        assert load_board_bundle()["designs"]["items"] == []
        assert load_cloth_bundle()["designs"]["items"][0]["name"] == "裙"
        assert not (Path(tmp) / "board-designs.json.prev").is_file()
        assert (Path(tmp) / "cloth-designs.json").is_file()
        assert (Path(tmp) / "board-designs.json").is_file()
    finally:
        if prev is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev


def test_board_generate_uses_led_size(monkeypatch):
    import base64
    import io

    from PIL import Image

    image = Image.new("RGBA", (32, 32), (20, 80, 180, 255))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    png = buf.getvalue()
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append(url)
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        import json
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = board_ai.generate_board_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="大红灯笼色块",
    )
    assert result.startswith("data:image/png;base64,")
    out = Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1])))
    assert out.size == (720, 480)
    assert any("/images/generations" in url for url in calls)


def test_board_generate_with_reference_uses_edits(monkeypatch):
    import base64
    import io

    from PIL import Image

    image = Image.new("RGBA", (32, 32), (20, 80, 180, 255))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    png = buf.getvalue()
    ref = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append(url)
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        import json
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = board_ai.generate_board_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="按参考图大色块重画",
        reference_png=ref,
    )
    assert result.startswith("data:image/png;base64,")
    assert any(url.endswith("/images/edits") for url in calls)


def test_board_builtin_refs_are_led_blocks():
    from PIL import Image

    rows = board_ai.load_builtin_refs()
    assert len(rows) >= 5
    assert {row["id"] for row in rows} >= {"sun-hills", "shop-sign", "pixel-bird"}
    for row in rows:
        path = Path(__file__).resolve().parents[1] / "data" / "board" / "refs" / row["file"]
        assert path.is_file()
        image = Image.open(path)
        assert image.size == board_ai.AI_SIZE
    pages = board_ai.builtin_ref_pages()
    rendered = board_ai.render_ref_image(pages[0]["page"])
    assert rendered.size == board_ai.AI_SIZE


def test_board_ani_roundtrip():
    from codec.board_ani import COLS, DARK, ROWS, decode_board_ani, encode_board_ani, safe_ani_filename

    page_a = [12] * (COLS * ROWS)
    page_b = [2] * (COLS * ROWS)
    page_a[0] = DARK
    blob = encode_board_ani([page_a, page_b], interval_ms=1000)
    assert blob.startswith(b"AEX\x00")
    from codec.ale import parse_ale

    header = parse_ale(blob)
    assert header["format"] == "AEX"
    assert header["kind"] == 3
    assert header["frames"] == 3
    assert header["blobs"][0][:3] == bytes([255, 216, 255])
    assert header["blobs"][1][:3] == b"GIF"
    doc = decode_board_ani(blob)
    assert doc["cols"] == COLS
    assert doc["rows"] == ROWS
    assert len(doc["pages"]) == 2
    got_a, got_b = doc["pages"]
    assert got_a[0] == DARK
    assert sum(1 for value in got_a[1:] if value == 12) > (COLS * ROWS) * 0.8
    assert sum(1 for value in got_b if value == 2) > (COLS * ROWS) * 0.8
    assert safe_ani_filename("夜市/灯牌") == "夜市灯牌.ale"


def test_compose_page_matches_highlight_sprite():
    from codec.board_ani import CELL, COLS, ROWS, bulb_frame, compose_page

    page = [12] * (COLS * ROWS)
    page[0] = 0
    page[1] = 50
    image = compose_page(page)
    assert image.size == (COLS * CELL, ROWS * CELL)
    cx, cy = CELL // 2, CELL // 2
    sprite0 = bulb_frame(0)
    sprite50 = bulb_frame(50)
    if sprite0.size != (CELL, CELL):
        sprite0 = sprite0.resize((CELL, CELL))
    if sprite50.size != (CELL, CELL):
        sprite50 = sprite50.resize((CELL, CELL))
    sprite12 = bulb_frame(12)
    if sprite12.size != (CELL, CELL):
        sprite12 = sprite12.resize((CELL, CELL))
    assert image.getpixel((cx, cy))[:3] == sprite0.getpixel((cx, cy))[:3]
    assert image.getpixel((CELL + cx, cy))[:3] == sprite50.getpixel((cx, cy))[:3]
    assert image.getpixel((CELL * 2 + cx, cy))[:3] == sprite12.getpixel((cx, cy))[:3]


def test_board_clip_matches_native_getdatastr():
    from codec.board_ani import (
        COLS,
        DARK,
        GBOX_ALPHA,
        ROWS,
        decode_board_clip,
        encode_all_clip,
        encode_page_clip,
        gbox_itoa,
    )

    assert GBOX_ALPHA[0] == "0"
    assert GBOX_ALPHA[10] == "A"
    assert GBOX_ALPHA[12] == "C"
    assert GBOX_ALPHA[50] == "m"
    assert gbox_itoa(50) == "m"
    page = [DARK] * (COLS * ROWS)
    page[0] = 12
    page[1] = 0
    text = encode_page_clip(page)
    assert text.startswith("C,0,m")
    assert text.count(",") == COLS * ROWS - 1
    got = decode_board_clip(text)[0]
    assert got[0] == 12
    assert got[1] == 0
    assert got[2] == DARK
    all_text = encode_all_clip([page, [2] * (COLS * ROWS)])
    assert all_text.startswith("('C,0,m")
    assert all_text.endswith("')")
    pages = decode_board_clip(all_text)
    assert len(pages) == 2
    assert pages[0][0] == 12
    assert pages[1][0] == 2
