# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import (
    Handler,
    auth_accounts,
    auth_credentials,
    clear_login_failures,
    credentials_match,
    listen_host,
    listen_port,
    parse_basic_auth,
    require_auth_for_bind,
    safe_next_path,
    should_open_browser,
)


def _clear_auth_env(monkey_keys=None):
    keys = monkey_keys or (
        "MANOR_HOST",
        "MANOR_PORT",
        "MANOR_USER",
        "MANOR_PASSWORD",
        "MANOR_BASIC_AUTH",
        "MANOR_USERS",
        "MANOR_SESSION_SECRET",
        "MANOR_ALLOW_OPEN",
        "MANOR_NO_BROWSER",
        "MANOR_OPEN_BROWSER",
    )
    saved = {key: os.environ.get(key) for key in keys}
    for key in keys:
        os.environ.pop(key, None)
    return saved


def _restore_env(saved):
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def _login_headers(host, port, user, password):
    clear_login_failures("127.0.0.1")
    conn = HTTPConnection(host, port, timeout=5)
    payload = json.dumps({"user": user, "password": password}).encode("utf-8")
    conn.request("POST", "/api/login", body=payload, headers={"Content-Type": "application/json"})
    res = conn.getresponse()
    body = res.read()
    status = res.status
    authenticate = res.getheader("WWW-Authenticate")
    cookie = (res.getheader("Set-Cookie") or "").split(";", 1)[0]
    conn.close()
    assert authenticate in (None, "")
    assert status == 200, body
    assert cookie.startswith("manor_session=")
    return {"Cookie": cookie}


def test_listen_defaults():
    saved = _clear_auth_env()
    try:
        assert listen_host() == "127.0.0.1"
        assert listen_port() == 8765
        os.environ["MANOR_HOST"] = "0.0.0.0"
        os.environ["MANOR_PORT"] = "8080"
        assert listen_host() == "0.0.0.0"
        assert listen_port() == 8080
    finally:
        _restore_env(saved)


def test_auth_from_user_password_and_combined():
    saved = _clear_auth_env()
    try:
        assert auth_credentials() is None
        os.environ["MANOR_USER"] = "ada"
        os.environ["MANOR_PASSWORD"] = "secret"
        assert auth_credentials() == ("ada", "secret")
        os.environ["MANOR_BASIC_AUTH"] = "bee:other"
        assert auth_credentials() == ("bee", "other")
        os.environ["MANOR_USERS"] = "zed:extra,  zed:ignored,amy:two"
        assert auth_accounts() == [("bee", "other"), ("zed", "extra"), ("amy", "two")]
        os.environ.pop("MANOR_BASIC_AUTH", None)
        os.environ["MANOR_USER"] = "ada"
        os.environ["MANOR_PASSWORD"] = "secret"
        assert auth_accounts() == [("ada", "secret"), ("zed", "extra"), ("amy", "two")]
    finally:
        _restore_env(saved)


def test_parse_basic_auth_and_match():
    token = base64.b64encode("ada:s ecret".encode("utf-8")).decode("ascii")
    assert parse_basic_auth("Basic " + token) == ("ada", "s ecret")
    assert parse_basic_auth("Bearer abc") is None
    assert parse_basic_auth("") is None
    assert credentials_match("ada", "pw", "ada", "pw")
    assert not credentials_match("ada", "pw", "ada", "no")
    assert not credentials_match("bob", "pw", "ada", "pw")


def test_public_bind_requires_password():
    saved = _clear_auth_env()
    try:
        require_auth_for_bind("127.0.0.1")
        try:
            require_auth_for_bind("0.0.0.0")
            raise AssertionError("expected SystemExit")
        except SystemExit:
            pass
        os.environ["MANOR_USER"] = "ada"
        os.environ["MANOR_PASSWORD"] = "secret"
        require_auth_for_bind("0.0.0.0")
    finally:
        _restore_env(saved)


def test_should_open_browser_skips_remote():
    saved = _clear_auth_env()
    try:
        assert should_open_browser("127.0.0.1")
        assert not should_open_browser("0.0.0.0")
        os.environ["MANOR_NO_BROWSER"] = "1"
        assert not should_open_browser("127.0.0.1")
    finally:
        _restore_env(saved)


def test_safe_next_path():
    assert safe_next_path("/web/building.html") == "/web/building.html"
    assert safe_next_path("//evil") == "/"
    assert safe_next_path("https://evil.example/") == "/"
    assert safe_next_path("/login") == "/"


def test_http_auth_and_public_health():
    saved = _clear_auth_env()
    os.environ["MANOR_USER"] = "ada"
    os.environ["MANOR_PASSWORD"] = "secret"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/")
        denied = conn.getresponse()
        denied.read()
        assert denied.status == 302
        assert "/login" in (denied.getheader("Location") or "")
        assert not denied.getheader("WWW-Authenticate")
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/login")
        login = conn.getresponse()
        page = login.read()
        assert login.status == 200
        assert "登录" in page.decode("utf-8")
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/health")
        health = conn.getresponse()
        body = health.read()
        assert health.status == 200
        assert b'"ok"' in body
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/saves/terrain")
        api = conn.getresponse()
        api.read()
        assert api.status == 401
        assert not api.getheader("WWW-Authenticate")
        conn.close()

        headers = _login_headers(host, port, "ada", "secret")
        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/", headers=headers)
        ok = conn.getresponse()
        page = ok.read()
        assert ok.status == 200
        assert b"design" in page.lower() or b"\xe8\xae\xbe\xe8\xae\xa1" in page
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        _restore_env(saved)


def test_http_auth_accepts_extra_users():
    saved = _clear_auth_env()
    os.environ["MANOR_USER"] = "ada"
    os.environ["MANOR_PASSWORD"] = "secret"
    os.environ["MANOR_USERS"] = "zed:extra"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        extra = _login_headers(host, port, "zed", "extra")
        primary = _login_headers(host, port, "ada", "secret")

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/", headers=extra)
        ok = conn.getresponse()
        ok.read()
        assert ok.status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/", headers=primary)
        ok = conn.getresponse()
        ok.read()
        assert ok.status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        payload = json.dumps({"user": "zed", "password": "secret"}).encode("utf-8")
        conn.request("POST", "/api/login", body=payload, headers={"Content-Type": "application/json"})
        denied = conn.getresponse()
        denied.read()
        assert denied.status == 401
        assert not denied.getheader("WWW-Authenticate")
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        _restore_env(saved)


def test_whoami_and_logout():
    saved = _clear_auth_env()
    os.environ["MANOR_USER"] = "ada"
    os.environ["MANOR_PASSWORD"] = "secret"
    os.environ["MANOR_USERS"] = "zed:extra"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/whoami")
        anon = conn.getresponse()
        anon_body = json.loads(anon.read())
        assert anon.status == 200
        assert anon_body["auth"] is True
        assert anon_body["user"] == ""
        conn.close()

        headers = _login_headers(host, port, "zed", "extra")
        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/whoami", headers=headers)
        who = conn.getresponse()
        payload = json.loads(who.read())
        assert who.status == 200
        assert payload["user"] == "zed"
        assert payload["auth"] is True
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("POST", "/api/logout", headers=headers)
        out = conn.getresponse()
        body = json.loads(out.read())
        assert out.status == 200
        assert body["ok"] is True
        assert not out.getheader("WWW-Authenticate")
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/")
        after = conn.getresponse()
        after.read()
        assert after.status == 302
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        _restore_env(saved)


def test_http_saves_roundtrip():
    saved = _clear_auth_env()
    tmp = Path(tempfile.mkdtemp(prefix="manor-saves-http-"))
    prev_saves = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = str(tmp)
    os.environ["MANOR_USER"] = "ada"
    os.environ["MANOR_PASSWORD"] = "secret"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        headers = {**_login_headers(host, port, "ada", "secret"), "Content-Type": "application/json"}
        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "PUT",
            "/api/saves/terrain/draft",
            body='{"id":"t1","name":"d","savedAt":1,"stamps":[]}',
            headers=headers,
        )
        put = conn.getresponse()
        put.read()
        assert put.status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/saves/terrain", headers=headers)
        got = conn.getresponse()
        body = got.read()
        assert got.status == 200
        assert b'"t1"' in body
        conn.close()

        asset = b"\x89PNG\r\n\x1a\npreview"
        asset_id = "a" * 64
        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "PUT",
            f"/api/saves/terrain/assets/{asset_id}",
            body=asset,
            headers={**headers, "Content-Type": "image/png"},
        )
        put_asset = conn.getresponse()
        put_asset.read()
        assert put_asset.status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "GET",
            f"/api/saves/terrain/assets/{asset_id}",
            headers=headers,
        )
        got_asset = conn.getresponse()
        assert got_asset.status == 200
        assert got_asset.getheader("Content-Type") == "image/png"
        assert got_asset.read() == asset
        conn.close()

        papers = '{"replace":true,"papers":[{"name":"garden/hut.txt","data":"VjE7dGVzdA=="}]}'
        conn = HTTPConnection(host, port, timeout=5)
        conn.request("PUT", "/api/saves/building/papers", body=papers, headers=headers)
        put_papers = conn.getresponse()
        put_body = put_papers.read()
        assert put_papers.status == 200
        assert b'"saved": 1' in put_body
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/saves/building/papers", headers=headers)
        got_papers = conn.getresponse()
        papers_body = got_papers.read()
        assert got_papers.status == 200
        assert b"hut.txt" in papers_body
        assert b"VjE7dGVzdA==" not in papers_body
        listed = json.loads(papers_body)
        ident = listed["papers"][0]["id"]
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", f"/api/saves/building/papers/{ident}", headers=headers)
        one = conn.getresponse()
        one_body = one.read()
        assert one.status == 200
        assert json.loads(one_body)["data"] == "VjE7dGVzdA=="
        conn.close()

        jpeg = b"\xff\xd8\xff\xd9" + b"\x00" * 24
        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "PUT",
            f"/api/saves/building/papers/{ident}/thumb",
            body=jpeg,
            headers={**headers, "Content-Type": "image/jpeg"},
        )
        put_thumb = conn.getresponse()
        assert put_thumb.status == 200
        put_thumb.read()
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", f"/api/saves/building/papers/{ident}/thumb", headers=headers)
        got_thumb = conn.getresponse()
        assert got_thumb.status == 200
        assert got_thumb.getheader("Content-Type") == "image/jpeg"
        assert got_thumb.read().startswith(b"\xff\xd8")
        conn.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        if prev_saves is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev_saves
        _restore_env(saved)


def test_http_saves_are_isolated_per_account():
    saved = _clear_auth_env()
    tmp = Path(tempfile.mkdtemp(prefix="manor-saves-http-users-"))
    prev_saves = os.environ.get("MANOR_SAVES")
    os.environ["MANOR_SAVES"] = str(tmp)
    os.environ["MANOR_USER"] = "ada"
    os.environ["MANOR_PASSWORD"] = "secret"
    os.environ["MANOR_USERS"] = "zed:extra"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        ada = {**_login_headers(host, port, "ada", "secret"), "Content-Type": "application/json"}
        zed = {**_login_headers(host, port, "zed", "extra"), "Content-Type": "application/json"}

        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "PUT",
            "/api/saves/terrain/draft",
            body='{"id":"ada-d","name":"Ada","savedAt":1,"stamps":[]}',
            headers=ada,
        )
        assert conn.getresponse().status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request(
            "PUT",
            "/api/saves/terrain/draft",
            body='{"id":"zed-d","name":"Zed","savedAt":2,"stamps":[]}',
            headers=zed,
        )
        assert conn.getresponse().status == 200
        conn.close()

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/saves/terrain", headers=ada)
        ada_body = json.loads(conn.getresponse().read())
        conn.close()
        assert ada_body["draft"]["id"] == "ada-d"

        conn = HTTPConnection(host, port, timeout=5)
        conn.request("GET", "/api/saves/terrain", headers=zed)
        zed_body = json.loads(conn.getresponse().read())
        conn.close()
        assert zed_body["draft"]["id"] == "zed-d"
    finally:
        httpd.shutdown()
        httpd.server_close()
        if prev_saves is None:
            os.environ.pop("MANOR_SAVES", None)
        else:
            os.environ["MANOR_SAVES"] = prev_saves
        _restore_env(saved)
