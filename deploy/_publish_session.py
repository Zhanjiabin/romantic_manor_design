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

RUNTIME_PREFIXES = ("web/", "data/")
RUNTIME_FILES = {"server.py", "saves.py", "export_xlsx.py"}
SKIP_PREFIXES = ("data/saves/", "data/image_to_building/")
SKIP_PARTS = ("__pycache__/", ".pytest_cache/")


def working_tree_runtime_files():
    out = subprocess.check_output(
        ["git", "status", "--porcelain", "-uall"],
        encoding="utf-8",
        cwd=ROOT,
    )
    files = []
    seen = set()
    for line in out.splitlines():
        path = line[3:].strip().replace("\\", "/")
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path.endswith(".pyc") or any(part in path for part in SKIP_PARTS):
            continue
        if any(path.startswith(prefix) for prefix in SKIP_PREFIXES):
            continue
        if not (path.startswith(RUNTIME_PREFIXES) or path in RUNTIME_FILES):
            continue
        if path in seen:
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


files = working_tree_runtime_files()
print("files:", files)
if not files:
    raise SystemExit("no runtime files to publish")
if not PASSWORD:
    raise SystemExit("missing MANOR_DEPLOY_PW / MANOR_SSH_PASS / DEPLOY_PASS")

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PASSWORD, timeout=20)
sftp = cli.open_sftp()
for f in files:
    local = ROOT / f.replace("/", os.sep)
    remote = f"{REMOTE}/{f.replace(chr(92), '/')}"
    ensure_remote_dir(sftp, remote)
    sftp.put(str(local), remote)
    print("put", remote)
sftp.close()

cmds = [
    "systemctl restart manor-desk",
    "sleep 1",
    "systemctl is-active manor-desk",
    "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8080/web/building.html",
    "grep -o 'building.js?v=[0-9]*' /opt/manor-desk/web/building.html | tail -n 1",
    "grep -o 'app.js?v=[0-9]*' /opt/manor-desk/web/index.html | tail -n 1",
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
