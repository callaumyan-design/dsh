"""按 data/targets.json 里的目标抓取数据（全程只读：只发 GET 请求、只打开页面）。"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field

from playwright.async_api import BrowserContext, Page, Response
from playwright.async_api import Error as PlaywrightError

from .browser import (
    MAX_BODY_BYTES,
    _decode,
    goto,
    json_capture_from_response,
    logged_in_at,
    looks_like_json,
    parse_json_text,
)
from .config import Config, Site
from .models import CaptureSet, HtmlCapture, JsonCapture
from .targets import Target, TargetFile

log = logging.getLogger(__name__)

_PASSWORD_INPUT_RE = re.compile(r"<input[^>]+type\s*=\s*[\"']?password", re.I)


class TargetFailed(Exception):
    pass


class _TargetLoginExpired(Exception):
    pass


@dataclass
class FetchResult:
    captures: CaptureSet = field(default_factory=CaptureSet)
    ok_targets: set[str] = field(default_factory=set)
    failed: dict[str, str] = field(default_factory=dict)  # 目标编号 -> 错误说明
    expired_sites: list[Site] = field(default_factory=list)


async def fetch_all(ctx: BrowserContext, cfg: Config, tf: TargetFile) -> FetchResult:
    result = FetchResult()
    result.captures.course_hints.update(tf.course_hints)
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    by_site: dict[str, list[Target]] = {}
    for t in tf.targets:
        by_site.setdefault(t.site or "", []).append(t)

    for site_id, targets in by_site.items():
        site = cfg.site_by_id(site_id)
        if site is not None:
            # 先打开网站首页：如果学校的单点登录还有效，浏览器会自动续上登录
            url = await goto(page, site.url, cfg)
            if not logged_in_at(cfg, site, url):
                log.warning("%s 停在了登录页：%s", site.name, url)
                result.expired_sites.append(site)
                continue
        for t in targets:
            try:
                await _fetch_one(ctx, page, cfg, t, result.captures)
                result.ok_targets.add(t.id)
            except _TargetLoginExpired:
                if site is not None and site not in result.expired_sites:
                    result.expired_sites.append(site)
                break
            except (TimeoutError, TargetFailed, PlaywrightError) as e:
                msg = str(e).splitlines()[0][:300] if str(e) else e.__class__.__name__
                log.warning("抓取失败 %s %s：%s", t.kind, t.url, msg)
                result.failed[t.id] = msg
    return result


async def _fetch_one(ctx: BrowserContext, page: Page, cfg: Config, t: Target, out: CaptureSet) -> None:
    if t.kind == "json_get":
        try:
            await _json_get(ctx, cfg, t, out)
            return
        except TargetFailed as e:
            if not t.page_url:
                raise
            log.info("直接请求接口失败（%s），改为用浏览器打开页面：%s", e, t.page_url)
            await _render(ctx, cfg, t, out, url=t.page_url)
            return
    if t.kind == "html_get":
        await _html_get(ctx, cfg, t, out)
        return
    if t.kind == "render":
        await _render(ctx, cfg, t, out, url=t.url)
        return
    raise TargetFailed(f"不认识的目标类型：{t.kind}")


async def _json_get(ctx: BrowserContext, cfg: Config, t: Target, out: CaptureSet) -> None:
    resp = await ctx.request.get(
        t.url,
        headers={"Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest"},
        max_redirects=10,
        fail_on_status_code=False,
    )
    try:
        if cfg.is_login_url(resp.url):
            raise _TargetLoginExpired()
        body = await resp.body()
        ct = resp.headers.get("content-type", "")
        if resp.status in (401, 403):
            raise TargetFailed(f"接口返回 HTTP {resp.status}")
        if not (200 <= resp.status < 300):
            raise TargetFailed(f"接口返回 HTTP {resp.status}")
        if len(body) > MAX_BODY_BYTES:
            raise TargetFailed("返回内容太大")
        text = _decode(body, ct)
        if not looks_like_json(text, ct):
            if _PASSWORD_INPUT_RE.search(text):
                raise _TargetLoginExpired()
            raise TargetFailed("接口返回的不是 JSON")
        try:
            data = parse_json_text(text)
        except ValueError as e:
            raise TargetFailed(f"JSON 解析失败：{e}") from e
    finally:
        await resp.dispose()
    out.json.append(
        JsonCapture(
            url=t.url,
            method="GET",
            status=200,
            data=data,
            frame_url=t.page_url,
            page_url=t.page_url,
            target_id=t.id,
        )
    )


async def _html_get(ctx: BrowserContext, cfg: Config, t: Target, out: CaptureSet) -> None:
    resp = await ctx.request.get(t.url, max_redirects=10, fail_on_status_code=False)
    try:
        if cfg.is_login_url(resp.url):
            raise _TargetLoginExpired()
        if not (200 <= resp.status < 300):
            raise TargetFailed(f"网页返回 HTTP {resp.status}")
        body = await resp.body()
        text = _decode(body, resp.headers.get("content-type", ""))
    finally:
        await resp.dispose()
    if _PASSWORD_INPUT_RE.search(text) and "sortable_item_row" not in text:
        raise _TargetLoginExpired()
    out.html.append(HtmlCapture(url=t.url, html=text, kind="raw", target_id=t.id))


async def _render(ctx: BrowserContext, cfg: Config, t: Target, out: CaptureSet, *, url: str) -> None:
    page = await ctx.new_page()
    pending: set[asyncio.Task] = set()
    caps: list[JsonCapture] = []

    async def handle(response: Response) -> None:
        if response.request.resource_type not in ("xhr", "fetch", "document"):
            return
        try:
            cap, _text, _body, _headers = await json_capture_from_response(response)
        except PlaywrightError:
            return
        if cap is not None and 200 <= cap.status < 300:
            cap.target_id = t.id
            caps.append(cap)

    def on_response(response: Response) -> None:
        task = asyncio.ensure_future(handle(response))
        pending.add(task)
        task.add_done_callback(pending.discard)

    page.on("response", on_response)
    try:
        final = await goto(page, url, cfg)
        if cfg.is_login_url(final):
            raise _TargetLoginExpired()
        if pending:
            await asyncio.wait(set(pending), timeout=15)
        for frame in page.frames:
            furl = frame.url
            if not furl or furl.startswith("about:") or cfg.is_login_url(furl):
                continue
            try:
                html = await frame.content()
            except PlaywrightError:
                continue
            out.html.append(HtmlCapture(url=furl, html=html, kind="dom", target_id=t.id))
        out.json.extend(caps)
    finally:
        try:
            await page.close()
        except PlaywrightError:
            pass
