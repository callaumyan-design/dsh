"""测试用的“假 UQ”：本机上的 SSO 登录服务器、Learn.UQ、my.UQ 和 Bark 服务器。

- SSO：/login 显示密码表单；提交后发 sso 会话 cookie。SSO 会话有效时，自动用一个会自动提交的表单
  把用户送回网站（模拟 SAML），网站据此建立自己的会话 cookie。
- Learn.UQ：原版课程的 My Grades 网页（服务器直接输出成绩），以及 Ultra 风格的单页应用：页面脚本
  用 cookie 请求 /learn/api/v1/... 的 JSON 接口（成绩栏和成绩分两个接口）。
- my.UQ：单页应用，脚本先从 /token 取令牌，再带 Authorization: Bearer 请求成绩接口。
- Bark：/push 收下推送内容，供测试检查。

所有 cookie、令牌都以 SECRET 开头，方便检查探查记录里有没有泄露。
"""

from __future__ import annotations

import json
import secrets
import threading
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse

FIXTURES = Path(__file__).parent / "fixtures"


@dataclass
class FakeState:
    secret: str = field(default_factory=lambda: secrets.token_hex(4))
    # 成绩（测试里可以随时改）
    a1: str = "85.00"  # COMP3506 Assignment 1（My Grades 网页）
    q1: str = ""  # COMP3506 Quiz 1，空 = 待评分
    ps1: float | None = 18.0  # MATH1051 Problem Set 1（JSON 接口）
    mid: float | None = None  # MATH1051 Midterm
    final_comp: str | None = None  # my.UQ COMP3506 最终成绩
    final_math: str | None = "6"  # my.UQ MATH1051 最终成绩
    # 会话
    sso_sessions: set = field(default_factory=set)
    learn_sessions: set = field(default_factory=set)
    myuq_sessions: set = field(default_factory=set)
    tokens: set = field(default_factory=set)
    pushes: list = field(default_factory=list)
    bark_key: str = "TESTKEY"
    ports: dict = field(default_factory=dict)
    requests: list = field(default_factory=list)  # (site, method, path)

    def url(self, site: str, path: str = "/") -> str:
        return f"http://127.0.0.1:{self.ports[site]}{path}"

    def expire_all(self) -> None:
        self.sso_sessions.clear()
        self.learn_sessions.clear()
        self.myuq_sessions.clear()
        self.tokens.clear()

    def expire_site_sessions(self) -> None:
        """网站自己的会话过期，但学校单点登录还有效。"""
        self.learn_sessions.clear()
        self.myuq_sessions.clear()
        self.tokens.clear()

    def new_secret(self, kind: str) -> str:
        return f"SECRET-{kind}-{self.secret}-{secrets.token_hex(4)}"


class _Handler(BaseHTTPRequestHandler):
    state: FakeState
    site: str

    def log_message(self, *a):  # 安静
        pass

    # ------------------------------------------------ 小工具
    def _cookies(self) -> dict[str, str]:
        c = SimpleCookie()
        c.load(self.headers.get("Cookie", ""))
        return {k: v.value for k, v in c.items()}

    def _send(self, code: int, body: str | bytes = b"", ctype: str = "text/html; charset=utf-8", headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def _redirect(self, location: str, headers=None) -> None:
        self._send(302, b"", headers=[("Location", location)] + list(headers or []))

    def _body(self) -> str:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode("utf-8") if n else ""

    def do_GET(self):
        self.state.requests.append((self.site, "GET", self.path))
        getattr(self, f"get_{self.site}")(urlparse(self.path))

    def do_POST(self):
        self.state.requests.append((self.site, "POST", self.path))
        getattr(self, f"post_{self.site}")(urlparse(self.path), self._body())

    # ------------------------------------------------ SSO
    def get_sso(self, u):
        st = self.state
        q = parse_qs(u.query)
        ret = q.get("return", [""])[0]
        if u.path == "/login":
            if self._cookies().get("sso_session") in st.sso_sessions:
                return self._auto_post(ret)
            return self._send(
                200,
                f"""<html><head><title>UQ Sign in</title></head><body>
                <form method="post" action="/login?{urlencode({'return': ret})}">
                  <input name="username"><input name="password" type="password">
                  <input type="hidden" name="csrf" value="{st.new_secret('SSOCSRF')}">
                  <button id="signin" type="submit">Sign in</button>
                </form></body></html>""",
            )
        self._send(404, "not found")

    def post_sso(self, u, body):
        st = self.state
        ret = parse_qs(u.query).get("return", [""])[0]
        form = parse_qs(body)
        if form.get("password", [""])[0] != "correct-horse":
            return self._send(200, "<html><body>wrong password <input type=password></body></html>")
        sid = st.new_secret("SSO")
        st.sso_sessions.add(sid)
        # 会话 cookie（没有过期时间）：浏览器关闭就会丢失
        self._auto_post(ret, headers=[("Set-Cookie", f"sso_session={sid}; Path=/; HttpOnly")])

    def _auto_post(self, ret: str, headers=None):
        ticket = self.state.new_secret("TICKET")
        self._send(
            200,
            f"""<html><body onload="document.forms[0].submit()">
            <form method="post" action="{ret}"><input type="hidden" name="SAMLResponse" value="{ticket}"></form>
            </body></html>""",
            headers=headers,
        )

    # ------------------------------------------------ 共用：网站登录
    def _site_session_ok(self, cookie_name: str, sessions: set) -> bool:
        return self._cookies().get(cookie_name) in sessions

    def _to_sso(self, path: str):
        ret = self.state.url(self.site, "/auth?next=" + quote(path, safe=""))
        self._redirect(self.state.url("sso", "/login?" + urlencode({"return": ret})))

    def _post_auth(self, u, body, cookie_name: str, sessions: set):
        form = parse_qs(body)
        if not form.get("SAMLResponse", [""])[0].startswith("SECRET-TICKET"):
            return self._send(400, "bad saml")
        nxt = parse_qs(u.query).get("next", ["/"])[0]
        sid = self.state.new_secret(cookie_name.upper())
        sessions.add(sid)
        self._redirect(nxt, headers=[("Set-Cookie", f"{cookie_name}={sid}; Path=/; HttpOnly")])

    # ------------------------------------------------ Learn.UQ
    def post_learn(self, u, body):
        if u.path == "/auth":
            return self._post_auth(u, body, "learn_session", self.state.learn_sessions)
        self._send(405, "read only")

    def get_learn(self, u):
        st = self.state
        logged = self._site_session_ok("learn_session", st.learn_sessions)
        if u.path.startswith("/learn/api/"):
            if not logged:
                return self._json(401, {"status": 401, "message": "Unauthorized"})
            return self._learn_api(u)
        if not logged:
            return self._to_sso(u.path + ("?" + u.query if u.query else ""))
        if u.path == "/":
            return self._redirect("/ultra/stream")
        if u.path == "/ultra/stream":
            return self._send(200, "<html><head><title>Activity Stream</title></head><body><h1>Stream</h1></body></html>")
        if u.path == "/webapps/bb-mygrades-BBLEARN/myGrades":
            html = (FIXTURES / "bb_mygrades.html").read_text(encoding="utf-8")
            if st.q1:
                q1 = f'<span class="grade">{st.q1}</span><span class="pointsPossible">/10</span>'
            else:
                q1 = '<img src="/images/needs_grading.gif" title="Needs Grading" alt="Needs Grading">'
            html = html.replace("{a1}", st.a1).replace("{q1}", q1).replace("{secret}", st.secret)
            return self._send(200, html)
        if u.path == "/ultra/courses/_202_1/grades":
            return self._send(200, ULTRA_PAGE.replace("{xsrf}", st.new_secret("XSRF")))
        self._send(404, "not found")

    def _learn_api(self, u):
        st = self.state
        if u.path == "/learn/api/v1/users/me/memberships":
            return self._json(
                200,
                {
                    "results": [
                        {"id": "_m1_1", "courseId": "_101_1", "course": {"id": "_101_1", "courseId": "COMP3506S_7620", "name": "COMP3506/7505 Algorithms & Data Structures"}},
                        {"id": "_m2_1", "courseId": "_202_1", "course": {"id": "_202_1", "courseId": "MATH1051S_7620", "name": "MATH1051 Calculus & Linear Algebra I"}},
                    ],
                    "csrfToken": st.new_secret("JSONCSRF"),
                },
            )
        if u.path == "/learn/api/v1/courses/_202_1/gradebook/columns":
            return self._json(
                200,
                {
                    "results": [
                        {"id": "_9001_1", "columnName": "Problem Set 1", "score": {"possible": 20}, "gradebookCategoryId": "_1_1"},
                        {"id": "_9002_1", "columnName": "Midterm Exam", "score": {"possible": 100}, "gradebookCategoryId": "_2_1"},
                    ]
                },
            )
        if u.path == "/learn/api/v1/courses/_202_1/gradebook/grades":
            res = []
            for cid, val in (("_9001_1", st.ps1), ("_9002_1", st.mid)):
                if val is None:
                    res.append({"columnId": cid, "userId": "_77_1", "status": "NeedsGrading"})
                else:
                    res.append(
                        {
                            "columnId": cid,
                            "userId": "_77_1",
                            "status": "Graded",
                            "score": val,
                            "displayGrade": {"scaleType": "Score", "score": val, "text": f"{val:.2f}"},
                        }
                    )
            return self._json(200, {"results": res})
        self._json(404, {"status": 404})

    # ------------------------------------------------ my.UQ
    def post_myuq(self, u, body):
        if u.path == "/auth":
            return self._post_auth(u, body, "myuq_session", self.state.myuq_sessions)
        self._send(405, "read only")

    def get_myuq(self, u):
        st = self.state
        logged = self._site_session_ok("myuq_session", st.myuq_sessions)
        if u.path == "/api/results":
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or auth[7:] not in st.tokens:
                return self._json(401, {"error": "invalid token"})
            return self._json(
                200,
                {
                    "student": {"name": "Test Student"},
                    "results": [
                        {"courseCode": "COMP3506", "title": "Algorithms", "term": "Semester 2, 2026", "grade": st.final_comp},
                        {"courseCode": "MATH1051", "title": "Calculus", "term": "Semester 2, 2026", "grade": st.final_math},
                    ],
                },
            )
        if u.path == "/token":
            if not logged:
                return self._json(401, {"error": "login"})
            tok = st.new_secret("BEARER")
            st.tokens.add(tok)
            return self._json(200, {"access_token": tok, "expires_in": 3600})
        if not logged:
            return self._to_sso(u.path)
        if u.path == "/":
            return self._send(200, "<html><head><title>my.UQ</title></head><body><h1>my.UQ dashboard</h1></body></html>")
        if u.path == "/grades":
            return self._send(200, MYUQ_PAGE)
        self._send(404, "not found")

    # ------------------------------------------------ Bark
    def post_bark(self, u, body):
        data = json.loads(body)
        if data.get("device_key") != self.state.bark_key:
            return self._json(400, {"code": 400, "message": "failed to get device token: device not found"})
        self.state.pushes.append(data)
        self._json(200, {"code": 200, "message": "success", "timestamp": 0})

    def get_bark(self, u):
        self._send(404, "")


ULTRA_PAGE = """<!doctype html>
<html><head><title>Grades</title></head>
<body>
<h1 id="course">loading</h1>
<table id="grades"><tr><th>Item</th><th>Grade</th></tr></table>
<script>
  window.__xsrf = "{xsrf}";
  async function main() {
    const opts = {credentials: 'same-origin', headers: {'Accept': 'application/json'}};
    const m = await (await fetch('/learn/api/v1/users/me/memberships?expand=course', opts)).json();
    const cols = await (await fetch('/learn/api/v1/courses/_202_1/gradebook/columns', opts)).json();
    const gr = await (await fetch('/learn/api/v1/courses/_202_1/gradebook/grades?userId=_77_1', opts)).json();
    document.getElementById('course').textContent = m.results[1].course.name;
    const t = document.getElementById('grades');
    for (const c of cols.results) {
      const g = gr.results.find(x => x.columnId === c.id);
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + c.columnName + '</td><td>' + (g && g.displayGrade ? g.displayGrade.text : '-') + '</td>';
      t.appendChild(tr);
    }
  }
  main();
</script>
</body></html>"""

MYUQ_PAGE = """<!doctype html>
<html><head><title>my.UQ - Results</title></head>
<body>
<h1>Course results</h1>
<table id="results"><thead><tr><th>Course code</th><th>Course</th><th>Term</th><th>Grade</th></tr></thead><tbody></tbody></table>
<script>
  async function main() {
    const tok = await (await fetch('/token', {credentials: 'same-origin'})).json();
    const res = await (await fetch('/api/results', {headers: {'Authorization': 'Bearer ' + tok.access_token}})).json();
    const tb = document.querySelector('#results tbody');
    for (const r of res.results) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.courseCode + '</td><td>' + r.title + '</td><td>' + r.term + '</td><td>' + (r.grade || '') + '</td>';
      tb.appendChild(tr);
    }
  }
  main();
</script>
</body></html>"""


class FakeUQ:
    def __init__(self):
        self.state = FakeState()
        self.servers: list[ThreadingHTTPServer] = []

    def start(self) -> FakeUQ:
        for site in ("sso", "learn", "myuq", "bark"):
            handler = type(f"H_{site}", (_Handler,), {"state": self.state, "site": site})
            srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            srv.daemon_threads = True
            self.state.ports[site] = srv.server_address[1]
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            self.servers.append(srv)
        return self

    def stop(self) -> None:
        for s in self.servers:
            s.shutdown()
            s.server_close()

    def config_toml(self, *, privacy: bool = False, quiet: str = "") -> str:
        st = self.state
        return f"""
[bark]
key = "{st.bark_key}"
server = "{st.url('bark', '')}"
privacy_mode = {'true' if privacy else 'false'}

[schedule]
min_interval_minutes = 30
max_interval_minutes = 60
quiet_hours = "{quiet}"

[advanced]
learn_url = "{st.url('learn', '/')}"
myuq_url = "{st.url('myuq', '/')}"
learn_hosts = ["127.0.0.1:{st.ports['learn']}"]
myuq_hosts = ["127.0.0.1:{st.ports['myuq']}"]
login_patterns = ["127.0.0.1:{st.ports['sso']}"]
page_timeout_seconds = 20
"""
