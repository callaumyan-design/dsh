"""统一数据模型：状态枚举、各来源状态映射表、观测条目、名称归一化。

映射表与 sources.md 保持一致；改动时两边一起改。
注意：Compatible / “能运行” / 未声明 ≠ 适配，一律映射为 none 或 unknown。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

PERFECT, FULL, PARTIAL, NONE, UNKNOWN = "perfect", "full", "partial", "none", "unknown"
DISPUTED = "disputed"  # 仅用于综合判定
STATUSES = (PERFECT, FULL, PARTIAL, NONE, UNKNOWN)
ADAPTED = (PERFECT, FULL, PARTIAL)
STATUS_LABEL = {
    PERFECT: "完美适配", FULL: "已适配", PARTIAL: "部分适配", NONE: "未适配",
    UNKNOWN: "未知", DISPUTED: "有争议",
}
STATUS_ORDER = {PARTIAL: 1, FULL: 2, PERFECT: 3}

# 来源 -> {原始枚举: 统一状态}
STATUS_MAP: dict[str, dict[str, str]] = {
    # 苹果官方合集「Great Apps and Games on iPhone Duo」：被收录即官方优化
    "apple_story": {"featured": PERFECT},
    # 本工具对 releaseNotes 的关键词扫描：命中即「官方疑似适配」
    "release_notes": {"strong_hit": FULL, "weak_hit": FULL},
    # shipeiduo.com（已收录 App 与网友投稿同一套枚举）
    "shipeiduo": {"perfect": PERFECT, "full": FULL, "partial": PARTIAL, "none": NONE, "unverified": UNKNOWN},
    "shipeiduo_submission": {"perfect": PERFECT, "full": FULL, "partial": PARTIAL, "none": NONE, "unverified": UNKNOWN},
    # duo.xiaoxinnote.com：verification.status；无 verification = 待核实(pending)
    "xiaoxinnote": {"adapted": FULL, "partial": PARTIAL, "unsupported": NONE, "inProgress": UNKNOWN, "pending": UNKNOWN},
    # duotoday.com：tier（只收录已支持的 App，未收录 ≠ 未适配，因此没有 none）
    "duotoday": {"made_for": PERFECT, "optimized": FULL},
    # foldhunt.com：data-status（Partner/Verified/App Store/Claimed/Not announced）
    "foldhunt": {"official": PERFECT, "verified": FULL, "store": FULL, "claimed": FULL, "unconfirmed": NONE},
    # duoappcheck.com
    "duoappcheck": {"ready": FULL, "not-ready": NONE, "unknown": UNKNOWN},
    # duoappsupport.com：Fully supported / Limited / Not optimized / Unverified
    "duoappsupport": {"full": FULL, "lim": PARTIAL, "no": NONE, "unv": UNKNOWN},
    # duoregistry.com/duo-support：Duo-native / Scaled up / Unverified
    "duoregistry": {"Duo-native": FULL, "Scaled up": PARTIAL, "Unverified": UNKNOWN},
    # duodiscover.com：Built for Duo(=Made for iPhone Duo) / Adapted / Compatible(原样运行，带黑边)
    "duodiscover": {"Built for Duo": PERFECT, "Adapted": FULL, "Compatible": NONE},
    # iphoneapplicationlist.com：只收录已就绪的 App
    "iphoneapplicationlist": {"Published update": FULL, "Developer-confirmed": FULL},
}

# 证据权重（综合判定用）。官方合集 > 更新说明明确提及 > 多站一致(累加) > 单站 > 单条投稿
SOURCE_WEIGHT = {
    "apple_story": 100,
    "release_notes": 60,           # strong_hit；weak_hit 见 WEAK_KEYWORD_WEIGHT
    "shipeiduo": 30, "xiaoxinnote": 30, "duotoday": 30, "foldhunt": 30, "duoappcheck": 30,
    "duoappsupport": 30, "duoregistry": 30, "duodiscover": 30, "iphoneapplicationlist": 30,
    "shipeiduo_submission": 10,
}
WEAK_KEYWORD_WEIGHT = 15
# 某些原始状态证据较弱（开发者自称/未实测），按比例降权
RAW_STATUS_WEIGHT_FACTOR = {
    ("foldhunt", "claimed"): 0.5,
    ("iphoneapplicationlist", "Developer-confirmed"): 0.5,
    ("duotoday", "low"): 0.5,  # confidence=low
}
OFFICIAL_SOURCES = {"apple_story"}
TRACKER_SOURCES = {"shipeiduo", "xiaoxinnote", "duotoday", "foldhunt", "duoappcheck",
                   "duoappsupport", "duoregistry", "duodiscover", "iphoneapplicationlist"}
SOURCE_LABEL = {
    "apple_story": "苹果官方合集", "release_notes": "更新说明关键词", "shipeiduo": "shipeiduo",
    "shipeiduo_submission": "shipeiduo 网友投稿", "xiaoxinnote": "Duo Tracker (xiaoxinnote)",
    "duotoday": "Duo Today", "foldhunt": "FoldHunt", "duoappcheck": "DuoAppCheck",
    "duoappsupport": "Duo App Support", "duoregistry": "Duo Registry", "duodiscover": "DuoDiscover",
    "iphoneapplicationlist": "iPhoneApplicationList",
}


def map_status(source: str, raw: str | None) -> str:
    if raw is None:
        return UNKNOWN
    return STATUS_MAP.get(source, {}).get(raw, UNKNOWN)


@dataclass
class SourceItem:
    """某来源一次抓取中的一个条目（尚未与 App 主键匹配）。"""
    source: str
    key: str                      # 来源内唯一键（slug / id）
    name: str
    raw_status: str | None
    status: str
    region: str | None = None     # cn / us / None(未知)
    store_id: str | None = None
    bundle_id: str | None = None
    alt_names: list[str] = field(default_factory=list)
    evidence: str = ""
    url: str = ""
    votes: dict[str, Any] | None = None
    observed_at: str | None = None  # 来源给出的时间（adaptedAt/checkedAt/eventDate…）
    weight_factor: float = 1.0
    extra: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- 名称归一化
_SUFFIX_SPLIT = re.compile(r"\s*(?:[-–—|:：·・]|\s\(|（)\s*")
_DROP = re.compile(r"[\s　®™©℠'’\"“”!！.。,，]+")


def norm_name(name: str) -> str:
    """去全角/半角差异（NFKC）、大小写、空白与常见符号。"""
    s = unicodedata.normalize("NFKC", name or "").lower()
    return _DROP.sub("", s)


def base_name(name: str) -> str:
    """去掉「-」「:」「|」「（」等之后的副标题，再归一化。"""
    s = unicodedata.normalize("NFKC", name or "").strip()
    head = _SUFFIX_SPLIT.split(s, maxsplit=1)[0]
    return norm_name(head or s)


def name_keys(name: str) -> set[str]:
    keys = {norm_name(name), base_name(name)}
    return {k for k in keys if k}


def store_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"/id(\d{6,12})", url)
    return m.group(1) if m else None


def region_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"apps\.apple\.com/([a-z]{2})/", url)
    return m.group(1) if m else None
