"""shipeiduo.com（适配Duo）。SPA，数据只在 /api/v1 下。

注意：该站 robots.txt 写了 `Disallow: /api/`，默认配置严格遵守 → 本来源会被 PoliteClient 拦下并记为失败。
只有在 config.yaml 的 robots_exceptions 里显式放行 `shipeiduo.com: [/api/v1/]`（例如取得站长许可后）才会请求。
"""
from __future__ import annotations

from ..model import SourceItem, map_status, region_from_url

NAME = "shipeiduo"
REGION = "cn"
BASE = "https://shipeiduo.com/api/v1"


def _paged(client, path, params, name, max_pages):
    items, page = [], 1
    while page <= max_pages:
        q = dict(params, page=page, limit=50)
        data = client.get(NAME, f"{BASE}/{path}", params=q, name=f"{name}_p{page:02d}.json").json()
        d = data.get("data") or {}
        items.extend(d.get("items") or [])
        if not d.get("hasMore"):
            break
        page += 1
    return items


def fetch(client, cfg) -> list[SourceItem]:
    max_pages = int(cfg.get("max_pages", 30))
    out: list[SourceItem] = []
    # 1) 已收录 App（不带 compatibility 过滤 = 全部状态，含 none）
    for a in _paged(client, "apps", {"region": "", "appType": "", "sort": "adapted"}, "apps", max_pages):
        regions = [r for r in (a.get("region") or "").split(",") if r]
        out.append(SourceItem(
            source=NAME, key=f"app:{a.get('slug')}", name=a.get("name") or "",
            alt_names=[a["nameEn"]] if a.get("nameEn") and a.get("nameEn") != a.get("slug") else [],
            raw_status=a.get("compatibility"), status=map_status(NAME, a.get("compatibility")),
            region=(regions[0] if len(regions) == 1 else None) or region_from_url(a.get("appStoreUrl")),
            store_id=(str(a["storeId"]) if a.get("storeId") else None),
            evidence=f"shipeiduo 收录：{a.get('compatibility')}，商店版本 {a.get('storeVersion') or '?'}",
            url=f"https://shipeiduo.com/app/{a.get('slug')}", observed_at=a.get("adaptedAt") or a.get("updatedAt"),
            extra={"storeVersion": a.get("storeVersion"), "appType": a.get("appType"), "slug": a.get("slug"),
                   "regions": regions, "category": a.get("category")},
        ))
    # 2) 网友投稿（待核实）
    for s in _paged(client, "submissions", {}, "submissions", max_pages):
        fit, unfit = int(s.get("fitVotes") or 0), int(s.get("unfitVotes") or 0)
        rec = s.get("recordedApp")
        out.append(SourceItem(
            source="shipeiduo_submission", key=f"sub:{s.get('id')}", name=s.get("appName") or "",
            raw_status=s.get("compatibility"), status=map_status("shipeiduo_submission", s.get("compatibility")),
            region="cn", evidence=f"网友投稿：{s.get('compatibility')}（适配票 {fit} / 不适配票 {unfit}，"
                                  f"回复 {len(s.get('replies') or [])} 条）",
            url="https://shipeiduo.com/submit", observed_at=s.get("createdAt"),
            # net = 支持该投稿结论的票 − 反对票：结论为适配时 = fit − unfit（规格原文）；结论为 none 时反过来
            votes={"fit": fit, "unfit": unfit,
                   "net": (unfit - fit) if s.get("compatibility") == "none" else (fit - unfit)},
            # 不保存投稿人地区等字段，只保留与适配判断有关的信息
            extra={"recorded": bool(rec), "recordedApp": (rec.get("slug") if isinstance(rec, dict) else rec),
                   "replies": [r.get("content") for r in (s.get("replies") or []) if isinstance(r, dict)][:5]},
        ))
    return out
