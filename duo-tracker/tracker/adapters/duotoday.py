"""www.duotoday.com（SvelteKit）。robots.txt 不存在（返回 404 页面）→ 全部允许。

GET /api/feed 返回全部事件（feed[]，含 appId/version/tier/evidenceType/confidence/excerpt/sourceUrl/eventDate）。
页面本身只渲染 30 条，前端分页也是调这个接口。只覆盖美区（storeUrl 均为 /us/）。
"""
from __future__ import annotations

from ..model import SourceItem, map_status

NAME = "duotoday"
REGION = "us"


def fetch(client, cfg) -> list[SourceItem]:
    data = client.get(NAME, "https://www.duotoday.com/api/feed", name="feed.json").json()
    best: dict[str, dict] = {}
    for f in data.get("feed", []):
        aid = str(f.get("appId"))
        cur = best.get(aid)
        # 同一 App 多条事件：tier 取更高的，其次取最新
        rank = (1 if f.get("tier") == "made_for" else 0, f.get("eventDate") or "")
        if cur is None or rank > (1 if cur.get("tier") == "made_for" else 0, cur.get("eventDate") or ""):
            best[aid] = f
    out = []
    for aid, f in best.items():
        conf = f.get("confidence")
        out.append(SourceItem(
            source=NAME, key=aid, name=f.get("appName") or "", raw_status=f.get("tier"),
            status=map_status(NAME, f.get("tier")), region="us", store_id=aid,
            evidence=f"[{f.get('evidenceType')}/{conf}] v{f.get('version') or '?'}：{(f.get('excerpt') or f.get('summary') or '')[:300]}",
            url=f.get("sourceUrl") or f.get("storeUrl") or "", observed_at=f.get("eventDate"),
            weight_factor=0.5 if conf == "low" else 1.0,
            extra={"evidenceType": f.get("evidenceType"), "kind": f.get("kind"), "version": f.get("version")},
        ))
    return out
