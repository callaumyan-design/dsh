from __future__ import annotations

from uqgrades.config import parse_config_text
from uqgrades.extract import extract_all, merge_records
from uqgrades.extract.blackboard import extract_gradebook_json, extract_mygrades_html
from uqgrades.extract.common import find_course_code, harvest_course_hints
from uqgrades.extract.generic import extract_final_grades_json, extract_final_grades_table
from uqgrades.models import CaptureSet, GradeRecord, HtmlCapture, JsonCapture, is_graded, normalize_grade

from .fakesite import FIXTURES

CFG = parse_config_text("")


def mygrades_html(a1="85.00", q1="", secret="x"):
    html = (FIXTURES / "bb_mygrades.html").read_text(encoding="utf-8")
    q = f'<span class="grade">{q1}</span><span class="pointsPossible">/10</span>' if q1 else '<img title="Needs Grading" alt="Needs Grading">'
    return html.replace("{a1}", a1).replace("{q1}", q).replace("{secret}", secret)


def test_normalize_grade():
    assert normalize_grade("85.00") == "85"
    assert normalize_grade("85.50") == "85.5"
    assert normalize_grade(" 85.50 % ") == "85.5%"
    assert normalize_grade(19.0) == "19"
    assert normalize_grade(7) == "7"
    assert normalize_grade("A+") == "A+"
    assert normalize_grade(None) == ""
    assert normalize_grade(True) == ""
    assert not is_graded("-") and not is_graded("Needs Grading") and not is_graded("")
    assert is_graded("0") and is_graded("F") and is_graded("Complete")


def test_record_display_and_value():
    r = GradeRecord("learn", "COMP3506", "A1", grade="85.00", out_of="/100")
    assert r.display == "85/100" and r.value == "85/100"
    assert GradeRecord("learn", "X", "Y", grade="85%", out_of="100").display == "85%"
    assert GradeRecord("myuq", "X", "最终成绩", grade="7").display == "7"
    assert GradeRecord("learn", "X", "Y", grade="-").display == "未出成绩"


def test_course_code():
    assert find_course_code("COMP3506/7505 Algorithms") == "COMP3506"
    assert find_course_code("MATH1051S_7620_22612") == "MATH1051"
    assert find_course_code("XCOMP3506") == ""
    assert find_course_code("COMP35061") == ""


def test_blackboard_mygrades_html():
    cap = HtmlCapture(url="https://learn.uq.edu.au/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_9_1", html=mygrades_html(), target_id="t1")
    recs = extract_mygrades_html(cap, "learn", {})
    assert [(r.course, r.item, r.display, r.item_id) for r in recs] == [
        ("COMP3506", "Assignment 1: Sorting", "85/100", "5101"),
        ("COMP3506", "Quiz 1", "未出成绩", "5102"),
        ("COMP3506", "Final Exam", "未出成绩", "5103"),
    ]
    assert recs[1].status == "Needs Grading"
    assert recs[0].link == cap.url and recs[0].sources == {"t1"}
    # 内部课程编号有对应关系时，优先使用
    recs = extract_mygrades_html(cap, "learn", {"_9_1": "ABCD1234"})
    assert recs[0].course == "ABCD1234"


def test_blackboard_mygrades_html_not_a_grades_page():
    cap = HtmlCapture(url="https://learn.uq.edu.au/", html="<html><body><table><tr><td>x</td></tr></table></body></html>")
    assert extract_mygrades_html(cap, "learn", {}) == []


def _json(url, data, tid="", frame=""):
    return JsonCapture(url=url, method="GET", status=200, data=data, target_id=tid, frame_url=frame)


def test_blackboard_gradebook_json_join_and_variants():
    cols = _json(
        "https://learn.uq.edu.au/learn/api/v1/courses/_5_1/gradebook/columns",
        {"results": [
            {"id": "_1_1", "columnName": "Lab 1", "score": {"possible": 10}, "gradebookCategoryId": "_c"},
            {"id": "_2_1", "name": "Essay", "possible": 50, "contentId": "_x"},
            {"id": "_3_1", "columnName": "Participation", "grading": {"type": "Manual"}},
            {"id": "_4_1", "columnName": "Weighted", "score": {"possible": 100}},
        ]},
        "tc",
    )
    grades = _json(
        "https://learn.uq.edu.au/learn/api/v1/courses/_5_1/gradebook/grades?userId=_7_1",
        {"results": [
            {"columnId": "_1_1", "status": "Graded", "displayGrade": {"scaleType": "Score", "score": 9.5, "text": "9.50"}},
            {"columnId": "_2_1", "status": "Graded", "score": 41},
            {"columnId": "_3_1", "status": "Graded", "text": "Complete"},
            {"columnId": "_4_1", "status": "Graded", "displayGrade": {"scaleType": "Percent", "score": 77.5}},
            {"columnId": "_99_1", "status": "Graded", "score": 1},  # 找不到名称，跳过
        ]},
        "tg",
        frame="https://learn.uq.edu.au/ultra/courses/_5_1/grades",
    )
    recs = extract_gradebook_json([(cols, "learn"), (grades, "learn")], {"_5_1": "PHYS1001"})
    got = {(r.course, r.item): (r.display, r.sources) for r in recs}
    assert got == {
        ("PHYS1001", "Lab 1"): ("9.5/10", {"tc", "tg"}),
        ("PHYS1001", "Essay"): ("41/50", {"tc", "tg"}),
        ("PHYS1001", "Participation"): ("Complete", {"tc", "tg"}),
        ("PHYS1001", "Weighted"): ("77.5%", {"tc", "tg"}),
    }
    assert all(r.link.endswith("/ultra/courses/_5_1/grades") for r in recs)


def test_course_hints_from_memberships():
    hints = {}
    harvest_course_hints(
        {"results": [{"id": "_m", "course": {"id": "_5_1", "courseId": "PHYS1001S_7620", "name": "Physics"}},
                     {"id": "_6_1", "name": "No code here"}]},
        hints,
    )
    assert hints == {"_5_1": "PHYS1001"}


def test_generic_final_grades_json():
    cap = _json(
        "https://api.my.uq.edu.au/results",
        {"data": {"enrolments": [
            {"courseCode": "COMP3506", "term": {"description": "Semester 1, 2026"}, "finalGrade": 7},
            {"code": "MATH1051", "semester": "Semester 1, 2026", "grade": None},
            {"courseCode": "STAT1201", "status": "Enrolled", "result": "Enrolled"},
            {"courseCode": "XXXX", "grade": "7"},
        ]}},
        "t",
        frame="https://my.uq.edu.au/grades",
    )
    recs = extract_final_grades_json(cap, "myuq")
    got = {(r.course, r.item): r.display for r in recs}
    assert got == {
        ("COMP3506", "最终成绩（Semester 1, 2026）"): "7",
        ("MATH1051", "最终成绩（Semester 1, 2026）"): "未出成绩",
        ("STAT1201", "最终成绩"): "未出成绩",
    }


def test_generic_final_grades_table():
    html = """<table><tr><th>Course Code</th><th>Title</th><th>Semester</th><th>Grading basis</th><th>Grade</th></tr>
    <tr><td>COMP3506</td><td>Algorithms</td><td>Sem 1 2026</td><td>Graded</td><td>6</td></tr>
    <tr><td>Total units</td><td></td><td></td><td></td><td>8</td></tr></table>
    <table><tr><th>Name</th><th>Value</th></tr><tr><td>COMP3506</td><td>x</td></tr></table>"""
    recs = extract_final_grades_table(HtmlCapture(url="https://my.uq.edu.au/r", html=html), "myuq")
    assert [(r.course, r.item, r.display) for r in recs] == [("COMP3506", "最终成绩（Sem 1 2026）", "6")]


def test_extract_all_routes_by_site_and_merges():
    caps = CaptureSet()
    caps.html.append(HtmlCapture(url="https://learn.uq.edu.au/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_9_1", html=mygrades_html(), kind="raw", target_id="a"))
    caps.html.append(HtmlCapture(url="https://learn.uq.edu.au/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_9_1", html=mygrades_html(), kind="dom", target_id="b"))
    # 别的网站上的同样网页不会被当成 Learn.UQ
    caps.html.append(HtmlCapture(url="https://example.com/x", html=mygrades_html()))
    # 登录页不解析
    caps.html.append(HtmlCapture(url="https://auth.uq.edu.au/x", html="<table><tr><th>Course</th><th>Grade</th></tr><tr><td>COMP1000</td><td>7</td></tr></table>"))
    recs = extract_all(caps, CFG)
    assert len(recs) == 3
    assert recs[0].sources == {"a", "b"}


def test_merge_same_name_different_ids():
    recs = merge_records([
        GradeRecord("learn", "C", "Quiz", grade="1", item_id="_1_1"),
        GradeRecord("learn", "C", "Quiz", grade="2", item_id="_2_1"),
        GradeRecord("learn", "C", "Quiz", grade="", item_id=""),
    ])
    assert [(r.item, r.grade) for r in recs] == [("Quiz", "1"), ("Quiz (2)", "2")]
