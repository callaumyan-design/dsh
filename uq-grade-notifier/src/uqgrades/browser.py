"""浏览器相关：持久化登录配置、会话 cookie 备份、等待页面稳定、判断是否停在登录页。"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

from playwright.async_api import BrowserContext, Page, Playwright, Response
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeout

from .config import Config, Site
from .models import JsonCapture
from .paths import Paths

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 8 * 1024 * 1024


class BrowserMissing(Exception):
    pass


async def open_context(pw: Playwright, paths: Paths, cfg: Config, *, headless: bool) -> BrowserContext:
    paths.ensure()
    paths.browser_profile.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {
        "user_data_dir": str(paths.browser_profile),
        "headless": headless,
        "accept_downloads": False,
        "locale": "en-AU",
    }
    channel = cfg.advanced.browser_channel
    if channel:
        kwargs["channel"] = channel
    elif headless:
        # 用完整版 Chromium 的新无头模式，和登录时用的是同一个浏览器
        kwargs["channel"] = "chromium"
    if headless:
        kwargs["viewport"] = {"width": 1366, "height": 900}
        ua = _load_meta(paths).get("user_agent")
        if ua:
            kwargs["user_agent"] = ua
    else:
        kwargs["no_viewport"] = True
    try:
        ctx = await pw.chromium.launch_persistent_context(**kwargs)
    except PlaywrightError as e:
        msg = str(e)
        if "Executable doesn't exist" in msg or "playwright install" in msg:
            raise BrowserMissing(
                "找不到 Playwright 的浏览器。请先运行：uv run playwright install chromium"
            ) from e
        if "ProcessSingleton" in msg or "SingletonLock" in msg or "user data directory is already in use" in msg:
            raise BrowserMissing(
                "浏览器配置正被另一个窗口占用。请关掉之前打开的登录/探查浏览器窗口后再试。"
            ) from e
        raise
    ctx.set_default_timeout(cfg.advanced.page_timeout_seconds * 1000)
    ctx.set_default_navigation_timeout(cfg.advanced.page_timeout_seconds * 1000)
    await restore_session_cookies(ctx, paths)
    return ctx


# ---------------------------------------------------------------- 会话 cookie


async def restore_session_cookies(ctx: BrowserContext, paths: Paths) -> int:
    """Chromium 关闭时会丢弃“会话 cookie”（没有过期时间的那种），很多登录状态就存在这里面。
    每次关闭前备份，下次启动时补回去。"""
    f = paths.session_backup
    if not f.exists():
        return 0
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        cookies = [c for c in data.get("cookies", []) if c.get("expires", -1) in (-1, None) or c.get("expires", -1) < 0]
        for c in cookies:
            c.pop("partitionKey", None)
            if c.get("sameSite") not in ("Strict", "Lax", "None"):
                c.pop("sameSite", None)
        if cookies:
            await ctx.add_cookies(cookies)
        return len(cookies)
    except Exception as e:  # 备份坏了就当没有
        log.warning("恢复会话 cookie 失败：%s", e)
        return 0


async def backup_session_cookies(ctx: BrowserContext, paths: Paths) -> None:
    try:
        cookies = await ctx.cookies()
    except PlaywrightError:
        return
    session = [c for c in cookies if c.get("expires", -1) in (-1, None) or c.get("expires", -1) < 0]
    _write_private(paths.session_backup, json.dumps({"saved_at": time.time(), "cookies": session}, ensure_ascii=False))


def _write_private(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    if sys.platform != "win32":
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _load_meta(paths: Paths) -> dict:
    try:
        return json.loads(paths.session_meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_meta(paths: Paths, **values) -> None:
    meta = _load_meta(paths)
    meta.update(values)
    _write_private(paths.session_meta, json.dumps(meta, ensure_ascii=False, indent=2))


def clear_login_state(paths: Paths) -> None:
    """删除浏览器配置和会话备份（用于“彻底退出登录”）。"""
    import shutil

    shutil.rmtree(paths.browser_profile, ignore_errors=True)
    for f in (paths.session_backup, paths.session_meta):
        try:
            f.unlink()
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------- 页面


async def settle(page: Page, cfg: Config, max_seconds: float = 25) -> str:
    """等页面（包括单点登录的自动跳转）安定下来，返回最终网址。"""
    deadline = time.monotonic() + max_seconds
    last = None
    stable = 0
    while time.monotonic() < deadline:
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except (PlaywrightTimeout, PlaywrightError):
            pass
        url = page.url
        if url == last:
            stable += 1
        else:
            stable = 0
            last = url
        # 停在登录页时多等一会儿：单点登录可能会自动跳回来
        need = 4 if cfg.is_login_url(url) else 1
        if stable >= need:
            break
        await asyncio.sleep(1)
    return page.url


async def goto(page: Page, url: str, cfg: Config) -> str:
    try:
        await page.goto(url, wait_until="domcontentloaded")
    except PlaywrightTimeout:
        log.warning("打开页面超时：%s", url)
    except PlaywrightError as e:
        if "net::ERR_ABORTED" not in str(e) and "interrupted by another navigation" not in str(e):
            raise
    return await settle(page, cfg)


def logged_in_at(cfg: Config, site: Site, url: str) -> bool:
    return site.owns_url(url) and not cfg.is_login_url(url)


def _decode(body: bytes, content_type: str) -> str:
    charset = "utf-8"
    ct = content_type.lower()
    if "charset=" in ct:
        charset = ct.split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
    try:
        return body.decode(charset, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def looks_like_json(text: str, content_type: str) -> bool:
    t = text.lstrip()
    return "json" in content_type.lower() or (t[:1] in ("{", "[") and t.rstrip()[-1:] in ("}", "]"))


def parse_json_text(text: str):
    t = text.lstrip()
    # 有的接口会在 JSON 前面加防劫持前缀，例如 )]}'
    for prefix in (")]}',", ")]}'", "while(1);", "for(;;);"):
        if t.startswith(prefix):
            t = t[len(prefix) :]
    return json.loads(t)


async def json_capture_from_response(response: Response) -> tuple[JsonCapture | None, str, bytes | None, dict]:
    """把一个网络响应变成 JsonCapture（如果它是 JSON）。同时返回 (文本, 原始字节, 请求头)。"""
    req = response.request
    try:
        headers = await req.all_headers()
    except PlaywrightError:
        headers = dict(req.headers)
    body = None
    text = ""
    if not (300 <= response.status < 400):
        try:
            body = await response.body()
        except PlaywrightError:
            body = None
    if body is None or len(body) > MAX_BODY_BYTES:
        return None, "", body, headers
    try:
        ct = (await response.all_headers()).get("content-type", "")
    except PlaywrightError:
        ct = response.headers.get("content-type", "")
    text = _decode(body, ct)
    if not looks_like_json(text, ct):
        return None, text, body, headers
    try:
        data = parse_json_text(text)
    except ValueError:
        return None, text, body, headers
    frame_url = page_url = ""
    try:
        frame_url = req.frame.url
        page_url = req.frame.page.url
    except Exception:
        pass
    cap = JsonCapture(
        url=response.url,
        method=req.method,
        status=response.status,
        data=data,
        frame_url=frame_url,
        page_url=page_url,
        had_auth_header=any(k.lower() == "authorization" for k in headers),
    )
    return cap, text, body, headers
