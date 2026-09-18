# -*- coding: utf-8 -*-
"""Publish working-tree runtime files to the live manor-desk server."""
import os
import posixpath
import subprocess
import sys
from pathlib import Path

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

HOST = "110.42.70.142"
USER = "root"
PASSWORD = (
    os.environ.get("MANOR_DEPLOY_PW")
    or os.environ.get("MANOR_SSH_PASS")
    or os.environ.get("DEPLOY_PASS")
    or ""
)
REMOTE = "/opt/manor-desk"
ROOT = Path(__file__).resolve().parents[1]

RUNTIME_PREFIXES = ("web/", "data/", "codec/")
RUNTIME_FILES = {"server.py", "saves.py", "export_xlsx.py", "game_paths.py", "cloth_ai.py", "board_ai.py"}
SKIP_PREFIXES = ("data/saves/", "data/image_to_building/")
SKIP_PARTS = ("__pycache__/", ".pytest_cache/")


def working_tree_runtime_files():
    out = subprocess.check_output(
        [
            "git",
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain",
            "-uall",
            "--",
            "web",
            "data",
            "codec",
            "server.py",
            "saves.py",
            "export_xlsx.py",
            "game_paths.py",
            "cloth_ai.py",
            "board_ai.py",
        ],
        encoding="utf-8",
        cwd=ROOT,
    )
    files = []
    seen = set()
    for line in out.splitlines():
        path = line[3:].strip().replace("\\", "/")
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
            path = path[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        if path.endswith(".pyc") or any(part in path for part in SKIP_PARTS):
            continue
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        if not (path.startswith(RUNTIME_PREFIXES) or path in RUNTIME_FILES):
            continue
        if path in seen:
            continue
        local = ROOT / path.replace("/", os.sep)
        if local.is_dir():
            for child in sorted(local.rglob("*")):
                if not child.is_file() or child.suffix == ".pyc":
                    continue
                rel = child.relative_to(ROOT).as_posix()
                if any(rel.startswith(prefix) for prefix in SKIP_PREFIXES):
                    continue
                if rel in seen:
                    continue
                seen.add(rel)
                files.append(rel)
            continue
        if not local.is_file():
            continue
        seen.add(path)
        files.append(path)
    return files


def ensure_remote_dir(sftp, remote_path):
    remote_dir = posixpath.dirname(remote_path)
    if not remote_dir or remote_dir == "/":
        return
    parts = remote_dir.strip("/").split("/")
    path = ""
    for part in parts:
        path = f"{path}/{part}" if path else f"/{part}"
        try:
            sftp.stat(path)
        except OSError:
            sftp.mkdir(path)


def main():
    files = working_tree_runtime_files()
    cloth_n = sum(1 for f in files if f.startswith("data/cloth/"))
    print("count:", len(files), "cloth:", cloth_n)
    for f in files:
        if not f.startswith("data/cloth/templates/"):
            print(" ", f)
    if not files:
        raise SystemExit("no runtime files to publish")
    if not PASSWORD:
        raise SystemExit("missing MANOR_DEPLOY_PW / MANOR_SSH_PASS / DEPLOY_PASS")

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    sftp = cli.open_sftp()
    uploaded = 0
    for f in files:
        local = ROOT / f.replace("/", os.sep)
        remote = f"{REMOTE}/{f.replace(chr(92), '/')}"
        ensure_remote_dir(sftp, remote)
        sftp.put(str(local), remote)
        uploaded += 1
        if f.startswith("data/cloth/templates/"):
            if uploaded % 100 == 0 or uploaded == len(files):
                print(f"put {uploaded}/{len(files)}")
        else:
            print("put", remote)
    sftp.close()

    cmds = [
        "python3 -c \"import json,pathlib; root=pathlib.Path('/opt/manor-desk/data/cloth/templates'); cat=json.load(open('/opt/manor-desk/data/cloth_catalog.json',encoding='utf-8')); keep={str(root / k['id'] / t['file']) for k in cat.get('kinds',[]) for t in k.get('templates') or []}; n=sum(1 for p in list(root.rglob('*')) if p.is_file() and str(p) not in keep and p.unlink() is None); print('cloth-prune', n, 'kept', len(keep), 'files', sum(1 for p in root.rglob('*') if p.is_file()))\"",
        "systemctl restart manor-desk",
        "sleep 1",
        "systemctl is-active manor-desk",
        "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8080/web/building.html",
        "grep -o 'building.js?v=[0-9]*' /opt/manor-desk/web/building.html | tail -n 1",
        "grep -o 'app.js?v=[0-9]*' /opt/manor-desk/web/index.html | tail -n 1",
        "grep -o 'cloth.js?v=[0-9]*' /opt/manor-desk/web/cloth.html | tail -n 1",
        "grep -o 'board.js?v=[0-9]*' /opt/manor-desk/web/board.html | tail -n 1",
        "grep -o 'board.css?v=[0-9]*' /opt/manor-desk/web/board.html | tail -n 1",
        "curl -s -o /dev/null -w board:%{http_code} http://127.0.0.1:8095/web/board.html",
        "grep -c 'href=\"/web/board.html\"' /opt/manor-desk/web/cloth.html /opt/manor-desk/web/building.html /opt/manor-desk/web/index.html",
        "grep -o 'remodel.js?v=[0-9]*' /opt/manor-desk/web/remodel.html | tail -n 1",
        "curl -s -o /dev/null -w remodel:%{http_code} http://127.0.0.1:8095/web/remodel.html",
        "grep -c 'btnCopyToGame' /opt/manor-desk/web/remodel.html",
        "grep -c 'href=\"/web/remodel.html\"' /opt/manor-desk/web/cloth.html /opt/manor-desk/web/building.html /opt/manor-desk/web/index.html",
        "test -f /opt/manor-desk/board_ai.py && python3 -c \"import sys; sys.path.insert(0,'/opt/manor-desk'); import board_ai; print('board-ai-prompts', len(board_ai.load_builtin_prompts()), board_ai.KIND)\"",
        "grep -o 'cloth.css?v=[0-9]*' /opt/manor-desk/web/cloth.html | tail -n 1",
        "grep -c 'dlgClothAi' /opt/manor-desk/web/cloth.html",
        "grep -c 'cloth-ai/generate' /opt/manor-desk/web/cloth.js",
        "test -f /opt/manor-desk/cloth_ai.py && python3 -c \"import sys; sys.path.insert(0,'/opt/manor-desk'); import cloth_ai; print('cloth-ai-models', len(cloth_ai.load_builtin_prompts()))\"",
        "grep -c 'btnSaveBoard' /opt/manor-desk/web/cloth.html",
        "curl -s -o /dev/null -w cloth:%{http_code} http://127.0.0.1:8095/web/cloth.html",
        "python3 -c \"import json; d=json.load(open('/opt/manor-desk/data/cloth_catalog.json',encoding='utf-8')); print('cloth', d.get('templateCount'))\"",
        "grep -o 'mobile-workspace.css?v=[0-9]*' /opt/manor-desk/web/building.html | tail -n 1",
        "grep -c 'nudge-copy' /opt/manor-desk/web/building.html",
        "grep -o 'building-image-convert.js?v=[0-9]*' /opt/manor-desk/web/building.html",
        "grep -c 'imageBuildingSource' /opt/manor-desk/web/building.html",
        "grep -c 'makePaperMapper' /opt/manor-desk/web/building-image-convert.js",
        "python3 -c \"import json; d=json.load(open('/opt/manor-desk/data/building_sprite_index.json',encoding='utf-8')); print('index', d.get('entryCount'))\"",
        "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8095/api/health || curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8080/api/health",
    ]
    for cmd in cmds:
        _, out, err = cli.exec_command(cmd, timeout=60)
        print("$", cmd)
        print(out.read().decode(errors="replace"))
        e = err.read().decode(errors="replace")
        if e:
            print("ERR", e)
    cli.close()
    print("done")


if __name__ == "__main__":
    main()

