"""my.UQ（以及其他非 Blackboard 页面）的课程最终成绩解析。

my.UQ 的数据格式要以探查录制为准。这里先提供两种通用的识别方法：
1. JSON：同一个对象里既有课程代码（如 COMP3506）又有成绩字段（grade / finalGrade / result ...）。
2. 网页表格：表头含 Course/Code 和 Grade/Result 的表格。

如果探查结束后显示的识别结果不对，把探查报告交给开发者，按真实格式补一个专门的解析器即可。
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..models import GradeRecord, HtmlCapture, JsonCapture
from .common import COURSE_CODE_RE, lower_keys, scalar_text, walk_dicts

FINAL_ITEM = "最终成绩"

_COURSE_KEYS = ("coursecode", "course_code", "code", "subjectcode", "classcode", "course", "courseid", "catalogcode")
_GRADE_KEYS = (
    "finalgrade",
    "final_grade",
    "officialgrade",
    "grade",
    "gradetext",
    "grade_text",
    "gradecode",
    "grade_code",
    "finalresult",
    "result",
    "finalmark",
    "mark",
)
_TERM_KEYS = ("term", "termname", "termdescription", "semester", "studyperiod", "teachingperiod", "period", "session")
_NOT_GRADES = {"enrolled", "active", "success", "ok", "true", "false", "error", "completed", "current", "dropped"}
_FULL_CODE_RE = re.compile(r"^\s*([A-Z]{4}\d{4})[A-Z]?\s*$")


def _course_of(d: dict) -> str:
    low = lower_keys(d)
    for k in _COURSE_KEYS:
        v = low.get(k)
        if isinstance(v, str):
            m = _FULL_CODE_RE.match(v)
            if m:
                return m.group(1)
    return ""


def _value_text(v) -> str:
    if isinstance(v, dict):
        lv = lower_keys(v)
        for k in ("display", "text", "value", "code", "grade", "description"):
            t = scalar_text(lv.get(k))
            if t:
                return t
        return ""
    return scalar_text(v)


def _grade_of(d: dict) -> str:
    low = lower_keys(d)
    for k in _GRADE_KEYS:
        if k in low:
            t = _value_text(low[k])
            if t and len(t) <= 12 and t.lower() not in _NOT_GRADES:
                return t
    return ""


def _term_of(d: dict) -> str:
    low = lower_keys(d)
    for k in _TERM_KEYS:
        t = _value_text(low.get(k))
        if t and len(t) <= 60:
            return t
    return ""


def _item_name(term: str) -> str:
    return f"{FINAL_ITEM}（{term}）" if term else FINAL_ITEM


def extract_final_grades_json(cap: JsonCapture, site: str) -> list[GradeRecord]:
    out: list[GradeRecord] = []
    for d in walk_dicts(cap.data):
        course = _course_of(d)
        if not course:
            continue
        grade = _grade_of(d)
        has_grade_field = any(k in lower_keys(d) for k in _GRADE_KEYS)
        if not grade and not has_grade_field:
            continue
        out.append(
            GradeRecord(
                site=site,
                course=course,
                item=_item_name(_term_of(d)),
                grade=grade,
                link=cap.frame_url or cap.page_url,
                sources={cap.target_id} if cap.target_id else set(),
                extractor="generic-json",
            )
        )
    return out


_COURSE_HEAD = re.compile(r"course|subject|code|课程", re.I)
_GRADE_HEAD = re.compile(r"grade|result|mark|成绩", re.I)
_TERM_HEAD = re.compile(r"term|semester|period|学期", re.I)


def extract_final_grades_table(cap: HtmlCapture, site: str) -> list[GradeRecord]:
    if "<table" not in cap.html.lower():
        return []
    soup = BeautifulSoup(cap.html, "html.parser")
    out: list[GradeRecord] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        head = [c.get_text(" ", strip=True) for c in rows[0].find_all(["th", "td"])]
        ci = next((i for i, h in enumerate(head) if _COURSE_HEAD.search(h)), None)
        gi = next((i for i, h in enumerate(head) if _GRADE_HEAD.search(h) and not re.search(r"basis|type", h, re.I)), None)
        ti = next((i for i, h in enumerate(head) if _TERM_HEAD.search(h)), None)
        if ci is None or gi is None or ci == gi:
            continue
        for row in rows[1:]:
            cells = [c.get_text(" ", strip=True) for c in row.find_all(["th", "td"])]
            if len(cells) <= max(ci, gi):
                continue
            m = COURSE_CODE_RE.search(cells[ci])
            if not m:
                continue
            term = cells[ti] if ti is not None and ti < len(cells) else ""
            out.append(
                GradeRecord(
                    site=site,
                    course=m.group(1),
                    item=_item_name(term),
                    grade=cells[gi],
                    link=cap.url,
                    sources={cap.target_id} if cap.target_id else set(),
                    extractor="generic-table",
                )
            )
    return out
