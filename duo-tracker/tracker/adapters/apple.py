"""苹果数据源：榜单 RSS、iTunes Lookup/Search、官方合集（story）页面。"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from ..http import PoliteClient
from ..model import SourceItem, map_status

log = logging.getLogger(__name__)

GAMES_GENRE = "6014"


@dataclass
class ChartEntry:
    region: str
    feed: str
    rank: int
    app_id: str
    name: str
    bundle_id: str | None = None
    genre_id: str | None = None


# --------------------------------------------------------------------------- 榜单
# 已确认（2026-11）：
#  * App Store 网页榜单 apps.apple.com/<cc>/iphone/charts/<genre>（robots.txt 允许）：SSR 的
#    serialized-server-data 里每个 segment（top-free / top-paid）有前 25 个 Lockup，
#    nextPage.remainingContent 按名次列出其余 175 个 id → 一页即可拿到完整 Top 200（免费+付费两个榜）。
#    genre 36 = 总榜（含游戏），6014 = 游戏。网页上没有畅销榜。偶尔返回 200 状态的 1KB 错误页，需校验后重试。
#  * 新版 Marketing Tools RSS（rss.applemarketingtools.com → 301 到 rss.marketingtools.apple.com）只有
#    apps/top-free、apps/top-paid，最多 100 条；畅销榜 404、无游戏分类；200 条返回 500，偶发 502/504。
#    这里只在网页榜单失败时作为兜底。
#  * 旧版 iTunes RSS（itunes.apple.com/<cc>/rss/...，有 topgrossing 与 genre 过滤，但封顶 100）被
#    itunes.apple.com/robots.txt 的 `Disallow: /*/rss/*` 禁止 → 默认不用（charts.legacy_rss: true 且在
#    robots_exceptions 放行后才会请求）。
#  ⇒ 畅销榜：没有 robots 允许的公开来源，记录并跳过。
GAMES_GENRE = "6014"
ALL_GENRE = "36"
WEB_CHART_URL = "https://apps.apple.com/{cc}/iphone/charts/{genre}"
LEGACY_FEEDS = [
    ("topfreeapplications", None), ("toppaidapplications", None), ("topgrossingapplications", None),
    ("topfreeapplications", GAMES_GENRE), ("toppaidapplications", GAMES_GENRE), ("topgrossingapplications", GAMES_GENRE),
]
V2_FEEDS = ["top-free", "top-paid"]


def _has_server_data(text: str) -> bool:
    return 'id="serialized-server-data"' in text


def parse_web_chart(html: str, cc: str, genre: str) -> list[ChartEntry]:
    m = re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>', html, re.S)
    data = json.loads(m.group(1))
    out = []
    for seg in data["data"][0]["data"].get("segments", []):
        chart = seg.get("chart")  # top-free / top-paid
        feed = f"web:{genre}:{chart}"
        rank = 0
        for sh in seg.get("shelves", []):
            for it in sh.get("items") or []:
                if it.get("$kind") == "Lockup" and it.get("adamId"):
                    rank += 1
                    out.append(ChartEntry(cc, feed, rank, str(it["adamId"]), it.get("title", ""), it.get("bundleId"),
                                          genre if genre == GAMES_GENRE else None))
        for r in (seg.get("nextPage") or {}).get("remainingContent") or []:
            rank += 1
            out.append(ChartEntry(cc, feed, rank, str(r["id"]), "", None, genre if genre == GAMES_GENRE else None))
    return out


def _legacy_feed_name(feed: str, genre: str | None) -> str:
    short = feed.replace("applications", "")
    return f"legacy:{short}:{'games' if genre else 'all'}"


def fetch_charts(client: PoliteClient, regions: list[str], use_v2: bool = True,
                 legacy: bool = False) -> tuple[list[ChartEntry], list[str]]:
    entries: list[ChartEntry] = []
    errors: list[str] = []
    for cc in regions:
        web_ok = True
        for genre in (ALL_GENRE, GAMES_GENRE):
            try:
                html = client.get("apple_charts", WEB_CHART_URL.format(cc=cc, genre=genre),
                                  name=f"{cc}_charts_{genre}.html", validate=_has_server_data).text
                got = parse_web_chart(html, cc, genre)
                if not got:
                    raise ValueError("榜单页没有解析出任何条目")
                entries += got
            except Exception as e:  # 单个榜单失败不影响其它
                errors.append(f"{cc} web:{genre}: {e}")
                web_ok = False
        if use_v2 and not web_ok:
            for feed in V2_FEEDS:
                url = f"https://rss.marketingtools.apple.com/api/v2/{cc}/apps/{feed}/100/apps.json"
                try:
                    data = client.get("apple_charts", url, name=f"{cc}_v2_{feed}.json").json()
                except Exception as e:
                    errors.append(f"{cc} v2:{feed}: {e}")
                    continue
                for i, r in enumerate(data.get("feed", {}).get("results", []) or [], start=1):
                    entries.append(ChartEntry(cc, f"v2:{feed}", i, r["id"], r.get("name", "")))
        if legacy:
            for feed, genre in LEGACY_FEEDS:
                url = f"https://itunes.apple.com/{cc}/rss/{feed}/limit=200/" + (f"genre={genre}/" if genre else "") + "json"
                fname = _legacy_feed_name(feed, genre)
                try:
                    data = client.get("apple_charts", url, name=f"{cc}_{fname.replace(':', '_')}.json").json()
                except Exception as e:
                    errors.append(f"{cc} {fname}: {e}")
                    continue
                for i, e in enumerate(data.get("feed", {}).get("entry", []) or [], start=1):
                    attrs = e["id"]["attributes"]
                    entries.append(ChartEntry(cc, fname, i, attrs["im:id"], e["im:name"]["label"],
                                              attrs.get("im:bundleId"),
                                              e.get("category", {}).get("attributes", {}).get("im:id")))
    return entries, errors


# --------------------------------------------------------------------------- Lookup
# itunes.apple.com/robots.txt：`Disallow: /*/lookup?` 只匹配 /<seg>/lookup?…，/lookup?id=… 按 RFC 9309 不在禁止范围；
# `Disallow: /search*` 禁止 Search API → 不使用，watchlist 名称改用各追踪站目录里的 名称→id 解析。
def lookup(client: PoliteClient, ids: list[str], country: str, batch: int = 100) -> tuple[dict[str, dict], int]:
    """批量查询；返回 {trackId: result} 与失败批次数。"""
    out: dict[str, dict] = {}
    failed = 0
    ids = list(dict.fromkeys(ids))
    for n, i in enumerate(range(0, len(ids), batch)):
        chunk = ids[i:i + batch]
        try:
            data = client.get(f"itunes_lookup_{country}", "https://itunes.apple.com/lookup",
                              params={"id": ",".join(chunk), "country": country},
                              name=f"lookup_{country}_{n:03d}.json").json()
        except Exception as e:
            log.warning("lookup %s 批次 %d 失败：%s", country, n, e)
            failed += 1
            continue
        for r in data.get("results", []):
            if r.get("wrapperType") == "software" or r.get("kind") == "software":
                out[str(r["trackId"])] = r
    return out, failed


def is_game(result: dict) -> bool:
    return GAMES_GENRE in [str(g) for g in result.get("genreIds", [])] or result.get("primaryGenreName") == "Games"


# --------------------------------------------------------------------------- 官方合集
STORY_URL = "https://apps.apple.com/{cc}/iphone/story/id{sid}"


def _walk_lockups(o, out: list):
    if isinstance(o, dict):
        if o.get("$kind") == "Lockup" and o.get("adamId"):
            out.append(o)
        for v in o.values():
            _walk_lockups(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk_lockups(v, out)


def fetch_story(client: PoliteClient, story_id: str, regions: list[str]) -> list[SourceItem]:
    """解析「Great Apps and Games on iPhone Duo」合集页 serialized-server-data 里的 Lockup。

    页面在 cn 区可能不存在，逐区尝试；同一 App 在不同区 trackId 可能不同（如绝区零 cn=1606359076, us=1606356401）。
    """
    items: list[SourceItem] = []
    for cc in regions:
        url = STORY_URL.format(cc=cc, sid=story_id)
        try:
            r = client.get("apple_story", url, name=f"story_{story_id}_{cc}.html", ok_statuses=(200,))
        except Exception as e:
            log.info("合集页 %s 不可用：%s", url, e)
            continue
        m = re.search(r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            continue
        data = json.loads(m.group(1))
        title = re.search(r"<title>(.*?)</title>", r.text, re.S)
        title = title.group(1).strip("‎ ") if title else "iPhone Duo story"
        lockups: list[dict] = []
        _walk_lockups(data, lockups)
        seen = set()
        for lk in lockups:
            aid = str(lk["adamId"])
            if aid in seen:
                continue
            seen.add(aid)
            items.append(SourceItem(
                source="apple_story", key=f"{cc}:{aid}", name=lk.get("title", ""), raw_status="featured",
                status=map_status("apple_story", "featured"), region=cc, store_id=aid,
                bundle_id=lk.get("bundleId"), evidence=f"收录于苹果官方合集《{title}》", url=url,
            ))
    return items
