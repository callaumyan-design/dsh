"""一次完整的查询：抓取 → 解析 → 对比 → 推送，以及定时任务的调度逻辑。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from playwright.async_api import async_playwright

from . import notify
from .browser import backup_session_cookies, open_context
from .config import Config
from .detect import ApplyResult, GradeEvent, apply_records
from .extract import extract_all
from .fetcher import FetchResult, fetch_all
from .lock import FileLock
from .models import GradeRecord
from .paths import Paths
from .schedule import next_run_after, should_run
from .store import Store, now_iso
from .targets import load_targets

log = logging.getLogger(__name__)

FAILURE_NOTIFY_AFTER = 3
SILENT_TARGET_RUNS = 3
RELOGIN_REMIND_HOURS = 24


class NoTargets(Exception):
    pass


class NothingExtracted(Exception):
    pass


@dataclass
class RunOutcome:
    ok: bool
    records: list[GradeRecord] = field(default_factory=list)
    applied: ApplyResult | None = None
    fetch: FetchResult | None = None
    expired_site_names: list[str] = field(default_factory=list)
    error: str = ""
    pushed: int = 0
    push_failed: int = 0
    first_run: bool = False


async def fetch_records(paths: Paths, cfg: Config) -> tuple[list[GradeRecord], FetchResult]:
    tf = load_targets(paths)
    if not tf.targets:
        raise NoTargets(
            "还没有抓取目标。请先运行 `uv run uqgrades probe`，在浏览器里打开各门课的成绩页面。"
        )
    async with async_playwright() as pw:
        ctx = await open_context(pw, paths, cfg, headless=True)
        try:
            fr = await fetch_all(ctx, cfg, tf)
        finally:
            await backup_session_cookies(ctx, paths)
            await ctx.close()
    records = extract_all(fr.captures, cfg)
    return records, fr


def run_once(paths: Paths, cfg: Config, store: Store, *, push: bool = True) -> RunOutcome:
    """查询一次。调用者负责加锁。"""
    out = RunOutcome(ok=False)
    try:
        records, fr = asyncio.run(fetch_records(paths, cfg))
    except NoTargets as e:
        out.error = str(e)
        _record_failure(store, cfg, out.error, push=False)
        return out
    except Exception as e:  # 浏览器启动失败、网络问题等
        log.exception("查询出错")
        out.error = f"{e.__class__.__name__}: {e}"
        _record_failure(store, cfg, out.error, push=push)
        _flush(store, cfg, out, push)
        return out

    out.fetch = fr
    out.records = records
    at = now_iso()

    baselined = store.baselined()
    new_targets = fr.ok_targets - baselined
    out.first_run = not baselined
    out.applied = apply_records(
        store,
        records,
        new_targets=new_targets,
        make_payloads=lambda evs: notify.build_grade_payloads(evs, cfg.bark),
        at=at,
    )
    with store.transaction():
        store.mark_baselined(fr.ok_targets, at)
    labels = {t.id: (t.label or t.url[:80]) for t in load_targets(paths).targets}
    _check_silent_targets(store, records, fr.ok_targets, labels, push=push)

    if fr.expired_sites:
        out.expired_site_names = [s.name for s in fr.expired_sites]
        _handle_expired(store, cfg, out.expired_site_names, push=push)
    else:
        store.del_state("login_expired")

    if not fr.ok_targets and not fr.expired_sites:
        out.error = "所有抓取目标都失败了：" + "；".join(sorted(set(fr.failed.values())))[:300]
        _record_failure(store, cfg, out.error, push=push)
    elif fr.ok_targets and not records and store.count() > 0:
        out.error = "这次没有识别出任何成绩，可能网页改版了或登录状态异常。"
        _record_failure(store, cfg, out.error, push=push)
    elif fr.expired_sites and not fr.ok_targets:
        out.error = "登录已失效：" + "、".join(out.expired_site_names)
        _record_failure(store, cfg, out.error, push=False, notify_streak=False)
    else:
        out.ok = True
        store.set_state("failures", 0)
        store.del_state("failure_notified")
        store.set_state("last_success", at)

    store.set_state("last_run", at)
    store.set_state("last_result", {"ok": out.ok, "error": out.error, "records": len(records)})
    _flush(store, cfg, out, push)
    return out


def _check_silent_targets(
    store: Store, records: list[GradeRecord], ok_targets: set[str], labels: dict[str, str], *, push: bool
) -> None:
    """某个页面以前能识别出成绩、现在连续几次一条都没有 → 很可能登录失效（但没跳到登录页）或网页改版了。"""
    counts = {t: 0 for t in ok_targets}
    for r in records:
        for t in r.sources:
            if t in counts:
                counts[t] += 1
    had = set(store.get_state("targets_with_records", []))
    streaks: dict = store.get_state("target_zero_streak", {})
    warned = set(store.get_state("target_zero_warned", []))
    to_warn = []
    for t, n in counts.items():
        if n > 0:
            had.add(t)
            streaks.pop(t, None)
            warned.discard(t)
        elif t in had:
            streaks[t] = int(streaks.get(t, 0)) + 1
            if streaks[t] >= SILENT_TARGET_RUNS and t not in warned:
                to_warn.append(t)
                warned.add(t)
    if to_warn and push:
        names = "、".join(labels.get(t, t) for t in to_warn)
        with store.transaction():
            store.add_pending(
                {
                    "title": "UQ 成绩推送：有页面读不到成绩了",
                    "body": f"{names} 的页面最近 {SILENT_TARGET_RUNS} 次都没有识别出成绩，可能登录失效或网页改版。"
                    "\n请运行 uv run uqgrades login 重新登录；还不行就重新运行 uv run uqgrades probe。",
                }
            )
    store.set_state("targets_with_records", sorted(had))
    store.set_state("target_zero_streak", streaks)
    store.set_state("target_zero_warned", sorted(warned))


def _flush(store: Store, cfg: Config, out: RunOutcome, push: bool) -> None:
    if push and cfg.bark.configured:
        out.pushed, out.push_failed = notify.flush_pending(store, cfg.bark)


def _handle_expired(store: Store, cfg: Config, names: list[str], *, push: bool) -> None:
    state = store.get_state("login_expired") or {}
    last = state.get("notified_at")
    remind = True
    if last:
        try:
            remind = datetime.now().astimezone() - datetime.fromisoformat(last) > timedelta(hours=RELOGIN_REMIND_HOURS)
        except ValueError:
            remind = True
    if remind and push:
        with store.transaction():
            store.add_pending(notify.relogin_payload(names))
        state = {"sites": names, "notified_at": now_iso()}
    else:
        state = {"sites": names, "notified_at": last}
    store.set_state("login_expired", state)


def _record_failure(store: Store, cfg: Config, message: str, *, push: bool, notify_streak: bool = True) -> None:
    n = int(store.get_state("failures", 0)) + 1
    store.set_state("failures", n)
    store.set_state("last_error", {"at": now_iso(), "message": message})
    if push and notify_streak and n >= FAILURE_NOTIFY_AFTER and not store.get_state("failure_notified"):
        with store.transaction():
            store.add_pending(notify.failure_payload(message))
        store.set_state("failure_notified", True)


def tick(paths: Paths, cfg: Config, *, now: datetime | None = None) -> str:
    """定时任务每次醒来时调用。返回一句说明（写进日志）。"""
    now = now or datetime.now().astimezone()
    lock = FileLock(paths.lock_file)
    try:
        lock.acquire(wait_seconds=0)
    except Exception as e:
        return f"跳过：{e}"
    try:
        store = Store(paths.db)
        try:
            nxt = store.get_state("next_run_at")
            next_at = datetime.fromisoformat(nxt) if nxt else None
            ok, why = should_run(now, cfg.schedule, next_at)
            if not ok:
                return f"跳过：{why}"
            out = run_once(paths, cfg, store, push=True)
            failures = int(store.get_state("failures", 0))
            nxt_at = next_run_after(datetime.now().astimezone(), cfg.schedule, failures)
            store.set_state("next_run_at", nxt_at.isoformat(timespec="seconds"))
            return summarize(out) + f"；下次查询约 {nxt_at:%m-%d %H:%M}"
        finally:
            store.close()
    finally:
        lock.release()


def summarize(out: RunOutcome) -> str:
    parts = []
    if out.ok:
        parts.append(f"查询成功，识别出 {len(out.records)} 条成绩记录")
    else:
        parts.append(f"查询未完成：{out.error}")
    if out.applied:
        if out.applied.events:
            parts.append(f"{len(out.applied.events)} 项新成绩/变化")
        if out.applied.baseline_records:
            parts.append(f"{out.applied.baseline_records} 项作为基准记录（不推送）")
    if out.expired_site_names:
        parts.append("登录失效：" + "、".join(out.expired_site_names))
    if out.pushed or out.push_failed:
        parts.append(f"推送成功 {out.pushed} 条" + (f"、失败 {out.push_failed} 条" if out.push_failed else ""))
    return "；".join(parts)


def describe_events(events: list[GradeEvent]) -> list[str]:
    lines = []
    for e in events:
        if e.kind == "changed":
            lines.append(f"{e.course}  {e.item}：{e.old_display} → {e.new_display}")
        else:
            lines.append(f"{e.course}  {e.item}：{e.new_display}（新）")
    return lines
