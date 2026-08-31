# -*- coding: utf-8 -*-
"""Disk-backed desk saves (terrain drafts/versions + building session)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path

from game_paths import ROOT

DATA = ROOT / "data"
_LOCK = threading.Lock()
_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
VERSION_CAP = 30


def saves_root() -> Path:
    env = (os.environ.get("MANOR_SAVES") or "").strip().strip('"')
    root = Path(env) if env else (DATA / "saves")
    root.mkdir(parents=True, exist_ok=True)
    (root / "terrain-versions").mkdir(parents=True, exist_ok=True)
    (root / "terrain-assets").mkdir(parents=True, exist_ok=True)
    return root


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


def load_building_papers() -> dict:
    papers = []
    for path in _papers_root().glob("*.json"):
        item = _read_json(path)
        if isinstance(item, dict) and item.get("data") and item.get("name"):
            papers.append(item)
    papers.sort(key=lambda item: str(item.get("name") or ""))
    return {"papers": papers}


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
            if not name or not isinstance(data, str) or not data:
                continue
            if len(data) > 4 * 1024 * 1024:
                continue
            ident = hashlib.sha1(data.encode("ascii", "ignore")).hexdigest()[:24]
            _atomic_write(
                root / f"{ident}.json",
                {"id": ident, "name": name, "data": data, "savedAt": now},
            )
            saved += 1
    return saved


def clear_building_papers() -> int:
    removed = 0
    with _LOCK:
        for path in _papers_root().glob("*.json"):
            try:
                path.unlink()
                removed += 1
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
