"""把各来源条目匹配到跟踪名单里的 App。

优先级：trackId（App Store id）> bundleId > 名称模糊匹配。
- 名称匹配：NFKC 去全/半角差异、去空格与符号、去「-」「:」等后的副标题；中英文名、别名都参与。
- 来源有地区时先在该地区的 App 里找；候选不唯一 → 记为 ambiguous，进 unmatched.csv，不强行合并。
- 来源条目自带 App Store id 但不在跟踪名单 → 视为“未跟踪”，不再做名称兜底（不同区的 id 是不同 App）。
- 来源无地区、且候选恰好是不同地区各一个时（例如同一游戏的国区/美区版本），这条区域无关的说法分别记到各区 App 上。
- manual_matches.yaml 可人工指定 {source, name} → app_id，或 ignore。
"""
from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .model import SourceItem, name_keys


@dataclass
class MatchResult:
    app_ids: list[str]
    method: str          # trackId / bundleId / name / name_multi_region / manual / untracked / ambiguous / no_candidate / ignored
    candidates: list[str] | None = None


class Matcher:
    def __init__(self, apps: dict[str, dict], manual: list[dict] | None = None):
        """apps: {app_id: {"names": [...], "regions": {...}, "bundle_id": str|None}}"""
        self.apps = apps
        self.by_bundle: dict[str, list[str]] = defaultdict(list)
        self.by_name: dict[str, set[str]] = defaultdict(set)
        for aid, a in apps.items():
            if a.get("bundle_id"):
                self.by_bundle[a["bundle_id"].lower()].append(aid)
            for n in a.get("names", []):
                for k in name_keys(n):
                    if len(k) >= 2:
                        self.by_name[k].add(aid)
        self.manual = {}
        for m in manual or []:
            self.manual[(m.get("source"), (m.get("name") or "").strip())] = m

    def match(self, it: SourceItem) -> MatchResult:
        m = self.manual.get((it.source, it.name.strip())) or self.manual.get((None, it.name.strip()))
        if m:
            if m.get("ignore"):
                return MatchResult([], "ignored")
            return MatchResult([str(m["app_id"])], "manual")
        if it.store_id:
            if it.store_id in self.apps:
                return MatchResult([it.store_id], "trackId")
            return MatchResult([], "untracked")
        if it.bundle_id and it.bundle_id.lower() in self.by_bundle:
            ids = self.by_bundle[it.bundle_id.lower()]
            return MatchResult(ids[:1], "bundleId") if len(ids) == 1 else MatchResult([], "ambiguous", ids)
        cands: set[str] = set()
        for n in [it.name, *it.alt_names]:
            for k in name_keys(n):
                cands |= self.by_name.get(k, set())
        if not cands:
            return MatchResult([], "no_candidate")
        if it.region:
            regional = {c for c in cands if it.region in self.apps[c]["regions"]}
            if len(regional) == 1:
                return MatchResult(sorted(regional), "name")
            if len(regional) > 1:
                return MatchResult([], "ambiguous", sorted(regional))
            # 该地区没有候选：不跨区套用（例如美区站点的说法不套到国区独立版本上）
            return MatchResult([], "no_candidate", sorted(cands))
        if len(cands) == 1:
            return MatchResult(sorted(cands), "name")
        per_region = defaultdict(list)
        for c in cands:
            for r in self.apps[c]["regions"]:
                per_region[r].append(c)
        if all(len(v) == 1 for v in per_region.values()) and len(cands) == len(per_region):
            return MatchResult(sorted(cands), "name_multi_region")
        return MatchResult([], "ambiguous", sorted(cands))


UNMATCHED_FIELDS = ["run_date", "source", "source_key", "name", "alt_names", "region", "raw_status", "status",
                    "reason", "candidates", "url"]


def write_unmatched(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=UNMATCHED_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in UNMATCHED_FIELDS})
