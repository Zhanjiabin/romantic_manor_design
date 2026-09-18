# -*- coding: utf-8 -*-
"""OpenRouterX OpenAI-compatible image models for the clothes desk."""
from __future__ import annotations

import base64
import io
import ipaddress
import json
import re
import secrets
import ssl
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
PROMPTS_PATH = ROOT / "data" / "cloth_ai_prompts.json"

# Same image relay used by nuannuan movie_factory (OpenAI-compatible /v1).
OPENROUTEX_HOST = "api.openroutex.top"
OPENROUTEX_BASE = "https://api.openroutex.top/v1"
CHAT_IMAGE_INTENT = "请生成一张完整的游戏 UV 贴图。必须输出图片，不要只回复文字。"
BILLBOARD_CHAT_IMAGE_INTENT = "请生成一张完整的横版电子广告牌画面。必须输出图片，不要只回复文字。"
GEMINI_EXTRA_IMAGE_MODELS = (
    "gemini-3-pro-image-preview",
    "gemini-3-pro-image",
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image",
)
IMAGE_HINTS = (
    "gpt-image",
    "dall-e",
    "dalle",
    "flux",
    "seedream",
    "seedance",
    "imagen",
    "banana",
    "nanobanana",
    "nano-banana",
    "ideogram",
    "recraft",
    "sdxl",
    "stable-diffusion",
    "stable_diffusion",
    "qwen-image",
    "hunyuan-image",
    "kling-image",
    "midjourney",
    "playground",
)
CLOTH_KIND_SIZES = {
    "female-short": (256, 256),
    "female-long": (256, 256),
    "female-skirt": (256, 256),
    "male-short": (256, 256),
    "male-long": (256, 256),
    "expression": (256, 256),
    "face": (256, 256),
    "hair": (512, 256),
}
KIND_SIZES = {
    **CLOTH_KIND_SIZES,
    "billboard-hd": (720, 480),
}


class ClothAiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def load_builtin_prompts() -> list[dict]:
    try:
        raw = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = raw.get("templates") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    out = []
    for row in items:
        if not isinstance(row, dict):
            continue
        ident = str(row.get("id") or "").strip()
        kind = str(row.get("kind") or "").strip()
        prompt = str(row.get("prompt") or "").strip()
        if not ident or not kind or not prompt:
            continue
        out.append({
            "id": ident,
            "kind": kind,
            "name": str(row.get("name") or ident),
            "prompt": prompt,
            "builtin": True,
        })
    return out


def normalize_base_url(raw: str | None) -> str:
    text = str(raw or "").strip() or OPENROUTEX_BASE
    if "://" not in text:
        text = "https://" + text
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host != OPENROUTEX_HOST:
        raise ClothAiError("只支持 OpenRouterX 图片接口 https://api.openroutex.top/")
    path = (parsed.path or "").rstrip("/")
    if not path or path == "/" or path == "/console" or path.startswith("/console/"):
        path = "/v1"
    elif not path.endswith("/v1"):
        path = path + "/v1"
    return f"https://{OPENROUTEX_HOST}{path}"


def canvas_size(kind: str, width: int | None = None, height: int | None = None) -> tuple[int, int]:
    default_w, default_h = KIND_SIZES.get(str(kind or ""), (256, 256))
    if kind == "hair":
        return 512, 256
    try:
        w = int(width) if width is not None else default_w
        h = int(height) if height is not None else default_h
    except (TypeError, ValueError):
        return default_w, default_h
    if w == default_w and h == default_h:
        return w, h
    return default_w, default_h


def billboard_layout_contract(width: int, height: int, has_ref: bool, has_mask: bool = False) -> str:
    size = f"{width}×{height}"
    lines = [
        f"硬性规则：输出必须是一张 {size} 的横版电子广告牌画面，铺满画布，不要黑边、白边、字母水印。",
        "这会量化成 36×24 颗彩灯。只用大色块和高对比，不要细线、小字、照片级渐变。",
        "风格贴近 2000 年代国内休闲养成游戏里的霓虹灯牌，饱和、平光。",
    ]
    if has_mask:
        lines.append("这是局部重绘：只改蒙版标明的灯区。未圈选区域必须与参考图像素一致。")
    elif has_ref:
        lines.append("附图是构图参考：沿用主体位置、大小和配色倾向，用更粗的色块重画成灯牌，不要临摹照片纹理，不要写字。")
    return "\n".join(lines)


def layout_contract(kind: str, width: int, height: int, has_ref: bool, has_mask: bool = False, has_uv_map: bool = False) -> str:
    if str(kind or "").startswith("billboard"):
        return billboard_layout_contract(width, height, has_ref, has_mask)
    size = f"{width}×{height}"
    lines = [
        f"硬性规则：输出必须是一张 {size} 的游戏 UV 贴图，铺满画布，不要黑边、白边、字母水印。",
        "这是换装网格贴图，不是时装摄影。不要画完整人物试穿。",
        "风格贴近 2000 年代国内休闲养成游戏手绘。",
    ]
    if kind == "hair":
        lines.append("头巾必须是 512×256 横图：左头发/布料，右饰品展开。")
    if has_uv_map:
        lines.append("必须按附图里当前种类的默认 UV 轮廓地图来画：亮线圈出的岛才是可贴图范围，图案、花色、阴影和高光都只能落在岛内，岛外保持空白或纯底色。")
        lines.append("不要移动、旋转、缩放、合并或重排这些岛，也不要把地图上的描边颜色画进成品。")
    if has_mask:
        lines.append("这是局部重绘：只改蒙版标明的区域。未圈选的 UV 岛必须与参考图像素一致，不要重排岛，不要重画袖口、裙褶或接缝。")
    elif has_ref:
        lines.append("若提供了参考图，必须沿用参考图里每个 UV 岛的位置、轮廓和接缝，只改花色与图案，不要重排岛。")
    return "\n".join(lines)


def canonicalize_model_id(model: str) -> str:
    key = str(model or "").strip().lower().replace("_", "-")
    aliases = {
        "nano-banana-pro": "gemini-3-pro-image-preview",
        "nanobananapro": "gemini-3-pro-image-preview",
        "nano-banana-pro-preview": "gemini-3-pro-image-preview",
        "gemini-3-pro-image": "gemini-3-pro-image-preview",
        "nano-banana-2": "gemini-3.1-flash-image",
        "nanobanana2": "gemini-3.1-flash-image",
        "nano-banana": "gemini-3.1-flash-image",
        "nanobanana": "gemini-3.1-flash-image",
    }
    return aliases.get(key, str(model or "").strip())


def is_openai_images_model(model: str) -> bool:
    m = canonicalize_model_id(model).lower()
    return m.startswith("gpt-image") or m.startswith("dall-e") or "dall-e" in m or m.startswith("dalle")


def is_chat_image_model(model: str) -> bool:
    m = canonicalize_model_id(model).lower()
    return ("gemini" in m and "image" in m) or "nano-banana" in m or "nanobanana" in m


def is_gemini3_image_model(model: str) -> bool:
    m = canonicalize_model_id(model).lower()
    return (("gemini-3" in m or "gemini-3.1" in m) and "image" in m) or "nano-banana-pro" in m


def is_image_model(model: str) -> bool:
    m = canonicalize_model_id(model).lower()
    if not m:
        return False
    if any(hint in m for hint in IMAGE_HINTS):
        return True
    if "gemini" in m and "image" in m:
        return True
    if m.startswith("gpt-image"):
        return True
    return False


def image_route(model: str, has_ref: bool) -> str:
    if is_openai_images_model(model):
        return "edits" if has_ref else "generations"
    if is_chat_image_model(model) or has_ref:
        return "chat"
    return "generations"


def filter_image_models(ids: list[str], *, extras: bool = True) -> list[str]:
    out: list[str] = []
    for item in ids:
        ident = canonicalize_model_id(str(item or ""))
        if ident and is_image_model(ident):
            out.append(ident)
    if extras:
        out.extend(GEMINI_EXTRA_IMAGE_MODELS)
    seen: set[str] = set()
    unique: list[str] = []
    for ident in out:
        if ident in seen:
            continue
        seen.add(ident)
        unique.append(ident)
    unique.sort()
    return unique


def redact(text: str) -> str:
    cleaned = str(text or "")
    cleaned = re.sub(r"(?i)(bearer\s+)([^\s,;]+)", r"\1***", cleaned)
    cleaned = re.sub(r"(?i)(api[_-]?key[\"']?\s*[:=]\s*[\"']?)([^\"'\s,]+)", r"\1***", cleaned)
    cleaned = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-***", cleaned)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", cleaned)
    cleaned = re.sub(r"\[[^\]]*\]\([^)]*\)", "", cleaned)
    cleaned = re.sub(r"https?://\S+", "", cleaned, flags=re.I)
    cleaned = re.sub(
        r"20\d{12,}[A-Za-z0-9_-]*(?:\.(?:jpe?g|png|webp|gif))?[)\]\}]*",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\b[A-Za-z0-9_-]{16,}\.(?:jpe?g|png|webp|gif)[)\]\}]*", "", cleaned, flags=re.I)
    return cleaned.strip()


def sanitize_user_prompt(text: str) -> str:
    cleaned = redact(str(text or ""))
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[)\]\}]+$", "", cleaned)
    return cleaned.strip()


def infer_aspect_ratio(width: int, height: int) -> str:
    if height <= 0:
        return "1:1"
    ratio = width / height
    if ratio > 1.7:
        return "16:9"
    if ratio < 0.65:
        return "9:16"
    if abs(ratio - 1.0) < 0.08:
        return "1:1"
    if ratio > 1.0:
        return "4:3"
    return "3:4"


def images_api_size_fields(model: str, width: int, height: int) -> tuple[str, str | None]:
    if is_gemini3_image_model(model):
        return "1K", infer_aspect_ratio(width, height)
    return f"{width}x{height}", None


def fallback_sizes(width: int, height: int) -> list[tuple[int, int]]:
    first = (width, height)
    extras = [(1024, 1024)]
    if width >= height * 1.6:
        extras = [(1536, 1024), (1024, 512), (1024, 1024)]
    out = [first]
    for item in extras:
        if item not in out:
            out.append(item)
    return out


def decode_data_url(raw: str | None) -> bytes | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.startswith("data:"):
        _, _, payload = text.partition(",")
        try:
            return base64.b64decode(payload)
        except Exception as exc:
            raise ClothAiError("参考图不是有效的图片数据") from exc
    return None


def bytes_to_png_data_url(raw: bytes, width: int, height: int) -> str:
    try:
        image = Image.open(io.BytesIO(raw))
        image = image.convert("RGBA")
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        raw = buf.getvalue()
    except Exception as exc:
        raise ClothAiError("模型返回的不是可用图片") from exc
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def mask_coverage(raw: bytes, width: int, height: int) -> Image.Image | None:
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception:
        return None
    if image.size != (width, height):
        image = image.resize((width, height), Image.Resampling.BILINEAR)
    _r, _g, _b, alpha = image.split()
    extrema = alpha.getextrema()
    if not extrema or extrema[1] < 18:
        return None
    return alpha.filter(ImageFilter.GaussianBlur(radius=1.2))


def openai_inpaint_mask(coverage: Image.Image) -> bytes:
    keep = Image.eval(coverage, lambda value: 255 - value)
    image = Image.new("RGBA", coverage.size, (255, 255, 255, 255))
    image.putalpha(keep)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def mask_preview_jpeg(coverage: Image.Image) -> bytes:
    image = Image.merge("RGB", (coverage, coverage, coverage))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def composite_locked(original: bytes, generated: bytes, mask: bytes, width: int, height: int) -> bytes:
    coverage = mask_coverage(mask, width, height)
    orig = Image.open(io.BytesIO(original)).convert("RGBA")
    gen = Image.open(io.BytesIO(generated)).convert("RGBA")
    if orig.size != (width, height):
        orig = orig.resize((width, height), Image.Resampling.LANCZOS)
    if gen.size != (width, height):
        gen = gen.resize((width, height), Image.Resampling.LANCZOS)
    if coverage is None:
        buf = io.BytesIO()
        orig.save(buf, format="PNG")
        return buf.getvalue()
    out = Image.composite(gen, orig, coverage)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def reference_jpeg(raw: bytes, max_edge: int = 1024) -> bytes:
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = image.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1:
        image = image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def _chat_image(raw: bytes) -> dict:
    return {
        "type": "image_url",
        "image_url": {
            "url": "data:image/jpeg;base64," + base64.b64encode(reference_jpeg(raw)).decode("ascii"),
        },
    }


def _private_host(host: str) -> bool:
    if not host or host.lower() in {"localhost"}:
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(addr.is_private or addr.is_loopback or addr.is_link_local)


def _headers(api_key: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "User-Agent": "manor-cloth-desk/1",
        "Accept": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def http_request(method: str, url: str, *, headers: dict[str, str] | None = None, data: bytes | None = None, timeout: int = 60) -> tuple[int, bytes]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ClothAiError("接口地址无效")
    if _private_host(parsed.hostname or ""):
        raise ClothAiError("拒绝访问内网地址")
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    context = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
            return int(resp.status), resp.read()
    except urllib.error.HTTPError as exc:
        body = b""
        try:
            body = exc.read()
        except Exception:
            body = b""
        return int(exc.code), body
    except urllib.error.URLError as exc:
        raise ClothAiError(redact(f"连不上图片接口：{exc.reason}")) from exc


def _json_error(body: bytes, fallback: str) -> str:
    try:
        obj = json.loads(body.decode("utf-8", errors="replace") or "{}")
    except json.JSONDecodeError:
        obj = None
    if isinstance(obj, dict):
        err = obj.get("error")
        if isinstance(err, dict) and err.get("message"):
            return redact(str(err["message"]))
        if isinstance(err, str) and err.strip():
            return redact(err)
        if obj.get("message"):
            return redact(str(obj["message"]))
    text = body.decode("utf-8", errors="replace").strip()
    return redact(text[:400] if text else fallback)


def _parse_json(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8") or "null")
    except json.JSONDecodeError as exc:
        raise ClothAiError("接口返回的不是 JSON") from exc


def list_image_models(api_key: str, base_url: str | None = None) -> list[str]:
    key = str(api_key or "").strip()
    if not key:
        raise ClothAiError("请先填写 API Key")
    base = normalize_base_url(base_url)
    status, body = http_request("GET", f"{base}/models", headers=_headers(key), timeout=20)
    if status >= 400:
        raise ClothAiError(_json_error(body, f"拉取模型列表失败 HTTP {status}"), 502)
    payload = _parse_json(body)
    rows = payload.get("data") if isinstance(payload, dict) else None
    ids: list[str] = []
    if isinstance(rows, list):
        for item in rows:
            if isinstance(item, dict):
                ident = item.get("id") or item.get("model_name") or item.get("name")
                if ident:
                    ids.append(str(ident))
            elif isinstance(item, str):
                ids.append(item)
    models = filter_image_models(ids)
    if not models:
        raise ClothAiError("接口没有返回图片模型，请手动填写模型名")
    return models


def _extract_b64_bytes(text: str) -> bytes | None:
    marker = "data:image/"
    start = text.find(marker)
    if start < 0:
        try:
            raw = base64.b64decode(text, validate=False)
        except Exception:
            return None
        return raw if raw.startswith(b"\x89PNG") or raw[:2] == b"\xff\xd8" else None
    slice_ = text[start:]
    comma = slice_.find(",")
    if comma < 0:
        return None
    payload = []
    for ch in slice_[comma + 1 :]:
        if ch in ")\"'<>`":
            break
        if ch not in " \n\r\t":
            payload.append(ch)
    try:
        return base64.b64decode("".join(payload))
    except Exception:
        return None


def extract_image_bytes(payload: Any) -> bytes | None:
    if payload is None:
        return None
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)
    if isinstance(payload, str):
        return _extract_b64_bytes(payload)
    if isinstance(payload, list):
        for item in payload:
            found = extract_image_bytes(item)
            if found:
                return found
        return None
    if not isinstance(payload, dict):
        return None
    for key in ("b64_json", "b64", "image_base64", "image"):
        value = payload.get(key)
        if isinstance(value, str) and len(value) > 80:
            found = _extract_b64_bytes(value if value.startswith("data:") else "data:image/png;base64," + value)
            if found:
                return found
    url = payload.get("url")
    if isinstance(url, str) and url.startswith("data:image/"):
        found = _extract_b64_bytes(url)
        if found:
            return found
    inline = payload.get("inline_data") or payload.get("inlineData")
    if isinstance(inline, dict) and isinstance(inline.get("data"), str):
        found = _extract_b64_bytes("data:image/png;base64," + inline["data"])
        if found:
            return found
    if isinstance(payload.get("data"), list):
        found = extract_image_bytes(payload["data"])
        if found:
            return found
    message = payload.get("message") if isinstance(payload.get("message"), dict) else None
    if message:
        found = extract_image_bytes(message.get("content"))
        if found:
            return found
        found = extract_image_bytes(message.get("images"))
        if found:
            return found
    choices = payload.get("choices")
    if isinstance(choices, list):
        found = extract_image_bytes(choices)
        if found:
            return found
    content = payload.get("content")
    if content is not None:
        found = extract_image_bytes(content)
        if found:
            return found
    parts = payload.get("parts")
    if isinstance(parts, list):
        found = extract_image_bytes(parts)
        if found:
            return found
    return None


def extract_image_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        match = re.search(r"https?://[^\s\"'<>]+", payload)
        return match.group(0) if match else None
    if isinstance(payload, list):
        for item in payload:
            found = extract_image_url(item)
            if found:
                return found
        return None
    if not isinstance(payload, dict):
        return None
    url = payload.get("url")
    if isinstance(url, str) and url.startswith("http"):
        return url
    nested = payload.get("image_url")
    if isinstance(nested, dict) and isinstance(nested.get("url"), str) and nested["url"].startswith("http"):
        return nested["url"]
    if isinstance(nested, str) and nested.startswith("http"):
        return nested
    for key in ("data", "choices", "message", "content", "parts"):
        found = extract_image_url(payload.get(key))
        if found:
            return found
    return None


def download_image(url: str) -> bytes:
    if url.startswith("data:image/"):
        found = _extract_b64_bytes(url)
        if not found:
            raise ClothAiError("图片地址无法解码")
        return found
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ClothAiError("图片地址必须是 https")
    if _private_host(parsed.hostname or ""):
        raise ClothAiError("拒绝下载内网图片")
    status, body = http_request("GET", url, headers={"User-Agent": "manor-cloth-desk/1", "Accept": "image/*"}, timeout=60)
    if status >= 400 or not body:
        raise ClothAiError("下载生成图失败")
    return body


def _multipart(fields: list[tuple[str, str]], files: list[tuple[str, str, str, bytes]]) -> tuple[bytes, str]:
    boundary = "----ManorClothAi" + secrets.token_hex(8)
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.append(f"--{boundary}\r\n".encode("ascii"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8") + b"\r\n")
    for name, filename, content_type, data in files:
        chunks.append(f"--{boundary}\r\n".encode("ascii"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("ascii"))
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _post_json(base: str, path: str, api_key: str, body: dict, timeout: int = 180) -> tuple[int, Any, bytes]:
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    status, resp = http_request(
        "POST",
        f"{base}{path}",
        headers=_headers(api_key, {"Content-Type": "application/json"}),
        data=raw,
        timeout=timeout,
    )
    parsed = None
    if resp:
        try:
            parsed = json.loads(resp.decode("utf-8") or "null")
        except json.JSONDecodeError:
            parsed = None
    return status, parsed, resp


def _image_from_payload(payload: Any) -> bytes:
    found = extract_image_bytes(payload)
    if found:
        return found
    url = extract_image_url(payload)
    if url:
        return download_image(url)
    raise ClothAiError("模型没有返回图片")


def generate_image(
    *,
    api_key: str,
    model: str,
    prompt: str,
    kind: str,
    width: int | None = None,
    height: int | None = None,
    reference_png: str | None = None,
    mask_png: str | None = None,
    uv_map_png: str | None = None,
    use_uv_map: bool | None = None,
    base_url: str | None = None,
) -> str:
    key = str(api_key or "").strip()
    if not key:
        raise ClothAiError("请先填写 API Key")
    model_id = canonicalize_model_id(model)
    if not model_id:
        raise ClothAiError("请选择图片模型")
    user_prompt = sanitize_user_prompt(prompt)
    if not user_prompt:
        raise ClothAiError("请先填写提示词")
    w, h = canvas_size(kind, width, height)
    ref = decode_data_url(reference_png)
    mask_bytes = decode_data_url(mask_png)
    uv_map = decode_data_url(uv_map_png)
    coverage = mask_coverage(mask_bytes, w, h) if mask_bytes else None
    has_mask = coverage is not None
    if has_mask and not ref:
        raise ClothAiError("局部改图需要当前画布作参考")
    has_ref = bool(ref)
    has_uv_map = bool(uv_map) or bool(use_uv_map)
    full_prompt = layout_contract(kind, w, h, has_ref, has_mask, has_uv_map) + "\n\n" + user_prompt
    base = normalize_base_url(base_url)
    route = image_route(model_id, has_ref)
    errors: list[str] = []

    def finish(raw_bytes: bytes) -> str:
        if ref and has_mask and mask_bytes:
            raw_bytes = composite_locked(ref, raw_bytes, mask_bytes, w, h)
        return bytes_to_png_data_url(raw_bytes, w, h)

    def openai_edits(source: bytes) -> str | None:
        jpeg = reference_jpeg(source)
        files = [("image", "uv.jpg", "image/jpeg", jpeg)]
        if has_mask and coverage is not None:
            files.append(("mask", "mask.png", "image/png", openai_inpaint_mask(coverage)))
        for size_w, size_h in fallback_sizes(w, h):
            size_val, aspect = images_api_size_fields(model_id, size_w, size_h)
            fields = [
                ("model", model_id),
                ("prompt", full_prompt),
                ("n", "1"),
                ("size", size_val),
                ("response_format", "b64_json"),
            ]
            if aspect:
                fields.append(("aspect_ratio", aspect))
            data, content_type = _multipart(fields, files)
            status, raw = http_request(
                "POST",
                f"{base}/images/edits",
                headers=_headers(key, {"Content-Type": content_type}),
                data=data,
                timeout=180,
            )
            parsed = None
            if raw:
                try:
                    parsed = json.loads(raw.decode("utf-8") or "null")
                except json.JSONDecodeError:
                    parsed = None
            if status < 400 and parsed is not None:
                try:
                    return finish(_image_from_payload(parsed))
                except ClothAiError as exc:
                    errors.append(str(exc))
                    continue
            errors.append(_json_error(raw, f"images/edits HTTP {status}"))
            if "size" not in errors[-1].lower():
                break
        return None

    if route == "generations" and not has_mask and not has_uv_map:
        for size_w, size_h in fallback_sizes(w, h):
            size_val, aspect = images_api_size_fields(model_id, size_w, size_h)
            body = {
                "model": model_id,
                "prompt": full_prompt,
                "n": 1,
                "size": size_val,
                "response_format": "b64_json",
            }
            if aspect:
                body["aspect_ratio"] = aspect
            status, parsed, raw = _post_json(base, "/images/generations", key, body)
            if status < 400 and parsed is not None:
                try:
                    return finish(_image_from_payload(parsed))
                except ClothAiError as exc:
                    errors.append(str(exc))
                    continue
            errors.append(_json_error(raw, f"images/generations HTTP {status}"))
            if "size" not in errors[-1].lower() and "resolution" not in errors[-1].lower():
                break

    if route == "edits" and ref:
        done = openai_edits(ref)
        if done:
            return done
    elif is_openai_images_model(model_id) and uv_map and not has_ref and not has_mask:
        done = openai_edits(uv_map)
        if done:
            return done

    if route == "chat" or (not is_openai_images_model(model_id) and errors) or has_mask or (has_uv_map and errors):
        billboard = str(kind or "").startswith("billboard")
        chat_intent = BILLBOARD_CHAT_IMAGE_INTENT if billboard else CHAT_IMAGE_INTENT
        parts: list[Any] = [{"type": "text", "text": chat_intent}]
        attached = False
        if uv_map:
            parts.append(_chat_image(uv_map))
            parts.append({
                "type": "text",
                "text": "这张是当前种类的默认 UV 轮廓地图：亮线圈出的岛才是可贴图范围，图案必须严格画在岛内，不要把描边颜色画进成品。",
            })
            attached = True
        if has_ref and ref:
            parts.append(_chat_image(ref))
            if billboard:
                ref_caption = "这张是当前灯牌参考。" if has_mask else "这张是构图参考。请沿用主体位置和大色块，画成灯珠广告牌，不要写真或小字。"
            else:
                ref_caption = "这张是当前画布参考图。" if has_mask else "这张是参考图，请沿用它的岛位与接缝。"
            parts.append({
                "type": "text",
                "text": ref_caption,
            })
            attached = True
            if has_mask and coverage is not None:
                mask_url = "data:image/jpeg;base64," + base64.b64encode(mask_preview_jpeg(coverage)).decode("ascii")
                parts.append({"type": "image_url", "image_url": {"url": mask_url}})
                parts.append({"type": "text", "text": "这张是蒙版：白=只改这里，黑=必须保持参考图像素。"})
        parts.append({"type": "text", "text": full_prompt})
        content: Any = parts if attached else f"{chat_intent}\n{full_prompt}"
        body = {"model": model_id, "messages": [{"role": "user", "content": content}], "stream": False}
        status, parsed, raw = _post_json(base, "/chat/completions", key, body)
        if status < 400 and parsed is not None:
            return finish(_image_from_payload(parsed))
        errors.append(_json_error(raw, f"chat/completions HTTP {status}"))

    raise ClothAiError("生图失败：" + " | ".join(errors[:3]), 502)


def public_error(exc: Exception) -> tuple[int, dict]:
    if isinstance(exc, ClothAiError):
        return exc.status, {"error": redact(exc.message)}
    return 500, {"error": "生图失败"}
