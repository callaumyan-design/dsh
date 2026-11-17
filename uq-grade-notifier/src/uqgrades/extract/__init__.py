"""把抓到的原始数据（JSON / 网页）变成成绩记录。"""

from __future__ import annotations

import logging

from ..config import Config
from ..models import CaptureSet, GradeRecord
from . import blackboard, generic
from .common import harvest_course_hints

log = logging.getLogger(__name__)


def _site_of(cfg: Config, *urls: str) -> str:
    for u in urls:
        s = cfg.site_for_url(u)
        if s:
            return s.id
    return ""


def extract_all(captures: CaptureSet, cfg: Config) -> list[GradeRecord]:
    hints = dict(captures.course_hints)  # 探查时保存的对应关系优先，保证课程代码稳定
    live: dict[str, str] = {}
    for cap in captures.json:
        harvest_course_hints(cap.data, live)
    for k, v in live.items():
        hints.setdefault(k, v)

    records: list[GradeRecord] = []
    learn_json = []
    for cap in captures.json:
        site = _site_of(cfg, cap.url, cap.frame_url, cap.page_url)
        if not site:
            continue
        if site == "learn":
            learn_json.append((cap, site))
        else:
            records += _safe(generic.extract_final_grades_json, cap, site)
    records += _safe(blackboard.extract_gradebook_json, learn_json, hints)

    for doc in captures.html:
        site = _site_of(cfg, doc.url)
        if not site or cfg.is_login_url(doc.url):
            continue
        if site == "learn":
            records += _safe(blackboard.extract_mygrades_html, doc, site, hints)
        else:
            records += _safe(generic.extract_final_grades_table, doc, site)

    return merge_records(records)


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception:  # 一个解析器出错不影响其他
        log.exception("解析器 %s 出错", getattr(fn, "__name__", fn))
        return []


def merge_records(records: list[GradeRecord]) -> list[GradeRecord]:
    """同一项成绩可能从多个地方抓到（比如网页原文和渲染后的快照），合并成一条。
    同一门课里名字相同、但内部编号不同的两项，第二项改名为“名称 (2)”。"""
    groups: dict[tuple[str, str, str], list[list[GradeRecord]]] = {}
    order: list[tuple[str, str, str]] = []
    for r in records:
        key = (r.site, r.course, r.item_key)
        if key not in groups:
            groups[key] = []
            order.append(key)
        clusters = groups[key]
        placed = False
        for cl in clusters:
            ids = {x.item_id for x in cl if x.item_id}
            if not r.item_id or not ids or r.item_id in ids:
                cl.append(r)
                placed = True
                break
        if not placed:
            clusters.append([r])

    out: list[GradeRecord] = []
    for key in order:
        for n, cl in enumerate(groups[key], start=1):
            best = next((x for x in cl if x.graded), cl[0])
            merged = GradeRecord(
                site=best.site,
                course=best.course,
                item=best.item if n == 1 else f"{best.item} ({n})",
                grade=best.grade,
                out_of=best.out_of or next((x.out_of for x in cl if x.out_of), ""),
                status=best.status,
                link=best.link or next((x.link for x in cl if x.link), ""),
                item_id=best.item_id or next((x.item_id for x in cl if x.item_id), ""),
                sources=set().union(*(x.sources for x in cl)),
                extractor=best.extractor,
            )
            out.append(merged)
    return out
