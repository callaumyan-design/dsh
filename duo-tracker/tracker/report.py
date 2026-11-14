"""生成 HTML 报告：每日日报、全量状态总表、历史时间线（均为单文件 HTML，浏览器直接打开）。

reports/<date>/daily.html   当日日报（①新版本 ②状态变化 ③追踪站新增 ④争议 ⑤整体进度+趋势）
reports/<date>/all.html     当日全量总表（按状态/类型/地区筛选）
reports/<date>/status.csv   当日全量总表 CSV
reports/timeline.html       历史时间线（所有日期的状态变化）
reports/index.html          指向最新日报
"""
from __future__ import annotations

import csv
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from . import db as dbm
from .model import ADAPTED, SOURCE_LABEL, STATUS_LABEL

TEMPLATES = Path(__file__).parent / "templates"
CONF_LABEL = {
    "official": "官方合集", "release_notes": "更新说明明确提及", "multi_source": "多站一致",
    "single_source": "单个站点", "submission": "网友投稿", "conflict": "来源冲突", "held": "无新版本·维持",
    "suspected": "疑似（弱关键词）", "release_notes_weak": "更新说明弱命中", "none": "无证据",
}
REGION_LABEL = {"cn": "中国", "us": "美国"}
CHART_LABEL = {"top-free": "免费榜", "top-paid": "付费榜"}
KIND_LABEL = {"app": "App", "game": "游戏"}


def _env():
    env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape(["html", "j2"]))
    env.globals.update(STATUS_LABEL=STATUS_LABEL, SOURCE_LABEL=SOURCE_LABEL, CONF_LABEL=CONF_LABEL,
                       REGION_LABEL=REGION_LABEL, CHART_LABEL=CHART_LABEL, KIND_LABEL=KIND_LABEL)
    env.filters["tojson_safe"] = lambda o: Markup(json.dumps(o, ensure_ascii=False).replace("</", "<\\/"))
    return env


def _claims(row) -> dict:
    try:
        return json.loads(row["claims"] or "{}")
    except (TypeError, ValueError):
        return {}


def _app_rows(conn, date):
    rows = conn.execute("""
        SELECT a.*, v.status, v.confidence, v.prev_status, v.changed, v.held, v.proposed_status, v.claims,
               v.current_version, v.score
        FROM verdicts v JOIN apps a USING(app_id) WHERE v.run_date=?""", (date,)).fetchall()
    ranks = defaultdict(dict)
    for r in conn.execute("SELECT * FROM top200 WHERE run_date=?", (date,)):
        ranks[r["app_id"]][f"{r['region']}:{r['chart']}"] = r["rank"]
    out = []
    for r in rows:
        c = _claims(r)
        out.append({
            "id": r["app_id"], "name": r["name"], "name_cn": r["name_cn"], "name_us": r["name_us"],
            "developer": r["developer"], "genre": r["genre"], "kind": "game" if r["is_game"] else "app",
            "regions": (r["regions"] or "").split(","), "status": r["status"], "confidence": r["confidence"],
            "prev": r["prev_status"], "changed": r["changed"], "held": r["held"], "proposed": r["proposed_status"],
            "version": r["current_version"], "ranks": ranks.get(r["app_id"], {}), "reason": c.get("reason", ""),
            "claims": [x for x in c.get("claims", [])],
            "track": r["track_reason"],
        })
    return out


def _progress(conn):
    """每个日期、地区、榜单、类型的 Top200 已适配占比。"""
    q = """SELECT t.run_date, t.region, t.chart, t.kind, COUNT(*) n,
                  SUM(CASE WHEN v.status IN ('perfect','full','partial') THEN 1 ELSE 0 END) adapted,
                  SUM(CASE WHEN v.status='perfect' THEN 1 ELSE 0 END) perfect,
                  SUM(CASE WHEN v.status='full' THEN 1 ELSE 0 END) full_,
                  SUM(CASE WHEN v.status='partial' THEN 1 ELSE 0 END) partial,
                  SUM(CASE WHEN v.status='none' THEN 1 ELSE 0 END) none_,
                  SUM(CASE WHEN v.status='disputed' THEN 1 ELSE 0 END) disputed,
                  SUM(CASE WHEN v.status='unknown' OR v.status IS NULL THEN 1 ELSE 0 END) unknown
           FROM top200 t LEFT JOIN verdicts v ON v.app_id=t.app_id AND v.run_date=t.run_date
           GROUP BY 1,2,3,4 ORDER BY 1"""
    return [dict(r) for r in conn.execute(q)]


def build(root: Path, cfg: dict, date: str) -> dict:
    root = Path(root)
    conn = dbm.connect(root / cfg["paths"]["db"])
    out_dir = root / cfg["paths"]["reports"] / date
    out_dir.mkdir(parents=True, exist_ok=True)
    env = _env()

    apps = _app_rows(conn, date)
    by_id = {a["id"]: a for a in apps}
    summary_p = out_dir / "run_summary.json"
    summary = json.loads(summary_p.read_text(encoding="utf-8")) if summary_p.exists() else {}
    prev_date = conn.execute("SELECT MAX(run_date) FROM verdicts WHERE run_date<?", (date,)).fetchone()[0]

    # ① 今日新版本（首次运行时为基线，不算新版本）
    vers = conn.execute("""SELECT v.*, a.name, a.is_game FROM versions v JOIN apps a USING(app_id)
                           WHERE v.first_seen=? ORDER BY v.release_date DESC""", (date,)).fetchall()
    new_versions, baseline_hits = [], []
    n_baseline = 0
    for v in vers:
        hits = json.loads(v["keyword_hits"] or "{}")
        item = {"id": v["app_id"], "name": v["name"], "region": v["region"], "version": v["version"],
                "release_date": (v["release_date"] or "")[:10], "notes": (v["release_notes"] or "")[:600],
                "strong": hits.get("strong", []), "weak": hits.get("weak", []),
                "kind": "game" if v["is_game"] else "app", "status": by_id.get(v["app_id"], {}).get("status")}
        if v["is_baseline"]:
            n_baseline += 1
            if item["strong"]:
                baseline_hits.append(item)
        else:
            new_versions.append(item)
    new_versions.sort(key=lambda x: (not x["strong"], not x["weak"], x["name"]))

    # ② 状态变化 / 维持
    changes = [a for a in apps if a["changed"]]
    held = [a for a in apps if a["held"] and a["proposed"] and a["proposed"] != "unknown"]

    # ③ 各追踪站新增条目 / 新增投稿
    new_items, baseline_sources = defaultdict(list), {}
    for src in [r[0] for r in conn.execute("SELECT DISTINCT source FROM source_items WHERE run_date=?", (date,))]:
        had = conn.execute("SELECT 1 FROM source_items WHERE source=? AND run_date<? LIMIT 1", (src, date)).fetchone()
        if not had:
            baseline_sources[src] = conn.execute("SELECT COUNT(*) FROM source_items WHERE source=? AND run_date=?",
                                                 (src, date)).fetchone()[0]
            continue
        rows = conn.execute("""SELECT s.* FROM source_items s WHERE s.source=? AND s.run_date=? AND NOT EXISTS
                               (SELECT 1 FROM source_items p WHERE p.source=s.source AND p.source_key=s.source_key
                                AND p.run_date<?)""", (src, date, date)).fetchall()
        for r in rows:
            p = json.loads(r["payload"] or "{}")
            new_items[src].append({"name": r["name"], "status": r["status"], "raw": r["raw_status"],
                                   "app_id": r["app_id"], "match": r["match_method"], "url": p.get("url"),
                                   "evidence": p.get("evidence"), "votes": p.get("votes")})
    status_moves = defaultdict(list)  # 已有条目的原始状态变化
    if prev_date:
        for r in conn.execute("""SELECT s.source, s.name, s.raw_status cur, p.raw_status old, s.app_id FROM source_items s
                                 JOIN source_items p ON p.source=s.source AND p.source_key=s.source_key AND p.run_date=?
                                 WHERE s.run_date=? AND IFNULL(s.raw_status,'')<>IFNULL(p.raw_status,'')""",
                              (prev_date, date)):
            status_moves[r["source"]].append(dict(r))

    # ④ 争议
    disputed = [a for a in apps if a["status"] == "disputed"]

    # ⑤ 整体进度
    progress = _progress(conn)
    today_prog = [p for p in progress if p["run_date"] == date]

    sources = summary.get("sources", {})
    lookup = summary.get("lookup", {})
    unmatched_n = summary.get("unmatched")
    ctx = dict(date=date, prev_date=prev_date, apps=apps, new_versions=new_versions, n_baseline=n_baseline,
               baseline_hits=baseline_hits, changes=changes, held=held, new_items=dict(new_items),
               baseline_sources=baseline_sources, status_moves=dict(status_moves), disputed=disputed,
               today_prog=today_prog, progress=progress, sources=sources, lookup=lookup, notes=summary.get("notes", []),
               unmatched_n=unmatched_n, top_sizes=summary.get("top_sizes", {}), n_apps=len(apps),
               adapted_n=sum(1 for a in apps if a["status"] in ADAPTED))
    (out_dir / "daily.html").write_text(env.get_template("daily.html.j2").render(**ctx), encoding="utf-8")
    (out_dir / "all.html").write_text(env.get_template("all.html.j2").render(**ctx), encoding="utf-8")
    _write_csv(out_dir / "status.csv", apps)

    # 历史时间线
    tl = conn.execute("""SELECT v.run_date, v.app_id, v.status, v.prev_status, v.changed, v.held, v.proposed_status,
                                v.confidence, v.claims, a.name, a.is_game, a.regions
                         FROM verdicts v JOIN apps a USING(app_id)
                         WHERE v.changed=1 OR (v.held=1 AND v.proposed_status IS NOT NULL AND v.proposed_status<>'unknown')
                         ORDER BY v.run_date DESC, a.name""").fetchall()
    first = conn.execute("""SELECT run_date, COUNT(*) n, SUM(CASE WHEN status IN ('perfect','full','partial') THEN 1 ELSE 0 END) ad
                            FROM verdicts GROUP BY run_date ORDER BY run_date""").fetchall()
    events = defaultdict(list)
    for r in tl:
        c = _claims(r)
        events[r["run_date"]].append({"id": r["app_id"], "name": r["name"], "status": r["status"], "prev": r["prev_status"],
                                      "held": r["held"], "proposed": r["proposed_status"], "confidence": r["confidence"],
                                      "kind": "game" if r["is_game"] else "app", "regions": r["regions"],
                                      "claims": c.get("claims", [])})
    vtl = conn.execute("""SELECT first_seen d, COUNT(*) n, SUM(CASE WHEN keyword_hits LIKE '%"strong": ["%' THEN 1 ELSE 0 END) hits
                          FROM versions WHERE is_baseline=0 GROUP BY 1""").fetchall()
    tl_ctx = dict(events=dict(events), days=[dict(r) for r in first], versions={r["d"]: dict(r) for r in vtl},
                  latest=date, progress=progress)
    rep_root = root / cfg["paths"]["reports"]
    (rep_root / "timeline.html").write_text(env.get_template("timeline.html.j2").render(**tl_ctx), encoding="utf-8")
    latest = sorted(p.name for p in rep_root.iterdir() if p.is_dir() and (p / "daily.html").exists())[-1]
    (rep_root / "index.html").write_text(
        f'<!doctype html><meta charset="utf-8"><title>Duo 适配日报</title>'
        f'<meta http-equiv="refresh" content="0; url={latest}/daily.html"><a href="{latest}/daily.html">最新日报</a>',
        encoding="utf-8")
    return {"daily": str(out_dir / "daily.html"), "all": str(out_dir / "all.html"),
            "timeline": str(rep_root / "timeline.html")}


def _write_csv(path: Path, apps: list[dict]):
    cols = ["id", "name", "name_cn", "name_us", "kind", "regions", "status", "confidence", "version", "ranks",
            "reason", "sources"]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for a in sorted(apps, key=lambda a: a["name"] or ""):
            srcs = "; ".join(f"{c['source']}={c['status']}" for c in a["claims"] if c.get("status") != "unknown")
            w.writerow([a["id"], a["name"], a["name_cn"], a["name_us"], a["kind"], ",".join(a["regions"]), a["status"],
                        a["confidence"], a["version"], json.dumps(a["ranks"]), a["reason"], srcs])
