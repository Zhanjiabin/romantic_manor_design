# -*- coding: utf-8 -*-
"""One-shot incremental deploy of the last two commits to the manor server."""
import os
import subprocess
import sys

import paramiko

HOST = "110.42.70.142"
USER = "root"
PASSWORD = os.environ.get("MANOR_DEPLOY_PW") or ""
REMOTE = "/opt/manor-desk"

files = (
    subprocess.check_output(
        ["git", "diff", "--name-only", "HEAD~2..HEAD"], encoding="utf-8"
    )
    .strip()
    .splitlines()
)
# Only runtime files exist on the server; tests/tools/rules stay local.
files = [f for f in files if f.startswith(("web/", "data/")) or f in ("server.py", "saves.py")]
print("files:", files)

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, username=USER, password=PASSWORD, timeout=20)
sftp = cli.open_sftp()
for f in files:
    local = f.replace("/", os.sep)
    remote = f"{REMOTE}/{f}"
    sftp.put(local, remote)
    print("put", remote)
sftp.close()

for cmd in sys.argv[1:]:
    _, out, err = cli.exec_command(cmd, timeout=60)
    print("$", cmd)
    print(out.read().decode(errors="replace"))
    e = err.read().decode(errors="replace")
    if e:
        print("ERR", e)
cli.close()
print("done")
