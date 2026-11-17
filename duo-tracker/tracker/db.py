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
    category_id TEXT,                      -- App：主分类；游戏：子分类（70xx）
    category    TEXT,                      -- 分类中文名
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
);  -- 只在某来源对某 App 的说法发生变化时写入一行（变更日志），未变化的日子不重复写
CREATE INDEX IF NOT EXISTS idx_obs_app ON observations(app_id, run_date);
CREATE INDEX IF NOT EXISTS idx_obs_date ON observations(run_date, source);
CREATE INDEX IF NOT EXISTS idx_obs_key ON observations(app_id, source, source_key, run_date);

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

-- 判定所依据的各来源说法，按内容去重（verdicts.claims_id 引用），避免每天重复存同样的证据
CREATE TABLE IF NOT EXISTS claim_sets (
    id   TEXT PRIMARY KEY,
    body TEXT NOT NULL
);

-- 各追踪站条目的“首次出现 / 最近出现 / 最近状态”，用于新增条目与状态变化；source_items 只保留最近一次运行
CREATE TABLE IF NOT EXISTS source_seen (
    source     TEXT NOT NULL,
    source_key TEXT NOT NULL,
    name       TEXT,
    store_id   TEXT,
    region     TEXT,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    last_raw   TEXT,
    prev_raw   TEXT,                       -- last_seen 之前那次的状态（同日重跑时用来比较）
    prev_seen  TEXT,
    app_id     TEXT,
    match_method TEXT,
    PRIMARY KEY (source, source_key)
);
CREATE TABLE IF NOT EXISTS source_events (
    run_date   TEXT NOT NULL,
    source     TEXT NOT NULL,
    source_key TEXT NOT NULL,
    name       TEXT,
    old_raw    TEXT,
    new_raw    TEXT,
    app_id     TEXT,
    PRIMARY KEY (run_date, source, source_key)
);

-- 每次运行的摘要（各来源成败、Lookup 成功率、榜单规模、备注），日报的“数据源运行情况”从这里读，
-- 这样换一台机器只用 --report-only 重新生成网页时也是完整的
CREATE TABLE IF NOT EXISTS run_summaries (
    run_date TEXT PRIMARY KEY,
    body     TEXT NOT NULL
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
    conn.execute("PRAGMA journal_mode=DELETE")  # 单文件，便于提交到仓库保存历史
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn: sqlite3.Connection):
    """给旧库补列（新增字段时在这里登记）。"""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(apps)")}
    for col in ("category_id", "category"):
        if col not in cols:
            conn.execute(f"ALTER TABLE apps ADD COLUMN {col} TEXT")
    vcols = {r[1] for r in conn.execute("PRAGMA table_info(verdicts)")}
    if "claims_id" not in vcols:
        conn.execute("ALTER TABLE verdicts ADD COLUMN claims_id TEXT")
    conn.commit()


def clear_run(conn: sqlite3.Connection, run_date: str):
    """同一天重复运行时先清掉当天的派生数据，保证幂等。"""
    for t in ("observations", "verdicts", "chart_entries", "top200", "source_items", "runs"):
        conn.execute(f"DELETE FROM {t} WHERE run_date=?", (run_date,))
    conn.execute("DELETE FROM versions WHERE first_seen=?", (run_date,))
    conn.execute("DELETE FROM source_events WHERE run_date=?", (run_date,))
    conn.execute("DELETE FROM source_seen WHERE first_seen=?", (run_date,))
    conn.execute("DELETE FROM run_summaries WHERE run_date=?", (run_date,))
    conn.commit()


def load_claims(conn: sqlite3.Connection, row) -> dict:
    """verdict 行的各来源说法：新数据在 claim_sets，旧数据内联在 claims 列。"""
    keys = row.keys()
    if "claims" in keys and row["claims"]:
        return json.loads(row["claims"])
    if "claims_id" in keys and row["claims_id"]:
        r = conn.execute("SELECT body FROM claim_sets WHERE id=?", (row["claims_id"],)).fetchone()
        if r:
            return json.loads(r[0])
    return {}


def dumps(o) -> str:
    return json.dumps(o, ensure_ascii=False, sort_keys=True)
