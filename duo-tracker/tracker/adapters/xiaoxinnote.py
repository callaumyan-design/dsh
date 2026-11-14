"""duo.xiaoxinnote.com（Duo Tracker · 中国 Top 200）。

首页内嵌 <script id="catalogue-urls"> 给出带哈希的目录 JSON 地址（/data/catalogue.<cc>.<hash>.json），
目录里每个 App 带 App Store id、各区版本、verification.status 与榜单名次（cn 区覆盖到 Top 200）。
"""
from __future__ import annotations

import json
import re

from ..model import SourceItem, map_status

NAME = "xiaoxinnote"
REGION = None
HOME = "https://duo.xiaoxinnote.com/"


def fetch_catalogue(client, regions):
    home = client.get(NAME, HOME, name="home.html").text
    m = re.search(r'<script type="application/json" id="catalogue-urls">(.*?)</script>', home, re.S)
    if not m:
        raise ValueError("首页里没找到 catalogue-urls")
    urls = json.loads(m.group(1))
    cats = {}
    for cc in regions:
        if cc in urls:
            cats[cc] = client.get(NAME, HOME.rstrip("/") + urls[cc], name=f"catalogue_{cc}.json").json()
    return cats


def fetch(client, cfg) -> list[SourceItem]:
    regions = cfg.get("regions", ["cn", "us"])
    cats = fetch_catalogue(client, regions)
    out = []
    for cc, cat in cats.items():
        for a in cat.get("apps", []):
            sf = (a.get("storefronts") or {}).get(cc) or {}
            ver = sf.get("verification")
            raw = ver.get("status") if ver else "pending"
            ev = f"verification={raw}"
            if ver:
                if ver.get("testedVersion"):
                    ev += f"，实测版本 {ver['testedVersion']}"
                if ver.get("note") or ver.get("notes"):
                    ev += f"，备注：{ver.get('note') or ver.get('notes')}"
            out.append(SourceItem(
                source=NAME, key=f"{cc}:{a['id']}", name=a.get("name") or "", alt_names=a.get("aliases") or [],
                raw_status=raw, status=map_status(NAME, raw), region=cc, store_id=str(a["id"]),
                evidence=ev, url=f"https://duo.xiaoxinnote.com/{'us/' if cc == 'us' else ''}",
                observed_at=(ver or {}).get("checkedAt") or cat.get("updatedAt"),
                extra={"version": sf.get("version"), "chart": sf.get("sources") or [],
                       "chartCurrent": sf.get("chartCurrent", True), "category": a.get("category")},
            ))
    return out


def chart_ranks(items: list[SourceItem], region: str = "cn", chart: str = "top-free") -> list[tuple[int, str, str]]:
    """从目录里取该站记录的榜单名次（用来补齐 Apple RSS 只给 100 名的缺口）。返回 [(rank, id, name)]。"""
    out = []
    for it in items:
        if it.region != region or not it.extra.get("chartCurrent", True):
            continue
        for s in it.extra.get("chart") or []:
            if s.get("chart") == chart and s.get("rank"):
                out.append((int(s["rank"]), it.store_id, it.name))
    return sorted(out)
