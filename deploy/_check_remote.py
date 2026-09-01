# -*- coding: utf-8 -*-
import os

import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect("110.42.70.142", username="root", password=os.environ.get("MANOR_DEPLOY_PW", ""), timeout=20)
cmds = [
    "ss -tlnp | grep python",
    "systemctl cat manor-desk | grep -E 'ExecStart|Environment'",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/data/building_pack_uids.json",
]
for cmd in cmds:
    _, out, err = cli.exec_command(cmd, timeout=30)
    print("$", cmd)
    print(out.read().decode(errors="replace"))
    e = err.read().decode(errors="replace")
    if e:
        print("ERR", e)
cli.close()
