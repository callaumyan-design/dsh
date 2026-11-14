"""更新说明关键词扫描 + 综合判定。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model import (ADAPTED, DISPUTED, NONE, OFFICIAL_SOURCES, STATUS_ORDER, TRACKER_SOURCES, UNKNOWN)

# ---------------------------------------------------------------------------- 关键词
# 规格给定的关键词：中文 Duo、折叠、外屏、内屏、大屏、展开、双屏、分屏；英文 Duo、fold、foldable、inner display、cover screen。
# 任一命中即「官方疑似适配」。为了降低“展开更多”“iPad 分屏”之类误报，按特异性分强/弱两档，弱命中权重更低。
_A = r"(?<![A-Za-z])"
_Z = r"(?![A-Za-z])"
STRONG_PATTERNS = {
    "iPhone Duo": r"iPhone\s*Duo",
    # 单独的 “Duo” 太宽（多邻国吉祥物也叫 Duo），只有与适配类词语相邻时才算强命中
    "Duo+适配语境": r"(?:适配|支持|优化|针对|for(?:\s+the)?(?:\s+new)?)\s*Duo" + _Z
                   + r"|" + _A + r"Duo\s*(?:适配|优化|布局|界面|版|半折叠|折叠|展开|屏|layout|support|form\s+factor|optimi[sz]ed|ready)",
    "折叠屏": r"折叠屏|折疊屏|折叠设备|折叠机",
    "内屏": r"内屏|內屏",
    "外屏": r"外屏",
    "foldable": _A + r"foldables?" + _Z,
    "inner display": r"inner\s+(?:display|screen)",
    "cover screen": r"cover\s+(?:screen|display)|outer\s+display",
}
WEAK_PATTERNS = {
    "Duo": _A + r"Duo" + _Z,
    "折叠": r"折叠|折疊",
    "展开": r"展开|展開",
    "大屏": r"大屏",
    "双屏": r"双屏|雙屏",
    "分屏": r"分屏",
    "fold": _A + r"(?:un)?fold(?:s|ed|ing)?" + _Z,
}


def scan_release_notes(text: str | None) -> dict:
    """返回 {"strong": [...], "weak": [...], "snippets": [...]}。"""
    text = text or ""
    res = {"strong": [], "weak": [], "snippets": []}
    for label, pats, bucket in (("s", STRONG_PATTERNS, "strong"), ("w", WEAK_PATTERNS, "weak")):
        for kw, pat in pats.items():
            m = re.search(pat, text, 0 if kw == "Duo" else re.I)
            if m:
                res[bucket].append(kw)
                a, b = max(0, m.start() - 40), min(len(text), m.end() + 60)
                snip = text[a:b].replace("\n", " ")
                if not any(snip in x or x in snip for x in res["snippets"]):
                    res["snippets"].append(snip)
    # 强命中已覆盖的弱词（如「折叠屏」里的「折叠」）不重复计
    if res["strong"]:
        covered = {"折叠": "折叠屏", "Duo": "iPhone Duo"}
        res["weak"] = [w for w in res["weak"]
                       if not (covered.get(w) in res["strong"] or (w == "Duo" and "Duo+适配语境" in res["strong"]))]
    return res


# ---------------------------------------------------------------------------- 判定
DISPUTE_MIN_WEIGHT = 20   # 冲突双方都至少有一个“站点级”证据才判 disputed
STALE_NEGATIVE_FACTOR = 0.25  # 早于当前版本的「未适配」结论只保留 1/4 权重（低于争议阈值）


def mark_stale(claims: list["Claim"], current_release: str | None):
    """未适配结论如果是在 App 当前版本发布之前做出的，就不能代表当前版本 → 降权并标注。
    适配类结论不衰减（适配一旦发生不会因新版本消失）。"""
    if not current_release:
        return
    cur = current_release[:10]
    for c in claims:
        if c.status == NONE and c.observed_at and c.observed_at[:10] < cur:
            c.stale = True
            c.weight = round(c.weight * STALE_NEGATIVE_FACTOR, 2)


@dataclass
class Claim:
    source: str
    status: str
    weight: float
    raw_status: str | None = None
    evidence: str = ""
    url: str = ""
    votes: dict | None = None
    disputed_votes: bool = False
    observed_at: str | None = None
    stale: bool = False          # 「未适配」结论早于 App 当前版本发布 → 降权

    def as_dict(self):
        return {k: v for k, v in self.__dict__.items() if v not in (None, "", False)}


@dataclass
class Verdict:
    status: str
    confidence: str
    score: float
    reason: str = ""
    claims: list[Claim] = field(default_factory=list)


def _pick_adapted(weights: dict[str, float]) -> str:
    # 权重最高者；并列时取更保守（级别更低）的
    return sorted(weights.items(), key=lambda kv: (-kv[1], STATUS_ORDER.get(kv[0], 0)))[0][0]


def decide(claims: list[Claim]) -> Verdict:
    real = [c for c in claims if c.status != UNKNOWN]
    if not real:
        return Verdict(UNKNOWN, "none", 0, "无任何来源给出明确结论", claims)

    official = [c for c in real if c.source in OFFICIAL_SOURCES]
    if official:
        st = max((c.status for c in official), key=lambda s: STATUS_ORDER.get(s, 0))
        return Verdict(st, "official", sum(c.weight for c in official), "苹果官方合集收录", claims)

    # 弱关键词命中（「展开」「大屏」、单独的 Duo…）只作提示，不参与正反权重比较
    weak = [c for c in real if c.source == "release_notes" and c.raw_status == "weak_hit"]
    counted = [c for c in real if not c.disputed_votes and c not in weak]
    if not counted:
        if weak:
            return Verdict(UNKNOWN, "suspected", 0, "仅更新说明弱关键词命中，疑似，待其它来源确认", claims)
        return Verdict(DISPUTED, "submission", 0, "仅有网友投稿且票数有争议（适配票−不适配票 ≤ 0）", claims)

    adapted = [c for c in counted if c.status in ADAPTED]
    negative = [c for c in counted if c.status == NONE]
    a_w = sum(c.weight for c in adapted)
    n_w = sum(c.weight for c in negative)
    a_strong = any(c.weight >= DISPUTE_MIN_WEIGHT for c in adapted)
    n_strong = any(c.weight >= DISPUTE_MIN_WEIGHT for c in negative)
    only_subs = all(c.source == "shipeiduo_submission" for c in counted)

    if (a_strong and n_strong) or (only_subs and adapted and negative):
        return Verdict(DISPUTED, "conflict", a_w - n_w,
                       f"来源冲突：适配方权重 {a_w:.0f} vs 未适配方 {n_w:.0f}", claims)
    if a_w == n_w:
        return Verdict(DISPUTED, "conflict", 0, "正反证据权重相同", claims)

    if a_w > n_w:
        per = {}
        for c in adapted:
            per[c.status] = per.get(c.status, 0) + c.weight
        status, winners = _pick_adapted(per), adapted
    else:
        status, winners = NONE, negative

    srcs = {c.source for c in winners}
    if "release_notes" in srcs and any(c.source == "release_notes" and c.raw_status == "strong_hit" for c in winners):
        conf = "release_notes"
    elif len(srcs & TRACKER_SOURCES) >= 2:
        conf = "multi_source"
    elif srcs & TRACKER_SOURCES:
        conf = "single_source"
    else:
        conf = "submission"
    reason = f"{len(srcs)} 个来源支持，权重 {max(a_w, n_w):.0f}" + (f"（反方 {min(a_w, n_w):.0f}）" if min(a_w, n_w) else "")
    return Verdict(status, conf, max(a_w, n_w), reason, claims)


HOLDABLE = set(ADAPTED) | {NONE}


def apply_hold(proposed: Verdict, prev: dict | None, version_sig: str) -> dict:
    """「自上次判定以来没有新版本 → 维持原判定」。

    以“当前判定确立时的版本”(status_version) 为准：只有版本变了，状态才允许在 适配/未适配 之间切换；
    从 unknown / disputed 出发、或有官方证据时不受限制（属于首次定性或权威更正）。
    """
    if prev is None:
        return {"status": proposed.status, "held": 0, "proposed": None, "status_version": version_sig,
                "changed": 0, "prev": None}
    prev_status = prev["status"]
    if proposed.status == prev_status:
        return {"status": prev_status, "held": 0, "proposed": None, "status_version": prev["status_version"] or version_sig,
                "changed": 0, "prev": prev_status}
    same_version = (prev["status_version"] or "") == version_sig
    refinement = prev_status in ADAPTED and proposed.status in ADAPTED  # 已适配内部的级别细化不受限
    if prev_status in HOLDABLE and same_version and not refinement and proposed.confidence != "official" and proposed.status != UNKNOWN:
        return {"status": prev_status, "held": 1, "proposed": proposed.status, "status_version": prev["status_version"],
                "changed": 0, "prev": prev_status}
    if proposed.status == UNKNOWN and prev_status in HOLDABLE:
        # 来源当天缺失（抓取失败等）不应把已有结论冲掉
        return {"status": prev_status, "held": 1, "proposed": UNKNOWN, "status_version": prev["status_version"],
                "changed": 0, "prev": prev_status}
    return {"status": proposed.status, "held": 0, "proposed": None, "status_version": version_sig,
            "changed": 1, "prev": prev_status}
