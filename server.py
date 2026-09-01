# -*- coding: utf-8 -*-
"""Local static server: editor + real unpacked tiles/tables."""
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import json
import os
import sys
import threading
import webbrowser
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
from game_paths import GAME, TILE, BDESIGN_RES, BDESIGN_IMGS, RCITEM, MAPDESIGN
WEB = ROOT / "web"
DATA = ROOT / "data"
PROBE_REFERENCE = ROOT / "data" / "probe_reference.jpg"
PNG_CACHE_DIR = DATA / "ale_png_cache"

sys.path.insert(0, str(ROOT))
from codec.building import dumps_document as dumps_building_document
from codec.building import dumps_gbk as dumps_building
from codec.building import loads_gbk as loads_building
from codec.building import public_document as public_building_document
from codec.ale import AleError, dumps_png
from codec.terrain import dumps_document as dumps_terrain_document
from codec.terrain import dumps_gbk as dumps_terrain
from codec.terrain import loads_gbk as loads_terrain
from export_xlsx import build_materials_xlsx
from saves import (
    clear_building_papers,
    delete_building_paper,
    delete_terrain_version,
    load_building_bundle,
    load_building_paper,
    load_building_papers,
    load_paper_thumb,
    load_terrain_asset,
    load_terrain_bundle,
    paper_exists,
    save_building_bundle,
    save_building_papers,
    save_paper_library_meta,
    save_paper_thumb,
    save_terrain_asset,
    save_terrain_draft,
    save_terrain_version,
)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_MAX_BODY = 8 * 1024 * 1024
PUBLIC_PATHS = frozenset({"/api/health"})
LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
ALE_PNG_MAX_BYTES = 80 * 1024 * 1024


def listen_host() -> str:
    return (os.environ.get("MANOR_HOST") or DEFAULT_HOST).strip() or DEFAULT_HOST


def listen_port() -> int:
    raw = (os.environ.get("MANOR_PORT") or str(DEFAULT_PORT)).strip()
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit("MANOR_PORT 必须是数字")
    if not (1 <= port <= 65535):
        raise SystemExit("MANOR_PORT 超出范围")
    return port


def max_body_bytes() -> int:
    raw = (os.environ.get("MANOR_MAX_BODY") or str(DEFAULT_MAX_BODY)).strip()
    try:
        n = int(raw)
    except ValueError:
        return DEFAULT_MAX_BODY
    return max(64 * 1024, n)


def _account_pair(user: str, password: str) -> tuple[str, str] | None:
    user = (user or "").strip()
    password = password or ""
    if user and password:
        return user, password
    return None


def _parse_account(raw: str) -> tuple[str, str] | None:
    user, sep, password = (raw or "").partition(":")
    if not sep:
        return None
    return _account_pair(user, password)


def auth_accounts() -> list[tuple[str, str]]:
    accounts: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(pair: tuple[str, str] | None) -> None:
        if not pair or pair[0] in seen:
            return
        seen.add(pair[0])
        accounts.append(pair)

    raw = (os.environ.get("MANOR_BASIC_AUTH") or "").strip()
    if raw:
        add(_parse_account(raw))
    else:
        add(_account_pair(os.environ.get("MANOR_USER") or "", os.environ.get("MANOR_PASSWORD") or ""))
    extra = (os.environ.get("MANOR_USERS") or "").strip()
    if extra:
        for part in extra.split(","):
            add(_parse_account(part.strip()))
    return accounts


def auth_credentials() -> tuple[str, str] | None:
    accounts = auth_accounts()
    return accounts[0] if accounts else None


def parse_basic_auth(header: str) -> tuple[str, str] | None:
    if not header:
        return None
    kind, _, token = header.partition(" ")
    if kind.lower() != "basic" or not token.strip():
        return None
    try:
        decoded = base64.b64decode(token.strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    user, sep, password = decoded.partition(":")
    if not sep:
        return None
    return user, password


def credentials_match(got_user: str, got_password: str, want_user: str, want_password: str) -> bool:
    user_ok = hmac.compare_digest(
        hashlib.sha256(got_user.encode("utf-8")).digest(),
        hashlib.sha256(want_user.encode("utf-8")).digest(),
    )
    pass_ok = hmac.compare_digest(
        hashlib.sha256(got_password.encode("utf-8")).digest(),
        hashlib.sha256(want_password.encode("utf-8")).digest(),
    )
    return user_ok and pass_ok


def require_auth_for_bind(host: str) -> None:
    if host in LOOPBACK:
        return
    if auth_accounts():
        return
    if (os.environ.get("MANOR_ALLOW_OPEN") or "").strip() == "1":
        print("警告: 已对公网开放且未设访问密码（MANOR_ALLOW_OPEN=1）")
        return
    raise SystemExit(
        "监听非本机地址时必须设置 MANOR_USER 和 MANOR_PASSWORD"
        "（或 MANOR_BASIC_AUTH=用户:密码，或 MANOR_USERS=用户:密码,用户:密码）。"
        "仅调试可设 MANOR_ALLOW_OPEN=1。"
    )


def should_open_browser(host: str) -> bool:
    if (os.environ.get("MANOR_NO_BROWSER") or "").strip() == "1":
        return False
    if (os.environ.get("MANOR_OPEN_BROWSER") or "").strip() == "1":
        return True
    return host in LOOPBACK


_ALE_PNG = OrderedDict()
_ALE_PNG_BYTES = 0
_ALE_PNG_LOCK = threading.Lock()
_ALE_PNG_INFLIGHT = {}


def _png_disk_path(cache_key: str) -> Path:
    digest = hashlib.md5(cache_key.encode("utf-8")).hexdigest()
    return PNG_CACHE_DIR / f"{digest}.png"


def _png_remember(cache_key: str, png: bytes) -> None:
    global _ALE_PNG_BYTES
    if cache_key in _ALE_PNG:
        _ALE_PNG_BYTES -= len(_ALE_PNG[cache_key])
        _ALE_PNG.pop(cache_key, None)
    _ALE_PNG[cache_key] = png
    _ALE_PNG_BYTES += len(png)
    while _ALE_PNG_BYTES > ALE_PNG_MAX_BYTES and len(_ALE_PNG) > 1:
        _old_key, old_png = _ALE_PNG.popitem(last=False)
        _ALE_PNG_BYTES -= len(old_png)


def _png_cached(cache_key: str, producer):
    with _ALE_PNG_LOCK:
        png = _ALE_PNG.get(cache_key)
        if png is not None:
            _ALE_PNG.move_to_end(cache_key)
            return png
        waiter = _ALE_PNG_INFLIGHT.get(cache_key)
        if waiter is None:
            waiter = threading.Event()
            _ALE_PNG_INFLIGHT[cache_key] = waiter
            owner = True
        else:
            owner = False
    if not owner:
        waiter.wait(timeout=60)
        with _ALE_PNG_LOCK:
            png = _ALE_PNG.get(cache_key)
        if png is not None:
            return png
        return producer()
    try:
        disk = _png_disk_path(cache_key)
        if disk.is_file():
            png = disk.read_bytes()
        else:
            png = producer()
            try:
                disk.parent.mkdir(parents=True, exist_ok=True)
                disk.write_bytes(png)
            except OSError:
                pass
        with _ALE_PNG_LOCK:
            _png_remember(cache_key, png)
        return png
    finally:
        with _ALE_PNG_LOCK:
            _ALE_PNG_INFLIGHT.pop(cache_key, None)
            waiter.set()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        try:
            sys.stderr.write("[desk] " + (fmt % args) + "\n")
        except OSError:
            pass

    def _request_path(self) -> str:
        return unquote(urlsplit(self.path).path)

    def _authorized(self) -> bool:
        accounts = auth_accounts()
        if not accounts:
            return True
        if self._request_path() in PUBLIC_PATHS:
            return True
        got = parse_basic_auth(self.headers.get("Authorization") or "")
        if not got:
            return False
        return any(credentials_match(got[0], got[1], user, password) for user, password in accounts)

    def _challenge(self) -> bool:
        if self._authorized():
            return False
        body = b"auth required"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Manor Desk", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            pass
        return True

    def _send(self, code, body: bytes, ctype="application/octet-stream", cache="no-cache", etag=None, encoding=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", cache)
        if etag:
            self.send_header("ETag", etag)
            self.send_header("Vary", "Accept-Encoding")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def _send_png(self, png: bytes):
        self._send(200, png, "image/png", cache="public, max-age=604800, immutable")

    def _send_download(self, body: bytes, filename: str, ctype: str):
        ascii_name = "materials.xlsx"
        encoded = quote(filename or ascii_name)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Content-Disposition",
            f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}",
        )
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def _read_body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if self._challenge():
            return
        request = urlsplit(self.path)
        path = unquote(request.path)
        query = parse_qs(request.query)
        if path in ("/", "/index.html"):
            return self._file(WEB / "index.html", guess=True)
        if path.startswith("/data/"):
            return self._file(DATA / path[len("/data/") :].replace("\\", "/"), guess=True)
        if path.startswith("/web/"):
            return self._file(WEB / path[len("/web/") :], guess=True)
        if path.startswith("/tiles/"):
            return self._file(TILE / path[len("/tiles/") :].replace("\\", "/"), guess=True)
        if path == "/probe/reference.jpg":
            if not PROBE_REFERENCE.is_file():
                return self._send(404, b"missing reference", "text/plain")
            return self._send(200, PROBE_REFERENCE.read_bytes(), "image/jpeg")
        if path.startswith("/ale-atlas/"):
            return self._ale_png(path[len("/ale-atlas/") :], crop=False)
        if path.startswith("/ale/"):
            return self._ale_png(path[len("/ale/") :])
        if path.startswith("/item-ale/"):
            try:
                frame = max(0, int(query.get("f", ["0"])[0]))
            except ValueError:
                return self._send(400, b"invalid frame", "text/plain")
            return self._item_ale_png(
                path[len("/item-ale/") :],
                frame,
                thumb=query.get("thumb", ["0"])[0] in {"1", "true", "yes"},
            )
        if path.startswith("/bdesign/ale/"):
            try:
                frame = max(0, int(query.get("f", ["0"])[0]))
            except ValueError:
                return self._send(400, b"invalid frame", "text/plain")
            return self._bdesign_ale_png(path[len("/bdesign/ale/") :], frame, thumb=query.get("thumb", ["0"])[0] in {"1", "true", "yes"})
        if path.startswith("/bdesign/res/"):
            return self._file(BDESIGN_RES / path[len("/bdesign/") :].replace("\\", "/"), guess=True)
        if path.startswith("/bdesign/imgs/"):
            rel = path[len("/bdesign/imgs/") :]
            if rel.lower().endswith(".ale.png"):
                try:
                    frame = max(0, int(query.get("f", ["0"])[0]))
                except ValueError:
                    return self._send(400, b"invalid frame", "text/plain")
                return self._bdesign_img_ale_png(rel[:-4], frame)
            return self._file(BDESIGN_IMGS / rel.replace("\\", "/"), guess=True)
        if path == "/api/kinds":
            kinds = DATA / "kinds.json"
            if not kinds.is_file():
                from tools.build_kinds import main as build

                build()
            return self._file(kinds, guess=True)
        if path == "/api/editor-catalog":
            catalog = DATA / "editor_catalog.json"
            if not catalog.is_file():
                from tools.build_editor_catalog import main as build_catalog

                build_catalog()
            return self._file(catalog, guess=True)
        if path == "/api/item-icons":
            icons = DATA / "item_icons.json"
            if not icons.is_file():
                from tools.build_item_icons import main as build_item_icons

                build_item_icons()
            if not icons.is_file():
                return self._send(404, b"missing item icons", "text/plain")
            return self._file(icons, guess=True)
        if path == "/api/sample-terrain":
            paper = GAME / "图代码" / "地形.txt"
            if not paper.is_file():
                return self._send(404, b"missing paper", "text/plain")
            doc = loads_terrain(paper.read_bytes())
            body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8")
        if path == "/api/health":
            payload = {
                "ok": True,
                "tile": TILE.is_dir(),
                "grass": (TILE / "maptexture" / "c01.jpg").is_file(),
            }
            return self._send(200, json.dumps(payload).encode("utf-8"), "application/json")
        if path == "/api/saves/terrain":
            body = json.dumps(load_terrain_bundle(), ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8")
        asset_prefix = "/api/saves/terrain/assets/"
        if path.startswith(asset_prefix):
            asset = load_terrain_asset(path[len(asset_prefix) :])
            if not asset:
                return self._send(404, b"missing", "text/plain")
            body, content_type = asset
            return self._send(200, body, content_type)
        if path == "/api/saves/building":
            body = json.dumps(load_building_bundle(), ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8")
        if path == "/api/saves/building/papers":
            body = json.dumps(load_building_papers(), ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8")
        paper_prefix = "/api/saves/building/papers/"
        if path.startswith(paper_prefix):
            rest = path[len(paper_prefix) :]
            parts = [part for part in rest.split("/") if part]
            if not parts:
                return self._send(404, b"missing", "text/plain")
            ident = parts[0]
            if len(parts) == 1:
                paper = load_building_paper(ident)
                if not paper:
                    return self._send(404, b"missing", "text/plain")
                body = json.dumps(paper, ensure_ascii=False).encode("utf-8")
                return self._send(200, body, "application/json; charset=utf-8")
            if len(parts) == 2 and parts[1] == "thumb":
                thumb = load_paper_thumb(ident)
                if not thumb:
                    return self._send(404, b"missing", "text/plain")
                payload, content_type = thumb
                return self._send(200, payload, content_type, cache="public, max-age=86400")
            return self._send(404, b"not found", "text/plain")
        return self._send(404, b"not found", "text/plain")

    def _limited_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, b"bad content-length", "text/plain")
            return None
        if length > max_body_bytes():
            self._send(413, b"payload too large", "text/plain")
            return None
        return self._read_body()

    def do_POST(self):
        if self._challenge():
            return
        path = unquote(self.path.split("?", 1)[0])
        raw = self._limited_body()
        if raw is None:
            return
        try:
            if path == "/api/from-gbk":
                text = None
                for enc in ("gbk", "gb18030", "utf-8-sig", "utf-8"):
                    try:
                        text = raw.decode(enc)
                        used = enc
                        break
                    except UnicodeDecodeError:
                        continue
                if text is None:
                    return self._send(400, b"decode fail", "text/plain")
                return self._send(
                    200,
                    json.dumps({"text": text, "encoding": used}, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
            if path == "/api/to-gbk":
                obj = json.loads(raw.decode("utf-8"))
                data = str(obj.get("text") or "").encode("gbk", errors="replace")
                # Never put Chinese in Content-Disposition: Python send_header is latin-1
                # and the browser would download the 500 body as a fake paper.
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", 'attachment; filename="map.txt"')
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
                return
            if path == "/api/parse-terrain":
                doc = loads_terrain(raw)
                return self._send(
                    200, json.dumps(doc, ensure_ascii=False).encode("utf-8"), "application/json"
                )
            if path in ("/api/parse-building", "/api/parse-building-desk", "/api/parse-manor"):
                kind = None
                if path == "/api/parse-building-desk":
                    kind = "desk"
                elif path == "/api/parse-manor":
                    kind = "manor"
                doc = public_building_document(loads_building(raw, kind=kind))
                return self._send(
                    200, json.dumps(doc, ensure_ascii=False).encode("utf-8"), "application/json"
                )
            if path == "/api/format-terrain":
                obj = json.loads(raw.decode("utf-8"))
                data = (
                    dumps_terrain_document(obj)
                    if obj.get("_source")
                    else dumps_terrain(obj["stamps"], int(obj["size"]), int(obj.get("mapflag") or 0))
                )
                return self._send(200, data, "application/octet-stream")
            if path == "/api/format-building":
                obj = json.loads(raw.decode("utf-8"))
                data = (
                    dumps_building_document(obj)
                    if obj.get("_source")
                    else dumps_building(obj["records"], kind=obj.get("kind") or "manor")
                )
                return self._send(200, data, "application/octet-stream")
            if path == "/api/export-materials":
                obj = json.loads(raw.decode("utf-8") or "{}")
                data, filename = build_materials_xlsx(obj)
                return self._send_download(
                    data,
                    filename,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
        except Exception as e:
            msg = str(e).encode("utf-8", errors="replace")
            return self._send(400, msg, "text/plain; charset=utf-8")
        return self._send(404, b"not found", "text/plain")

    def do_PUT(self):
        if self._challenge():
            return
        path = unquote(self.path.split("?", 1)[0])
        raw = self._limited_body()
        if raw is None:
            return
        try:
            asset_prefix = "/api/saves/terrain/assets/"
            if path.startswith(asset_prefix):
                save_terrain_asset(
                    path[len(asset_prefix) :],
                    raw,
                    self.headers.get("Content-Type") or "application/octet-stream",
                )
                return self._send(200, b'{"ok":true}', "application/json")
            paper_prefix = "/api/saves/building/papers/"
            if path.startswith(paper_prefix) and path.endswith("/thumb"):
                ident = path[len(paper_prefix) : -len("/thumb")].strip("/")
                if "/" in ident or not ident:
                    return self._send(404, b"missing", "text/plain")
                if not paper_exists(ident):
                    return self._send(404, b"missing", "text/plain")
                save_paper_thumb(ident, raw, self.headers.get("Content-Type") or "")
                return self._send(200, b'{"ok":true}', "application/json")
            obj = json.loads(raw.decode("utf-8") or "null")
            if path == "/api/saves/terrain/draft":
                save_terrain_draft(obj)
                return self._send(200, b'{"ok":true}', "application/json")
            if path == "/api/saves/terrain/version":
                save_terrain_version(obj)
                return self._send(200, b'{"ok":true}', "application/json")
            if path == "/api/saves/building":
                body = json.dumps(save_building_bundle(obj), ensure_ascii=False).encode("utf-8")
                return self._send(200, body, "application/json; charset=utf-8")
            if path == "/api/saves/building/papers":
                if obj.get("replace"):
                    clear_building_papers()
                if "groups" in obj:
                    save_paper_library_meta(obj.get("groups"))
                saved = save_building_papers(obj.get("papers") or [])
                payload = json.dumps({"ok": True, "saved": saved}).encode("utf-8")
                return self._send(200, payload, "application/json")
        except Exception as e:
            return self._send(400, str(e).encode("utf-8", errors="replace"), "text/plain; charset=utf-8")
        return self._send(404, b"not found", "text/plain")

    def do_DELETE(self):
        if self._challenge():
            return
        path = unquote(self.path.split("?", 1)[0])
        prefix = "/api/saves/terrain/version/"
        if path.startswith(prefix):
            if delete_terrain_version(path[len(prefix) :]):
                return self._send(200, b'{"ok":true}', "application/json")
            return self._send(404, b"missing", "text/plain")
        if path == "/api/saves/building/papers":
            removed = clear_building_papers()
            payload = json.dumps({"ok": True, "removed": removed}).encode("utf-8")
            return self._send(200, payload, "application/json")
        paper_prefix = "/api/saves/building/papers/"
        if path.startswith(paper_prefix):
            if delete_building_paper(path[len(paper_prefix) :]):
                return self._send(200, b'{"ok":true}', "application/json")
            return self._send(404, b"missing", "text/plain")
        return self._send(404, b"not found", "text/plain")

    def _ale_png(self, name: str, crop: bool = True):
        name = name.replace("\\", "/").split("/")[-1]
        if name.lower().endswith(".png"):
            name = name[:-4]
        if name.lower().endswith(".ale"):
            name = name[:-4]
        if not name or any(c in name for c in "/\\.."):
            return self._send(404, b"missing", "text/plain")
        cache_key = ("link-crop:" if crop else "link-atlas:") + name
        src = (TILE / "mask" / (name + ".ale")).resolve()
        if not _is_under(src, (TILE / "mask").resolve()) or not src.is_file():
            return self._send(404, b"missing", "text/plain")
        try:
            png = _png_cached(cache_key, lambda: dumps_png(src.read_bytes(), crop=crop))
        except (AleError, OSError) as e:
            return self._send(400, str(e).encode("utf-8", errors="replace"), "text/plain; charset=utf-8")
        return self._send_png(png)

    def _item_ale_png(self, name: str, frame: int = 0, thumb: bool = False):
        clean = name.replace("\\", "/").lstrip("/")
        if clean.lower().endswith(".png"):
            clean = clean[:-4]
        src = (RCITEM / clean).resolve()
        root = RCITEM.resolve()
        if not _is_under(src, root) or not src.is_file():
            return self._send(404, b"missing", "text/plain")
        suffix = src.suffix.lower()
        if suffix in {".gif", ".png", ".jpg", ".jpeg"}:
            return self._send(200, src.read_bytes(), _ctype(src), cache="public, max-age=604800, immutable")
        if suffix != ".ale":
            return self._send(404, b"missing", "text/plain")
        cache_key = f"item:{rel_cache_key(src, root)}:frame={frame}:thumb={int(thumb)}"
        try:
            png = _png_cached(
                cache_key,
                lambda: dumps_png(src.read_bytes(), frame=frame, crop=False, trim=True),
            )
        except (AleError, OSError) as exc:
            return self._send(
                415,
                str(exc).encode("utf-8", errors="replace"),
                "text/plain; charset=utf-8",
            )
        return self._send_png(png)

    def _bdesign_ale_png(self, name: str, frame: int = 0, thumb: bool = False):
        clean = name.replace("\\", "/").lstrip("/")
        if clean.lower().endswith(".png"):
            clean = clean[:-4]
        if not clean.lower().endswith(".ale"):
            clean += ".ale"
        src = (BDESIGN_RES / clean).resolve()
        root = BDESIGN_RES.resolve()
        if not _is_under(src, root) or not src.is_file():
            return self._send(404, b"missing", "text/plain")
        cache_key = f"building:{rel_cache_key(src, root)}:frame={frame}:thumb={int(thumb)}"
        try:
            png = _png_cached(
                cache_key,
                lambda: dumps_png(src.read_bytes(), frame=frame, crop=False, trim=thumb),
            )
        except (AleError, OSError) as exc:
            return self._send(
                415,
                str(exc).encode("utf-8", errors="replace"),
                "text/plain; charset=utf-8",
            )
        return self._send_png(png)

    def _bdesign_img_ale_png(self, name: str, frame: int = 0):
        clean = name.replace("\\", "/").lstrip("/")
        if not clean.lower().endswith(".ale"):
            return self._send(404, b"missing", "text/plain")
        src = (BDESIGN_IMGS / clean).resolve()
        root = BDESIGN_IMGS.resolve()
        if not _is_under(src, root) or not src.is_file():
            return self._send(404, b"missing", "text/plain")
        cache_key = f"building-img:{rel_cache_key(src, root)}:frame={frame}"
        try:
            png = _png_cached(
                cache_key,
                lambda: dumps_png(src.read_bytes(), frame=frame, crop=False),
            )
        except (AleError, OSError) as exc:
            return self._send(
                415,
                str(exc).encode("utf-8", errors="replace"),
                "text/plain; charset=utf-8",
            )
        return self._send_png(png)

    def _file(self, path: Path, guess=False):
        path = path.resolve()
        allowed = (
            TILE.resolve(),
            BDESIGN_RES.resolve(),
            BDESIGN_IMGS.resolve(),
            RCITEM.resolve(),
            WEB.resolve(),
            DATA.resolve(),
        )
        if not any(_is_under(path, root) for root in allowed) or not path.is_file():
            return self._send(404, b"missing", "text/plain")
        stat = path.stat()
        etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        # Game asset trees never change at runtime; editor files (web/data)
        # revalidate with ETag so deploys show up immediately but unchanged
        # files cost a 304 instead of a re-transfer.
        immutable_roots = (TILE.resolve(), BDESIGN_RES.resolve(), BDESIGN_IMGS.resolve(), RCITEM.resolve())
        cache = (
            "public, max-age=604800, immutable"
            if any(_is_under(path, root) for root in immutable_roots)
            else "no-cache"
        )
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            return
        data = path.read_bytes()
        ctype = _ctype(path) if guess else "application/octet-stream"
        encoding = None
        compressible = ctype.split(";")[0] in {
            "text/html",
            "text/javascript",
            "text/css",
            "text/plain",
            "application/json",
            "image/svg+xml",
        }
        if compressible and len(data) > 2048 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            data = gzip.compress(data, 6)
            encoding = "gzip"
        return self._send(200, data, ctype, cache=cache, etag=etag, encoding=encoding)


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def rel_cache_key(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix().lower()


def _ctype(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".png": "image/png",
        ".cur": "application/octet-stream",
        ".ale": "application/octet-stream",
    }.get(ext, "application/octet-stream")


def main():
    if not TILE.is_dir():
        print("找不到游戏贴图目录:", TILE)
        print("仓库应自带 vendor/game；或把 config.json 的 gameRoot 指到解包后的游戏目录。")
        raise SystemExit(1)
    if not (DATA / "kinds.json").is_file():
        from tools.build_kinds import main as build

        build()
    if not (DATA / "item_icons.json").is_file():
        from tools.build_item_icons import main as build_item_icons

        build_item_icons()
    if not (DATA / "terrain_frames" / "f003.png").is_file() or not (DATA / "manor_exit_sign.png").is_file():
        from tools.export_assets import main as export_assets

        export_assets()
    host = listen_host()
    port = listen_port()
    require_auth_for_bind(host)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    url = "http://127.0.0.1:%d/" % port if host in LOOPBACK else "http://%s:%d/" % (host, port)
    print("外部设计桌", url)
    print("bind", "%s:%d" % (host, port))
    print("game", GAME)
    print("tiles", TILE)
    if auth_accounts():
        print("auth", "basic")
    if should_open_browser(host):
        try:
            webbrowser.open("http://127.0.0.1:%d/" % port)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("bye")


if __name__ == "__main__":
    main()
