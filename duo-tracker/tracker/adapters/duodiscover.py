"""duodiscover.com（Next.js App Router）。/apps 页 SSR 渲染全部卡片：
<a class="row" href="/apps/<slug>"> … <span class="badge b-built|b-adapted|b-compat">。
没有 App Store id → 名称匹配（美区）。
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from ..model import SourceItem, map_status

NAME = "duodiscover"
REGION = "us"


def fetch(client, cfg) -> list[SourceItem]:
    soup = BeautifulSoup(client.get(NAME, "https://duodiscover.com/apps", name="apps.html").text, "lxml")
    out = []
    for a in soup.select("a.row[href^='/apps/']"):
        name = a.select_one(".name")
        badge = a.select_one(".badge")
        if not name or not badge:
            continue
        raw = badge.get_text(strip=True)
        sub = a.select_one(".sub")
        out.append(SourceItem(
            source=NAME, key=a["href"].split("/")[-1], name=name.get_text(strip=True), raw_status=raw,
            status=map_status(NAME, raw), region="us",
            evidence=f"DuoDiscover：{raw}｜{sub.get_text(strip=True) if sub else ''}"[:300],
            url=f"https://duodiscover.com{a['href']}",
        ))
    return out
