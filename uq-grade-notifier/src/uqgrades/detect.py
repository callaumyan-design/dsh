"""和上一次的记录对比，找出“新出的成绩”和“发生变化的成绩”。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from .models import GradeRecord
from .store import Store, now_iso


@dataclass
class GradeEvent:
    kind: str  # "new" 或 "changed"
    site: str
    course: str
    item: str
    new_display: str
    old_display: str = ""
    link: str = ""


@dataclass
class ApplyResult:
    events: list[GradeEvent] = field(default_factory=list)
    baseline_records: int = 0
    total_records: int = 0
    graded_records: int = 0


def _display(grade: str, out_of: str) -> str:
    return GradeRecord(site="", course="", item="", grade=grade, out_of=out_of).display


def apply_records(
    store: Store,
    records: list[GradeRecord],
    *,
    new_targets: set[str],
    make_payloads: Callable[[list[GradeEvent]], list[dict]] | None = None,
    at: str | None = None,
) -> ApplyResult:
    """把这次抓到的成绩写进本地记录，返回需要推送的变化。

    new_targets：这次第一次成功抓取的目标。只来自这些目标的成绩只作为基准记录，不推送
    （第一次运行、或者重新探查后新增的页面，都属于这种情况）。
    推送内容和成绩记录在同一个事务里写入，保证“记录更新了但推送丢了”不会发生。
    """
    at = at or now_iso()
    result = ApplyResult(total_records=len(records))
    store_was_empty = store.count() == 0
    with store.transaction():
        for r in records:
            old = store.get(r.site, r.course, r.item_key)
            if r.sources:
                baseline_only = bool(r.sources & new_targets)
            else:
                baseline_only = store_was_empty
            kind = None
            if r.graded:
                result.graded_records += 1
                if old is None or not old.value:
                    kind = "new"
                elif old.value != r.value:
                    kind = "changed"
            if kind and baseline_only:
                result.baseline_records += 1
                kind = None
            if kind:
                ev = GradeEvent(
                    kind=kind,
                    site=r.site,
                    course=r.course,
                    item=r.item,
                    new_display=r.display,
                    old_display=_display(old.grade, old.out_of) if (old and old.value) else "",
                    link=r.link or (old.link if old else ""),
                )
                result.events.append(ev)
                store.add_history(
                    site=r.site,
                    course=r.course,
                    item=r.item,
                    old_value=old.value if old else "",
                    new_value=r.value,
                    kind=kind,
                    notified=True,
                    at=at,
                )
            elif old is not None and old.value and not r.value:
                store.add_history(
                    site=r.site,
                    course=r.course,
                    item=r.item,
                    old_value=old.value,
                    new_value="",
                    kind="hidden",
                    notified=False,
                    at=at,
                )
            store.upsert(
                site=r.site,
                course=r.course,
                item_key=r.item_key,
                item=r.item,
                grade=r.grade,
                out_of=r.out_of,
                value=r.value,
                status=r.status,
                link=r.link,
                at=at,
            )
        if make_payloads and result.events:
            for payload in make_payloads(result.events):
                store.add_pending(payload)
    return result
