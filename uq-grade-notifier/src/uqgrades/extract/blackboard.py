"""Learn.UQ（Blackboard）成绩解析。

两种来源：
1. 网页：Blackboard 原版课程的 “My Grades” 页面（div.sortable_item_row 一行一个评估项）。
2. 数据接口：Blackboard 的 JSON 数据，成绩栏（column：名称、满分）和成绩（grade：columnId、分数）
   可能分在两个接口里，这里按 columnId 拼起来。

具体用哪些地址，全部来自探查录制（data/targets.json），这里只负责“看懂”返回的内容。
"""

from __future__ import annotations

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from ..models import GradeRecord, HtmlCapture, JsonCapture
from .common import (
    BB_ID_RE,
    bb_course_id_from_url,
    find_course_code,
    lower_keys,
    scalar_text,
    walk_dicts,
)

# ---------------------------------------------------------------- 网页


_META_CLASSES = {
    "itemCat",
    "activityType",
    "gradeDueDate",
    "lastActivityDate",
    "eval-links",
    "hideoff",
    "itemDetails",
    "gradeStatus",
}


def _cell_name(cell: Tag) -> str:
    """评估项名称是格子里第一段有文字的内容；后面的分类、状态等说明跳过。"""
    for child in cell.children:
        if isinstance(child, Comment):
            continue
        if isinstance(child, NavigableString):
            text = " ".join(str(child).split())
        elif isinstance(child, Tag):
            if child.name in ("script", "style") or set(child.get("class") or []) & _META_CLASSES:
                continue
            text = " ".join(child.get_text(" ", strip=True).split())
        else:
            continue
        if text:
            return text
    return ""


def _course_from_html(soup: BeautifulSoup, url: str, hints: dict[str, str]) -> str:
    bbid = bb_course_id_from_url(url)
    if bbid and bbid in hints:
        return hints[bbid]
    selectors = [
        "#courseMenuPalette_paletteTitleHeading",
        "#breadcrumbs",
        ".courseName",
        "#pageTitleText",
        "title",
        "h1",
        "h2",
    ]
    for sel in selectors:
        for el in soup.select(sel):
            code = find_course_code(el.get_text(" ", strip=True))
            if code:
                return code
    return bbid


def extract_mygrades_html(cap: HtmlCapture, site: str, hints: dict[str, str]) -> list[GradeRecord]:
    if "sortable_item_row" not in cap.html:
        return []
    soup = BeautifulSoup(cap.html, "html.parser")
    rows = soup.select("div.sortable_item_row")
    if not rows:
        return []
    course = _course_from_html(soup, cap.url, hints) or "Learn.UQ"
    records: list[GradeRecord] = []
    for row in rows:
        name_cell = row.select_one(".cell.gradable")
        if name_cell is None:
            continue
        name = _cell_name(name_cell)
        if not name:
            continue
        grade = out_of = status = ""
        grade_cell = row.select_one(".cell.grade")
        if grade_cell is not None:
            g = grade_cell.select_one("span.grade, .grade")
            if g is not None:
                grade = g.get_text(" ", strip=True)
            p = grade_cell.select_one(".pointsPossible")
            if p is not None:
                out_of = p.get_text(strip=True).lstrip("/").strip()
            if g is None:
                icon = grade_cell.select_one("[title], [alt]")
                if icon is not None:
                    status = icon.get("title") or icon.get("alt") or ""
        act = row.select_one(".cell.activity .activityType, .activityType")
        if act is not None and not status:
            status = act.get_text(" ", strip=True)
        records.append(
            GradeRecord(
                site=site,
                course=course,
                item=name,
                grade=grade,
                out_of=out_of,
                status=status,
                link=cap.url,
                item_id=row.get("id", "") or "",
                sources={cap.target_id} if cap.target_id else set(),
                extractor="blackboard-html",
            )
        )
    return records


# ---------------------------------------------------------------- 数据接口

_COLUMN_NAME_KEYS = ("columnName", "displayColumnName", "name", "displayName", "title")
_COLUMN_HINT_KEYS = {
    "score",
    "possible",
    "pointspossible",
    "grading",
    "gradingtype",
    "scoreproviderhandle",
    "gradebookcategoryid",
    "contentid",
    "calculationtype",
    "aggregationmodel",
    "externalgrade",
    "columnname",
}
_GRADE_VALUE_KEYS = ("displayGrade", "score", "text", "grade", "manualGrade", "manualScore")


def _is_column(d: dict) -> bool:
    cid = d.get("id")
    if not isinstance(cid, str) or not BB_ID_RE.match(cid):
        return False
    if not any(isinstance(d.get(k), str) and d.get(k).strip() for k in _COLUMN_NAME_KEYS):
        return False
    return bool(_COLUMN_HINT_KEYS & set(lower_keys(d)))


def _column_name(d: dict) -> str:
    for k in _COLUMN_NAME_KEYS:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _column_possible(d: dict) -> str:
    score = d.get("score")
    if isinstance(score, dict):
        p = scalar_text(score.get("possible"))
        if p:
            return p
    for k in ("possible", "pointsPossible", "maxScore"):
        p = scalar_text(d.get(k))
        if p:
            return p
    return ""


def _is_grade(d: dict) -> bool:
    # 待评分的项可能只有 columnId 和 status，没有分数字段
    return isinstance(d.get("columnId"), str) and any(k in d for k in (*_GRADE_VALUE_KEYS, "status"))


def _grade_value(d: dict) -> tuple[str, str]:
    """返回 (成绩文字, 满分)"""
    out_of = ""
    dg = d.get("displayGrade")
    if isinstance(dg, dict):
        text = scalar_text(dg.get("text"))
        score = scalar_text(dg.get("score"))
        out_of = scalar_text(dg.get("possible"))
        scale = str(dg.get("scaleType") or "").lower()
        if scale == "percent" and score and not text:
            return f"{score}%", out_of
        if text or score:
            return text or score, out_of
    for k in ("text", "grade", "manualGrade"):
        v = d.get(k)
        if isinstance(v, dict):
            v = v.get("text") or v.get("score")
        t = scalar_text(v)
        if t:
            return t, out_of
    for k in ("score", "manualScore"):
        t = scalar_text(d.get(k))
        if t:
            return t, scalar_text(d.get("pointsPossible")) or out_of
    return "", out_of


def extract_gradebook_json(caps: list[tuple[JsonCapture, str]], hints: dict[str, str]) -> list[GradeRecord]:
    """caps: [(capture, site_id)]，只传 Learn.UQ 的 JSON。"""
    columns: dict[tuple[str, str], tuple[dict, JsonCapture]] = {}
    columns_any: dict[str, tuple[dict, JsonCapture]] = {}
    grades: list[tuple[str, dict, JsonCapture, str]] = []
    for cap, site in caps:
        course_id = bb_course_id_from_url(cap.url)
        for d in walk_dicts(cap.data):
            if _is_column(d):
                cdid = d.get("courseId") if isinstance(d.get("courseId"), str) and BB_ID_RE.match(d.get("courseId")) else course_id
                columns[(cdid, d["id"])] = (d, cap)
                columns_any.setdefault(d["id"], (d, cap))
            if _is_grade(d):
                gcid = d.get("courseId") if isinstance(d.get("courseId"), str) and BB_ID_RE.match(d.get("courseId")) else course_id
                grades.append((gcid, d, cap, site))

    records: list[GradeRecord] = []
    for course_id, g, gcap, site in grades:
        col_id = g["columnId"]
        col = None
        ccap = None
        if isinstance(g.get("column"), dict):
            col, ccap = g["column"], gcap
        elif (course_id, col_id) in columns:
            col, ccap = columns[(course_id, col_id)]
        elif col_id in columns_any:
            col, ccap = columns_any[col_id]
            if not course_id:
                course_id = bb_course_id_from_url(ccap.url)
        if col is None:
            continue  # 没有评估项名称，无法展示
        name = _column_name(col)
        if not name:
            continue
        grade, out_of = _grade_value(g)
        out_of = out_of or _column_possible(col)
        status = scalar_text(g.get("status"))
        if status.lower() in ("needsgrading", "needs_grading") and not grade:
            grade = ""
        course = hints.get(course_id, "") or course_id or "Learn.UQ"
        sources = {c.target_id for c in (gcap, ccap) if c is not None and c.target_id}
        records.append(
            GradeRecord(
                site=site,
                course=course,
                item=name,
                grade=grade,
                out_of=out_of,
                status=status,
                link=gcap.frame_url or gcap.page_url or ccap.frame_url or "",
                item_id=col_id,
                sources=sources,
                extractor="blackboard-json",
            )
        )
    return records
