"""安装 / 卸载后台定时任务。

- Windows：任务计划程序（schtasks + XML 定义，允许用电池运行、错过时间开机后补跑、不弹黑窗口）
- macOS：launchd（~/Library/LaunchAgents 下的 plist）
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from .paths import Paths

TASK_NAME = "UQGradesNotifier"
LAUNCHD_LABEL = "com.uqgrades.notifier"


class ServiceError(Exception):
    pass


def python_for_background(executable: str | None = None, platform: str | None = None) -> str:
    """后台运行用的 Python。Windows 上用 pythonw.exe，运行时不会弹出黑色命令行窗口。"""
    exe = Path(executable or sys.executable)
    platform = platform or sys.platform
    if platform == "win32":
        w = exe.with_name("pythonw.exe")
        if w.exists():
            return str(w)
    return str(exe)


# ---------------------------------------------------------------- Windows


def windows_task_xml(python: str, workdir: str, interval_minutes: int, user_id: str = "", start: datetime | None = None) -> str:
    start = (start or datetime.now()).replace(second=0, microsecond=0)
    user = f"\n      <UserId>{escape(user_id)}</UserId>" if user_id else ""
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>UQ 新成绩推送：定时检查 Learn.UQ 和 my.UQ 的成绩（只读）</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT{int(interval_minutes)}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>{start:%Y-%m-%dT%H:%M:%S}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">{user}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(python)}</Command>
      <Arguments>-m uqgrades tick</Arguments>
      <WorkingDirectory>{escape(workdir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def _decode_console(b: bytes) -> str:
    for enc in ("oem", "mbcs", "utf-8"):
        try:
            return b.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return b.decode("utf-8", errors="replace")


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    kwargs = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    p = subprocess.run(cmd, capture_output=True, **kwargs)
    p.stdout_text = _decode_console(p.stdout or b"")  # type: ignore[attr-defined]
    p.stderr_text = _decode_console(p.stderr or b"")  # type: ignore[attr-defined]
    return p


def install_windows(paths: Paths, interval_minutes: int, runner=_run) -> str:
    python = python_for_background()
    domain, user = os.environ.get("USERDOMAIN", ""), os.environ.get("USERNAME", "")
    user_id = f"{domain}\\{user}" if domain and user else user
    xml = windows_task_xml(python, str(paths.home), interval_minutes, user_id)
    paths.ensure()
    xml_file = paths.data / "windows-task.xml"
    xml_file.write_text(xml, encoding="utf-16")
    p = runner(["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(xml_file), "/F"])
    if p.returncode != 0:
        raise ServiceError("创建定时任务失败：" + (p.stderr_text or p.stdout_text).strip())
    runner(["schtasks", "/Run", "/TN", TASK_NAME])
    return f"已创建 Windows 定时任务“{TASK_NAME}”，每 {interval_minutes} 分钟醒来一次，程序会自己按随机间隔决定是否查询。"


def uninstall_windows(runner=_run) -> str:
    p = runner(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    if p.returncode != 0:
        text = (p.stderr_text or p.stdout_text).strip()
        q = runner(["schtasks", "/Query", "/TN", TASK_NAME])
        if q.returncode != 0:
            return "没有找到定时任务（可能已经卸载过了）。"
        raise ServiceError("删除定时任务失败：" + text)
    return f"已删除 Windows 定时任务“{TASK_NAME}”。"


def windows_status(runner=_run) -> str:
    p = runner(["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST"])
    return "已安装" if p.returncode == 0 else "未安装"


# ---------------------------------------------------------------- macOS


def launchd_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"


def launchd_plist(python: str, paths: Paths, interval_minutes: int) -> bytes:
    data = {
        "Label": LAUNCHD_LABEL,
        "ProgramArguments": [python, "-m", "uqgrades", "tick"],
        "WorkingDirectory": str(paths.home),
        "EnvironmentVariables": {
            "UQGRADES_HOME": str(paths.home),
            "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONIOENCODING": "utf-8",
            "LANG": "en_US.UTF-8",
        },
        "StartInterval": int(interval_minutes) * 60,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "StandardOutPath": str(paths.logs / "launchd.out.log"),
        "StandardErrorPath": str(paths.logs / "launchd.err.log"),
    }
    return plistlib.dumps(data)


def install_macos(paths: Paths, interval_minutes: int, runner=_run, plist_path: Path | None = None) -> str:
    _warn_protected_folder(paths)
    paths.ensure()
    plist_path = plist_path or launchd_plist_path()
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    plist_path.write_bytes(launchd_plist(python_for_background(), paths, interval_minutes))
    uid = os.getuid()
    runner(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"])
    p = runner(["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)])
    if p.returncode != 0:
        p2 = runner(["launchctl", "load", "-w", str(plist_path)])
        if p2.returncode != 0:
            raise ServiceError("加载定时任务失败：" + (p.stderr_text or p2.stderr_text).strip())
    return f"已安装 macOS 定时任务（launchd：{LAUNCHD_LABEL}），每 {interval_minutes} 分钟醒来一次。"


def uninstall_macos(runner=_run, plist_path: Path | None = None) -> str:
    plist_path = plist_path or launchd_plist_path()
    uid = os.getuid()
    p = runner(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"])
    if p.returncode != 0 and plist_path.exists():
        runner(["launchctl", "unload", "-w", str(plist_path)])
    existed = plist_path.exists()
    if existed:
        plist_path.unlink()
    return "已卸载 macOS 定时任务。" if existed or p.returncode == 0 else "没有找到定时任务（可能已经卸载过了）。"


def macos_status() -> str:
    return "已安装" if launchd_plist_path().exists() else "未安装"


def _warn_protected_folder(paths: Paths) -> None:
    home = Path.home()
    for name in ("Desktop", "Documents", "Downloads"):
        try:
            paths.home.relative_to(home / name)
        except ValueError:
            continue
        raise ServiceError(
            f"工具文件夹在“{name}”里。macOS 不允许后台任务读写桌面/文稿/下载文件夹，定时任务会运行失败。\n"
            f"请把整个文件夹移动到你的个人文件夹（{home}）下，例如 {home}/uq-grade-notifier，\n"
            "然后在新位置重新运行 uv sync 和 uv run uqgrades install。"
        )


# ---------------------------------------------------------------- 统一入口


def install(paths: Paths, interval_minutes: int) -> str:
    if sys.platform == "win32":
        return install_windows(paths, interval_minutes)
    if sys.platform == "darwin":
        return install_macos(paths, interval_minutes)
    raise ServiceError(
        "定时任务只支持 Windows 和 macOS。Linux 可以手动在 crontab 里加一行：\n"
        f"*/{interval_minutes} * * * * cd {paths.home} && {sys.executable} -m uqgrades tick"
    )


def uninstall() -> str:
    if sys.platform == "win32":
        return uninstall_windows()
    if sys.platform == "darwin":
        return uninstall_macos()
    raise ServiceError("定时任务只支持 Windows 和 macOS。")


def status() -> str:
    if sys.platform == "win32":
        return windows_status()
    if sys.platform == "darwin":
        return macos_status()
    return "不支持（仅 Windows / macOS）"
