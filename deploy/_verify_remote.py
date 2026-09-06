# -*- coding: utf-8 -*-
import os
import paramiko

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect("110.42.70.142", username="root", password=os.environ.get("MANOR_DEPLOY_PW", ""), timeout=20)
cmds = [
    "curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8095/api/health",
    'bash -lc \'set -a; source /opt/manor-desk/.env; set +a; cookie=$(mktemp); trap "rm -f $cookie" EXIT; echo -n login:; curl -s -o /dev/null -w %{http_code} -c "$cookie" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "user=$MANOR_USER" --data-urlencode "password=$MANOR_PASSWORD" --data-urlencode "next=/" http://127.0.0.1:8095/api/login; echo; echo -n papers:; curl -s -o /dev/null -w %{http_code} -b "$cookie" http://127.0.0.1:8095/api/saves/building/papers; echo; echo -n html:; curl -s -o /dev/null -w %{http_code} -b "$cookie" http://127.0.0.1:8095/web/building.html; echo; echo -n jsver:; curl -s -b "$cookie" http://127.0.0.1:8095/web/building.html | grep -o "building.js?v=[0-9]*"\'',
]
for cmd in cmds:
    _, out, err = cli.exec_command(cmd, timeout=30)
    print("$", cmd[:80])
    print(out.read().decode(errors="replace"))
    e = err.read().decode(errors="replace")
    if e:
        print("ERR", e)

roundtrip = r'''
import base64
import http.cookiejar
import json
import os
import time
import urllib.parse
import urllib.request

base = "http://127.0.0.1:8095"
cookies = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
login = urllib.parse.urlencode({
    "user": os.environ["MANOR_USER"],
    "password": os.environ["MANOR_PASSWORD"],
    "next": "/",
}).encode()
opener.open(urllib.request.Request(base + "/api/login", data=login), timeout=10).read()
stamp = str(int(time.time() * 1000))
name = "__smart_builder_verify_" + stamp + ".txt"
payload = {
    "papers": [{
        "name": name,
        "kind": "desk",
        "data": base64.b64encode(("V1;verify-" + stamp).encode()).decode(),
        "deskLayers": [{"mat": 14501, "group": "verify-wall", "groupName": "墙身"}],
        "deskDocument": {
            "v": 1,
            "records": [{"x": 100, "y": 100, "mat": 14501, "state": 0, "packKey": "bazaar", "group": "verify-wall", "groupName": "墙身"}],
            "smartBuilder": {
                "v": 1,
                "styleId": "bazaar-bookshop",
                "mode": "door",
                "walls": [{"a": {"x": 100, "y": 100}, "b": {"x": 180, "y": 140}, "openings": [{"kind": "door", "t": 0.5, "width": 30}]}],
                "props": [],
            },
        },
    }],
}
request = urllib.request.Request(
    base + "/api/saves/building/papers",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="PUT",
)
opener.open(request, timeout=10).read()
ident = None
try:
    papers = json.load(opener.open(base + "/api/saves/building/papers", timeout=10))["papers"]
    ident = next(row["id"] for row in papers if row.get("name") == name)
    paper = json.load(opener.open(base + "/api/saves/building/papers/" + ident, timeout=10))
    assert paper["deskLayers"][0]["group"] == "verify-wall"
    assert paper["deskDocument"]["records"][0]["groupName"] == "墙身"
    assert paper["deskDocument"]["smartBuilder"]["styleId"] == "bazaar-bookshop"
    assert paper["deskDocument"]["smartBuilder"]["walls"][0]["openings"][0]["kind"] == "door"
    print("smart-paper-roundtrip:ok")
finally:
    if ident:
        opener.open(urllib.request.Request(base + "/api/saves/building/papers/" + ident, method="DELETE"), timeout=10).read()
'''
stdin, out, err = cli.exec_command("bash -lc 'set -a; source /opt/manor-desk/.env; set +a; python3 -'", timeout=30)
stdin.write(roundtrip)
stdin.channel.shutdown_write()
print(out.read().decode(errors="replace"))
e = err.read().decode(errors="replace")
if e:
    print("ERR", e)
cli.close()
