"""所有本地文件的位置。

默认情况下，一切都放在工具文件夹（有 pyproject.toml 的那个文件夹）里：
- config.toml          你的配置（含 Bark 密钥）
- data/                登录状态、成绩记录、日志、探查录制（全部只在本机）

可以用环境变量 UQGRADES_HOME 指定别的文件夹（测试时使用）。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _find_home() -> Path:
    env = os.environ.get("UQGRADES_HOME")
    if env:
        return Path(env).expanduser().resolve()
    # src/uqgrades/paths.py -> 工具文件夹
    candidate = Path(__file__).resolve().parents[2]
    if (candidate / "pyproject.toml").exists():
        return candidate
    return Path.cwd().resolve()


@dataclass(frozen=True)
class Paths:
    home: Path

    @classmethod
    def default(cls) -> Paths:
        return cls(_find_home())

    @property
    def config_file(self) -> Path:
        return self.home / "config.toml"

    @property
    def config_example(self) -> Path:
        return self.home / "config.example.toml"

    @property
    def data(self) -> Path:
        return self.home / "data"

    @property
    def browser_profile(self) -> Path:
        return self.data / "browser-profile"

    @property
    def session_backup(self) -> Path:
        # 浏览器关闭时会丢掉“会话 cookie”，这里备份一份，下次启动时补回去
        return self.data / "session-cookies.json"

    @property
    def session_meta(self) -> Path:
        return self.data / "session-meta.json"

    @property
    def db(self) -> Path:
        return self.data / "grades.sqlite3"

    @property
    def targets(self) -> Path:
        return self.data / "targets.json"

    @property
    def logs(self) -> Path:
        return self.data / "logs"

    @property
    def log_file(self) -> Path:
        return self.logs / "uqgrades.log"

    @property
    def probes(self) -> Path:
        return self.data / "probe"

    @property
    def lock_file(self) -> Path:
        return self.data / ".lock"

    def ensure(self) -> None:
        for p in (self.data, self.logs, self.probes):
            p.mkdir(parents=True, exist_ok=True)
