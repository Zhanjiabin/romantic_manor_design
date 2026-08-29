# -*- coding: utf-8 -*-
"""Resolve tiles/tables: local game folder, or the vendored copy in this repo."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUNDLED_GAME = ROOT / "vendor" / "game"


def _looks_like_game(path: Path) -> bool:
    return (path / "sourceCode" / "leo" / "rcex" / "maps" / "tile").is_dir()


def game_root() -> Path:
    env = (os.environ.get("MANOR_GAME_ROOT") or "").strip().strip('"')
    if env:
        p = Path(env)
        if _looks_like_game(p):
            return p.resolve()
    cfg_json = ROOT / "config.json"
    if cfg_json.is_file():
        try:
            data = json.loads(cfg_json.read_text(encoding="utf-8"))
            raw = str(data.get("gameRoot") or data.get("game_root") or "").strip().strip('"')
            if raw:
                p = Path(raw)
                if _looks_like_game(p):
                    return p.resolve()
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    cfg = ROOT / "game_root.txt"
    if cfg.is_file():
        line = cfg.read_text(encoding="utf-8").strip().strip('"')
        if line:
            p = Path(line)
            if _looks_like_game(p):
                return p.resolve()
    if _looks_like_game(BUNDLED_GAME):
        return BUNDLED_GAME.resolve()
    sibling = ROOT.parent / "浪漫庄园"
    if _looks_like_game(sibling):
        return sibling.resolve()
    return BUNDLED_GAME


GAME = game_root()
TILE = GAME / "sourceCode" / "leo" / "rcex" / "maps" / "tile"
BDESIGN_RES = GAME / "sourceCode" / "leo" / "rcex" / "svr" / "bdesign"
BDESIGN_IMGS = GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "bdesign" / "imgs"
MAPDESIGN = GAME / "sourceCode" / "leo" / "rcsys" / "svr" / "mapdesign"
LAUNCHER = GAME / "launcher" / "rc3.exe"
