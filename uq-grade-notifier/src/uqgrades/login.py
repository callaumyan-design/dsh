"""登录：弹出一个看得见的浏览器窗口，你手动登录（含多重验证），程序只保存浏览器的登录状态，不碰密码。"""

from __future__ import annotations

import asyncio

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

from .browser import backup_session_cookies, goto, logged_in_at, open_context, save_meta
from .config import Config
from .paths import Paths
from .probe import _LineReader


async def interactive_login(paths: Paths, cfg: Config, say=print) -> dict[str, bool]:
    """返回 {网站编号: 是否已登录}"""
    async with async_playwright() as pw:
        ctx = await open_context(pw, paths, cfg, headless=False)
        try:
            pages = []
            for i, site in enumerate(cfg.sites):
                page = ctx.pages[0] if (i == 0 and ctx.pages) else await ctx.new_page()
                try:
                    await page.goto(site.url, wait_until="domcontentloaded")
                except PlaywrightError:
                    pass
                pages.append((site, page))
            say("")
            say("浏览器窗口已打开，里面有两个标签页：Learn.UQ 和 my.UQ。")
            say("请在浏览器里分别登录这两个网站（包括多重验证）。")
            say("如果登录页面问“保持登录 / Stay signed in / Remember me”，请选“是”，这样登录能维持更久。")
            say("两个网站都能看到登录后的页面以后，回到这个窗口按【回车】。")
            loop = asyncio.get_running_loop()
            reader = _LineReader(loop)
            closed = loop.create_future()
            ctx.on("close", lambda *_: closed.done() or closed.set_result(True))
            get = asyncio.ensure_future(reader.queue.get())
            done, _ = await asyncio.wait({get, closed}, return_when=asyncio.FIRST_COMPLETED)
            if closed in done:
                get.cancel()
                say("浏览器窗口被关掉了，登录没有完成。请重新运行 uv run uqgrades login，登录完成后再按回车。")
                return {s.id: False for s in cfg.sites}

            say("正在检查登录状态……")
            status: dict[str, bool] = {}
            check = await ctx.new_page()
            for site in cfg.sites:
                url = await goto(check, site.url, cfg)
                status[site.id] = logged_in_at(cfg, site, url)
            try:
                ua = await check.evaluate("navigator.userAgent")
                save_meta(paths, user_agent=ua.replace("HeadlessChrome", "Chrome"))
            except PlaywrightError:
                pass
            await backup_session_cookies(ctx, paths)
            return status
        finally:
            try:
                await ctx.close()
            except PlaywrightError:
                pass
