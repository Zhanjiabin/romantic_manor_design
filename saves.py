# -*- coding: utf-8 -*-
"""Disk-backed desk saves (terrain drafts/versions + building session)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
from contextvars import ContextVar
from pathlib import Path

from game_paths import ROOT

DATA = ROOT / "data"
_LOCK = threading.Lock()
_INHERIT_LOCK = threading.Lock()
_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
VERSION_CAP = 30
_save_user: ContextVar[str] = ContextVar("manor_save_user", default="")
_LEGACY_FILES = ("terrain-draft.json", "building-session.json", "building-customs.json")
_LEGACY_DIRS = ("terrain-versions", "terrain-assets", "building-papers")


def set_save_user(user: str | None) -> None:
    _save_user.set(str(user or "").strip())


def current_save_user() -> str:
    return _save_user.get()


def _legacy_owner() -> str:
    raw = (os.environ.get("MANOR_BASIC_AUTH") or "").strip()
    if raw:
        return raw.split(":", 1)[0].strip()
    return (os.environ.get("MANOR_USER") or "").strip()


def _user_folder_name(user: str) -> str:
    ident = safe_save_id(user)
    if ident:
        return ident
    return hashlib.sha1(user.encode("utf-8")).hexdigest()[:16]


def _base_saves_root() -> Path:
    env = (os.environ.get("MANOR_SAVES") or "").strip().strip('"')
    return Path(env) if env else (DATA / "saves")


def _prepare_saves_root(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "terrain-versions").mkdir(parents=True, exist_ok=True)
    (root / "terrain-assets").mkdir(parents=True, exist_ok=True)
    return root


def _user_dir_has_data(root: Path) -> bool:
    if any((root / name).is_file() for name in _LEGACY_FILES):
        return True
    papers = root / "building-papers"
    if papers.is_dir() and any(path.suffix == ".json" and not path.name.startswith("_") for path in papers.iterdir()):
        return True
    versions = root / "terrain-versions"
    if versions.is_dir() and any(versions.glob("*.json")):
        return True
    return False


def _maybe_inherit_legacy(base: Path, dest: Path, user: str) -> None:
    if user != _legacy_owner() or _user_dir_has_data(dest):
        return
    marker = dest / ".inherited"
    if marker.is_file():
        return
    copied = False
    for name in _LEGACY_FILES:
        src = base / name
        if src.is_file():
            shutil.copy2(src, dest / name)
            copied = True
    for name in _LEGACY_DIRS:
        src = base / name
        dst = dest / name
        if src.is_dir() and not dst.exists():
            shutil.copytree(src, dst)
            copied = True
    if copied:
        marker.write_text(user, encoding="utf-8")


def saves_root() -> Path:
    base = _base_saves_root()
    user = current_save_user()
    if not user:
        return _prepare_saves_root(base)
    root = base / "users" / _user_folder_name(user)
    root.mkdir(parents=True, exist_ok=True)
    with _INHERIT_LOCK:
        _maybe_inherit_legacy(base, root, user)
    return _prepare_saves_root(root)


def safe_save_id(value: str) -> str | None:
    text = str(value or "").strip()
    if not _ID_RE.fullmatch(text):
        return None
    return text


def _atomic_write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd, tmp = tempfile.mkstemp(prefix=".save-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path: Path):
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    return data


def load_terrain_bundle() -> dict:
    root = saves_root()
    draft = _read_json(root / "terrain-draft.json")
    versions = []
    for path in (root / "terrain-versions").glob("*.json"):
        item = _read_json(path)
        if isinstance(item, dict):
            versions.append(item)
    versions.sort(key=lambda item: int(item.get("savedAt") or 0), reverse=True)
    return {"draft": draft if isinstance(draft, dict) else None, "versions": versions}


def save_terrain_draft(doc: dict) -> dict:
    if not isinstance(doc, dict):
        raise ValueError("draft must be an object")
    with _LOCK:
        _atomic_write(saves_root() / "terrain-draft.json", doc)
    return doc


def save_terrain_version(doc: dict) -> dict:
    if not isinstance(doc, dict):
        raise ValueError("version must be an object")
    ident = safe_save_id(str(doc.get("id") or ""))
    if not ident:
        raise ValueError("invalid version id")
    with _LOCK:
        root = saves_root()
        _atomic_write(root / "terrain-versions" / f"{ident}.json", doc)
        _atomic_write(root / "terrain-draft.json", doc)
        versions = sorted(
            (root / "terrain-versions").glob("*.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for extra in versions[VERSION_CAP:]:
            try:
                extra.unlink()
            except OSError:
                pass
    return doc


def delete_terrain_version(ident: str) -> bool:
    ident = safe_save_id(ident)
    if not ident:
        return False
    path = saves_root() / "terrain-versions" / f"{ident}.json"
    with _LOCK:
        if not path.is_file():
            return False
        path.unlink()
    return True


def save_terrain_asset(ident: str, payload: bytes, content_type: str = "") -> None:
    ident = safe_save_id(ident)
    if not ident:
        raise ValueError("invalid asset id")
    if not isinstance(payload, (bytes, bytearray)) or not payload:
        raise ValueError("asset must not be empty")
    root = saves_root() / "terrain-assets"
    with _LOCK:
        fd, tmp = tempfile.mkstemp(prefix=".asset-", dir=str(root))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
            os.replace(tmp, root / ident)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        _atomic_write(
            root / f"{ident}.meta.json",
            {"contentType": str(content_type or "application/octet-stream")[:100]},
        )


def load_terrain_asset(ident: str) -> tuple[bytes, str] | None:
    ident = safe_save_id(ident)
    if not ident:
        return None
    root = saves_root() / "terrain-assets"
    path = root / ident
    if not path.is_file():
        return None
    try:
        payload = path.read_bytes()
    except OSError:
        return None
    meta = _read_json(root / f"{ident}.meta.json") or {}
    return payload, str(meta.get("contentType") or "application/octet-stream")


def _papers_root() -> Path:
    root = saves_root() / "building-papers"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _library_meta_path() -> Path:
    return _papers_root() / "_meta.json"


def load_paper_library_meta() -> dict:
    meta = _read_json(_library_meta_path()) or {}
    groups = meta.get("groups") if isinstance(meta.get("groups"), list) else []
    cleaned = []
    for item in groups:
        if not isinstance(item, dict):
            continue
        ident = str(item.get("id") or "").strip()[:40]
        name = str(item.get("name") or "").strip()[:40]
        if ident and name:
            cleaned.append({"id": ident, "name": name})
    return {"groups": cleaned}


def save_paper_library_meta(groups) -> None:
    cleaned = []
    if isinstance(groups, list):
        for item in groups:
            if not isinstance(item, dict):
                continue
            ident = str(item.get("id") or "").strip()[:40]
            name = str(item.get("name") or "").strip()[:40]
            if ident and name:
                cleaned.append({"id": ident, "name": name})
    with _LOCK:
        _atomic_write(_library_meta_path(), {"groups": cleaned})


def _int_field(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _paper_thumb_names(ident: str) -> tuple[str, str]:
    return f"{ident}.thumb.jpg", f"{ident}.thumb.png"


def find_paper_thumb(ident: str) -> Path | None:
    ident = safe_save_id(ident) or ""
    if not ident:
        return None
    root = _papers_root()
    for name in _paper_thumb_names(ident):
        path = root / name
        if path.is_file():
            return path
    return None


def _thumb_mtime_map() -> dict[str, int]:
    found: dict[str, int] = {}
    root = _papers_root()
    for path in root.glob("*.thumb.jpg"):
        ident = path.name[: -len(".thumb.jpg")]
        found[ident] = int(path.stat().st_mtime * 1000)
    for path in root.glob("*.thumb.png"):
        ident = path.name[: -len(".thumb.png")]
        found.setdefault(ident, int(path.stat().st_mtime * 1000))
    return found


def _unlink_paper_thumbs(ident: str) -> None:
    root = _papers_root()
    for name in _paper_thumb_names(ident):
        try:
            (root / name).unlink()
        except OSError:
            pass


def paper_exists(ident: str) -> bool:
    ident = safe_save_id(ident)
    return bool(ident) and (_papers_root() / f"{ident}.json").is_file()


def paper_public_meta(item: dict, *, has_thumb: bool = False, thumb_at: int = 0) -> dict:
    data = item.get("data") if isinstance(item.get("data"), str) else ""
    return {
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "kind": str(item.get("kind") or ""),
        "group": str(item.get("group") or ""),
        "savedAt": _int_field(item.get("savedAt")),
        "bytes": len(data),
        "count": max(0, _int_field(item.get("count"))),
        "meta": str(item.get("meta") or "")[:80],
        "unresolved": max(0, _int_field(item.get("unresolved"))),
        "hasThumb": bool(has_thumb),
        "thumbAt": thumb_at if has_thumb else 0,
    }


def load_building_paper(ident: str) -> dict | None:
    ident = safe_save_id(ident)
    if not ident:
        return None
    item = _read_json(_papers_root() / f"{ident}.json")
    if isinstance(item, dict) and item.get("data") and item.get("name"):
        return item
    return None


def load_paper_thumb(ident: str) -> tuple[bytes, str] | None:
    path = find_paper_thumb(ident)
    if not path:
        return None
    try:
        payload = path.read_bytes()
    except OSError:
        return None
    ctype = "image/png" if path.name.endswith(".png") else "image/jpeg"
    return payload, ctype


def save_paper_thumb(ident: str, payload: bytes, content_type: str = "") -> None:
    ident = safe_save_id(ident)
    if not ident:
        raise ValueError("invalid paper id")
    if not paper_exists(ident):
        raise ValueError("missing paper")
    if not isinstance(payload, (bytes, bytearray)) or not payload:
        raise ValueError("thumb must not be empty")
    raw = bytes(payload)
    if len(raw) > 256 * 1024:
        raise ValueError("thumb too large")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        suffix = ".thumb.png"
    elif raw.startswith(b"\xff\xd8"):
        suffix = ".thumb.jpg"
    else:
        raise ValueError("thumb must be jpeg or png")
    del content_type
    root = _papers_root()
    dest = root / f"{ident}{suffix}"
    other = root / f"{ident}{'.thumb.jpg' if suffix == '.thumb.png' else '.thumb.png'}"
    with _LOCK:
        fd, tmp = tempfile.mkstemp(prefix=".thumb-", dir=str(root))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(raw)
            os.replace(tmp, dest)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        try:
            other.unlink()
        except OSError:
            pass


def load_building_papers(*, include_data: bool = False) -> dict:
    papers = []
    thumbs = _thumb_mtime_map() if not include_data else {}
    for path in _papers_root().glob("*.json"):
        if path.name.startswith("_"):
            continue
        item = _read_json(path)
        if not (isinstance(item, dict) and item.get("data") and item.get("name")):
            continue
        if include_data:
            papers.append(item)
            continue
        ident = str(item.get("id") or path.stem)
        papers.append(
            paper_public_meta(
                item,
                has_thumb=ident in thumbs,
                thumb_at=thumbs.get(ident) or 0,
            )
        )
    papers.sort(
        key=lambda item: (-int(item.get("savedAt") or 0), str(item.get("name") or "").lower())
    )
    meta = load_paper_library_meta()
    return {"papers": papers, "groups": meta["groups"]}


def save_building_papers(items) -> int:
    """Upsert uploaded paper files (base64 bytes); id is the content hash so
    re-uploading the same folder dedupes instead of duplicating."""
    if not isinstance(items, list):
        raise ValueError("papers must be a list")
    saved = 0
    now = int(time.time() * 1000)
    with _LOCK:
        root = _papers_root()
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip().replace("\\", "/")[:240]
            data = item.get("data")
            ident = str(item.get("id") or "").strip()
            if ident:
                ident = ident[:24]
            elif isinstance(data, str) and data:
                ident = hashlib.sha1(data.encode("ascii", "ignore")).hexdigest()[:24]
            if not ident:
                continue
            path = root / f"{ident}.json"
            existing = _read_json(path) if path.is_file() else None
            if not isinstance(existing, dict):
                existing = {}
            if not isinstance(data, str) or not data:
                data = existing.get("data")
            if not name:
                name = str(existing.get("name") or "").strip()
            if not name or not isinstance(data, str) or not data:
                continue
            if len(data) > 4 * 1024 * 1024:
                continue
            payload = {
                "id": ident,
                "name": name,
                "data": data,
                "savedAt": now,
            }
            kind = str(item.get("kind") or existing.get("kind") or "").strip()
            if kind in ("desk", "terrain", "manor"):
                payload["kind"] = kind
            group = item.get("group")
            if group is None:
                group = existing.get("group") or ""
            payload["group"] = str(group or "").strip()[:40]
            if "count" in item:
                payload["count"] = max(0, _int_field(item.get("count")))
            elif "count" in existing:
                payload["count"] = existing["count"]
            if "meta" in item:
                payload["meta"] = str(item.get("meta") or "")[:80]
            elif existing.get("meta"):
                payload["meta"] = str(existing.get("meta") or "")[:80]
            if "unresolved" in item:
                payload["unresolved"] = max(0, _int_field(item.get("unresolved")))
            elif "unresolved" in existing:
                payload["unresolved"] = existing["unresolved"]
            _atomic_write(path, payload)
            saved += 1
    return saved


def clear_building_papers() -> int:
    removed = 0
    with _LOCK:
        root = _papers_root()
        for path in root.glob("*.json"):
            if path.name.startswith("_"):
                continue
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
        for path in list(root.glob("*.thumb.jpg")) + list(root.glob("*.thumb.png")):
            try:
                path.unlink()
            except OSError:
                pass
    return removed


def delete_building_paper(ident: str) -> bool:
    ident = safe_save_id(ident)
    if not ident:
        return False
    path = _papers_root() / f"{ident}.json"
    with _LOCK:
        if not path.is_file():
            return False
        path.unlink()
        _unlink_paper_thumbs(ident)
    return True


def load_building_bundle() -> dict:
    root = saves_root()
    session = _read_json(root / "building-session.json")
    customs = _read_json(root / "building-customs.json")
    return {
        "session": session if isinstance(session, dict) else None,
        "customs": customs if isinstance(customs, dict) else None,
    }


def save_building_bundle(doc: dict) -> dict:
    if not isinstance(doc, dict):
        raise ValueError("building save must be an object")
    with _LOCK:
        root = saves_root()
        if "session" in doc:
            session = doc.get("session")
            path = root / "building-session.json"
            if session is None:
                try:
                    path.unlink()
                except OSError:
                    pass
            elif isinstance(session, dict):
                _atomic_write(path, session)
            else:
                raise ValueError("session must be an object")
        if "customs" in doc:
            customs = doc.get("customs")
            path = root / "building-customs.json"
            if customs is None:
                try:
                    path.unlink()
                except OSError:
                    pass
            elif isinstance(customs, dict):
                _atomic_write(path, customs)
            else:
                raise ValueError("customs must be an object")
    return load_building_bundle()
