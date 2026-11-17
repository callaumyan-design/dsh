"""命令行入口：uv run uqgrades <命令>"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler

from . import notify, service
from .browser import BrowserMissing
from .config import Config, ConfigError, load_config, parse_quiet_hours, write_basic_config
from .lock import FileLock, LockBusy
from .paths import Paths
from .store import Store

log = logging.getLogger("uqgrades")


def say(*args) -> None:
    if sys.stdout is not None:
        print(*args, flush=True)


def setup_logging(paths: Paths, *, console: bool = True, verbose: bool = False) -> None:
    paths.ensure()
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(paths.log_file, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(fh)
    if console and sys.stderr is not None:
        sh = logging.StreamHandler(sys.stderr)
        sh.setLevel(logging.INFO if verbose else logging.WARNING)
        sh.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
        root.addHandler(sh)


# ---------------------------------------------------------------- 各个命令


def cmd_init(paths: Paths, args) -> int:
    if paths.config_file.exists() and not args.force:
        say(f"配置文件已经存在：{paths.config_file}")
        say("想重新生成就运行：uv run uqgrades init --force（会覆盖现有配置）")
        say("只改某一项的话，直接用记事本 / 文本编辑打开 config.toml 修改即可。")
        return 0
    say("下面回答几个问题，程序会帮你生成 config.toml。")
    say("")
    say("1) Bark 密钥：打开 iPhone 上的 Bark App，复制首页那条 https://api.day.app/... 的链接，粘贴到这里。")
    key = input("   粘贴后按回车：").strip()
    while not key:
        key = input("   不能为空，请粘贴 Bark 链接或密钥：").strip()
    say("")
    say("2) 隐私模式：打开后，锁屏通知只显示“某门课有新成绩”，不显示分数。")
    privacy = input("   要打开吗？输入 y 打开，直接回车表示不打开：").strip().lower() in ("y", "yes", "是", "1")
    say("")
    say('3) 免打扰时段：这段时间不查询、不推送。例如 23:00-07:00。直接回车使用 23:00-07:00；输入 无 表示不设置。')
    while True:
        quiet = input("   免打扰时段：").strip()
        if quiet == "":
            quiet = "23:00-07:00"
        if quiet in ("无", "none", "no", "0"):
            quiet = ""
        try:
            parse_quiet_hours(quiet)
            break
        except ConfigError as e:
            say("   " + str(e))
    path = write_basic_config(paths, bark_key=key, privacy_mode=privacy, quiet_hours=quiet)
    say("")
    say(f"已保存配置：{path}")
    say("下一步：运行 uv run uqgrades test-push 试一下推送。")
    return 0


def _require_config(paths: Paths) -> Config:
    cfg = load_config(paths)
    if not paths.config_file.exists():
        say("提示：还没有配置文件 config.toml，先用默认设置运行。推送前请运行 uv run uqgrades init。")
    return cfg


def cmd_test_push(paths: Paths, args) -> int:
    cfg = load_config(paths)
    if not cfg.bark.configured:
        say("还没有填写 Bark 密钥。请先运行：uv run uqgrades init")
        return 1
    say(f"正在发送测试推送到 {cfg.bark.server} ……（隐私模式：{'开' if cfg.bark.privacy_mode else '关'}）")
    for p in notify.test_payloads(cfg.bark):
        notify.send(cfg.bark, p)
    say("已发送 2 条测试推送，请看看 iPhone 有没有收到。")
    return 0


def cmd_login(paths: Paths, args) -> int:
    from .login import interactive_login

    cfg = _require_config(paths)
    lock = FileLock(paths.lock_file)
    say("正在等待后台查询结束（如果有的话）……")
    lock.acquire(wait_seconds=180)
    try:
        status = asyncio.run(interactive_login(paths, cfg, say=say))
    finally:
        lock.release()
    ok_all = all(status.values())
    for site in cfg.sites:
        say(f"  {site.name}：{'已登录 ✓' if status.get(site.id) else '未登录 ✗'}")
    if ok_all:
        store = Store(paths.db)
        try:
            store.del_state("login_expired")
            store.set_state("failures", 0)
            store.del_state("failure_notified")
            store.del_state("next_run_at")  # 让定时任务下次醒来时马上查询
        finally:
            store.close()
        say("登录状态已保存。")
        tf_exists = paths.targets.exists()
        say("下一步：" + ("运行 uv run uqgrades run 手动查一次。" if tf_exists else "运行 uv run uqgrades probe 进行探查录制。"))
        return 0
    say("有网站没有登录成功。请重新运行 uv run uqgrades login，在浏览器里登录完成、看到登录后的页面后再按回车。")
    return 1


def cmd_probe(paths: Paths, args) -> int:
    from playwright.async_api import async_playwright

    from .browser import backup_session_cookies, open_context
    from .probe import Recorder, interactive_probe
    from .targets import KIND_LABELS, new_target_file, save_targets

    cfg = _require_config(paths)
    started = datetime.now()
    out_dir = paths.probes / started.strftime("%Y%m%d-%H%M%S")
    rec = Recorder(cfg, out_dir)

    async def go():
        async with async_playwright() as pw:
            ctx = await open_context(pw, paths, cfg, headless=False)
            try:
                rec.attach(ctx)
                for i, site in enumerate(cfg.sites):
                    page = ctx.pages[0] if (i == 0 and ctx.pages) else await ctx.new_page()
                    try:
                        await page.goto(site.url, wait_until="domcontentloaded")
                    except Exception:
                        pass
                say("")
                say("探查录制已开始。浏览器里打开了 Learn.UQ 和 my.UQ 两个标签页。")
                say("请依次打开每门课的成绩页面：")
                say("  · Learn.UQ：进入一门课 → 左侧菜单的 My Grades / Grades（或顶部的“成绩”）")
                say("  · my.UQ：找到课程成绩 / Results / Grades 的页面")
                say("程序只在旁边记录，不会点击或提交任何东西。")
                await interactive_probe(ctx, cfg, rec, say=say)
                await rec.drain()
                await backup_session_cookies(ctx, paths)
            finally:
                try:
                    await ctx.close()
                except Exception:
                    pass

    lock = FileLock(paths.lock_file)
    lock.acquire(wait_seconds=180)
    try:
        asyncio.run(go())
    except KeyboardInterrupt:
        say("\n已按 Ctrl+C 结束，正在保存已经记录到的内容……")
    finally:
        lock.release()

    res = rec.write(started)
    say("")
    say(f"共记录 {res.request_count} 条数据请求、{res.page_snapshots} 个页面快照。")
    if res.records:
        say(f"识别出 {len(res.records)} 条成绩记录，请对照网页核对：")
        _print_records(res.records)
    else:
        say("没有识别出任何成绩。")
    say("")
    if res.targets:
        tf = new_target_file(res.targets, res.course_hints, str(out_dir))
        tf = save_targets(paths, tf, merge=args.add)
        say(f"以后自动查询会访问以下 {len(tf.targets)} 个地址（已保存到 data/targets.json）：")
        for t in tf.targets:
            say(f"  [{KIND_LABELS.get(t.kind, t.kind)}] {t.label or ''}  {t.url[:120]}")
    else:
        if paths.targets.exists():
            say("这次没有找到可用的抓取目标，原来的 data/targets.json 保持不变。")
        else:
            say("没有找到可用的抓取目标。")
    say("")
    say(f"探查报告：{res.report_file}")
    say("请打开这个文件检查（可以用记事本 / 文本编辑 / VS Code 打开）。")
    if not res.records:
        say("如果你确实打开了成绩页面但这里没有识别出来，说明网页格式需要专门适配：")
        say("检查报告确认没有敏感信息后，把整个文件夹交给开发者（例如 Claude）补充解析器。")
    else:
        say("识别结果正确的话，下一步运行：uv run uqgrades run")
    return 0


def _print_records(records) -> None:
    from .notify import SITE_NAMES

    width = max((len(r.course) for r in records), default=8)
    for r in records:
        say(f"  {SITE_NAMES.get(r.site, r.site):9} {r.course:{width}}  {r.item}  →  {r.display}")


def cmd_run(paths: Paths, args) -> int:
    from .runner import describe_events, run_once, summarize
    from .schedule import next_run_after

    cfg = _require_config(paths)
    lock = FileLock(paths.lock_file)
    try:
        lock.acquire(wait_seconds=120)
    except LockBusy as e:
        say(str(e))
        return 1
    try:
        store = Store(paths.db)
        try:
            say("正在查询（后台浏览器，不会弹出窗口，大约需要半分钟到两分钟）……")
            out = run_once(paths, cfg, store, push=not args.no_push)
            if out.records:
                say(f"识别出 {len(out.records)} 条成绩记录：")
                _print_records(out.records)
            if out.fetch and out.fetch.failed:
                say(f"有 {len(out.fetch.failed)} 个地址抓取失败（详情见 data/logs/uqgrades.log）。")
            if out.expired_site_names:
                say("")
                say("⚠ 登录已失效：" + "、".join(out.expired_site_names))
                say("请运行 uv run uqgrades login 重新登录。")
            if out.applied:
                if out.applied.events:
                    say("")
                    say("新成绩 / 变化：")
                    for line in describe_events(out.applied.events):
                        say("  " + line)
                if out.first_run and out.applied.baseline_records + out.applied.graded_records > 0:
                    say("")
                    say("这是第一次运行：当前成绩已记录为对比基准，不发送推送。以后有新成绩或变化时才推送。")
                elif out.applied.baseline_records:
                    say(f"（有 {out.applied.baseline_records} 项来自新加入的页面，只作为基准记录，不推送）")
                elif not out.applied.events and out.ok:
                    say("")
                    say("没有新成绩。")
            if args.no_push:
                say("（--no-push：这次没有发送推送，待发送的推送会在下次运行时发出）")
            elif not cfg.bark.configured and store.pending():
                say("还没有配置 Bark，推送暂存在本地。运行 uv run uqgrades init 配置后会自动补发。")
            if out.push_failed:
                say(f"有 {out.push_failed} 条推送发送失败，下次运行会重试。")
            say("")
            say(summarize(out))
            failures = int(store.get_state("failures", 0))
            nxt = next_run_after(datetime.now().astimezone(), cfg.schedule, failures)
            store.set_state("next_run_at", nxt.isoformat(timespec="seconds"))
            return 0 if out.ok else 1
        finally:
            store.close()
    finally:
        lock.release()


def cmd_tick(paths: Paths, args) -> int:
    from .runner import tick

    try:
        cfg = load_config(paths)
    except ConfigError as e:
        log.error("配置文件有误：%s", e)
        return 1
    msg = tick(paths, cfg)
    log.info("%s", msg)
    say(msg)
    return 0


def cmd_install(paths: Paths, args) -> int:
    cfg = _require_config(paths)
    if not cfg.bark.configured:
        say("提醒：还没有配置 Bark 密钥，定时任务能运行但收不到推送。可以先运行 uv run uqgrades init。")
    msg = service.install(paths, cfg.schedule.wake_interval_minutes)
    say(msg)
    say(f"查询间隔：{cfg.schedule.min_interval_minutes:g}–{cfg.schedule.max_interval_minutes:g} 分钟随机；"
        f"免打扰：{cfg.schedule.quiet_hours or '无'}")
    say("运行记录在 data/logs/uqgrades.log；随时可以用 uv run uqgrades status 查看状态。")
    return 0


def cmd_uninstall(paths: Paths, args) -> int:
    say(service.uninstall())
    return 0


def cmd_status(paths: Paths, args) -> int:
    from .targets import load_targets

    cfg = load_config(paths)
    say(f"工具文件夹：{paths.home}")
    say(f"配置文件：{'已创建' if paths.config_file.exists() else '未创建（运行 uv run uqgrades init）'}")
    say(f"Bark：{'已配置' if cfg.bark.configured else '未配置'}；隐私模式：{'开' if cfg.bark.privacy_mode else '关'}")
    say(f"免打扰：{cfg.schedule.quiet_hours or '无'}；查询间隔：{cfg.schedule.min_interval_minutes:g}–{cfg.schedule.max_interval_minutes:g} 分钟")
    say(f"定时任务：{service.status()}")
    say(f"登录状态：{'已保存' if paths.browser_profile.exists() else '未登录（运行 uv run uqgrades login）'}")
    tf = load_targets(paths)
    say(f"抓取目标：{len(tf.targets)} 个" + (f"（探查于 {tf.generated_at}）" if tf.generated_at else "（运行 uv run uqgrades probe）"))
    if not paths.db.exists():
        say("成绩记录：还没有运行过。")
        return 0
    store = Store(paths.db)
    try:
        say(f"成绩记录：{store.count()} 条")
        last = store.get_state("last_run")
        res = store.get_state("last_result") or {}
        if last:
            say(f"上次查询：{last}，{'成功' if res.get('ok') else '未完成：' + res.get('error', '')}")
        nxt = store.get_state("next_run_at")
        if nxt:
            say(f"下次查询：约 {nxt}（免打扰时段内会顺延）")
        fails = int(store.get_state("failures", 0))
        if fails:
            err = store.get_state("last_error") or {}
            say(f"连续失败：{fails} 次；最近错误：{err.get('message', '')}")
        exp = store.get_state("login_expired")
        if exp:
            say("⚠ 登录已失效：" + "、".join(exp.get("sites", [])) + "。请运行 uv run uqgrades login")
        pend = store.pending()
        if pend:
            say(f"待发送的推送：{len(pend)} 条")
        hist = store.recent_history(8)
        if hist:
            say("最近的成绩变化：")
            for h in hist:
                kind = {"new": "新", "changed": "变", "hidden": "隐"}.get(h["kind"], h["kind"])
                say(f"  {h['at'][:16]}  [{kind}] {h['course']} {h['item']}：{h['old_value'] or '—'} → {h['new_value'] or '—'}")
    finally:
        store.close()
    return 0


# ---------------------------------------------------------------- 入口


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="uqgrades",
        description="UQ 新成绩推送：盯着 Learn.UQ 和 my.UQ 的成绩，有新成绩就推送到 iPhone（只读）。",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="显示更多运行细节")
    sub = p.add_subparsers(dest="command", metavar="命令")
    s = sub.add_parser("init", help="生成配置文件（填 Bark 密钥、隐私模式、免打扰时段）")
    s.add_argument("--force", action="store_true", help="覆盖已有的 config.toml")
    sub.add_parser("login", help="打开浏览器窗口手动登录 UQ（含多重验证），保存登录状态")
    s = sub.add_parser("probe", help="探查录制：你手动打开成绩页面，程序记录网页背后的数据请求")
    s.add_argument("--add", action="store_true", help="把这次找到的地址加到原有目标里，而不是替换")
    s = sub.add_parser("run", help="马上手动查询一次")
    s.add_argument("--no-push", action="store_true", help="只查询和记录，不发送推送")
    sub.add_parser("test-push", help="发送测试推送到 iPhone")
    sub.add_parser("install", help="安装后台定时任务（Windows 任务计划程序 / macOS launchd）")
    sub.add_parser("uninstall", help="卸载后台定时任务")
    sub.add_parser("status", help="查看当前状态：登录、上次查询、最近变化等")
    sub.add_parser("tick", help="（给定时任务用的）到时间就查询一次，没到时间就什么都不做")
    return p


COMMANDS = {
    "init": cmd_init,
    "login": cmd_login,
    "probe": cmd_probe,
    "run": cmd_run,
    "test-push": cmd_test_push,
    "install": cmd_install,
    "uninstall": cmd_uninstall,
    "status": cmd_status,
    "tick": cmd_tick,
}


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except Exception:
                pass
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    paths = Paths.default()
    setup_logging(paths, console=args.command != "tick", verbose=args.verbose)
    try:
        return COMMANDS[args.command](paths, args)
    except ConfigError as e:
        say(f"配置文件有问题：{e}")
        return 2
    except (BrowserMissing, LockBusy, service.ServiceError, notify.PushError) as e:
        say(str(e))
        log.warning("%s", e)
        return 1
    except KeyboardInterrupt:
        say("\n已取消。")
        return 130
    except Exception as e:
        log.exception("出错了")
        say(f"出错了：{e.__class__.__name__}: {e}")
        say(f"详细信息已写入 {paths.log_file}")
        return 1
