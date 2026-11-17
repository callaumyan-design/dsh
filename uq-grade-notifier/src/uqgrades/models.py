"""成绩数据的基本结构，以及抓取过程中收集到的原始数据。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

UNGRADED_MARKERS = {
    "",
    "-",
    "--",
    "—",
    "–",
    "n/a",
    "na",
    "null",
    "none",
    "not graded",
    "needs grading",
    "in progress",
    "upcoming",
    "submitted",
    "not submitted",
    "pending",
    "grade pending",
    "not yet released",
    "not released",
    "未评分",
}

_NUM_RE = re.compile(r"^([+-]?\d+(?:\.\d+)?)(\s*%)?$")


def normalize_grade(text) -> str:
    """'85.00' -> '85'，'85.50%' -> '85.5%'，其他文字原样去掉多余空白。"""
    if text is None:
        return ""
    if isinstance(text, bool):
        return ""
    if isinstance(text, (int, float)):
        text = repr(float(text))
    s = re.sub(r"\s+", " ", str(text)).strip()
    m = _NUM_RE.match(s)
    if m:
        num = m.group(1)
        if "." in num:
            num = num.rstrip("0").rstrip(".")
        if num in ("-0", "+0"):
            num = "0"
        num = num.lstrip("+")
        return num + ("%" if m.group(2) else "")
    return s


def is_graded(grade: str) -> bool:
    return normalize_grade(grade).lower() not in UNGRADED_MARKERS


@dataclass
class GradeRecord:
    site: str  # "learn" 或 "myuq"
    course: str  # 课程代码，例如 "COMP3506"
    item: str  # 评估项名称，例如 "Assignment 1"；课程最终成绩为 "最终成绩"
    grade: str = ""  # 显示的成绩，例如 "85"、"7"、"A"；没出成绩为空
    out_of: str = ""  # 满分，例如 "100"
    status: str = ""
    link: str = ""
    item_id: str = ""  # 网站内部的编号（有的话）
    sources: set[str] = field(default_factory=set)  # 产生这条记录的抓取目标编号
    extractor: str = ""

    def __post_init__(self):
        self.grade = normalize_grade(self.grade)
        self.out_of = normalize_grade(str(self.out_of).lstrip("/ ")) if self.out_of not in (None, "") else ""
        self.course = (self.course or "").strip()
        self.item = re.sub(r"\s+", " ", (self.item or "").strip())

    @property
    def graded(self) -> bool:
        return is_graded(self.grade)

    @property
    def value(self) -> str:
        """用于比较是否变化的值。"""
        if not self.graded:
            return ""
        return f"{self.grade}/{self.out_of}" if self.out_of else self.grade

    @property
    def display(self) -> str:
        if not self.graded:
            return "未出成绩"
        if self.out_of and not self.grade.endswith("%"):
            return f"{self.grade}/{self.out_of}"
        return self.grade

    @property
    def item_key(self) -> str:
        return re.sub(r"\s+", " ", self.item.strip().lower())


@dataclass
class JsonCapture:
    url: str
    method: str
    status: int
    data: object
    frame_url: str = ""
    page_url: str = ""
    had_auth_header: bool = False
    target_id: str = ""


@dataclass
class HtmlCapture:
    url: str
    html: str
    kind: str = "raw"  # "raw" = 服务器直接返回的网页；"dom" = 浏览器渲染后的页面快照
    method: str = "GET"
    status: int = 200
    title: str = ""
    target_id: str = ""


@dataclass
class CaptureSet:
    json: list[JsonCapture] = field(default_factory=list)
    html: list[HtmlCapture] = field(default_factory=list)
    course_hints: dict[str, str] = field(default_factory=dict)  # 网站内部课程编号 -> 课程代码

    def extend(self, other: CaptureSet) -> None:
        self.json.extend(other.json)
        self.html.extend(other.html)
        for k, v in other.course_hints.items():
            self.course_hints.setdefault(k, v)
