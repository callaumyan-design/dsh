"""本地成绩记录（SQLite，文件在 data/grades.sqlite3）。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS grades (
    site TEXT NOT NULL,
    course TEXT NOT NULL,
    item_key TEXT NOT NULL,
    item TEXT NOT NULL,
    grade TEXT NOT NULL DEFAULT '',
    out_of TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    first_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (site, course, item_key)
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    site TEXT NOT NULL,
    course TEXT NOT NULL,
    item TEXT NOT NULL,
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    kind TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS baselined_targets (
    target_id TEXT PRIMARY KEY,
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


@dataclass
class StoredGrade:
    site: str
    course: str
    item_key: str
    item: str
    grade: str
    out_of: str
    value: str
    status: str
    link: str
    first_seen: str
    updated_at: str
    last_seen: str


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def transaction(self):
        try:
            yield self.conn
            self.conn.commit()
        except BaseException:
            self.conn.rollback()
            raise

    # -------- 成绩
    def get(self, site: str, course: str, item_key: str) -> StoredGrade | None:
        row = self.conn.execute(
            "SELECT * FROM grades WHERE site=? AND course=? AND item_key=?", (site, course, item_key)
        ).fetchone()
        return StoredGrade(**dict(row)) if row else None

    def all_grades(self) -> list[StoredGrade]:
        rows = self.conn.execute("SELECT * FROM grades ORDER BY site, course, item").fetchall()
        return [StoredGrade(**dict(r)) for r in rows]

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM grades").fetchone()[0]

    def upsert(self, *, site, course, item_key, item, grade, out_of, value, status, link, at: str) -> None:
        self.conn.execute(
            """
            INSERT INTO grades (site, course, item_key, item, grade, out_of, value, status, link,
                                first_seen, updated_at, last_seen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(site, course, item_key) DO UPDATE SET
                item=excluded.item,
                grade=excluded.grade,
                out_of=excluded.out_of,
                status=excluded.status,
                link=CASE WHEN excluded.link != '' THEN excluded.link ELSE grades.link END,
                updated_at=CASE WHEN grades.value != excluded.value THEN excluded.updated_at ELSE grades.updated_at END,
                value=excluded.value,
                last_seen=excluded.last_seen
            """,
            (site, course, item_key, item, grade, out_of, value, status, link, at, at, at),
        )

    def add_history(self, *, site, course, item, old_value, new_value, kind, notified: bool, at: str) -> None:
        self.conn.execute(
            "INSERT INTO history (at, site, course, item, old_value, new_value, kind, notified) VALUES (?,?,?,?,?,?,?,?)",
            (at, site, course, item, old_value, new_value, kind, 1 if notified else 0),
        )

    def recent_history(self, limit: int = 10) -> list[dict]:
        rows = self.conn.execute("SELECT * FROM history ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # -------- 待发送的推送（发送失败会留到下次再发）
    def add_pending(self, payload: dict) -> None:
        self.conn.execute(
            "INSERT INTO pending (created_at, payload) VALUES (?, ?)",
            (now_iso(), json.dumps(payload, ensure_ascii=False)),
        )

    def pending(self) -> list[tuple[int, dict]]:
        rows = self.conn.execute("SELECT id, payload FROM pending ORDER BY id").fetchall()
        return [(r["id"], json.loads(r["payload"])) for r in rows]

    def remove_pending(self, pid: int) -> None:
        with self.transaction():
            self.conn.execute("DELETE FROM pending WHERE id=?", (pid,))

    def bump_pending(self, pid: int) -> None:
        with self.transaction():
            self.conn.execute("UPDATE pending SET attempts = attempts + 1 WHERE id=?", (pid,))

    # -------- 基准
    def baselined(self) -> set[str]:
        return {r[0] for r in self.conn.execute("SELECT target_id FROM baselined_targets")}

    def mark_baselined(self, target_ids, at: str) -> None:
        self.conn.executemany(
            "INSERT OR IGNORE INTO baselined_targets (target_id, at) VALUES (?, ?)",
            [(t, at) for t in target_ids],
        )

    # -------- 状态
    def get_state(self, key: str, default=None):
        row = self.conn.execute("SELECT v FROM state WHERE k=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_state(self, key: str, value) -> None:
        with self.transaction():
            self.conn.execute(
                "INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                (key, json.dumps(value, ensure_ascii=False)),
            )

    def del_state(self, key: str) -> None:
        with self.transaction():
            self.conn.execute("DELETE FROM state WHERE k=?", (key,))
