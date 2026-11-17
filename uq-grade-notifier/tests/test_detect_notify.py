from __future__ import annotations

import pytest

from uqgrades import notify
from uqgrades.config import BarkConfig
from uqgrades.detect import GradeEvent, apply_records
from uqgrades.models import GradeRecord
from uqgrades.store import Store


def rec(item, grade, course="COMP3506", site="learn", src="t1", out_of="100"):
    return GradeRecord(site, course, item, grade=grade, out_of=out_of, link=f"https://x/{course}", sources={src})


def test_first_run_is_baseline_then_new_and_changed():
    s = Store(":memory:")
    r1 = apply_records(s, [rec("A1", "80"), rec("A2", "-")], new_targets={"t1"})
    assert r1.events == [] and r1.baseline_records == 1 and s.count() == 2

    # 没变化
    r2 = apply_records(s, [rec("A1", "80"), rec("A2", "-")], new_targets=set())
    assert r2.events == []

    # A2 出成绩、A1 改分、新增 A3
    r3 = apply_records(s, [rec("A1", "82"), rec("A2", "70"), rec("A3", "9", out_of="10")], new_targets=set())
    got = {(e.kind, e.item, e.old_display, e.new_display) for e in r3.events}
    assert got == {("changed", "A1", "80/100", "82/100"), ("new", "A2", "", "70/100"), ("new", "A3", "", "9/10")}
    hist = s.recent_history(10)
    assert {h["kind"] for h in hist} == {"new", "changed"}


def test_grade_hidden_then_republished():
    s = Store(":memory:")
    apply_records(s, [rec("A1", "80")], new_targets={"t1"})
    r = apply_records(s, [rec("A1", "")], new_targets=set())
    assert r.events == []
    assert s.recent_history(1)[0]["kind"] == "hidden"
    r = apply_records(s, [rec("A1", "80")], new_targets=set())
    assert [e.kind for e in r.events] == ["new"]


def test_record_from_new_target_is_baseline_only():
    s = Store(":memory:")
    apply_records(s, [rec("A1", "80", src="old")], new_targets={"old"})
    r = apply_records(s, [rec("B1", "50", course="MATH1051", src="new"), rec("A2", "1", src="old")], new_targets={"new"})
    assert [e.item for e in r.events] == ["A2"]
    assert r.baseline_records == 1


def test_payloads_queued_atomically_with_records():
    s = Store(":memory:")
    apply_records(s, [rec("A1", "80")], new_targets={"t1"})
    bark = BarkConfig(key="k")
    apply_records(s, [rec("A1", "90")], new_targets=set(), make_payloads=lambda evs: notify.build_grade_payloads(evs, bark))
    pend = s.pending()
    assert len(pend) == 1 and pend[0][1]["body"] == "A1：80/100 → 90/100"

    def boom(evs):
        raise RuntimeError("x")

    with pytest.raises(RuntimeError):
        apply_records(s, [rec("A1", "95")], new_targets=set(), make_payloads=boom)
    # 出错时整笔回滚：成绩还是 90，不会“记录更新了但推送丢了”
    assert s.get("learn", "COMP3506", "a1").value == "90/100"


def ev(kind, item, new, old="", course="COMP3506", site="learn"):
    return GradeEvent(kind=kind, site=site, course=course, item=item, new_display=new, old_display=old, link=f"https://l/{course}")


def test_payload_grouping_and_privacy():
    events = [ev("new", "A1", "8/10"), ev("changed", "A2", "9/10", "7/10"), ev("new", "最终成绩", "7", course="MATH1051", site="myuq")]
    normal = notify.build_grade_payloads(events, BarkConfig(key="k"))
    assert normal == [
        {"title": "COMP3506 成绩有更新（2 项）", "subtitle": "Learn.UQ", "body": "A1：8/10\nA2：7/10 → 9/10", "url": "https://l/COMP3506"},
        {"title": "MATH1051 有新成绩", "subtitle": "my.UQ", "body": "最终成绩：7", "url": "https://l/MATH1051"},
    ]
    private = notify.build_grade_payloads(events, BarkConfig(key="k", privacy_mode=True))
    assert [(p["title"], p["body"]) for p in private] == [("UQ 成绩提醒", "COMP3506 成绩有更新"), ("UQ 成绩提醒", "MATH1051 有新成绩")]
    for p in private:
        assert not any(ch.isdigit() for ch in p["body"].replace("3506", "").replace("1051", ""))


def test_send_and_flush_with_fake_bark(fake):
    st = fake.state
    bark = BarkConfig(key=st.bark_key, server=st.url("bark", ""), sound="minuet")
    notify.send(bark, {"title": "T", "body": "B", "url": "https://u", "subtitle": "S"})
    assert st.pushes[-1] == {
        "device_key": st.bark_key, "title": "T", "body": "B", "group": "UQ 成绩", "level": "active",
        "isArchive": "1", "subtitle": "S", "url": "https://u", "sound": "minuet",
    }
    with pytest.raises(notify.PushError, match="密钥不对"):
        notify.send(BarkConfig(key="wrong", server=bark.server), {"title": "T"})
    with pytest.raises(notify.PushError, match="还没有填写"):
        notify.send(BarkConfig(key=""), {"title": "T"})
    with pytest.raises(notify.PushError, match="连不上"):
        notify.send(BarkConfig(key="k", server="http://127.0.0.1:9"), {"title": "T"}, timeout=3)

    s = Store(":memory:")
    s.add_pending({"title": "one", "body": "1"})
    s.conn.commit()
    ok, failed = notify.flush_pending(s, BarkConfig(key="wrong", server=bark.server))
    assert (ok, failed) == (0, 1) and len(s.pending()) == 1  # 失败的留着下次再发
    ok, failed = notify.flush_pending(s, bark)
    assert (ok, failed) == (1, 0) and s.pending() == []


def test_test_payloads_follow_privacy_setting():
    normal = notify.test_payloads(BarkConfig(key="k"))
    assert "85/100" in normal[1]["body"]
    private = notify.test_payloads(BarkConfig(key="k", privacy_mode=True))
    assert "85" not in private[1]["body"]


def test_warns_once_when_a_page_stops_yielding_grades():
    from uqgrades.runner import SILENT_TARGET_RUNS, _check_silent_targets

    s = Store(":memory:")
    labels = {"tA": "COMP3506", "tB": "my.UQ"}
    _check_silent_targets(s, [rec("A1", "80", src="tA")], {"tA", "tB"}, labels, push=True)
    for _ in range(SILENT_TARGET_RUNS + 2):  # tA 突然一条都没有了；tB 从来没有过，不算
        _check_silent_targets(s, [], {"tA", "tB"}, labels, push=True)
    pend = [p for _, p in s.pending()]
    assert len(pend) == 1 and "COMP3506" in pend[0]["body"] and "my.UQ" not in pend[0]["body"]
    # 恢复正常后再出问题，会再提醒一次
    _check_silent_targets(s, [rec("A1", "80", src="tA")], {"tA"}, labels, push=True)
    for _ in range(SILENT_TARGET_RUNS):
        _check_silent_targets(s, [], {"tA"}, labels, push=True)
    assert len(s.pending()) == 2
