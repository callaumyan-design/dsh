"""用“看得见的”浏览器把命令行的 login → probe → run → tick 完整跑一遍。

浏览器里的操作（填登录表单、打开成绩页面）和终端里的“按回车”由测试代替人来做。
Linux 上用 Xvfb 虚拟屏幕；Windows / macOS 上设置环境变量 UQGRADES_HEADED_TESTS=1 才运行（会弹出浏览器窗口）。
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time

import pytest

from uqgrades import cli
from uqgrades.store import Store


@pytest.fixture(scope="module")
def display():
    if os.environ.get("DISPLAY") or os.environ.get("UQGRADES_HEADED_TESTS") == "1":
        yield
        return
    if not sys.platform.startswith("linux") or not shutil.which("Xvfb"):
        pytest.skip("没有可用的屏幕（设置 UQGRADES_HEADED_TESTS=1 可在桌面系统上运行）")
    num = 99
    proc = subprocess.Popen(["Xvfb", f":{num}", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    os.environ["DISPLAY"] = f":{num}"
    try:
        yield
    finally:
        del os.environ["DISPLAY"]
        proc.terminate()
        proc.wait(5)


class Keyboard:
    """代替终端输入：测试往这里“按回车”。"""

    current: Keyboard | None = None

    def __init__(self, loop):
        self.loop = loop
        self.queue: asyncio.Queue = asyncio.Queue()
        Keyboard.current = self


def patch_browser(monkeypatch, human):
    """包装 open_context：浏览器一打开，就启动一个“人”在旁边操作。"""
    import uqgrades.browser as browser_mod
    import uqgrades.login as login_mod

    real_open = browser_mod.open_context
    seen = {}

    async def wrapped(pw, paths, cfg, *, headless):
        ctx = await real_open(pw, paths, cfg, headless=headless)
        seen["headless"] = headless
        seen["task"] = asyncio.ensure_future(human(ctx, cfg))
        return ctx

    monkeypatch.setattr(browser_mod, "open_context", wrapped)
    monkeypatch.setattr(login_mod, "open_context", wrapped)
    monkeypatch.setattr("uqgrades.probe._LineReader", Keyboard)
    monkeypatch.setattr("uqgrades.login._LineReader", Keyboard)
    return seen


async def _press(text=""):
    for _ in range(100):
        if Keyboard.current is not None:
            break
        await asyncio.sleep(0.1)
    await Keyboard.current.queue.put(text)


async def _wait_for(page, pred, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred(page.url):
            return
        await asyncio.sleep(0.2)
    raise AssertionError(f"等待超时，当前页面 {page.url}")


def test_login_probe_run_tick_via_cli(display, home, fake, site_cfg, monkeypatch, capsys):
    st = fake.state
    # ---------------- login：人在浏览器里输入密码，然后在终端按回车
    async def human_login(ctx, cfg):
        await asyncio.sleep(0.5)
        page = ctx.pages[0]
        await _wait_for(page, cfg.is_login_url)
        await page.fill("input[name=username]", "s1234567")
        await page.fill("input[name=password]", "correct-horse")
        await page.click("#signin")
        await _wait_for(page, lambda u: f":{st.ports['learn']}/ultra/stream" in u)
        # 第二个标签页（my.UQ）此时还停在登录页；人刷新一下就自动登录了
        await ctx.pages[1].reload()
        await _wait_for(ctx.pages[1], lambda u: f":{st.ports['myuq']}/" in u and not cfg.is_login_url(u))
        await _press("")

    seen = patch_browser(monkeypatch, human_login)
    Keyboard.current = None
    assert cli.main(["login"]) == 0, capsys.readouterr().out
    out = capsys.readouterr().out
    assert seen["headless"] is False  # 登录用的是看得见的窗口
    assert "Learn.UQ：已登录 ✓" in out and "my.UQ：已登录 ✓" in out
    assert "uqgrades probe" in out
    assert home.session_backup.exists()
    meta = json.loads(home.session_meta.read_text())
    assert "HeadlessChrome" not in meta["user_agent"]

    # ---------------- probe：人依次打开三个成绩页面，每次按回车，最后输入 q
    async def human_probe(ctx, cfg):
        await asyncio.sleep(0.5)
        page = ctx.pages[0]
        for path, site in (
            ("/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_101_1&stream_name=mygrades", "learn"),
            ("/ultra/courses/_202_1/grades", "learn"),
            ("/grades", "myuq"),
        ):
            await page.goto(st.url(site, path))
            await page.wait_for_load_state("networkidle")
            await _press("")
            await asyncio.sleep(1.0)
        await _press("q")

    seen = patch_browser(monkeypatch, human_probe)
    Keyboard.current = None
    assert cli.main(["probe"]) == 0
    out = capsys.readouterr().out
    assert seen["headless"] is False
    assert "识别出 7 条成绩记录" in out, out
    assert "以后自动查询会访问以下 4 个地址" in out, out
    assert "探查报告：" in out
    targets = json.loads(home.targets.read_text(encoding="utf-8"))
    assert sorted(t["kind"] for t in targets["targets"]) == ["html_get", "json_get", "json_get", "render"]
    probe_dirs = list(home.probes.iterdir())
    assert len(probe_dirs) == 1 and (probe_dirs[0] / "report.md").exists()

    # ---------------- run：第一次只记基准
    assert cli.main(["run"]) == 0
    out = capsys.readouterr().out
    assert "这是第一次运行" in out and st.pushes == []
    assert "COMP3506" in out and "85/100" in out

    # ---------------- 成绩变化 → run 推送
    st.final_comp = "7"
    assert cli.main(["run"]) == 0
    out = capsys.readouterr().out
    assert "COMP3506  最终成绩（Semester 2, 2026）：7（新）" in out
    assert [p["title"] for p in st.pushes] == ["COMP3506 有新成绩"]

    # ---------------- tick：刚运行过，还没到时间
    assert cli.main(["tick"]) == 0
    assert "还没到下次查询时间" in capsys.readouterr().out

    # 把下次时间提前，tick 就会真的查询
    s = Store(home.db)
    s.del_state("next_run_at")
    s.close()
    st.a1 = "88"
    assert cli.main(["tick"]) == 0
    out = capsys.readouterr().out
    assert "查询成功" in out and "1 项新成绩/变化" in out
    assert st.pushes[-1]["body"] == "Assignment 1: Sorting：85/100 → 88/100"
    log_text = home.log_file.read_text(encoding="utf-8")
    assert "查询成功" in log_text

    assert cli.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "成绩记录：7 条" in out and "[变] COMP3506 Assignment 1: Sorting：85/100 → 88/100" in out
