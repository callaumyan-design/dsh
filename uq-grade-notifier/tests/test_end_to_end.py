"""端到端测试：真实的无头 Chromium + 本机上的假 UQ / SSO / Bark 服务器。

完整走一遍：登录 → 探查录制 → 第一次运行（只记基准）→ 成绩变化推送 → 隐私模式
→ 单点登录自动续期 → 登录失效提醒（只提醒一次）→ 重新登录后恢复。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from urllib.parse import urlparse


from uqgrades.runner import run_once
from uqgrades.store import Store
from uqgrades.targets import load_targets, new_target_file, save_targets

from .conftest import simulate_human_login, simulate_human_probe


def _by_key(records):
    return {(r.site, r.course, r.item): r.display for r in records}


def _all_text(folder) -> str:
    return "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in folder.rglob("*") if p.is_file())


def test_full_flow(home, fake, site_cfg):
    st = fake.state
    cfg = site_cfg

    # ---------- 1. 登录（模拟手动登录）
    asyncio.run(simulate_human_login(home, cfg, fake))
    assert home.session_backup.exists()
    backup = json.loads(home.session_backup.read_text())
    assert {c["name"] for c in backup["cookies"]} >= {"sso_session", "learn_session"}

    # ---------- 2. 探查录制
    res = asyncio.run(simulate_human_probe(home, cfg, fake))
    got = _by_key(res.records)
    assert got[("learn", "COMP3506", "Assignment 1: Sorting")] == "85/100"
    assert got[("learn", "COMP3506", "Quiz 1")] == "未出成绩"
    assert got[("learn", "COMP3506", "Final Exam")] == "未出成绩"
    assert got[("learn", "MATH1051", "Problem Set 1")] == "18/20"
    assert got[("learn", "MATH1051", "Midterm Exam")] == "未出成绩"
    assert got[("myuq", "MATH1051", "最终成绩（Semester 2, 2026）")] == "6"
    assert got[("myuq", "COMP3506", "最终成绩（Semester 2, 2026）")] == "未出成绩"
    assert len(res.records) == 7, got

    kinds = {(t.kind, t.url.split("?")[0].split("/", 3)[-1]) for t in res.targets}
    assert ("html_get", "webapps/bb-mygrades-BBLEARN/myGrades") in kinds
    assert ("json_get", "learn/api/v1/courses/_202_1/gradebook/columns") in kinds
    assert ("json_get", "learn/api/v1/courses/_202_1/gradebook/grades") in kinds
    # my.UQ 的成绩接口需要 Authorization 令牌，不能直接调用 → 用浏览器打开页面
    assert ("render", "grades") in kinds
    assert not any("api/results" in t.url for t in res.targets)
    assert res.course_hints == {"_101_1": "COMP3506", "_202_1": "MATH1051"}

    # 探查记录里不能有任何凭证
    text = _all_text(res.out_dir)
    assert "SECRET-" not in text, [line for line in text.splitlines() if "SECRET-" in line][:5]
    report = res.report_file.read_text(encoding="utf-8")
    assert "识别出的成绩" in report and "Problem Set 1" in report
    assert "🔑" in report  # 标出了带 Authorization 的请求
    jsonl = [json.loads(line) for line in (res.out_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines()]
    api = next(e for e in jsonl if e["url"].endswith("/api/results"))
    assert api["had_authorization_header"] is True
    assert api["request_headers"]["authorization"] == "[已移除]"

    save_targets(home, new_target_file(res.targets, res.course_hints, str(res.out_dir)))

    # ---------- 3. 第一次运行：只记录基准，不推送
    store = Store(home.db)
    out = run_once(home, cfg, store)
    assert out.ok, out.error
    assert out.first_run
    assert out.applied.events == []
    assert st.pushes == []
    assert store.count() == 7

    # 再运行一次：没有变化，不推送
    out = run_once(home, cfg, store)
    assert out.ok and out.applied.events == [] and st.pushes == []

    # ---------- 4. 成绩出现 / 变化 → 推送
    st.q1 = "8"
    st.ps1 = 19.0
    st.final_comp = "7"
    out = run_once(home, cfg, store)
    assert out.ok, out.error
    assert len(out.applied.events) == 3
    assert len(st.pushes) == 3
    pushes = {(p["subtitle"], p["title"]): p for p in st.pushes}
    p1 = pushes[("Learn.UQ", "COMP3506 有新成绩")]
    assert p1["body"] == "Quiz 1：8/10"
    assert "myGrades?course_id=_101_1" in p1["url"]
    p2 = pushes[("Learn.UQ", "MATH1051 成绩有变化")]
    assert p2["body"] == "Problem Set 1：18/20 → 19/20"
    assert p2["url"].endswith("/ultra/courses/_202_1/grades")
    p3 = pushes[("my.UQ", "COMP3506 有新成绩")]
    assert p3["body"] == "最终成绩（Semester 2, 2026）：7"
    assert p3["url"].endswith("/grades")
    assert all(p["group"] == "UQ 成绩" and p["device_key"] == st.bark_key for p in st.pushes)

    # ---------- 5. 隐私模式：不出现评估项和分数
    st.pushes.clear()
    private_cfg = replace(cfg, bark=replace(cfg.bark, privacy_mode=True))
    st.mid = 72.0
    out = run_once(home, private_cfg, store)
    assert out.ok
    assert len(st.pushes) == 1
    p = st.pushes[0]
    assert p["title"] == "UQ 成绩提醒"
    assert p["body"] == "MATH1051 有新成绩"
    assert "72" not in json.dumps(p, ensure_ascii=False)
    assert "Midterm" not in json.dumps(p, ensure_ascii=False)

    # ---------- 6. 网站会话过期，但学校单点登录还有效 → 自动续上，不打扰
    st.pushes.clear()
    st.expire_site_sessions()
    out = run_once(home, cfg, store)
    assert out.ok, out.error
    assert out.expired_site_names == []
    assert st.pushes == []

    # ---------- 7. 登录彻底失效 → 推送“请重新登录”，而且只推一次
    st.expire_all()
    out = run_once(home, cfg, store)
    assert not out.ok
    assert set(out.expired_site_names) == {"Learn.UQ", "my.UQ"}
    assert len(st.pushes) == 1
    assert "请重新登录" in st.pushes[0]["title"]
    assert "uv run uqgrades login" in st.pushes[0]["body"]
    out = run_once(home, cfg, store)
    assert len(st.pushes) == 1, "登录失效提醒不应重复推送"
    assert store.get_state("login_expired")["sites"]
    assert int(store.get_state("failures")) >= 2

    # ---------- 8. 重新登录后恢复正常
    asyncio.run(simulate_human_login(home, cfg, fake))
    st.a1 = "90"
    out = run_once(home, cfg, store)
    assert out.ok, out.error
    assert store.get_state("login_expired") is None
    assert int(store.get_state("failures")) == 0
    assert st.pushes[-1]["body"] == "Assignment 1: Sorting：85/100 → 90/100"

    # 全程只读：除了登录本身，没有向网站发过任何 POST
    posts = [(s, path) for (s, m, path) in st.requests if m == "POST" and s != "bark"]
    assert all(path.startswith("/auth") or path.startswith("/login") for _, path in posts), posts
    store.close()


def test_session_cookies_survive_restart_only_via_backup(home, fake, site_cfg):
    """浏览器重启会丢失会话 cookie；有备份就能恢复登录。"""
    from playwright.async_api import async_playwright

    from uqgrades.browser import goto, logged_in_at, open_context

    cfg = site_cfg
    asyncio.run(simulate_human_login(home, cfg, fake))
    learn = cfg.site_by_id("learn")

    async def check() -> bool:
        async with async_playwright() as pw:
            ctx = await open_context(pw, home, cfg, headless=True)
            url = await goto(ctx.pages[0], cfg.advanced.learn_url, cfg)
            await ctx.close()
            return logged_in_at(cfg, learn, url)

    assert asyncio.run(check()) is True
    saved = home.session_backup.read_text()
    home.session_backup.unlink()
    assert asyncio.run(check()) is False  # 没有备份 → 回到登录页
    home.session_backup.write_text(saved)
    assert asyncio.run(check()) is True


def test_reprobe_new_page_is_baseline_only(home, fake, site_cfg):
    """重新探查加入的新页面，第一次抓到的成绩只作基准，不会一下子推一堆。"""
    cfg = site_cfg
    st = fake.state
    asyncio.run(simulate_human_login(home, cfg, fake))
    res = asyncio.run(
        simulate_human_probe(home, cfg, fake, pages=[st.url("learn", "/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_101_1")])
    )
    save_targets(home, new_target_file(res.targets, res.course_hints, ""))
    store = Store(home.db)
    run_once(home, cfg, store)
    assert st.pushes == []

    res2 = asyncio.run(simulate_human_probe(home, cfg, fake, pages=[st.url("learn", "/ultra/courses/_202_1/grades")]))
    save_targets(home, new_target_file(res2.targets, res2.course_hints, ""), merge=True)
    assert len(load_targets(home).targets) == 3
    out = run_once(home, cfg, store)
    assert out.ok
    assert out.applied.baseline_records >= 1
    assert st.pushes == []
    st.ps1 = 20.0
    run_once(home, cfg, store)
    assert [p["body"] for p in st.pushes] == ["Problem Set 1：18/20 → 20/20"]
    store.close()


def test_probe_with_login_inside_does_not_leak(home, fake, site_cfg):
    """探查时才登录（在被记录的浏览器里输入密码）：密码、SAML、cookie 都不能出现在记录里。"""
    cfg = site_cfg
    st = fake.state
    res = asyncio.run(
        simulate_human_probe(
            home,
            cfg,
            fake,
            login_in_browser=True,
            pages=[st.url("learn", "/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_101_1"), st.url("myuq", "/grades")],
        )
    )
    assert len(res.records) == 5
    text = _all_text(res.out_dir)
    assert "correct-horse" not in text
    assert "SECRET-" not in text
    jsonl = [json.loads(line) for line in (res.out_dir / "requests.jsonl").read_text(encoding="utf-8").splitlines()]
    login_post = [e for e in jsonl if e["method"] == "POST" and e["is_login_page"]]
    assert login_post and all(e["request_body"] == "[登录页面提交的内容一律不记录]" for e in login_post)
    saml_post = [e for e in jsonl if e["method"] == "POST" and urlparse(e["url"]).path == "/auth"]
    assert saml_post and all(e["request_body"] == "SAMLResponse=[已移除]" for e in saml_post)
    assert any(e["is_login_page"] for e in jsonl)
    assert "登录过程中经过的主机：127.0.0.1" in res.report_file.read_text(encoding="utf-8")
