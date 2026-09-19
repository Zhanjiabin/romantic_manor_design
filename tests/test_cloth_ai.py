# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import io
import json
from email.parser import BytesParser
from email import policy

import pytest

from PIL import Image

import cloth_ai


def _png_bytes(size=(32, 32), color=(180, 70, 90, 255)) -> bytes:
    image = Image.new("RGBA", size, color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_builtin_prompts_cover_every_cloth_kind():
    rows = cloth_ai.load_builtin_prompts()
    kinds = set(cloth_ai.CLOTH_KIND_SIZES)
    got = {row["kind"] for row in rows}
    assert kinds <= got
    assert all(row["prompt"] for row in rows)
    hair = [row for row in rows if row["kind"] == "hair"]
    assert any("512×256" in row["prompt"] for row in hair)


def test_filter_keeps_image_models_only():
    models = cloth_ai.filter_image_models(
        ["gpt-4o", "gpt-image-2", "gemini-2.5-flash", "gemini-2.5-flash-image", "dall-e-3"],
        extras=False,
    )
    assert models == ["dall-e-3", "gemini-2.5-flash-image", "gpt-image-2"]
    extras = cloth_ai.filter_image_models(["gpt-4o"], extras=True)
    assert "gemini-2.5-flash-image" in extras
    assert "gpt-4o" not in extras


def test_routes_match_movie_factory():
    assert cloth_ai.image_route("gpt-image-2", False) == "generations"
    assert cloth_ai.image_route("gpt-image-2", True) == "edits"
    assert cloth_ai.image_route("gemini-2.5-flash-image", False) == "chat"
    assert cloth_ai.image_route("gemini-2.5-flash-image", True) == "chat"


def test_base_url_is_openroutex_only():
    assert cloth_ai.normalize_base_url("") == cloth_ai.OPENROUTEX_BASE
    assert cloth_ai.normalize_base_url("https://api.openroutex.top") == cloth_ai.OPENROUTEX_BASE
    assert cloth_ai.normalize_base_url("https://api.openroutex.top/console") == cloth_ai.OPENROUTEX_BASE
    assert cloth_ai.normalize_base_url("https://api.openroutex.top/v1") == cloth_ai.OPENROUTEX_BASE
    try:
        cloth_ai.normalize_base_url("https://ai.qiaojiangapp.cn/v1")
        assert False
    except cloth_ai.ClothAiError:
        pass
    try:
        cloth_ai.normalize_base_url("https://127.0.0.1/v1")
        assert False
    except cloth_ai.ClothAiError:
        pass


def test_redact_strips_keys():
    assert "sk-live-secret" not in cloth_ai.redact("Authorization: Bearer sk-live-secret")
    assert "sk-***" in cloth_ai.redact("token sk-abcdefghijk")


def test_layout_contract_mentions_native_size():
    text = cloth_ai.layout_contract("hair", 512, 256, True)
    assert "512×256" in text
    assert "UV" in text
    assert "参考" in text


def test_layout_contract_uv_map_keeps_islands():
    text = cloth_ai.layout_contract("female-short", 256, 256, False, False, True)
    assert "轮廓地图" in text
    assert "岛" in text
    hair = cloth_ai.layout_contract("hair", 512, 256, False, False, True)
    assert "512×256" in hair
    assert "轮廓地图" in hair


def test_billboard_layout_is_led_not_uv():
    text = cloth_ai.layout_contract("billboard-hd", 720, 480, False)
    assert "720×480" in text
    assert "36×24" in text
    assert "UV" not in text
    assert cloth_ai.canvas_size("billboard-hd") == (720, 480)
    assert cloth_ai.KIND_SIZES["female-short"] == (256, 256)
    ref = cloth_ai.layout_contract("billboard-hd", 720, 480, True)
    assert "构图参考" in ref
    assert "色号表" in ref
    assert "白格" in ref
    assert "太阳小山" in ref
    assert "UV" not in ref
    assert "电子广告牌" in cloth_ai.BILLBOARD_CHAT_IMAGE_INTENT
    assert "色号表" in cloth_ai.BILLBOARD_CHAT_IMAGE_INTENT
    assert "UV" in cloth_ai.CHAT_IMAGE_INTENT


def test_generate_uses_images_generations(monkeypatch):
    png = _png_bytes()
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append((method, url, headers, data))
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = cloth_ai.generate_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="浅粉短袖",
        kind="female-short",
    )
    assert result.startswith("data:image/png;base64,")
    assert any("/images/generations" in url for _, url, _, _ in calls)
    assert all("sk-test-key" not in str(item) or "Authorization" in (headers or {}) for item, (_, url, headers, _) in zip(calls, calls))
    image = Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1])))
    assert image.size == (256, 256)
    auth = calls[0][2]["Authorization"]
    assert auth.startswith("Bearer ")
    dumped = json.loads(calls[0][3].decode("utf-8"))
    assert "256" in dumped["prompt"] or "256×256" in dumped["prompt"]
    assert "浅粉短袖" in dumped["prompt"]


def test_generate_with_reference_uses_edits(monkeypatch):
    png = _png_bytes()
    ref = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append(url)
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = cloth_ai.generate_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="改成蓝色",
        kind="female-short",
        reference_png=ref,
    )
    assert result.startswith("data:image/png;base64,")
    assert any(url.endswith("/images/edits") for url in calls)


def test_list_models_filters_and_adds_gemini(monkeypatch):
    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        payload = {"data": [{"id": "gpt-4o"}, {"id": "gpt-image-2"}, {"name": "flux-1"}]}
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    models = cloth_ai.list_image_models("sk-test")
    assert "gpt-4o" not in models
    assert "gpt-image-2" in models
    assert "flux-1" in models
    assert "gemini-2.5-flash-image" in models


def _png_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def test_composite_locked_keeps_unmasked_pixels():
    mask = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    for y in range(10, 22):
        for x in range(10, 22):
            mask.putpixel((x, y), (226, 72, 128, 220))
    out = Image.open(io.BytesIO(cloth_ai.composite_locked(
        _png_bytes((32, 32), (200, 40, 40, 255)),
        _png_bytes((32, 32), (40, 80, 200, 255)),
        _encode(mask),
        32,
        32,
    )))
    corner = out.getpixel((1, 1))
    center = out.getpixel((16, 16))
    assert corner[0] > 160 and corner[2] < 80
    assert center[2] > 140 and center[0] < 90


def _encode(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_generate_with_mask_sends_mask_and_locks_outside(monkeypatch):
    gen_png = _png_bytes((256, 256), (40, 80, 200, 255))
    ref = _png_url(Image.new("RGBA", (256, 256), (200, 40, 40, 255)))
    mask_img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    for y in range(80, 176):
        for x in range(80, 176):
            mask_img.putpixel((x, y), (226, 72, 128, 220))
    payloads = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        payloads.append((url, data or b""))
        return 200, json.dumps({"data": [{"b64_json": base64.b64encode(gen_png).decode("ascii")}]}).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = cloth_ai.generate_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="只修领结",
        kind="female-short",
        reference_png=ref,
        mask_png=_png_url(mask_img),
    )
    assert any(url.endswith("/images/edits") and b'name="mask"' in data for url, data in payloads)
    image = Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1])))
    corner = image.getpixel((4, 4))
    center = image.getpixel((128, 128))
    assert corner[0] > 160 and corner[2] < 80
    assert center[2] > 140 and center[0] < 90
    assert "局部重绘" in cloth_ai.layout_contract("female-short", 256, 256, True, True)


def test_generate_uv_map_only_uses_edits_for_gpt_image(monkeypatch):
    png = _png_bytes((256, 256))
    uv_map = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append((url, data or b""))
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = cloth_ai.generate_image(
        api_key="sk-test-key",
        model="gpt-image-2",
        prompt="按地图画碎花",
        kind="female-short",
        uv_map_png=uv_map,
        use_uv_map=True,
    )
    assert result.startswith("data:image/png;base64,")
    assert any(url.endswith("/images/edits") for url, _ in calls)
    assert all("/images/generations" not in url for url, _ in calls)
    prompt_blob = b"".join(data for _, data in calls)
    assert "轮廓地图" in prompt_blob.decode("utf-8", errors="replace")


def test_generate_sends_uv_map_on_chat(monkeypatch):
    png = _png_bytes((256, 256))
    uv_map = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    calls = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        calls.append((url, data or b""))
        payload = {"data": [{"b64_json": base64.b64encode(png).decode("ascii")}]}
        return 200, json.dumps(payload).encode("utf-8")

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    result = cloth_ai.generate_image(
        api_key="sk-test-key",
        model="gemini-2.5-flash-image",
        prompt="短款碎花",
        kind="female-short",
        uv_map_png=uv_map,
        use_uv_map=True,
    )
    assert result.startswith("data:image/png;base64,")
    assert any("/chat/completions" in url for url, _ in calls)
    dumped = json.loads(calls[0][1].decode("utf-8"))
    content = dumped["messages"][0]["content"]
    blob = json.dumps(content, ensure_ascii=False)
    assert any(part.get("type") == "image_url" for part in content)
    assert "轮廓地图" in blob
    assert "岛" in blob
    assert "短款碎花" in blob


def test_sanitize_user_prompt_strips_image_ids_without_extension():
    dirty = (
        "五官眼睛大小和位置一样"
        "20260918113639674426899b0SLCOvF)"
        " 还有一句"
    )
    cleaned = cloth_ai.sanitize_user_prompt(dirty)
    assert "20260918" not in cleaned
    assert "SLCOvF" not in cleaned
    assert ")" not in cleaned
    assert "五官眼睛大小和位置一样" in cleaned
    assert "还有一句" in cleaned
    assert cloth_ai.sanitize_user_prompt("正常提示词，不要黑边") == "正常提示词，不要黑边"
    assert "jpg" not in cloth_ai.sanitize_user_prompt("a ![x](20260918103328120350463XsUY.jpg) b")
    assert cloth_ai.redact("fail 20260918103328120350463XsUY.jpg) ok").find("20260918") < 0


def test_edits_keep_both_reference_and_lossless_uv_map_with_mask_on_first_image(monkeypatch):
    ref = Image.new("RGBA", (256, 256), (25, 80, 180, 255))
    uv = Image.new("RGBA", (256, 256), (244, 240, 234, 255))
    uv.putpixel((120, 120), (255, 20, 168, 255))
    mask = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    mask.putpixel((80, 80), (226, 72, 128, 255))
    requests = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        requests.append((url, headers, data))
        return 200, json.dumps({"data": [{"b64_json": base64.b64encode(_encode(ref)).decode()}]}).encode()

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    cloth_ai.generate_image(api_key="test", model="gpt-image-2", prompt="蓝色学院风",
                            kind="female-short", reference_png=_png_url(ref),
                            uv_map_png=_png_url(uv), use_uv_map=True, mask_png=_png_url(mask))
    url, headers, data = requests[0]
    assert url.endswith("/images/edits")
    message = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + headers["Content-Type"] + "\r\n\r\n").encode() + data)
    files = [part for part in message.iter_parts() if part.get_filename()]
    assert [part.get_filename() for part in files] == ["reference.png", "uv-layout.png", "mask.png"]
    assert [part.get_param("name", header="content-disposition") for part in files] == ["image[]", "image[]", "mask"]
    for part, expected in zip(files, [ref, uv]):
        actual = Image.open(io.BytesIO(part.get_payload(decode=True))).convert("RGBA")
        assert actual.size == expected.size
        assert actual.tobytes() == expected.tobytes()


def test_uv_map_remains_attached_when_edits_falls_back_to_chat(monkeypatch):
    uv = _png_url(Image.new("RGBA", (256, 256), (255, 20, 168, 255)))
    requests = []

    def fake_http(method, url, *, headers=None, data=None, timeout=60):
        requests.append((url, data))
        if url.endswith("/images/edits"):
            return 400, b'{"error":"unsupported multipart image array"}'
        return 200, json.dumps({"data": [{"b64_json": base64.b64encode(_png_bytes()).decode()}]}).encode()

    monkeypatch.setattr(cloth_ai, "http_request", fake_http)
    cloth_ai.generate_image(api_key="test", model="gpt-image-2", prompt="蓝色学院风",
                            kind="female-short", reference_png=uv, uv_map_png=uv, use_uv_map=True)
    assert len(requests) == 2
    assert requests[-1][0].endswith("/chat/completions")
    parts = json.loads(requests[-1][1])["messages"][0]["content"]
    images = [part["image_url"]["url"] for part in parts if part["type"] == "image_url"]
    assert len(images) == 2
    assert images[0] == uv
    assert "唯一依据" in cloth_ai.layout_contract("female-short", 256, 256, True, has_uv_map=True)


def test_missing_enabled_uv_map_fails_before_contacting_provider(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("must not generate without the enabled layout")
    monkeypatch.setattr(cloth_ai, "http_request", unexpected)
    with pytest.raises(cloth_ai.ClothAiError, match="UV 底图未加载"):
        cloth_ai.generate_image(api_key="test", model="gpt-image-2", prompt="蓝色",
                                kind="female-short", use_uv_map=True)
