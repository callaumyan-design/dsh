"""抓取目标：以后每次自动查询要访问哪些地址。全部由探查录制生成，保存在 data/targets.json。

三种目标：
- json_get：直接请求数据接口（GET，只靠登录 cookie 就能访问的接口）。最快。
- html_get：直接下载网页原文再解析（服务器直接给出成绩的网页）。
- render：用无头浏览器完整打开页面，收集页面加载时的数据并读取渲染后的内容。
          用于需要页面里的脚本带令牌才能访问的接口、或者成绩是页面脚本画出来的情况。
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime

from .config import Config
from .models import CaptureSet, GradeRecord
from .paths import Paths

KIND_LABELS = {"json_get": "数据接口", "html_get": "网页", "render": "浏览器打开页面"}


@dataclass
class Target:
    id: str
    site: str
    kind: str
    url: str
    page_url: str = ""
    label: str = ""


@dataclass
class TargetFile:
    targets: list[Target] = field(default_factory=list)
    course_hints: dict[str, str] = field(default_factory=dict)
    generated_at: str = ""
    probe_dir: str = ""

    def to_json(self) -> str:
        return json.dumps(
            {
                "version": 1,
                "generated_at": self.generated_at,
                "probe_dir": self.probe_dir,
                "course_hints": self.course_hints,
                "targets": [asdict(t) for t in self.targets],
            },
            ensure_ascii=False,
            indent=2,
        )


def target_id(kind: str, url: str) -> str:
    return "t-" + hashlib.sha1(f"{kind}|{url}".encode()).hexdigest()[:12]


def load_targets(paths: Paths) -> TargetFile:
    f = paths.targets
    if not f.exists():
        return TargetFile()
    data = json.loads(f.read_text(encoding="utf-8"))
    return TargetFile(
        targets=[Target(**t) for t in data.get("targets", [])],
        course_hints=dict(data.get("course_hints", {})),
        generated_at=data.get("generated_at", ""),
        probe_dir=data.get("probe_dir", ""),
    )


def save_targets(paths: Paths, tf: TargetFile, *, merge: bool = False) -> TargetFile:
    paths.ensure()
    if paths.targets.exists():
        old = load_targets(paths)
        backup = paths.targets.with_name("targets.previous.json")
        backup.write_text(old.to_json(), encoding="utf-8")
        if merge:
            known = {t.id for t in tf.targets}
            tf.targets = tf.targets + [t for t in old.targets if t.id not in known]
            for k, v in old.course_hints.items():
                tf.course_hints.setdefault(k, v)
    tmp = paths.targets.with_suffix(".tmp")
    tmp.write_text(tf.to_json(), encoding="utf-8")
    os.replace(tmp, paths.targets)
    return tf


def tag_probe_captures(captures: CaptureSet, cfg: Config) -> dict[str, tuple[Target, str]]:
    """给探查时抓到的每份数据分配一个“候选目标”编号。返回 {编号: (目标, 来源类型)}。"""
    cands: dict[str, tuple[Target, str]] = {}

    def add(kind: str, url: str, page_url: str, origin: str) -> str:
        site = cfg.site_for_url(url) or cfg.site_for_url(page_url)
        tid = target_id(kind, url)
        if tid not in cands:
            cands[tid] = (Target(id=tid, site=site.id if site else "", kind=kind, url=url, page_url=page_url), origin)
        return tid

    for cap in captures.json:
        if cap.method.upper() == "GET" and not cap.had_auth_header and 200 <= cap.status < 300:
            cap.target_id = add("json_get", cap.url, cap.frame_url or cap.page_url, "json")
        else:
            render_url = cap.frame_url or cap.page_url
            if render_url and not cfg.is_login_url(render_url):
                cap.target_id = add("render", render_url, render_url, "json-auth")
    for doc in captures.html:
        if doc.kind == "raw" and doc.method.upper() == "GET" and 200 <= doc.status < 300:
            doc.target_id = add("html_get", doc.url, doc.url, "raw")
        elif doc.kind == "dom":
            doc.target_id = add("render", doc.url, doc.url, "dom")
    return cands


def choose_targets(records: list[GradeRecord], cands: dict[str, tuple[Target, str]]) -> list[Target]:
    """只保留真正产出了成绩的目标；同一页面如果直接下载就能解析，就不再用浏览器打开。"""
    chosen: dict[str, Target] = {}
    for r in records:
        srcs = [s for s in r.sources if s in cands]
        non_dom = [s for s in srcs if cands[s][1] != "dom"]
        keep = non_dom if non_dom else srcs
        for s in keep:
            t = cands[s][0]
            if not t.label and r.course:
                t.label = r.course
            elif r.course and r.course not in t.label.split("、") and len(t.label) < 60:
                t.label = t.label + "、" + r.course
            chosen[s] = t
    # 同一网址既有 html_get 又有 render 时，只留 html_get
    html_urls = {t.url for t in chosen.values() if t.kind == "html_get"}
    out = [t for t in chosen.values() if not (t.kind == "render" and t.url in html_urls)]
    order = {"json_get": 0, "html_get": 1, "render": 2}
    out.sort(key=lambda t: (t.site, order.get(t.kind, 9), t.url))
    return out


def new_target_file(targets: list[Target], hints: dict[str, str], probe_dir: str) -> TargetFile:
    return TargetFile(
        targets=targets,
        course_hints=hints,
        generated_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        probe_dir=probe_dir,
    )
