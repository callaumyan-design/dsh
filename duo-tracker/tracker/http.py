"""文明抓取客户端：robots.txt（RFC 9309 最长匹配）、每站限速、重试退避、原始响应缓存。

- 每个 host 两次请求间隔 >= min_interval 秒（默认 1.0，配置不允许更小）。
- User-Agent 为通用客户端名，不带任何个人信息。
- 所有响应按 raw/<source>/<date>/<name> 落盘；offline 模式只读缓存，用于回溯重解析。
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import requests

log = logging.getLogger(__name__)

DEFAULT_UA = "Mozilla/5.0 (compatible; DuoTracker/1.0)"
UA_TOKEN = "duotracker"  # robots.txt 里匹配 user-agent 组用的产品名


class RobotsDisallowed(Exception):
    pass


class FetchError(Exception):
    pass


class NotCached(FetchError):
    pass


class _Invalid(Exception):
    pass


# --------------------------------------------------------------------------- robots
@dataclass
class _Group:
    agents: list[str] = field(default_factory=list)
    rules: list[tuple[bool, str]] = field(default_factory=list)  # (allow, pattern)


class Robots:
    """最小实现的 RFC 9309 解析：按 UA 选组，最长匹配，等长时 Allow 优先，支持 * 与 $。"""

    def __init__(self, text: str | None, allow_all=False, disallow_all=False):
        self.allow_all = allow_all
        self.disallow_all = disallow_all
        self.groups: list[_Group] = []
        if text:
            self._parse(text)

    def _parse(self, text: str):
        cur: _Group | None = None
        last_was_agent = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            k, v = line.split(":", 1)
            k, v = k.strip().lower(), v.strip()
            if k == "user-agent":
                if cur is None or not last_was_agent:
                    cur = _Group()
                    self.groups.append(cur)
                cur.agents.append(v.lower())
                last_was_agent = True
            elif k in ("allow", "disallow"):
                last_was_agent = False
                if cur is None:
                    continue
                if k == "disallow" and v == "":
                    continue  # 空 Disallow = 全部允许
                cur.rules.append((k == "allow", v))
            else:
                last_was_agent = False

    def _rules_for(self, token: str):
        specific, star = [], []
        for g in self.groups:
            if any(a != "*" and a in token for a in g.agents):
                specific.extend(g.rules)
            elif "*" in g.agents:
                star.extend(g.rules)
        return specific or star

    @staticmethod
    def _match_len(pattern: str, path: str) -> int:
        regex = "".join(".*" if c == "*" else ("$" if c == "$" else re.escape(c)) for c in pattern)
        if pattern.endswith("$"):
            regex = regex[:-1] + "$"
        m = re.match(regex, path)
        return len(pattern) if m else -1

    def allowed(self, path: str, token: str = UA_TOKEN) -> bool:
        if self.allow_all:
            return True
        if self.disallow_all:
            return False
        best_len, best_allow = -1, True
        for allow, pat in self._rules_for(token):
            n = self._match_len(pat, path)
            if n > best_len or (n == best_len and allow):
                best_len, best_allow = n, allow
        return best_allow


# --------------------------------------------------------------------------- client
def _slug(url: str) -> str:
    parts = urlsplit(url)
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", (parts.path + ("_" + parts.query if parts.query else "")).strip("/"))
    base = base[:80] or "index"
    return f"{base}_{hashlib.sha1(url.encode()).hexdigest()[:8]}"


@dataclass
class Response:
    url: str
    status: int
    text: str
    from_cache: bool = False

    def json(self):
        return json.loads(self.text)


class PoliteClient:
    def __init__(self, raw_root: Path, run_date: str, *, user_agent: str = DEFAULT_UA,
                 min_interval: float = 1.0, retries: int = 4, backoff: float = 2.0,
                 timeout: float = 30.0, offline: bool = False, respect_robots: bool = True,
                 robots_exceptions: dict[str, list[str]] | None = None):
        self.raw_root = Path(raw_root)
        self.run_date = run_date
        self.min_interval = max(1.0, float(min_interval))
        self.retries = retries
        self.backoff = backoff
        self.timeout = timeout
        self.offline = offline
        self.respect_robots = respect_robots
        # host -> 路径前缀列表：仅当配置里显式授权时才会越过 robots.txt（见 config.yaml 说明）
        self.robots_exceptions = robots_exceptions or {}
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
        self._last: dict[str, float] = {}
        self._robots: dict[str, Robots] = {}
        self.stats: dict[str, dict[str, int]] = {}

    # -- bookkeeping
    def _stat(self, source: str, key: str, n: int = 1):
        self.stats.setdefault(source, {}).setdefault(key, 0)
        self.stats[source][key] += n

    def _wait(self, host: str):
        last = self._last.get(host)
        if last is not None:
            delta = time.monotonic() - last
            if delta < self.min_interval:
                time.sleep(self.min_interval - delta)
        self._last[host] = time.monotonic()

    def _cache_path(self, source: str, name: str) -> Path:
        return self.raw_root / source / self.run_date / name

    # -- robots
    def _latest_cached_robots(self, source: str, cache_name: str) -> Path | None:
        found = sorted(self.raw_root.glob(f"*/*/{cache_name}"), key=lambda p: p.parent.name, reverse=True)
        return found[0] if found else None

    def robots_for(self, scheme: str, host: str, source: str) -> Robots:
        if host in self._robots:
            return self._robots[host]
        cache_name = f"robots_{host}.txt"
        cp = self._cache_path(source, cache_name)
        if self.offline:
            rob = Robots(cp.read_text(encoding="utf-8") if cp.exists() else None, allow_all=not cp.exists())
        else:
            try:
                try:
                    r = self._raw_get(f"{scheme}://{host}/robots.txt", source)
                except requests.RequestException:
                    time.sleep(self.backoff)
                    r = self._raw_get(f"{scheme}://{host}/robots.txt", source)
                if r.status_code == 200 and "<html" not in r.text[:500].lower():
                    rob = Robots(r.text)
                    cp.parent.mkdir(parents=True, exist_ok=True)
                    cp.write_text(r.text, encoding="utf-8")
                elif r.status_code in (401, 403):
                    rob = Robots(None, disallow_all=True)
                elif 400 <= r.status_code < 500 or r.status_code == 200:
                    rob = Robots(None, allow_all=True)  # 404 / 返回 HTML 页面 = 未提供 robots
                else:
                    rob = Robots(None, disallow_all=True)  # 5xx：按 RFC 9309 视为全部禁止
            except requests.RequestException as e:
                cached = self._latest_cached_robots(source, cache_name)
                if cached is not None:
                    log.warning("robots.txt %s 获取失败（%s），使用最近缓存 %s", host, e, cached)
                    rob = Robots(cached.read_text(encoding="utf-8"))
                else:
                    log.warning("robots.txt %s 获取失败（%s），按全部禁止处理", host, e)
                    rob = Robots(None, disallow_all=True)
        self._robots[host] = rob
        return rob

    def _check_robots(self, url: str, source: str):
        if not self.respect_robots:
            return
        p = urlsplit(url)
        path = p.path + ("?" + p.query if p.query else "")
        for prefix in self.robots_exceptions.get(p.hostname or "", []):
            if p.path.startswith(prefix):
                self._stat(source, "robots_exception")
                return
        if not self.robots_for(p.scheme, p.hostname, source).allowed(path):
            raise RobotsDisallowed(f"robots.txt 禁止抓取 {url}")

    # -- fetching
    def _raw_get(self, url: str, source: str, params=None) -> requests.Response:
        host = urlsplit(url).hostname or ""
        self._wait(host)
        self._stat(source, "requests")
        return self.session.get(url, params=params, timeout=self.timeout)

    def get(self, source: str, url: str, *, name: str | None = None, params: dict | None = None,
            ok_statuses: tuple[int, ...] = (200,), validate=None) -> Response:
        """validate(text)->bool：返回 False 视为临时错误页（例如 200 状态的错误页），按可重试处理。"""
        if params:
            url = requests.Request("GET", url, params=params).prepare().url
        name = name or _slug(url)
        cp = self._cache_path(source, name)
        if self.offline:
            if not cp.exists():
                raise NotCached(f"无缓存：{cp}")
            return Response(url, 200, cp.read_text(encoding="utf-8"), from_cache=True)
        self._check_robots(url, source)
        last_err: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                r = self._raw_get(url, source)
                if r.status_code in ok_statuses:
                    r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
                    text = r.text
                    if validate is not None and not validate(text):
                        raise _Invalid(f"响应内容校验失败（{len(text)} 字节）：{url}")
                    cp.parent.mkdir(parents=True, exist_ok=True)
                    cp.write_text(text, encoding="utf-8")
                    meta = cp.with_name(cp.name + ".meta.json")
                    meta.write_text(json.dumps({"url": url, "status": r.status_code,
                                                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}), encoding="utf-8")
                    return Response(url, r.status_code, text)
                if r.status_code in (429,) or r.status_code >= 500:
                    last_err = FetchError(f"HTTP {r.status_code} {url}")
                    retry_after = r.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else self.backoff ** (attempt + 1)
                else:
                    raise FetchError(f"HTTP {r.status_code} {url}")
            except (requests.RequestException, _Invalid) as e:
                last_err = e
                delay = self.backoff ** (attempt + 1)
            if attempt < self.retries:
                self._stat(source, "retries")
                log.info("重试 %s（第 %d 次，%.0fs 后）：%s", url, attempt + 1, delay, last_err)
                time.sleep(min(delay, 60))
        self._stat(source, "failures")
        raise FetchError(f"多次重试失败：{url}：{last_err}")
