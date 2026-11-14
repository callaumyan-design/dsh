"""foldhunt.com（Astro 静态站）。robots.txt：Disallow /api/ → 只解析 HTML。

/iphone-duo/compatibility/ 单页渲染全部 1000+ 行 <tr class="ct__row" data-status=… data-display=… data-name=…>；
来源列有时直接是 App Store 链接（可取 id），否则只能按名称匹配。data-name 含中英繁多个名字。
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..model import SourceItem, map_status, region_from_url, store_id_from_url

NAME = "foldhunt"
REGION = None
URL = "https://foldhunt.com/iphone-duo/compatibility/"


def fetch(client, cfg) -> list[SourceItem]:
    html = client.get(NAME, URL, name="compatibility.html").text
    soup = BeautifulSoup(html, "lxml")
    out = []
    for tr in soup.select("tr.ct__row"):
        a = tr.select_one("a.ct__app-name")
        if not a:
            continue
        sr = a.select_one(".sr-only")
        if sr:
            sr.extract()
        name = a.get_text(strip=True)
        slug = a.get("href", "").strip("/").split("/")[-1]
        badge = tr.select_one(".ct__cell-status .badge")
        mode = tr.select_one(".ct__mode-badge")
        src = tr.select_one(".ct__cell-source a")
        when = tr.select_one(".ct__cell-checked time")
        cat = tr.select_one(".ct__app-cat")
        raw = tr.get("data-status")
        src_url = src.get("href") if src else ""
        # data-name 形如 "zenless zone zero 绝区零 絕區零"：英文名与中文名以空格相连，取出含汉字的词作别名
        alt = [t for t in (tr.get("data-name") or "").split() if re.search(r"[\u4e00-\u9fff]", t)]
        out.append(SourceItem(
            source=NAME, key=slug, name=name, alt_names=alt, raw_status=raw,
            status=map_status(NAME, raw), region=region_from_url(src_url),
            store_id=store_id_from_url(src_url),
            evidence=f"{badge.get_text(strip=True) if badge else raw}：{badge.get('title') if badge else ''}"
                     f"｜内屏：{mode.get_text(strip=True) if mode else '?'}｜来源：{src.get('title') or src.get_text(strip=True) if src else '-'}",
            url=f"https://foldhunt.com{a.get('href')}", observed_at=when.get("datetime") if when else None,
            extra={"display": tr.get("data-display"), "source_url": src_url,
                   "is_game": bool(cat and cat.get_text().startswith("Game"))},
        ))
    return out
