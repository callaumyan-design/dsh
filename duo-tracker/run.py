#!/usr/bin/env python3
"""iPhone Duo App 适配进度追踪器 — 入口。

    python run.py --date today                # 跑一次（抓取 + 判定 + 生成报告）
    python run.py --date 2026-11-14 --offline # 只用 raw/ 缓存重新解析（不发请求）
    python run.py --report-only --date today  # 只重新生成报告
    python run.py --schedule                  # 常驻，每天按 config.yaml 的 schedule.time 运行
    python run.py --only shipeiduo,duotoday   # 只跑部分第三方来源（苹果数据源总会运行）
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tracker.engine import Run, load_config  # noqa: E402
from tracker import report  # noqa: E402


def resolve_date(s: str, tz: str) -> str:
    if s in ("today", None):
        return dt.datetime.now(ZoneInfo(tz)).date().isoformat()
    if s == "yesterday":
        return (dt.datetime.now(ZoneInfo(tz)).date() - dt.timedelta(days=1)).isoformat()
    return dt.date.fromisoformat(s).isoformat()


def run_once(cfg, date, offline=False, only=None, report_only=False):
    if not report_only:
        summary = Run(ROOT, cfg, date, offline=offline, only=only).execute()
        (ROOT / cfg["paths"]["reports"] / date).mkdir(parents=True, exist_ok=True)
        (ROOT / cfg["paths"]["reports"] / date / "run_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    out = report.build(ROOT, cfg, date)
    logging.info("日报：%s", out["daily"])
    return out


def schedule_loop(cfg):
    tz = cfg.get("schedule", {}).get("timezone", "Asia/Shanghai")
    hh, mm = map(int, cfg.get("schedule", {}).get("time", "09:30").split(":"))
    while True:
        now = dt.datetime.now(ZoneInfo(tz))
        nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if nxt <= now:
            nxt += dt.timedelta(days=1)
        logging.info("下一次运行：%s", nxt.isoformat())
        time.sleep((nxt - now).total_seconds())
        try:
            run_once(cfg, nxt.date().isoformat())
        except Exception:  # noqa: BLE001
            logging.exception("本次运行失败，等待下一次")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default="today")
    ap.add_argument("--offline", action="store_true", help="只读 raw/ 缓存，不发网络请求")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--schedule", action="store_true")
    ap.add_argument("--only", help="逗号分隔的第三方来源名")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    cfg = load_config(ROOT)
    if a.schedule:
        schedule_loop(cfg)
        return
    date = resolve_date(a.date, cfg.get("schedule", {}).get("timezone", "Asia/Shanghai"))
    only = set(a.only.split(",")) if a.only else None
    run_once(cfg, date, offline=a.offline, only=only, report_only=a.report_only)


if __name__ == "__main__":
    main()
