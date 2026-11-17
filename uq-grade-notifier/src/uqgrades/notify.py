"""Bark 推送。

Bark 接口：POST {server}/push，JSON 里带 device_key、title、body、url、group 等。
只用 Python 自带的 urllib，不额外安装网络库。
"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.error
import urllib.request
from collections import OrderedDict

from .config import BarkConfig
from .detect import GradeEvent

log = logging.getLogger(__name__)

SITE_NAMES = {"learn": "Learn.UQ", "myuq": "my.UQ"}
RELOGIN_COMMAND = "uv run uqgrades login"


class PushError(Exception):
    pass


def build_grade_payloads(events: list[GradeEvent], bark: BarkConfig) -> list[dict]:
    """同一门课的变化合并成一条推送。"""
    groups: OrderedDict[tuple[str, str], list[GradeEvent]] = OrderedDict()
    for ev in events:
        groups.setdefault((ev.site, ev.course), []).append(ev)
    payloads = []
    for (site, course), evs in groups.items():
        site_name = SITE_NAMES.get(site, site)
        has_new = any(e.kind == "new" for e in evs)
        has_changed = any(e.kind == "changed" for e in evs)
        if has_new and has_changed:
            what = "成绩有更新"
        elif has_new:
            what = "有新成绩"
        else:
            what = "成绩有变化"
        link = next((e.link for e in evs if e.link), "")
        if bark.privacy_mode:
            title = "UQ 成绩提醒"
            body = f"{course} {what}"
        else:
            title = f"{course} {what}" + (f"（{len(evs)} 项）" if len(evs) > 1 else "")
            lines = []
            for e in evs:
                if e.kind == "changed" and e.old_display:
                    lines.append(f"{e.item}：{e.old_display} → {e.new_display}")
                else:
                    lines.append(f"{e.item}：{e.new_display}")
            body = "\n".join(lines)
        payloads.append({"title": title, "subtitle": site_name, "body": body, "url": link})
    return payloads


def relogin_payload(site_names: list[str]) -> dict:
    names = "、".join(site_names) or "UQ"
    return {
        "title": "UQ 成绩推送：请重新登录",
        "body": f"{names} 的登录已失效，暂时查不到成绩。\n请在电脑上打开终端，进入工具文件夹，运行：{RELOGIN_COMMAND}",
    }


def failure_payload(message: str) -> dict:
    return {
        "title": "UQ 成绩推送：查询连续失败",
        "body": f"最近几次查询都失败了：{message[:120]}\n在电脑上运行 uv run uqgrades status 查看详情。",
    }


def test_payloads(bark: BarkConfig) -> list[dict]:
    sample = GradeEvent(
        kind="new", site="learn", course="TEST1000", item="示例作业", new_display="85/100", link="https://learn.uq.edu.au/"
    )
    p = build_grade_payloads([sample], bark)[0]
    p["title"] = "【测试】" + p["title"]
    return [
        {"title": "UQ 成绩推送测试", "body": "看到这条说明 Bark 配置正确。下一条是成绩推送的样子（内容是假的）。"},
        p,
    ]


def send(bark: BarkConfig, payload: dict, timeout: float = 20) -> None:
    if not bark.key:
        raise PushError("还没有填写 Bark 密钥（config.toml 里的 [bark] key）。")
    data = {
        "device_key": bark.key,
        "title": payload.get("title", ""),
        "body": payload.get("body", "") or " ",
        "group": bark.group,
        "level": bark.level,
        "isArchive": "1",
    }
    if payload.get("subtitle"):
        data["subtitle"] = payload["subtitle"]
    if payload.get("url"):
        data["url"] = payload["url"]
    if bark.sound:
        data["sound"] = bark.sound
    req = urllib.request.Request(
        bark.server.rstrip("/") + "/push",
        data=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "uqgrades"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        if e.code in (400, 404) and "device" in detail.lower():
            raise PushError(f"Bark 服务器说密钥不对（HTTP {e.code}）。请检查 config.toml 里的 key。") from e
        raise PushError(f"Bark 服务器返回错误 HTTP {e.code}：{detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise PushError(f"连不上 Bark 服务器 {bark.server}：{getattr(e, 'reason', e)}") from e
    try:
        result = json.loads(raw)
    except ValueError:
        raise PushError(f"Bark 服务器返回了看不懂的内容：{raw[:200]}") from None
    if int(result.get("code", 200)) != 200:
        raise PushError(f"Bark 推送失败：{result.get('message', raw[:200])}")


def flush_pending(store, bark: BarkConfig) -> tuple[int, int]:
    """把排队中的推送发出去。返回 (成功数, 失败数)。"""
    ok = failed = 0
    for pid, payload in store.pending():
        try:
            send(bark, payload)
        except PushError as e:
            log.warning("推送失败，下次再试：%s", e)
            store.bump_pending(pid)
            failed += 1
            continue
        store.remove_pending(pid)
        ok += 1
    return ok, failed
