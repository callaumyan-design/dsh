"""防止两个查询同时运行（例如定时任务正在查询时，你又手动运行了 login）。

使用操作系统的文件锁：程序退出（哪怕是崩溃）时锁会自动释放，不会出现“死锁文件”。
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path


class LockBusy(Exception):
    pass


class FileLock:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._fh = None

    def acquire(self, wait_seconds: float = 0) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+")
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                _lock(fh)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    fh.close()
                    raise LockBusy("另一个查询或登录正在进行中，请稍等一两分钟再试。") from None
                time.sleep(1)
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()))
        fh.flush()
        self._fh = fh

    def release(self) -> None:
        if self._fh is not None:
            try:
                _unlock(self._fh)
            finally:
                self._fh.close()
                self._fh = None

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()


if sys.platform == "win32":
    import msvcrt

    def _lock(fh) -> None:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock(fh) -> None:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def _lock(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
