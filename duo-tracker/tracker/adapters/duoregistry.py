"""duoregistry.com（TanStack Start SSR）。robots.txt：Disallow /api/、/go/ → 解析 /duo-support HTML。

页面按标签分节：<h2 id="label-duo-native">、<h2 id="label-unverified">（以及可能出现的 Scaled up 等），
每个 <li> 是一个 App：名称 + 依据说明 + Checked 日期。没有 App Store id → 名称匹配（美区）。
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..model import SourceItem, map_status

NAME = "duoregistry"
REGION = "us"
URL = "https://duoregistry.com/duo-support"


def fetch(client, cfg) -> list[SourceItem]:
    soup = BeautifulSoup(client.get(NAME, URL, name="duo-support.html").text, "lxml")
    out = []
    for h2 in soup.find_all("h2", id=re.compile(r"^label-")):
        label = h2.get_text(" ", strip=True).split(".")[0].strip()
        sec = h2.find_parent("section") or h2.parent
        for li in sec.find_all("li"):
            a = li.find("a", href=True)
            spans = li.select("span.min-w-0 > span")
            if not a or not spans:
                continue
            name = spans[0].get_text(strip=True)
            note = spans[1].get_text(" ", strip=True) if len(spans) > 1 else ""
            t = li.find("time")
            out.append(SourceItem(
                source=NAME, key=a["href"].rstrip("/").split("/")[-1], name=name, raw_status=label,
                status=map_status(NAME, label), region="us", evidence=f"{label}：{note}"[:400],
                url=f"https://duoregistry.com{a['href']}", observed_at=t.get("datetime") if t else None,
            ))
    return out
