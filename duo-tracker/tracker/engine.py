"""一次完整运行：榜单 → 名单 → Lookup/版本 → 关键词 → 官方/第三方观测 → 匹配 → 判定 → 报告。

每个数据源独立 try/except：单个来源失败只记录在 runs 表和日报里，不影响整体。
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import sqlite3
import traceback
from collections import defaultdict
from pathlib import Path

import yaml

from . import db as dbm
from .adapters import TRACKERS
from .adapters import apple
from .adapters import xiaoxinnote as xx
from .http import PoliteClient
from .matching import Matcher, write_unmatched
from .model import (ADAPTED, RAW_STATUS_WEIGHT_FACTOR, SOURCE_WEIGHT, UNKNOWN, WEAK_KEYWORD_WEIGHT,
                    SourceItem, base_name, map_status, norm_name)
from .verdict import Claim, apply_hold, decide, mark_stale, scan_release_notes

log = logging.getLogger("tracker")


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Run:
    def __init__(self, root: Path, cfg: dict, run_date: str, offline: bool = False, only: set[str] | None = None):
        self.root = Path(root)
        self.cfg = cfg
        self.date = run_date
        self.offline = offline
        self.only = only
        p = cfg["paths"]
        self.conn: sqlite3.Connection = dbm.connect(self.root / p["db"])
        h = cfg.get("http", {})
        self.client = PoliteClient(
            self.root / p["raw"], run_date, user_agent=h.get("user_agent"), min_interval=h.get("min_interval", 1.0),
            retries=h.get("retries", 4), backoff=h.get("backoff", 2.0), timeout=h.get("timeout", 30),
            offline=offline, respect_robots=h.get("respect_robots", True),
            robots_exceptions=h.get("robots_exceptions") or {})
        self.regions = cfg.get("regions", ["cn", "us"])
        self.source_status: dict[str, dict] = {}
        self.unmatched: list[dict] = []
        self.notes: list[str] = []
        self._seen_claims: set[tuple[str, str]] = set()

    # ------------------------------------------------------------------ helpers
    def _enabled(self, name: str) -> bool:
        if self.only and name not in self.only:
            return False
        return (self.cfg.get("sources", {}).get(name) or {}).get("enabled", True)

    def _guard(self, source: str, fn, *a, **kw):
        started = now_iso()
        before = dict(self.client.stats.get(source, {}))
        try:
            res = fn(*a, **kw)
            n = len(res) if hasattr(res, "__len__") else None
            self._record(source, started, True, n, None, before)
            return res
        except Exception as e:  # noqa: BLE001 — 单个来源出错不影响整体
            log.error("来源 %s 失败：%s", source, e)
            log.debug(traceback.format_exc())
            self._record(source, started, False, 0, f"{type(e).__name__}: {e}", before)
            return None

    def _record(self, source, started, ok, n, err, before):
        st = self.client.stats.get(source, {})
        reqs = st.get("requests", 0) - before.get("requests", 0)
        self.source_status[source] = {"ok": ok, "n": n, "error": err, "requests": reqs,
                                      "retries": st.get("retries", 0) - before.get("retries", 0)}
        self.conn.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?,?,?,?,?)",
                          (self.date, source, started, now_iso(), int(ok), n, reqs, err))
        self.conn.commit()

    def _load_yaml(self, key):
        p = self.root / self.cfg["paths"][key]
        if not p.exists():
            return {}
        return yaml.safe_load(p.read_text(encoding="utf-8")) or {}

    # ------------------------------------------------------------------ main
    def execute(self) -> dict:
        dbm.clear_run(self.conn, self.date)
        conn = self.conn

        # 1) 苹果榜单
        ch = self.cfg.get("charts", {})
        res = self._guard("apple_charts", apple.fetch_charts, self.client, self.regions, ch.get("use_v2_rss", True),
                          ch.get("legacy_rss", False))
        chart_entries, chart_errors = res if res else ([], ["apple_charts 整体失败"])
        if res and self.source_status.get("apple_charts"):
            self.source_status["apple_charts"]["n"] = len(chart_entries)
        if chart_errors:
            self.notes += [f"榜单失败：{e}" for e in chart_errors]
            if self.source_status.get("apple_charts"):
                self.source_status["apple_charts"]["error"] = "；".join(chart_errors)
        self.notes.append("畅销榜：App Store 网页与新版 RSS 均不提供，旧版 iTunes RSS 被 robots.txt 禁止 → 跳过")

        # 2) 第三方追踪站（先抓取，后匹配）
        tracker_items: dict[str, list[SourceItem]] = {}
        for name, mod in TRACKERS.items():
            if not self._enabled(name):
                continue
            items = self._guard(name, mod.fetch, self.client, dict(self.cfg.get("sources", {}).get(name) or {},
                                                                   regions=self.regions))
            if items is not None:
                tracker_items[name] = items

        # 3) 官方合集
        story_items = []
        for sid in self.cfg.get("official", {}).get("story_ids", []):
            r = self._guard("apple_story", apple.fetch_story, self.client, sid,
                            self.cfg["official"].get("story_regions", ["us"]))
            story_items += r or []

        # 4) 跟踪名单：榜单 Top 200（免费/付费 × 总榜/游戏）∪ watchlist
        members: dict[tuple[str, str], set[str]] = defaultdict(set)   # (app_id, region) -> reasons
        chart_names: dict[str, str] = {}
        for e in chart_entries:
            members[(e.app_id, e.region)].add("chart")
            chart_names.setdefault(e.app_id, e.name)
            conn.execute("INSERT OR REPLACE INTO chart_entries VALUES (?,?,?,?,?)",
                         (self.date, e.region, e.feed, e.rank, e.app_id))
        top_n = int(self.cfg["charts"].get("top_n", 200))
        watch = self._load_yaml("watchlist").get("apps", []) or []
        pending_names = []
        for w in watch:
            regs = w.get("regions") or ["cn"]
            if w.get("id"):
                for r in regs:
                    members[(str(w["id"]), r)].add("watchlist")
            elif w.get("name"):
                pending_names.append((w["name"], regs))
        catalogue = self._name_catalogue(tracker_items, chart_entries)
        for nm, regs in pending_names:
            for r in regs:
                found = self._resolve_name(catalogue, nm, r)
                if found:
                    members[(found, r)].add("watchlist")
                else:
                    self.unmatched.append({"run_date": self.date, "source": "watchlist", "source_key": nm, "name": nm,
                                           "region": r, "reason": "watchlist 名称无法唯一解析（请改填 id）"})

        # 5) iTunes Lookup
        by_region: dict[str, list[str]] = defaultdict(list)
        for (aid, r) in members:
            by_region[r].append(aid)
        lookups: dict[str, dict[str, dict]] = {}
        self.lookup_stats = {}
        for r, ids in by_region.items():
            got = self._guard(f"itunes_lookup_{r}", apple.lookup, self.client, ids, r)
            found, failed_batches = got if got else ({}, -1)
            lookups[r] = found
            self.lookup_stats[r] = {"requested": len(set(ids)), "found": len(found), "failed_batches": failed_batches,
                                    "missing": sorted(set(ids) - set(found))}
        self._upsert_apps(members, lookups, chart_names)

        # 6) Top 200（按地区 × App/游戏，合并名次）
        self._build_top200(chart_entries, top_n)

        # 7) 版本 & 关键词
        self.new_versions = self._record_versions(lookups)

        # 8) 观测：官方 / 更新说明 / 第三方
        apps_index = self._apps_index()
        manual = (self._load_yaml("manual_matches").get("matches") or [])
        matcher = Matcher(apps_index, manual)
        obs = defaultdict(list)  # app_id -> [Claim]
        for it in story_items:
            self._ingest(it, matcher, obs)
        for name, items in tracker_items.items():
            for it in items:
                self._ingest(it, matcher, obs)
        self._keyword_observations(obs, set(apps_index))

        # 9) 判定
        self._verdicts(apps_index, obs)
        conn.commit()
        # 有明确结论的排前面，方便人工优先确认
        self.unmatched.sort(key=lambda r: (r.get("status") in (None, "", UNKNOWN), r.get("source", ""), r.get("name", "")))
        write_unmatched(self.root / self.cfg["paths"]["unmatched"], self.unmatched)
        return {"date": self.date, "sources": self.source_status, "lookup": self.lookup_stats,
                "top_sizes": self.top_sizes,
                "notes": self.notes, "unmatched": len(self.unmatched)}

    # ------------------------------------------------------------------ steps
    @staticmethod
    def _name_catalogue(tracker_items, chart_entries):
        """名称→id 目录：榜单 + 自带 App Store id 的追踪站条目（iTunes Search 被 robots.txt 禁止，故不用）。"""
        cat = defaultdict(set)  # (region, key) -> ids
        for e in chart_entries:
            if e.name:
                for k in {norm_name(e.name), base_name(e.name)}:
                    cat[(e.region, k)].add(e.app_id)
        for items in tracker_items.values():
            for it in items:
                if not it.store_id or not it.region:
                    continue
                for n in [it.name, *it.alt_names]:
                    for k in {norm_name(n), base_name(n)}:
                        cat[(it.region, k)].add(it.store_id)
        return cat

    @staticmethod
    def _resolve_name(catalogue, name: str, region: str) -> str | None:
        for k in (norm_name(name), base_name(name)):
            ids = catalogue.get((region, k), set())
            if len(ids) == 1:
                return next(iter(ids))
        return None

    def _upsert_apps(self, members, lookups, chart_names):
        conn = self.conn
        per_app_regions = defaultdict(set)
        per_app_reasons = defaultdict(set)
        for (aid, r), reasons in members.items():
            if aid in lookups.get(r, {}):
                per_app_regions[aid].add(r)
            per_app_reasons[aid] |= reasons
        for aid in set(a for a, _ in members):
            cur = conn.execute("SELECT * FROM apps WHERE app_id=?", (aid,)).fetchone()
            row = dict(cur) if cur else {"app_id": aid, "first_seen": self.date, "regions": ""}
            regs = set(filter(None, (row.get("regions") or "").split(","))) | per_app_regions[aid]
            for r in per_app_regions[aid]:
                res = lookups[r][aid]
                row[f"name_{r}"] = res.get("trackName")
                row["bundle_id"] = res.get("bundleId") or row.get("bundle_id")
                row["developer"] = res.get("artistName") or row.get("developer")
                row["genre"] = res.get("primaryGenreName") or row.get("genre")
                row["is_game"] = int(apple.is_game(res))
            row["name"] = row.get("name_cn") or row.get("name_us") or row.get("name") or chart_names.get(aid) or aid
            row["regions"] = ",".join(sorted(regs))
            row["track_reason"] = ",".join(sorted(per_app_reasons[aid]))
            row["last_seen"] = self.date
            cols = ["app_id", "bundle_id", "name", "name_cn", "name_us", "developer", "genre", "is_game", "regions",
                    "track_reason", "first_seen", "last_seen"]
            conn.execute(f"INSERT OR REPLACE INTO apps ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                         [row.get(c) for c in cols])
        self.today_members = {aid: per_app_regions[aid] for aid in set(a for a, _ in members) if per_app_regions[aid]}
        conn.commit()

    def _build_top200(self, entries, top_n):
        """Top N：按 地区 × 榜单(免费/付费) × 类型。App = 总榜(36)去掉游戏后的名次；游戏 = 游戏榜(6014)。
        网页榜单失败时退回新版 RSS（最多 100 名，总榜口径）。"""
        kind_of = {r["app_id"]: ("game" if r["is_game"] else "app")
                   for r in self.conn.execute("SELECT app_id,is_game FROM apps")}
        lists: dict[tuple[str, str, str], list[str]] = defaultdict(list)
        have_web = {(e.region, e.feed.split(":")[2]) for e in entries if e.feed.startswith("web:")}
        for e in sorted(entries, key=lambda e: (e.region, e.feed, e.rank)):
            if e.app_id not in self.today_members or e.region not in self.today_members[e.app_id]:
                continue
            parts = e.feed.split(":")
            if parts[0] == "web":
                genre, chart = parts[1], parts[2]
                if genre == apple.GAMES_GENRE:
                    kinds = ["game"]
                else:
                    kinds = ["app"] if kind_of.get(e.app_id) == "app" else []
            elif parts[0] == "v2" and (e.region, parts[1]) not in have_web:
                chart = parts[1]
                kinds = [kind_of.get(e.app_id, "app")]
            else:
                continue
            for k in kinds:
                lst = lists[(e.region, chart, k)]
                if e.app_id not in lst:
                    lst.append(e.app_id)
        self.top_sizes = {}
        for (region, chart, kind), ids in lists.items():
            ids = ids[:top_n]
            self.top_sizes[f"{region}:{chart}:{kind}"] = len(ids)
            for i, aid in enumerate(ids, start=1):
                self.conn.execute("INSERT INTO top200 VALUES (?,?,?,?,?,?)", (self.date, region, kind, chart, i, aid))
        self.conn.commit()

    def _record_versions(self, lookups):
        conn = self.conn
        new = []
        for r, found in lookups.items():
            for aid, res in found.items():
                ver = res.get("version")
                if not ver:
                    continue
                exists = conn.execute("SELECT 1 FROM versions WHERE app_id=? AND region=? AND version=?",
                                      (aid, r, ver)).fetchone()
                if exists:
                    continue
                had_any = conn.execute("SELECT 1 FROM versions WHERE app_id=? AND region=? AND first_seen<?",
                                       (aid, r, self.date)).fetchone()
                hits = scan_release_notes(res.get("releaseNotes"))
                conn.execute("INSERT INTO versions VALUES (?,?,?,?,?,?,?,?)",
                             (aid, r, ver, res.get("currentVersionReleaseDate"), res.get("releaseNotes"), self.date,
                              dbm.dumps(hits), 0 if had_any else 1))
                if had_any:
                    new.append((aid, r, ver))
        conn.commit()
        return new

    def _apps_index(self):
        idx = {}
        aliases = defaultdict(set)
        for aid, regs in self.today_members.items():
            row = self.conn.execute("SELECT * FROM apps WHERE app_id=?", (aid,)).fetchone()
            names = {row["name_cn"], row["name_us"], row["name"]} - {None, ""}
            idx[aid] = {"names": sorted(names | aliases[aid]), "regions": set(regs), "bundle_id": row["bundle_id"]}
        return idx

    def _ingest(self, it: SourceItem, matcher: Matcher, obs):
        m = matcher.match(it)
        app_id = m.app_ids[0] if len(m.app_ids) == 1 else None
        self.conn.execute(
            "INSERT OR REPLACE INTO source_items VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (self.date, it.source, it.key, it.name, it.store_id, it.region, it.raw_status, it.status,
             ",".join(m.app_ids) or None, m.method,
             dbm.dumps({"evidence": it.evidence, "url": it.url, "votes": it.votes, "observed_at": it.observed_at,
                        "alt_names": it.alt_names, "extra": it.extra})))
        if m.method in ("ambiguous", "no_candidate") and not it.store_id:
            self.unmatched.append({"run_date": self.date, "source": it.source, "source_key": it.key, "name": it.name,
                                   "alt_names": "|".join(it.alt_names), "region": it.region or "",
                                   "raw_status": it.raw_status, "status": it.status, "reason": m.method,
                                   "candidates": "|".join(m.candidates or []), "url": it.url})
        if not m.app_ids:
            return
        weight = SOURCE_WEIGHT.get(it.source, 10) * it.weight_factor
        weight *= RAW_STATUS_WEIGHT_FACTOR.get((it.source, it.raw_status), 1.0)
        disputed_votes = False
        if it.source == "shipeiduo_submission" and it.votes is not None:
            net = it.votes.get("net", 0)
            if net <= 0:
                disputed_votes, weight = True, 0
            else:
                weight = 5 + min(net, 10)  # 1 票净赞成 = 6，封顶 15，始终低于站点级证据
        for aid in m.app_ids:
            # 同一来源对同一 App 只计一次（例如同一 id 同时出现在该站国区与美区目录里）；投稿逐条计
            if it.source != "shipeiduo_submission":
                if (it.source, aid) in self._seen_claims:
                    continue
                self._seen_claims.add((it.source, aid))
            claim = Claim(it.source, it.status, weight, it.raw_status, it.evidence, it.url, it.votes, disputed_votes,
                          it.observed_at)
            obs[aid].append(claim)
            self.conn.execute(
                "INSERT INTO observations (run_date,app_id,source,source_key,status,raw_status,evidence,url,votes,weight,"
                "match_method,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.date, aid, it.source, it.key, it.status, it.raw_status, it.evidence, it.url,
                 dbm.dumps(it.votes) if it.votes else None, weight, m.method, it.observed_at or self.date))

    def _keyword_observations(self, obs, tracked: set[str]):
        """历史上任一版本的更新说明命中关键词 → 「官方疑似适配」观测（证据指向命中的那个版本）。"""
        rows = self.conn.execute("SELECT app_id,region,version,release_date,keyword_hits FROM versions "
                                 "WHERE keyword_hits LIKE '%\"strong\": [\"%' OR keyword_hits LIKE '%\"weak\": [\"%' "
                                 "ORDER BY release_date DESC").fetchall()
        best: dict[str, tuple[bool, sqlite3.Row, dict]] = {}
        for r in rows:  # 按发布日期倒序：同强度取最新版本
            aid = r["app_id"]
            if aid not in tracked:
                continue
            hits = json.loads(r["keyword_hits"])
            strong = bool(hits.get("strong"))
            if aid not in best or (strong and not best[aid][0]):
                best[aid] = (strong, r, hits)
        for aid, (strong, r, hits) in best.items():
            raw = "strong_hit" if strong else "weak_hit"
            w = SOURCE_WEIGHT["release_notes"] if strong else WEAK_KEYWORD_WEIGHT
            kws = hits.get("strong", []) + hits.get("weak", [])
            ev = f"{r['region']} v{r['version']} 更新说明命中：{'、'.join(kws)}｜" + " … ".join(hits.get("snippets", [])[:2])
            url = f"https://apps.apple.com/{r['region']}/app/id{aid}"
            claim = Claim("release_notes", map_status("release_notes", raw), w, raw, ev[:500], url,
                          observed_at=r["release_date"])
            obs[aid].append(claim)
            self.conn.execute(
                "INSERT INTO observations (run_date,app_id,source,source_key,status,raw_status,evidence,url,votes,weight,"
                "match_method,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.date, aid, "release_notes", f"{r['region']}:{r['version']}", claim.status, raw, claim.evidence,
                 url, None, w, "trackId", r["release_date"]))

    def _version_sig(self, aid: str) -> str:
        rows = self.conn.execute(
            "SELECT region, version FROM versions v WHERE app_id=? AND first_seen=(SELECT MAX(first_seen) FROM versions "
            "WHERE app_id=v.app_id AND region=v.region) ORDER BY region", (aid,)).fetchall()
        return ";".join(f"{r['region']}:{r['version']}" for r in rows)

    def _verdicts(self, apps_index, obs):
        conn = self.conn
        for aid in apps_index:
            claims = obs.get(aid, [])
            rel = conn.execute("SELECT MAX(release_date) FROM versions v WHERE app_id=? AND first_seen=(SELECT MAX(first_seen) "
                               "FROM versions WHERE app_id=v.app_id AND region=v.region)", (aid,)).fetchone()[0]
            mark_stale(claims, rel)
            v = decide(claims)
            prev = conn.execute("SELECT * FROM verdicts WHERE app_id=? AND run_date<? ORDER BY run_date DESC LIMIT 1",
                                (aid, self.date)).fetchone()
            sig = self._version_sig(aid)
            h = apply_hold(v, dict(prev) if prev else None, sig)
            conn.execute(
                "INSERT INTO verdicts (run_date,app_id,status,confidence,score,prev_status,changed,held,proposed_status,"
                "status_version,current_version,claims) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.date, aid, h["status"], ("held" if h["held"] else v.confidence), v.score, h["prev"], h["changed"],
                 h["held"], h["proposed"], h["status_version"], sig,
                 dbm.dumps({"reason": v.reason, "proposed": v.status, "claims": [c.as_dict() for c in claims]})))


def load_config(root: Path) -> dict:
    return yaml.safe_load((Path(root) / "config.yaml").read_text(encoding="utf-8"))
