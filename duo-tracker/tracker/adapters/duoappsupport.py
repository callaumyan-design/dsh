"""duoappsupport.com（单页，数据写死在内联脚本里）。

`var NAMES="A|B|…"` 是收录名单，`var STATUS={"App":"full"|"lim"|"no"}` 是已核实状态，其余均为 Unverified。
只有英文名，没有 App Store id → 只能名称匹配（美区）。
"""
from __future__ import annotations

import json
import re

from ..model import SourceItem, map_status

NAME = "duoappsupport"
REGION = "us"
LABEL = {"full": "Fully supported", "lim": "Limited", "no": "Not optimized", "unv": "Unverified"}


def fetch(client, cfg) -> list[SourceItem]:
    html = client.get(NAME, "https://duoappsupport.com/", name="home.html").text
    names = re.search(r'var NAMES="([^"]*)"', html)
    status = re.search(r"var STATUS=(\{.*?\});", html, re.S)
    if not names or not status:
        raise ValueError("没找到 NAMES/STATUS 内联数据，页面结构可能变了")
    st = json.loads(status.group(1))
    out = []
    for n in dict.fromkeys(names.group(1).split("|")):
        raw = st.get(n, "unv")
        out.append(SourceItem(source=NAME, key=n, name=n, raw_status=raw, status=map_status(NAME, raw),
                              region="us", evidence=f"Duo App Support 标记为「{LABEL.get(raw, raw)}」",
                              url="https://duoappsupport.com/"))
    return out
