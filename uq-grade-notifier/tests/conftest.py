from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import pytest

from uqgrades.config import parse_config_text
from uqgrades.paths import Paths

from .fakesite import FakeUQ

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def home(tmp_path, monkeypatch) -> Paths:
    monkeypatch.setenv("UQGRADES_HOME", str(tmp_path))
    paths = Paths(tmp_path)
    paths.ensure()
    (tmp_path / "config.example.toml").write_text((ROOT / "config.example.toml").read_text(encoding="utf-8"), encoding="utf-8")
    return paths


@pytest.fixture
def fake():
    f = FakeUQ().start()
    yield f
    f.stop()


@pytest.fixture
def site_cfg(fake, home):
    text = fake.config_toml()
    home.config_file.write_text(text, encoding="utf-8")
    return parse_config_text(text)


# ---------------------------------------------------------------- 模拟“人”的操作


async def simulate_human_login(paths, cfg, fake, *, password="correct-horse"):
    """模拟你在 login 弹出的浏览器里手动登录：填表单、点登录。"""
    from playwright.async_api import async_playwright

    from uqgrades.browser import backup_session_cookies, goto, open_context, save_meta

    st = fake.state
    async with async_playwright() as pw:
        ctx = await open_context(pw, paths, cfg, headless=True)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(cfg.advanced.learn_url)
        await page.fill("input[name=username]", "s1234567")
        await page.fill("input[name=password]", password)
        await page.click("#signin")
        await page.wait_for_url(re.compile(rf"127\.0\.0\.1:{st.ports['learn']}/ultra/stream"))
        url = await goto(page, cfg.advanced.myuq_url, cfg)
        assert f":{st.ports['myuq']}/" in url, url
        save_meta(paths, user_agent=(await page.evaluate("navigator.userAgent")).replace("HeadlessChrome", "Chrome"))
        await backup_session_cookies(ctx, paths)
        await ctx.close()


async def simulate_human_probe(paths, cfg, fake, *, pages=None, login_in_browser=False):
    """模拟你在探查时依次打开各个成绩页面，每个页面按一次回车。"""
    from playwright.async_api import async_playwright

    from uqgrades.browser import backup_session_cookies, goto, open_context
    from uqgrades.probe import Recorder

    st = fake.state
    pages = pages or [
        st.url("learn", "/"),
        st.url("learn", "/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_101_1&stream_name=mygrades"),
        st.url("learn", "/ultra/courses/_202_1/grades"),
        st.url("myuq", "/grades"),
    ]
    started = datetime.now()
    rec = Recorder(cfg, paths.probes / started.strftime("%Y%m%d-%H%M%S"))
    async with async_playwright() as pw:
        ctx = await open_context(pw, paths, cfg, headless=True)
        rec.attach(ctx)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        for url in pages:
            await goto(page, url, cfg)
            if login_in_browser and cfg.is_login_url(page.url):
                await page.fill("input[name=username]", "s1234567")
                await page.fill("input[name=password]", "correct-horse")
                await page.click("#signin")
                await page.wait_for_url(lambda u: not cfg.is_login_url(u))
                await goto(page, url, cfg)
            await page.wait_for_timeout(300)
            await rec.drain()
            await rec.snapshot(ctx)
        await rec.drain()
        await backup_session_cookies(ctx, paths)
        await ctx.close()
    return rec.write(started)
