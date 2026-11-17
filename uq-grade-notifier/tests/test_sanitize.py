from __future__ import annotations

import json

from uqgrades.sanitize import (
    REMOVED,
    json_shape,
    sanitize_body_text,
    sanitize_headers,
    sanitize_html,
    sanitize_json,
    sanitize_url,
)

JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"


def test_url_query_and_fragment():
    u = sanitize_url(f"https://x.uq.edu.au/cb?code=abc&state=xyz&course_id=_1_1&access_token={JWT}#id_token={JWT}&a=1")
    assert "abc" not in u and "xyz" not in u and JWT not in u
    assert "course_id=_1_1" in u
    assert f"code={REMOVED}" in u
    assert sanitize_url("https://user:pw@h.com/p").startswith(f"https://{REMOVED}@h.com")
    assert "SECRET" not in sanitize_url("https://h/?next=https%3A%2F%2Fa%2F%3Fticket%3DSECRET1")


def test_headers_whitelist():
    h = sanitize_headers({
        "Cookie": "a=b", "Authorization": "Bearer x", "X-Blackboard-XSRF": "y", "Accept": "application/json",
        "Referer": "https://h/?token=t1", "X-Custom": "secret",
    })
    assert h["Cookie"] == REMOVED and h["Authorization"] == REMOVED and h["X-Blackboard-XSRF"] == REMOVED
    assert h["X-Custom"] == REMOVED
    assert h["Accept"] == "application/json"
    assert "t1" not in h["Referer"]


def test_json_sensitive_keys_and_tokens():
    data = {
        "user": {"name": "Test", "sessionId": "s1"},
        "csrfToken": "c1", "xsrf": "x1", "nonce": "n1", "password": "p1",
        "auth": {"access_token": "a1", "refresh_token": "r1"},
        "results": [{"score": 85, "code": "COMP3506", "note": f"bearer {JWT}"}],
        "longToken": "A" * 60,
        "empty_token": "",
    }
    out = sanitize_json(data)
    dumped = json.dumps(out)
    for secret in ("s1", "c1", "x1", "n1", "p1", "a1", "r1", JWT, "A" * 60):
        assert f'"{secret}"' not in dumped and secret not in dumped.replace("Test", "")
    assert out["results"][0]["score"] == 85
    assert out["results"][0]["code"] == "COMP3506"  # 课程代码字段不受影响
    assert out["empty_token"] == ""


def test_post_bodies():
    assert sanitize_body_text("SAMLResponse=abc&RelayState=xyz&course=1", "application/x-www-form-urlencoded") == (
        f"SAMLResponse={REMOVED}&RelayState={REMOVED}&course=1"
    )
    assert json.loads(sanitize_body_text('{"password":"p","q":1}')) == {"password": REMOVED, "q": 1}
    assert sanitize_body_text("random binary-ish text with spaces") == REMOVED


def test_html_snapshot():
    html = f"""<meta name="csrf-token" content="m1"><input type="hidden" name="blackboard.nonce" value="h1">
    <input name="session_key" value="h2"><input name="q" value="visible">
    <script nonce="sn1">window.cfg = {{"xsrfToken": "st1", "apiToken": 'st2'}}; var t = "{JWT}";</script>"""
    out = sanitize_html(html)
    for s in ("m1", "h1", "h2", "sn1", "st1", "st2", JWT):
        assert f'"{s}"' not in out and f"'{s}'" not in out and JWT not in out
    assert 'value="visible"' in out


def test_json_shape():
    shaped = json_shape({"results": [{"a": 1}, {"a": 2}, {"a": 3}], "s": "x" * 100})
    assert shaped["results"][-1] == "…（共 3 项）"
    assert len(shaped["s"]) == 58
