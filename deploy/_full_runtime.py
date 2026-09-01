# -*- coding: utf-8 -*-
"""Publish the full manor-desk runtime tree to the live server.

Does not upload user saves, PNG cache, tests, tools, or .env.
"""
import os
import stat
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
SKIP_DIRS = {"saves", "ale_png_cache", "__pycache__", ".git", ".pytest_cache"}
SKIP_SUFFIX = {".pyc", ".pyo"}
ROOT_FILES = ("server.py", "saves.py", "export_xlsx.py", "game_paths.py")
FOLDERS = ("web", "codec")
DATA_SUFFIX = {".json", ".jpg", ".jpeg", ".png", ".gif", ".webp"}


def collect():
    files = []
    for name in ROOT_FILES:
        if (ROOT / name).is_file():
            files.append(name)
    for folder in FOLDERS:
        base = ROOT / folder
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix in SKIP_SUFFIX:
                continue
            rel = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in rel.parts):
                continue
            files.append(rel.as_posix())
    data = ROOT / "data"
    if data.is_dir():
        for path in sorted(data.iterdir()):
            if path.is_file() and path.suffix.lower() in DATA_SUFFIX:
                files.append(path.relative_to(ROOT).as_posix())
    return files


def mkdir_p(sftp, remote_dir):
    parts = [p for p in remote_dir.split("/") if p]
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def main():
    files = collect()
    print("count:", len(files))
    for path in files:
        print(" ", path)
    if not files:
        raise SystemExit("no runtime files to publish")
    if not PASSWORD:
        raise SystemExit("missing MANOR_DEPLOY_PW / MANOR_SSH_PASS / DEPLOY_PASS")

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    sftp = cli.open_sftp()
    for path in files:
        local = ROOT / path.replace("/", os.sep)
        remote = f"{REMOTE}/{path}"
        mkdir_p(sftp, str(Path(remote).parent).replace("\\", "/"))
        sftp.put(str(local), remote)
        sftp.chmod(remote, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
        print("put", remote)
    sftp.close()

    cmds = [
        "systemctl restart manor-desk",
        "sleep 2",
        "systemctl is-active manor-desk",
        "ss -tlnp | grep -E 'python|8095|8080' || true",
        "curl -s -o /dev/null -w 'health:%{http_code}\\n' http://127.0.0.1:8095/api/health",
        "curl -s -o /dev/null -w 'login:%{http_code}\\n' http://127.0.0.1:8095/login",
        "curl -s -o /dev/null -w 'building:%{http_code}\\n' http://127.0.0.1:8095/web/building.html",
        "grep -n 'building.js?v=' /opt/manor-desk/web/building.html",
        "grep -n 'desk-account.js?v=' /opt/manor-desk/web/building.html /opt/manor-desk/web/index.html",
        "grep -n 'mobile-workspace.css?v=' /opt/manor-desk/web/building.html /opt/manor-desk/web/index.html",
        "grep -n 'data-account-switch' /opt/manor-desk/web/building.html /opt/manor-desk/web/index.html | head",
        "test -f /opt/manor-desk/web/login.html && echo login.html:ok",
        "test -f /opt/manor-desk/codec/building.py && echo codec:ok",
    ]
    for cmd in cmds:
        _, out, err = cli.exec_command(cmd, timeout=60)
        print("$", cmd)
        print(out.read().decode(errors="replace"), end="")
        extra = err.read().decode(errors="replace")
        if extra:
            print("ERR", extra, end="")
    cli.close()
    print("done")


if __name__ == "__main__":
    main()
