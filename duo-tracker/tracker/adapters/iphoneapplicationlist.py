"""iphoneapplicationlist.com/iphone-duo-apps/（WordPress）。页面提供官方 CSV 下载：?duo_download=csv，
一次请求即得全部（rank,name,…,evidence_type,evidence,evidence_label,source_url,url,checked）。美区。
"""
from __future__ import annotations

import csv
import io

from ..model import SourceItem, map_status, store_id_from_url

NAME = "iphoneapplicationlist"
REGION = "us"
URL = "https://iphoneapplicationlist.com/iphone-duo-apps/?duo_download=csv"


def fetch(client, cfg) -> list[SourceItem]:
    text = client.get(NAME, URL, name="duo-apps.csv").text.lstrip("﻿")
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        sid = store_id_from_url(r.get("url"))
        raw = r.get("evidence_type")
        out.append(SourceItem(
            source=NAME, key=sid or r.get("name"), name=r.get("name") or "", raw_status=raw,
            status=map_status(NAME, raw), region="us", store_id=sid,
            evidence=f"[{r.get('evidence_label')}] {r.get('evidence') or ''}"[:400],
            url=r.get("source_url") or r.get("url") or "", observed_at=r.get("checked") or r.get("updated"),
            extra={"version": r.get("version"), "category": r.get("category")},
        ))
    return out
