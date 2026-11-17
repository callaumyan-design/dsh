"""探查录制：你在浏览器里手动打开成绩页面，程序在旁边记录网页背后的数据请求。

输出（都在 data/probe/<时间>/ 里，只在本机）：
- report.md        给人看的报告：识别出的成绩、以后要用的地址、所有请求列表、JSON 数据结构
- requests.jsonl   每个请求一行的完整记录（已去掉凭证）
- pages/           网页快照（已去掉隐藏字段里的令牌）
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import BrowserContext, Response
from playwright.async_api import Error as PlaywrightError

from .browser import json_capture_from_response
from .config import Config
from .extract import extract_all
from .models import CaptureSet, GradeRecord, HtmlCapture
from .notify import SITE_NAMES
from .sanitize import (
    json_shape,
    sanitize_body_text,
    sanitize_headers,
    sanitize_html,
    sanitize_json,
    sanitize_url,
)
from .targets import KIND_LABELS, Target, choose_targets, tag_probe_captures

log = logging.getLogger(__name__)

RECORD_TYPES = {"document", "xhr", "fetch"}


@dataclass
class ProbeResult:
    out_dir: Path
    records: list[GradeRecord]
    targets: list[Target]
    course_hints: dict[str, str]
    request_count: int
    page_snapshots: int
    report_file: Path
    hosts: Counter = field(default_factory=Counter)


class Recorder:
    def __init__(self, cfg: Config, out_dir: Path):
        self.cfg = cfg
        self.out_dir = Path(out_dir)
        self.pages_dir = self.out_dir / "pages"
        self.entries: list[dict] = []
        self.captures = CaptureSet()
        self.skipped: Counter = Counter()
        self.login_hosts: set[str] = set()
        self._tasks: set[asyncio.Task] = set()
        self._seq = 0
        self._page_seq = 0

    # ------------------------------------------------ 记录
    def attach(self, ctx: BrowserContext) -> None:
        ctx.on("response", self._on_response)

    def _on_response(self, response: Response) -> None:
        task = asyncio.ensure_future(self._handle(response))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def drain(self, timeout: float = 20) -> None:
        if self._tasks:
            await asyncio.wait(set(self._tasks), timeout=timeout)

    async def _handle(self, response: Response) -> None:
        try:
            await self._handle_inner(response)
        except PlaywrightError as e:
            log.debug("记录请求失败：%s", e)
        except Exception:
            log.exception("记录请求时出错")

    async def _handle_inner(self, response: Response) -> None:
        req = response.request
        rtype = req.resource_type
        url = response.url
        if not url.startswith("http"):
            return
        if rtype not in RECORD_TYPES:
            self.skipped[rtype] += 1
            return
        self._seq += 1
        seq = self._seq
        host = urlparse(url).hostname or ""
        is_login = self.cfg.is_login_url(url)
        if is_login:
            self.login_hosts.add(host)
        site = self.cfg.site_for_url(url)

        cap, text, body, req_headers = await json_capture_from_response(response)
        try:
            resp_headers = await response.all_headers()
        except PlaywrightError:
            resp_headers = dict(response.headers)
        frame_url = ""
        try:
            frame_url = req.frame.url
        except Exception:
            pass
        ct = resp_headers.get("content-type", "")

        entry: dict = {
            "seq": seq,
            "time": datetime.now().strftime("%H:%M:%S"),
            "method": req.method,
            "url": sanitize_url(url),
            "status": response.status,
            "resource_type": rtype,
            "site": site.id if site else "",
            "is_login_page": is_login,
            "frame_url": sanitize_url(frame_url),
            "had_authorization_header": any(k.lower() == "authorization" for k in req_headers),
            "request_headers": sanitize_headers(req_headers),
            "response_headers": sanitize_headers(resp_headers),
        }
        if req.method.upper() != "GET":
            try:
                post = req.post_data or ""
            except Exception:
                post = ""
            if is_login:
                entry["request_body"] = "[登录页面提交的内容一律不记录]"
            elif post:
                entry["request_body"] = sanitize_body_text(post, req_headers.get("content-type", ""))

        if cap is not None:
            self.captures.json.append(cap)
            clean = sanitize_json(cap.data)
            entry["response_kind"] = "json"
            entry["response_json"] = clean
        elif body is not None and ("html" in ct.lower() or rtype == "document") and text:
            entry["response_kind"] = "html"
            entry["response_size"] = len(body)
            if not is_login:
                title = _title_of(text)
                self.captures.html.append(
                    HtmlCapture(url=url, html=text, kind="raw", method=req.method, status=response.status, title=title)
                )
                entry["page_title"] = title
                entry["saved_page"] = self._save_page(url, text, "raw")
        elif body is not None:
            entry["response_kind"] = "other"
            entry["response_size"] = len(body)
            entry["content_type"] = ct
        self.entries.append(entry)

    def _save_page(self, url: str, html: str, kind: str) -> str:
        self.pages_dir.mkdir(parents=True, exist_ok=True)
        self._page_seq += 1
        host = re.sub(r"[^a-z0-9.-]", "_", (urlparse(url).hostname or "page").lower())
        name = f"{self._page_seq:03d}-{kind}-{host}.html"
        header = f"<!-- 来源：{sanitize_url(url)}（{'服务器返回的原文' if kind == 'raw' else '浏览器渲染后的快照'}，已去掉凭证） -->\n"
        (self.pages_dir / name).write_text(header + sanitize_html(html), encoding="utf-8")
        return f"pages/{name}"

    async def snapshot(self, ctx: BrowserContext) -> int:
        """保存当前所有标签页（包括页面里嵌套的框架）渲染后的内容。"""
        n = 0
        for page in list(ctx.pages):
            for frame in list(page.frames):
                url = frame.url
                if not url.startswith("http") or self.cfg.is_login_url(url):
                    continue
                try:
                    html = await frame.content()
                except PlaywrightError:
                    continue
                self.captures.html.append(HtmlCapture(url=url, html=html, kind="dom", title=_title_of(html)))
                self._save_page(url, html, "dom")
                n += 1
        return n

    # ------------------------------------------------ 结束
    def analyze(self) -> tuple[list[GradeRecord], list[Target]]:
        cands = tag_probe_captures(self.captures, self.cfg)
        records = extract_all(self.captures, self.cfg)
        targets = choose_targets(records, cands)
        return records, targets

    def course_hints(self) -> dict[str, str]:
        from .extract.common import harvest_course_hints

        hints: dict[str, str] = {}
        for cap in self.captures.json:
            harvest_course_hints(cap.data, hints)
        return hints

    def write(self, started: datetime) -> ProbeResult:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        records, targets = self.analyze()
        hints = self.course_hints()
        with open(self.out_dir / "requests.jsonl", "w", encoding="utf-8") as f:
            for e in self.entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        report = self.out_dir / "report.md"
        report.write_text(self._report(started, records, targets, hints), encoding="utf-8")
        hosts = Counter(urlparse(e["url"]).hostname or "" for e in self.entries)
        snaps = sum(1 for d in self.captures.html if d.kind == "dom")
        return ProbeResult(
            out_dir=self.out_dir,
            records=records,
            targets=targets,
            course_hints=hints,
            request_count=len(self.entries),
            page_snapshots=snaps,
            report_file=report,
            hosts=hosts,
        )

    def _report(self, started, records, targets, hints) -> str:
        L: list[str] = []
        L.append(f"# 探查报告 {started:%Y-%m-%d %H:%M}")
        L.append("")
        L.append("> 已自动去掉：Cookie、Authorization 请求头、各种 token / session / nonce / csrf 字段、")
        L.append("> 网址里的 code/state 等参数、登录页面提交的内容、网页里隐藏输入框的值。")
        L.append("> **报告里仍然有你的成绩、姓名、学号等个人信息**，分享给别人之前请先检查。")
        L.append("")
        L.append("## 一、识别出的成绩（请对照网页核对）")
        L.append("")
        if records:
            L.append("| 网站 | 课程 | 评估项 | 成绩 | 解析方式 |")
            L.append("|---|---|---|---|---|")
            for r in sorted(records, key=lambda r: (r.site != "learn", r.course)):
                L.append(
                    f"| {SITE_NAMES.get(r.site, r.site)} | {r.course} | {_md(r.item)} | {_md(r.display)} | {r.extractor} |"
                )
        else:
            L.append("没有识别出任何成绩。可能原因：没有打开成绩页面；或者网页格式和现有解析器不一样——")
            L.append("这种情况请把本文件夹（检查后）交给开发者，按真实格式补充解析器。")
        L.append("")
        L.append("## 二、以后自动查询会访问的地址（抓取目标）")
        L.append("")
        if targets:
            for t in targets:
                site = SITE_NAMES.get(t.site, t.site or "其他")
                L.append(f"- **{KIND_LABELS.get(t.kind, t.kind)}**（{site} · {t.label or '未知课程'}）：`{sanitize_url(t.url)}`")
        else:
            L.append("（无）")
        if hints:
            L.append("")
            L.append("课程内部编号对应关系：" + "，".join(f"`{k}` → {v}" for k, v in sorted(hints.items())))
        L.append("")
        L.append(f"## 三、记录到的数据请求（共 {len(self.entries)} 条）")
        L.append("")
        if self.skipped:
            L.append(
                "未记录的静态资源："
                + "，".join(f"{k} {v} 个" for k, v in self.skipped.most_common())
                + "（图片、样式、脚本等，与成绩无关）"
            )
            L.append("")
        by_host: dict[str, list[dict]] = {}
        for e in self.entries:
            by_host.setdefault(urlparse(e["url"]).hostname or "", []).append(e)
        for host, items in sorted(by_host.items(), key=lambda kv: -len(kv[1])):
            L.append(f"### {host}（{len(items)} 条）")
            L.append("")
            L.append("| # | 方法 | 状态 | 类型 | 返回 | 地址 |")
            L.append("|---|---|---|---|---|---|")
            for e in items:
                path = urlparse(e["url"])
                short = path.path + (("?" + path.query) if path.query else "")
                if len(short) > 140:
                    short = short[:137] + "…"
                kind = e.get("response_kind", "")
                flag = " 🔑" if e.get("had_authorization_header") else ""
                L.append(
                    f"| {e['seq']} | {e['method']} | {e['status']} | {e['resource_type']} | {kind}{flag} | `{short}` |"
                )
            L.append("")
        L.append("🔑 = 这个请求带了 Authorization 请求头（值已移除）。这类接口不能直接调用，会改用浏览器打开页面的方式获取。")
        L.append("")
        L.append("## 四、返回 JSON 的数据结构")
        L.append("")
        L.append("下面是每个 JSON 返回内容的结构：保留字段名，示例值截短，列表只显示前 2 项。完整内容见 requests.jsonl。")
        L.append("")
        for e in self.entries:
            if e.get("response_kind") != "json":
                continue
            L.append(f"#### #{e['seq']} {e['method']} `{_short_url(e['url'])}`")
            L.append("")
            L.append("```json")
            L.append(json.dumps(json_shape(e["response_json"]), ensure_ascii=False, indent=2)[:6000])
            L.append("```")
            L.append("")
        L.append("## 五、登录相关")
        L.append("")
        L.append("登录过程中经过的主机：" + ("、".join(sorted(self.login_hosts)) or "（本次没有经过登录页面）"))
        L.append("")
        return "\n".join(L) + "\n"


def _md(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def _short_url(u: str) -> str:
    return u if len(u) <= 160 else u[:157] + "…"


def _title_of(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    return " ".join(m.group(1).split())[:200] if m else ""


# ---------------------------------------------------------------- 交互


class _LineReader:
    """在后台线程读终端输入，不卡住浏览器事件。线程是守护线程，程序结束时不会被它拖住。"""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.queue: asyncio.Queue[str | None] = asyncio.Queue()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        while True:
            try:
                line = input()
            except (EOFError, KeyboardInterrupt):
                self.loop.call_soon_threadsafe(self.queue.put_nowait, None)
                return
            self.loop.call_soon_threadsafe(self.queue.put_nowait, line)


async def interactive_probe(ctx: BrowserContext, cfg: Config, rec: Recorder, say=print) -> None:
    loop = asyncio.get_running_loop()
    closed = loop.create_future()
    ctx.on("close", lambda *_: closed.done() or closed.set_result(True))
    reader = _LineReader(loop)
    while True:
        say("\n➜ 打开一个成绩页面、看到成绩后，按【回车】保存快照；全部看完后输入 q 再按回车结束。")
        get = asyncio.ensure_future(reader.queue.get())
        done, _ = await asyncio.wait({get, closed}, return_when=asyncio.FIRST_COMPLETED)
        if closed in done:
            get.cancel()
            say("浏览器窗口已关闭，结束探查。")
            return
        line = get.result()
        if line is None or line.strip().lower() in ("q", "quit", "exit", "结束"):
            await asyncio.sleep(1)
            await rec.drain()
            await rec.snapshot(ctx)
            return
        await rec.drain()
        n = await rec.snapshot(ctx)
        records, _ = rec.analyze()
        courses = sorted({r.course for r in records})
        say(
            f"已保存 {n} 个页面快照；目前共记录 {len(rec.entries)} 条数据请求，"
            f"识别出 {len(records)} 条成绩记录" + (f"（课程：{'、'.join(courses)}）" if courses else "")
        )
