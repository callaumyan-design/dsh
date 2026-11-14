"""SQLite 存储。核心四表：apps / versions / observations / verdicts（保留完整历史）。
辅助表：chart_entries（每日榜单）、source_items（各站每日原始条目，用于“新增条目”）、runs（运行日志）。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS apps (
    app_id      TEXT PRIMARY KEY,          -- App Store trackId
    bundle_id   TEXT,
    name        TEXT,                      -- 首选显示名（中国区优先）
    name_cn     TEXT,
    name_us     TEXT,
    developer   TEXT,
    genre       TEXT,
    is_game     INTEGER DEFAULT 0,
    regions     TEXT,                      -- 逗号分隔：cn,us
    track_reason TEXT,                     -- chart / watchlist
    first_seen  TEXT,
    last_seen   TEXT
);
CREATE INDEX IF NOT EXISTS idx_apps_bundle ON apps(bundle_id);

CREATE TABLE IF NOT EXISTS versions (
    app_id        TEXT NOT NULL,
    region        TEXT NOT NULL,
    version       TEXT NOT NULL,
    release_date  TEXT,                    -- currentVersionReleaseDate
    release_notes TEXT,
    first_seen    TEXT NOT NULL,           -- 本工具首次观测到该版本的日期
    keyword_hits  TEXT,                    -- JSON 数组
    is_baseline   INTEGER DEFAULT 0,       -- 首次建档时的版本（不算“新版本”）
    PRIMARY KEY (app_id, region, version)
);

CREATE TABLE IF NOT EXISTS observations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date    TEXT NOT NULL,
    app_id      TEXT NOT NULL,
    source      TEXT NOT NULL,
    source_key  TEXT,
    status      TEXT NOT NULL,             -- 统一状态
    raw_status  TEXT,
    evidence    TEXT,                      -- 原文摘录
    url         TEXT,                      -- 证据链接
    votes       TEXT,                      -- JSON（若有）
    weight      REAL,
    match_method TEXT,                     -- trackId / bundleId / name / manual
    observed_at TEXT                       -- 来源给出的时间，缺省为 run_date
);
CREATE INDEX IF NOT EXISTS idx_obs_app ON observations(app_id, run_date);
CREATE INDEX IF NOT EXISTS idx_obs_date ON observations(run_date, source);

CREATE TABLE IF NOT EXISTS verdicts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date        TEXT NOT NULL,
    app_id          TEXT NOT NULL,
    status          TEXT NOT NULL,         -- perfect/full/partial/none/unknown/disputed
    confidence      TEXT,                  -- official/release_notes/multi_source/single_source/submission/none
    score           REAL,
    prev_status     TEXT,
    changed         INTEGER DEFAULT 0,
    held            INTEGER DEFAULT 0,     -- 证据变了但无新版本，维持原判定
    proposed_status TEXT,                  -- held 时证据给出的状态
    status_version  TEXT,                  -- 当前判定确立时的 App 版本
    current_version TEXT,
    claims          TEXT,                  -- JSON：各来源说法
    UNIQUE(run_date, app_id)
);

CREATE TABLE IF NOT EXISTS chart_entries (
    run_date TEXT NOT NULL,
    region   TEXT NOT NULL,
    feed     TEXT NOT NULL,                -- web:<genre>:<chart> / v2:<chart> / legacy:<chart>:<all|games>
    rank     INTEGER NOT NULL,
    app_id   TEXT NOT NULL,
    PRIMARY KEY (run_date, region, feed, rank)
);

CREATE TABLE IF NOT EXISTS top200 (
    run_date TEXT NOT NULL,
    region   TEXT NOT NULL,
    kind     TEXT NOT NULL,                -- app / game
    chart    TEXT NOT NULL,                -- top-free / top-paid
    rank     INTEGER NOT NULL,             -- App：总榜去掉游戏后的名次；游戏：游戏榜名次
    app_id   TEXT NOT NULL,
    PRIMARY KEY (run_date, region, kind, chart, rank)
);

CREATE TABLE IF NOT EXISTS source_items (
    run_date   TEXT NOT NULL,
    source     TEXT NOT NULL,
    source_key TEXT NOT NULL,
    name       TEXT,
    store_id   TEXT,
    region     TEXT,
    raw_status TEXT,
    status     TEXT,
    app_id     TEXT,                       -- 匹配到的跟踪 App（可空）
    match_method TEXT,
    payload    TEXT,                       -- JSON
    PRIMARY KEY (run_date, source, source_key)
);

CREATE TABLE IF NOT EXISTS runs (
    run_date    TEXT NOT NULL,
    source      TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT,
    ok          INTEGER,
    n_items     INTEGER,
    requests    INTEGER,
    error       TEXT,
    PRIMARY KEY (run_date, source)
);
"""


def connect(path: Path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def clear_run(conn: sqlite3.Connection, run_date: str):
    """同一天重复运行时先清掉当天的派生数据，保证幂等。"""
    for t in ("observations", "verdicts", "chart_entries", "top200", "source_items", "runs"):
        conn.execute(f"DELETE FROM {t} WHERE run_date=?", (run_date,))
    conn.execute("DELETE FROM versions WHERE first_seen=?", (run_date,))
    conn.commit()


def dumps(o) -> str:
    return json.dumps(o, ensure_ascii=False, sort_keys=True)
