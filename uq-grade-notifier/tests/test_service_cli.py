from __future__ import annotations

import plistlib
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import pytest

from uqgrades import cli, service
from uqgrades.lock import FileLock, LockBusy
from uqgrades.runner import tick
from uqgrades.store import Store

NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}


class FakeRunner:
    def __init__(self, fail=()):
        self.calls = []
        self.fail = set(fail)

    def __call__(self, cmd):
        self.calls.append(cmd)
        rc = 1 if any(f in " ".join(cmd) for f in self.fail) else 0
        p = subprocess.CompletedProcess(cmd, rc, b"", b"")
        p.stdout_text, p.stderr_text = "", ("错误" if rc else "")
        return p


def test_windows_task_xml(home):
    xml = service.windows_task_xml(
        r"C:\Users\me\uq grade\.venv\Scripts\pythonw.exe", r"C:\Users\me\uq grade", 10, r"PC\me", datetime(2026, 1, 2, 3, 4)
    )
    root = ET.fromstring(xml.encode("utf-16"))
    assert root.find(".//t:Interval", NS).text == "PT10M"
    assert root.find(".//t:StartBoundary", NS).text == "2026-01-02T03:04:00"
    assert root.find(".//t:DisallowStartIfOnBatteries", NS).text == "false"
    assert root.find(".//t:StopIfGoingOnBatteries", NS).text == "false"
    assert root.find(".//t:StartWhenAvailable", NS).text == "true"
    assert root.find(".//t:MultipleInstancesPolicy", NS).text == "IgnoreNew"
    assert root.find(".//t:UserId", NS).text == r"PC\me"
    assert root.find(".//t:Command", NS).text.endswith("pythonw.exe")
    assert root.find(".//t:Arguments", NS).text == "-m uqgrades tick"
    assert root.find(".//t:WorkingDirectory", NS).text == r"C:\Users\me\uq grade"


def test_install_windows_commands(home, monkeypatch):
    monkeypatch.setenv("USERDOMAIN", "PC")
    monkeypatch.setenv("USERNAME", "me")
    r = FakeRunner()
    msg = service.install_windows(home, 10, runner=r)
    assert "已创建" in msg
    assert r.calls[0][:4] == ["schtasks", "/Create", "/TN", service.TASK_NAME]
    xml_path = Path(r.calls[0][5])
    assert xml_path.read_bytes()[:2] in (b"\xff\xfe", b"\xfe\xff")  # UTF-16 带 BOM
    assert r.calls[1] == ["schtasks", "/Run", "/TN", service.TASK_NAME]
    with pytest.raises(service.ServiceError):
        service.install_windows(home, 10, runner=FakeRunner(fail=["/Create"]))
    assert "已删除" in service.uninstall_windows(runner=FakeRunner())
    assert "没有找到" in service.uninstall_windows(runner=FakeRunner(fail=["/Delete", "/Query"]))


def test_python_for_background_prefers_pythonw(tmp_path):
    exe = tmp_path / "python.exe"
    exe.write_text("")
    assert service.python_for_background(str(exe), "win32") == str(exe)
    (tmp_path / "pythonw.exe").write_text("")
    assert service.python_for_background(str(exe), "win32") == str(tmp_path / "pythonw.exe")
    assert service.python_for_background(str(exe), "darwin") == str(exe)


def test_launchd_plist_and_install(home, tmp_path, monkeypatch):
    data = plistlib.loads(service.launchd_plist("/u/.venv/bin/python", home, 10))
    assert data["Label"] == service.LAUNCHD_LABEL
    assert data["ProgramArguments"] == ["/u/.venv/bin/python", "-m", "uqgrades", "tick"]
    assert data["StartInterval"] == 600
    assert data["RunAtLoad"] is True
    assert data["EnvironmentVariables"]["UQGRADES_HOME"] == str(home.home)

    monkeypatch.setattr(service.Path, "home", classmethod(lambda cls: tmp_path / "fakehome"))
    plist = tmp_path / "LaunchAgents" / "x.plist"
    r = FakeRunner(fail=["bootstrap"])  # 老系统：bootstrap 失败，退回 load -w
    service.install_macos(home, 10, runner=r, plist_path=plist)
    assert plist.exists()
    assert ["launchctl", "load", "-w", str(plist)] in r.calls
    assert "已卸载" in service.uninstall_macos(runner=FakeRunner(), plist_path=plist)
    assert not plist.exists()


def test_macos_refuses_protected_folders(tmp_path, monkeypatch):
    from uqgrades.paths import Paths

    monkeypatch.setattr(service.Path, "home", classmethod(lambda cls: tmp_path))
    p = Paths(tmp_path / "Documents" / "uq-grade-notifier")
    with pytest.raises(service.ServiceError, match="桌面/文稿/下载"):
        service.install_macos(p, 10, runner=FakeRunner(), plist_path=tmp_path / "x.plist")


def test_lock_blocks_second_holder(tmp_path):
    a = FileLock(tmp_path / ".lock")
    a.acquire()
    with pytest.raises(LockBusy):
        FileLock(tmp_path / ".lock").acquire(wait_seconds=0)
    a.release()
    b = FileLock(tmp_path / ".lock")
    b.acquire()
    b.release()


def test_tick_respects_quiet_hours_and_next_run(home, site_cfg):
    from dataclasses import replace

    quiet = replace(site_cfg, schedule=replace(site_cfg.schedule, quiet_hours="00:00-23:59"))
    assert "免打扰" in tick(home, quiet, now=datetime(2026, 1, 1, 12, 0).astimezone())
    s = Store(home.db)
    s.set_state("next_run_at", "2099-01-01T00:00:00+10:00")
    s.close()
    assert "还没到" in tick(home, site_cfg, now=datetime(2026, 1, 1, 12, 0).astimezone())


def test_tick_without_targets_schedules_backoff(home, site_cfg):
    msg = tick(home, site_cfg, now=datetime(2026, 1, 1, 12, 0).astimezone())
    assert "还没有抓取目标" in msg
    s = Store(home.db)
    assert int(s.get_state("failures")) == 1
    assert s.get_state("next_run_at")
    s.close()


def test_tick_skips_when_locked(home, site_cfg):
    lock = FileLock(home.lock_file)
    lock.acquire()
    try:
        assert "正在进行中" in tick(home, site_cfg)
    finally:
        lock.release()


def test_cli_test_push_and_status(home, fake, site_cfg, capsys):
    assert cli.main(["test-push"]) == 0
    assert len(fake.state.pushes) == 2
    assert fake.state.pushes[0]["title"] == "UQ 成绩推送测试"
    assert cli.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "Bark：已配置" in out and "抓取目标：0 个" in out


def test_cli_run_without_targets(home, site_cfg, capsys):
    assert cli.main(["run", "--no-push"]) == 1
    assert "uv run uqgrades probe" in capsys.readouterr().out


def test_cli_bad_config_message(home, capsys):
    home.config_file.write_text("[bark]\nkey = abc\n", encoding="utf-8")
    assert cli.main(["status"]) == 2
    assert "配置文件有问题" in capsys.readouterr().out


def test_cli_init(home, monkeypatch, capsys):
    answers = iter(["https://api.day.app/MyKey123/hello", "y", ""])
    monkeypatch.setattr("builtins.input", lambda *_: next(answers))
    assert cli.main(["init"]) == 0
    text = home.config_file.read_text(encoding="utf-8")
    assert 'key = "MyKey123"' in text and "privacy_mode = true" in text and 'quiet_hours = "23:00-07:00"' in text
    assert cli.main(["init"]) == 0  # 已存在时不覆盖
    assert "已经存在" in capsys.readouterr().out


def test_gitignore_covers_private_files():
    text = (Path(__file__).resolve().parents[1] / ".gitignore").read_text(encoding="utf-8")
    for pattern in ("config.toml", "data/", "*.sqlite3", "session-cookies.json", "browser-profile/", ".venv/"):
        assert pattern in text.splitlines()
