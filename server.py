# -*- coding: utf-8 -*-
"""Local static server: editor + real unpacked tiles/tables."""
from __future__ import annotations

import hashlib
import json
import sys
import threading
import webbrowser
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

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

PORT = 8765
ALE_PNG_MAX_BYTES = 80 * 1024 * 1024
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

    def _send(self, code, body: bytes, ctype="application/octet-stream", cache="no-cache"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", cache)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
            return

    def _send_png(self, png: bytes):
        self._send(200, png, "image/png", cache="public, max-age=604800, immutable")

    def _read_body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        request = urlsplit(self.path)
        path = unquote(request.path)
        query = parse_qs(request.query)
        if path in ("/", "/index.html"):
            data = (WEB / "index.html").read_bytes()
            return self._send(200, data, "text/html; charset=utf-8")
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
            return self._send(200, kinds.read_bytes(), "application/json; charset=utf-8")
        if path == "/api/editor-catalog":
            catalog = DATA / "editor_catalog.json"
            if not catalog.is_file():
                from tools.build_editor_catalog import main as build_catalog

                build_catalog()
            return self._send(200, catalog.read_bytes(), "application/json; charset=utf-8")
        if path == "/api/item-icons":
            icons = DATA / "item_icons.json"
            if not icons.is_file():
                from tools.build_item_icons import main as build_item_icons

                build_item_icons()
            if not icons.is_file():
                return self._send(404, b"missing item icons", "text/plain")
            return self._send(200, icons.read_bytes(), "application/json; charset=utf-8")
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
        return self._send(404, b"not found", "text/plain")

    def do_POST(self):
        path = unquote(self.path.split("?", 1)[0])
        raw = self._read_body()
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
        except Exception as e:
            msg = str(e).encode("utf-8", errors="replace")
            return self._send(400, msg, "text/plain; charset=utf-8")
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
        data = path.read_bytes()
        ctype = _ctype(path) if guess else "application/octet-stream"
        return self._send(200, data, ctype)


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
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    httpd.daemon_threads = True
    url = "http://127.0.0.1:%d/" % PORT
    print("外部设计桌", url)
    print("game", GAME)
    print("tiles", TILE)
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("bye")


if __name__ == "__main__":
    main()
