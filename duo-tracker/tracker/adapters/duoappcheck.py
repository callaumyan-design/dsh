"""duoappcheck.com（vinext/RSC）。robots.txt：Disallow /api/ → 不用 /api/catalog，
改为解析首页内联 RSC 流（self[...].rsc.push("…")）里的 initialCatalog（apps[] + history[]）。
"""
from __future__ import annotations

import json
import re

from ..model import SourceItem, map_status, region_from_url, store_id_from_url

NAME = "duoappcheck"
REGION = None


def parse_catalog(html: str) -> dict:
    chunks = [json.loads(f'"{m}"') for m in re.findall(r'\.rsc\.push\("((?:[^"\\]|\\.)*)"\)', html)]
    s = "".join(chunks)
    i = s.find('"initialCatalog":')
    if i < 0:
        raise ValueError("页面里没找到 initialCatalog")
    cat, _ = json.JSONDecoder().raw_decode(s, i + len('"initialCatalog":'))
    return cat


def fetch(client, cfg) -> list[SourceItem]:
    cat = parse_catalog(client.get(NAME, "https://duoappcheck.com/", name="home.html").text)
    out = []
    for a in cat.get("apps", []):
        url = a.get("appStoreUrl") or ""
        out.append(SourceItem(
            source=NAME, key=a["id"], name=a.get("name") or "", raw_status=a.get("status"),
            status=map_status(NAME, a.get("status")), region=region_from_url(url), store_id=store_id_from_url(url),
            evidence=f"[{a.get('evidence')}] {a.get('summary') or ''} {a.get('detail') or ''}".strip()[:400],
            url=a.get("sourceUrl") or url, observed_at=a.get("checkedAt") or a.get("sourceDate") or cat.get("updatedAt"),
            extra={"version": a.get("version"), "modes": a.get("modes")},
        ))
    return out
