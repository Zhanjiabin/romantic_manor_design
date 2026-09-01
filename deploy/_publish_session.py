# -*- coding: utf-8 -*-
"""Publish working-tree runtime files to the live manor-desk server."""
import os
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
        if not (path.startswith(RUNTIME_PREFIXES) or path in RUNTIME_FILES):
            continue
        if path in seen:
            continue
        seen.add(path)
        files.append(path)
    return files


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
    remote = f"{REMOTE}/{f}"
    sftp.put(str(local), remote)
    print("put", remote)
sftp.close()

cmds = [
    "systemctl restart manor-desk",
    "sleep 1",
    "systemctl is-active manor-desk",
    "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8080/web/building.html",
    "grep -n 'building.js?v=' /opt/manor-desk/web/building.html | tail -n 3",
    "grep -n 'data-tool=\"diamond\"' /opt/manor-desk/web/building.html || true",
    "grep -n '成组 C' /opt/manor-desk/web/building.html | head -n 5",
    "grep -n 'executeCommand(\"group\")' /opt/manor-desk/web/building.js | head -n 8",
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
