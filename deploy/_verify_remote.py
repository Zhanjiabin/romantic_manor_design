# -*- coding: utf-8 -*-
import os
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect("110.42.70.142", username="root", password=os.environ.get("MANOR_DEPLOY_PW", ""), timeout=20)
cmds = [
    "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8095/api/health",
    'bash -lc \'set -a; source /opt/manor-desk/.env; set +a; echo -n papers:; curl -s -o /dev/null -w %{http_code} -u "$MANOR_USER:$MANOR_PASSWORD" http://127.0.0.1:8095/api/saves/building/papers; echo; echo -n html:; curl -s -o /dev/null -w %{http_code} -u "$MANOR_USER:$MANOR_PASSWORD" http://127.0.0.1:8095/web/building.html; echo; echo -n jsver:; curl -s -u "$MANOR_USER:$MANOR_PASSWORD" http://127.0.0.1:8095/web/building.html | grep -o "building.js?v=[0-9]*"\'',
]
for cmd in cmds:
    _, out, err = cli.exec_command(cmd, timeout=30)
    print("$", cmd[:80])
    print(out.read().decode(errors="replace"))
    e = err.read().decode(errors="replace")
    if e:
        print("ERR", e)
cli.close()
