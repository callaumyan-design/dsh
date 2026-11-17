"""决定什么时候查询：随机间隔、出错退避、免打扰时段。

定时任务每隔几分钟把程序叫醒一次（`uqgrades tick`），程序自己判断这次该不该查。
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from .config import ScheduleConfig, parse_quiet_hours


def in_quiet_hours(now: datetime, quiet_hours: str) -> bool:
    minute = now.hour * 60 + now.minute
    for start, end in parse_quiet_hours(quiet_hours):
        if start < end:
            if start <= minute < end:
                return True
        elif minute >= start or minute < end:  # 跨午夜，例如 23:00-07:00
            return True
    return False


def next_delay_minutes(cfg: ScheduleConfig, failures: int, rng: random.Random | None = None) -> float:
    """正常：在 [min, max] 之间随机。连续失败 n 次：随机值 × 2^n，但不超过 max_backoff。"""
    rng = rng or random.Random()
    base = rng.uniform(cfg.min_interval_minutes, cfg.max_interval_minutes)
    if failures <= 0:
        return base
    delay = base * (2 ** min(failures, 10))
    cap = cfg.max_backoff_minutes
    if delay >= cap:
        # 到了上限也带一点随机，避免每次都在同一时刻
        delay = rng.uniform(cap * 0.85, cap)
    return delay


def next_run_after(now: datetime, cfg: ScheduleConfig, failures: int, rng: random.Random | None = None) -> datetime:
    return now + timedelta(minutes=next_delay_minutes(cfg, failures, rng))


def should_run(now: datetime, cfg: ScheduleConfig, next_run_at: datetime | None) -> tuple[bool, str]:
    if in_quiet_hours(now, cfg.quiet_hours):
        return False, "免打扰时段"
    if next_run_at is not None and now < next_run_at:
        return False, f"还没到下次查询时间（{next_run_at:%H:%M}）"
    return True, ""
