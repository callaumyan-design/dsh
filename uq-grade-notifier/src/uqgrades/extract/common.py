"""解析器共用的小工具。"""

from __future__ import annotations

import re
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

# UQ 课程代码：4 个大写字母 + 4 位数字，例如 COMP3506、MATH1051（后面可能紧跟字母，如 COMP3506S_...）
COURSE_CODE_RE = re.compile(r"(?<![A-Z])([A-Z]{4}\d{4})(?!\d)")
# Blackboard 内部编号，例如 _123456_1
BB_ID_RE = re.compile(r"^_\d+_\d+$")
BB_COURSE_IN_PATH_RE = re.compile(r"/courses/(_\d+_\d+)(?:/|$)")


def find_course_code(text: str | None) -> str:
    if not text or not isinstance(text, str):
        return ""
    m = COURSE_CODE_RE.search(text)
    return m.group(1) if m else ""


def walk_dicts(obj, depth: int = 0) -> Iterator[dict]:
    """依次给出 JSON 里所有的对象（字典）。"""
    if depth > 40:
        return
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            if isinstance(v, (dict, list)):
                yield from walk_dicts(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            if isinstance(v, (dict, list)):
                yield from walk_dicts(v, depth + 1)


def bb_course_id_from_url(url: str) -> str:
    if not url:
        return ""
    m = BB_COURSE_IN_PATH_RE.search(urlparse(url).path)
    if m:
        return m.group(1)
    qs = parse_qs(urlparse(url).query)
    for key in ("course_id", "courseId", "course"):
        for v in qs.get(key, []):
            if BB_ID_RE.match(v):
                return v
    return ""


def lower_keys(d: dict) -> dict:
    return {str(k).lower(): v for k, v in d.items()}


def scalar_text(v) -> str:
    """把 JSON 里的简单值变成文字；对象/列表/布尔/空值返回空字符串。"""
    if v is None or isinstance(v, bool):
        return ""
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v.strip()
    return ""


def harvest_course_hints(obj, hints: dict[str, str]) -> None:
    """从 JSON 里找“内部课程编号 -> 课程代码”的对应关系（例如 Learn.UQ 的课程列表）。"""
    for d in walk_dicts(obj):
        bbid = d.get("id")
        if not isinstance(bbid, str) or not BB_ID_RE.match(bbid):
            continue
        for key in ("courseId", "displayId", "courseCode", "name", "displayName", "courseName", "title"):
            code = find_course_code(d.get(key) if isinstance(d.get(key), str) else "")
            if code:
                hints.setdefault(bbid, code)
                break
