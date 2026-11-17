"""读取 config.toml。

普通用户只需要关心 [bark] 和 [schedule] 两节；[advanced] 一般不用改。
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .paths import Paths


class ConfigError(Exception):
    """配置文件有问题。消息是给用户看的中文。"""


DEFAULT_BARK_SERVER = "https://api.day.app"

DEFAULT_LOGIN_PATTERNS = [
    # 只匹配“主机名”（含子域名）
    "auth.uq.edu.au",
    "login.microsoftonline.com",
    "login.microsoft.com",
    "login.live.com",
    "login.windows.net",
    "okta.com",
    "duosecurity.com",
    # 含“/”的匹配“主机名+路径”中的片段
    "/webapps/login",
    "/auth-saml/",
    "/idp/profile/",
    "/adfs/ls",
]

_SMART_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "＂": '"'})


@dataclass
class BarkConfig:
    key: str = ""
    server: str = DEFAULT_BARK_SERVER
    privacy_mode: bool = False
    group: str = "UQ 成绩"
    level: str = "active"
    sound: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.key)


@dataclass
class ScheduleConfig:
    min_interval_minutes: float = 30
    max_interval_minutes: float = 60
    max_backoff_minutes: float = 360
    quiet_hours: str = ""
    wake_interval_minutes: int = 10


@dataclass
class Site:
    id: str
    name: str
    url: str
    hosts: list[str]

    def owns_url(self, url: str) -> bool:
        """网址是否属于这个网站（主机名相同或是子域名；条目写成 host:port 时连端口一起比较）。"""
        p = urlparse(url or "")
        host = (p.hostname or "").lower()
        host_port = f"{host}:{p.port}" if p.port else host
        return any(host == h or host.endswith("." + h) or host_port == h for h in self.hosts)


@dataclass
class AdvancedConfig:
    learn_url: str = "https://learn.uq.edu.au/"
    myuq_url: str = "https://my.uq.edu.au/"
    learn_hosts: list[str] = field(default_factory=lambda: ["learn.uq.edu.au"])
    myuq_hosts: list[str] = field(default_factory=lambda: ["my.uq.edu.au", "sinet.uq.edu.au"])
    login_patterns: list[str] = field(default_factory=lambda: list(DEFAULT_LOGIN_PATTERNS))
    browser_channel: str = ""
    page_timeout_seconds: float = 45


@dataclass
class Config:
    bark: BarkConfig = field(default_factory=BarkConfig)
    schedule: ScheduleConfig = field(default_factory=ScheduleConfig)
    advanced: AdvancedConfig = field(default_factory=AdvancedConfig)

    @property
    def sites(self) -> list[Site]:
        a = self.advanced
        return [
            Site("learn", "Learn.UQ", a.learn_url, [h.lower() for h in a.learn_hosts]),
            Site("myuq", "my.UQ", a.myuq_url, [h.lower() for h in a.myuq_hosts]),
        ]

    def site_for_url(self, url: str) -> Site | None:
        for s in self.sites:
            if s.owns_url(url):
                return s
        return None

    def site_by_id(self, site_id: str) -> Site | None:
        for s in self.sites:
            if s.id == site_id:
                return s
        return None

    def is_login_url(self, url: str) -> bool:
        return is_login_url(url, self.advanced.login_patterns)


def is_login_url(url: str, patterns: list[str]) -> bool:
    p = urlparse(url or "")
    host = (p.hostname or "").lower()
    if p.port:
        host_port = f"{host}:{p.port}"
    else:
        host_port = host
    host_path = host_port + (p.path or "")
    for pat in patterns:
        pat = pat.strip().lower()
        if not pat:
            continue
        if "/" in pat:
            if pat in host_path.lower():
                return True
        elif host == pat or host.endswith("." + pat) or host_port == pat:
            return True
    return False


_QUIET_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*[-~–—到至]\s*(\d{1,2}):(\d{2})\s*$")


def parse_quiet_hours(text: str) -> list[tuple[int, int]]:
    """'23:00-07:00, 12:00-13:00' -> [(1380, 420), (720, 780)]（单位：一天中的第几分钟）"""
    text = (text or "").strip()
    if not text:
        return []
    ranges = []
    for part in re.split(r"[,，;；]", text):
        if not part.strip():
            continue
        m = _QUIET_RE.match(part)
        if not m:
            raise ConfigError(
                f'免打扰时段写法不对："{part.strip()}"。正确写法例如 "23:00-07:00"，多个时段用逗号隔开。'
            )
        h1, m1, h2, m2 = (int(x) for x in m.groups())
        if not (0 <= h1 <= 24 and 0 <= h2 <= 24 and 0 <= m1 < 60 and 0 <= m2 < 60):
            raise ConfigError(f'免打扰时段里的时间不存在："{part.strip()}"')
        start, end = (h1 * 60 + m1) % 1440, (h2 * 60 + m2) % 1440
        if start != end:
            ranges.append((start, end))
    return ranges


def parse_bark_key(raw: str, server: str = DEFAULT_BARK_SERVER) -> tuple[str, str]:
    """用户可能粘贴整条 Bark 链接（https://api.day.app/KEY/内容），也可能只粘贴 KEY。"""
    raw = (raw or "").strip().strip('"').strip("'")
    if raw.startswith("http://") or raw.startswith("https://"):
        p = urlparse(raw)
        parts = [x for x in p.path.split("/") if x]
        if not parts:
            raise ConfigError("Bark 链接里找不到密钥。请从 Bark App 首页复制形如 https://api.day.app/xxxxxx/ 的链接。")
        return f"{p.scheme}://{p.netloc}", parts[0]
    return server, raw


def _get(section: dict, key: str, typ, default):
    if key not in section:
        return default
    val = section[key]
    if typ is float and isinstance(val, int) and not isinstance(val, bool):
        val = float(val)
    if typ is int and isinstance(val, float) and val.is_integer():
        val = int(val)
    if typ is list:
        if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
            raise ConfigError(f"配置项 {key} 应该是一组用引号括起来的文字，例如 [\"a\", \"b\"]")
        return val
    if not isinstance(val, typ) or (typ is not bool and isinstance(val, bool)):
        names = {str: "文字（要用英文双引号括起来）", bool: "true 或 false", float: "数字", int: "整数"}
        raise ConfigError(f"配置项 {key} 应该是{names.get(typ, typ.__name__)}，现在是 {val!r}")
    return val


def load_config(paths: Paths) -> Config:
    path = paths.config_file
    if not path.exists():
        return Config()
    return parse_config_text(path.read_text(encoding="utf-8-sig"), path)


def parse_config_text(text: str, path: Path | str = "config.toml") -> Config:
    text = text.translate(_SMART_QUOTES)
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(
            f"配置文件 {path} 格式有误：{e}\n"
            "常见原因：文字两边没有加英文双引号 \"...\"，或者 true/false 写成了中文。"
        ) from e

    bark_s = data.get("bark", {}) or {}
    sched_s = data.get("schedule", {}) or {}
    adv_s = data.get("advanced", {}) or {}

    server = _get(bark_s, "server", str, DEFAULT_BARK_SERVER).strip() or DEFAULT_BARK_SERVER
    server, key = parse_bark_key(_get(bark_s, "key", str, ""), server)
    bark = BarkConfig(
        key=key,
        server=server.rstrip("/"),
        privacy_mode=_get(bark_s, "privacy_mode", bool, False),
        group=_get(bark_s, "group", str, "UQ 成绩"),
        level=_get(bark_s, "level", str, "active").strip() or "active",
        sound=_get(bark_s, "sound", str, "").strip(),
    )
    if bark.level not in ("active", "timeSensitive", "passive", "critical"):
        raise ConfigError('bark.level 只能是 "active"、"timeSensitive"、"passive" 或 "critical"')

    sched = ScheduleConfig(
        min_interval_minutes=_get(sched_s, "min_interval_minutes", float, 30.0),
        max_interval_minutes=_get(sched_s, "max_interval_minutes", float, 60.0),
        max_backoff_minutes=_get(sched_s, "max_backoff_minutes", float, 360.0),
        quiet_hours=_get(sched_s, "quiet_hours", str, ""),
        wake_interval_minutes=_get(sched_s, "wake_interval_minutes", int, 10),
    )
    if sched.min_interval_minutes < 5:
        raise ConfigError("min_interval_minutes 不能小于 5 分钟（查得太频繁可能被学校系统限制）。")
    if sched.max_interval_minutes < sched.min_interval_minutes:
        raise ConfigError("max_interval_minutes 不能小于 min_interval_minutes。")
    if sched.max_backoff_minutes < sched.max_interval_minutes:
        raise ConfigError("max_backoff_minutes 不能小于 max_interval_minutes。")
    if not (1 <= sched.wake_interval_minutes <= 60):
        raise ConfigError("wake_interval_minutes 应在 1 到 60 之间。")
    parse_quiet_hours(sched.quiet_hours)  # 提前检查格式

    d = AdvancedConfig()
    adv = AdvancedConfig(
        learn_url=_get(adv_s, "learn_url", str, d.learn_url),
        myuq_url=_get(adv_s, "myuq_url", str, d.myuq_url),
        learn_hosts=_get(adv_s, "learn_hosts", list, d.learn_hosts),
        myuq_hosts=_get(adv_s, "myuq_hosts", list, d.myuq_hosts),
        login_patterns=_get(adv_s, "login_patterns", list, d.login_patterns)
        + _get(adv_s, "extra_login_patterns", list, []),
        browser_channel=_get(adv_s, "browser_channel", str, "").strip(),
        page_timeout_seconds=_get(adv_s, "page_timeout_seconds", float, d.page_timeout_seconds),
    )
    return Config(bark=bark, schedule=sched, advanced=adv)


def write_basic_config(paths: Paths, *, bark_key: str, privacy_mode: bool, quiet_hours: str) -> Path:
    """由 `uqgrades init` 调用：在示例配置的基础上填入用户的回答。"""
    if paths.config_example.exists():
        text = paths.config_example.read_text(encoding="utf-8")
    else:
        text = DEFAULT_CONFIG_TEXT
    server, key = parse_bark_key(bark_key)
    parse_quiet_hours(quiet_hours)
    text = _replace_value(text, "bark", "key", _toml_str(key))
    text = _replace_value(text, "bark", "server", _toml_str(server))
    text = _replace_value(text, "bark", "privacy_mode", "true" if privacy_mode else "false")
    text = _replace_value(text, "schedule", "quiet_hours", _toml_str(quiet_hours))
    parse_config_text(text)  # 保证写出去的一定能读回来
    paths.config_file.write_text(text, encoding="utf-8")
    return paths.config_file


def _toml_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _replace_value(text: str, section: str, key: str, value: str) -> str:
    lines = text.splitlines()
    current = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        m = re.match(r"^\[([^\]]+)\]", stripped)
        if m:
            current = m.group(1).strip()
            continue
        if current == section and re.match(rf"^{re.escape(key)}\s*=", stripped):
            # 示例配置里的说明都写在单独的注释行上，所以整行替换即可
            lines[i] = f"{key} = {value}"
            return "\n".join(lines) + "\n"
    raise ConfigError(f"示例配置里找不到 [{section}] {key}")


DEFAULT_CONFIG_TEXT = """\
[bark]
key = ""
server = "https://api.day.app"
privacy_mode = false

[schedule]
min_interval_minutes = 30
max_interval_minutes = 60
quiet_hours = ""
"""
