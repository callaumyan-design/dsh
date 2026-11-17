from __future__ import annotations

import random
from datetime import datetime, timedelta

import pytest

from uqgrades.config import (
    ConfigError,
    ScheduleConfig,
    is_login_url,
    load_config,
    parse_bark_key,
    parse_config_text,
    parse_quiet_hours,
    write_basic_config,
)
from uqgrades.schedule import in_quiet_hours, next_delay_minutes, should_run

from .conftest import ROOT


def test_example_config_is_valid():
    cfg = parse_config_text((ROOT / "config.example.toml").read_text(encoding="utf-8"))
    assert cfg.bark.key == ""
    assert cfg.bark.server == "https://api.day.app"
    assert cfg.schedule.quiet_hours == "23:00-07:00"
    assert cfg.schedule.min_interval_minutes == 30 and cfg.schedule.max_interval_minutes == 60
    assert [s.id for s in cfg.sites] == ["learn", "myuq"]
    assert cfg.site_for_url("https://learn.uq.edu.au/ultra/stream").id == "learn"
    assert cfg.site_for_url("https://api.my.uq.edu.au/x").id == "myuq"
    assert cfg.site_for_url("https://example.com/") is None


def test_missing_config_uses_defaults(home):
    cfg = load_config(home)
    assert not cfg.bark.configured


def test_smart_quotes_and_full_bark_url_are_accepted():
    text = "[bark]\nkey = “https://api.day.app/AbC123/这里改成你自己的推送内容”\nprivacy_mode = true\n"
    cfg = parse_config_text(text)
    assert cfg.bark.key == "AbC123"
    assert cfg.bark.server == "https://api.day.app"
    assert cfg.bark.privacy_mode is True


def test_parse_bark_key_variants():
    assert parse_bark_key("AbC123") == ("https://api.day.app", "AbC123")
    assert parse_bark_key("https://bark.example.com/KEY9/") == ("https://bark.example.com", "KEY9")
    with pytest.raises(ConfigError):
        parse_bark_key("https://api.day.app/")


@pytest.mark.parametrize(
    "text, msg",
    [
        ("[bark]\nkey = abc\n", "格式有误"),
        ("[bark]\nprivacy_mode = \"是\"\n", "true 或 false"),
        ("[schedule]\nmin_interval_minutes = 2\n", "不能小于 5"),
        ("[schedule]\nmin_interval_minutes = 50\nmax_interval_minutes = 40\n", "不能小于 min_interval"),
        ("[schedule]\nquiet_hours = \"晚上\"\n", "免打扰时段写法不对"),
        ("[bark]\nlevel = \"loud\"\n", "bark.level"),
    ],
)
def test_config_errors_are_friendly(text, msg):
    with pytest.raises(ConfigError) as e:
        parse_config_text(text)
    assert msg in str(e.value)


def test_write_basic_config_roundtrip(home):
    write_basic_config(home, bark_key="https://api.day.app/XyZ/内容", privacy_mode=True, quiet_hours="22:30-06:45")
    cfg = load_config(home)
    assert cfg.bark.key == "XyZ"
    assert cfg.bark.privacy_mode is True
    assert cfg.schedule.quiet_hours == "22:30-06:45"
    text = home.config_file.read_text(encoding="utf-8")
    assert "# 你的 Bark 密钥" in text  # 说明文字保留


def test_quiet_hours_parsing():
    assert parse_quiet_hours("") == []
    assert parse_quiet_hours("23:00-07:00, 12:00-13:30") == [(1380, 420), (720, 810)]
    assert parse_quiet_hours("23:00～07:00".replace("～", "-")) == [(1380, 420)]
    assert parse_quiet_hours("00:00-00:00") == []


def at(h, m=0):
    return datetime(2026, 11, 17, h, m)


def test_in_quiet_hours_across_midnight():
    q = "23:00-07:00"
    assert in_quiet_hours(at(23, 0), q)
    assert in_quiet_hours(at(2, 30), q)
    assert in_quiet_hours(at(6, 59), q)
    assert not in_quiet_hours(at(7, 0), q)
    assert not in_quiet_hours(at(12, 0), q)
    assert not in_quiet_hours(at(22, 59), q)
    assert in_quiet_hours(at(12, 15), "12:00-13:00")
    assert not in_quiet_hours(at(3, 0), "")


def test_next_delay_is_random_within_range_and_backs_off():
    cfg = ScheduleConfig(min_interval_minutes=30, max_interval_minutes=60, max_backoff_minutes=360)
    rng = random.Random(1)
    normal = [next_delay_minutes(cfg, 0, rng) for _ in range(200)]
    assert all(30 <= d <= 60 for d in normal)
    assert max(normal) - min(normal) > 20  # 确实有随机
    one = [next_delay_minutes(cfg, 1, rng) for _ in range(100)]
    assert all(60 <= d <= 120 for d in one)
    two = [next_delay_minutes(cfg, 2, rng) for _ in range(100)]
    assert all(120 <= d <= 240 for d in two)
    many = [next_delay_minutes(cfg, 8, rng) for _ in range(100)]
    assert all(360 * 0.85 <= d <= 360 for d in many)


def test_should_run():
    cfg = ScheduleConfig(quiet_hours="23:00-07:00")
    assert should_run(at(10), cfg, None) == (True, "")
    ok, why = should_run(at(10), cfg, at(10) + timedelta(minutes=5))
    assert not ok and "下次查询" in why
    assert should_run(at(10, 6), cfg, at(10, 5))[0]
    ok, why = should_run(at(1), cfg, None)
    assert not ok and why == "免打扰时段"


def test_login_url_patterns():
    pats = ["auth.uq.edu.au", "login.microsoftonline.com", "/webapps/login", "127.0.0.1:9999"]
    assert is_login_url("https://auth.uq.edu.au/idp/module.php/core/loginuserpass.php?x=1", pats)
    assert is_login_url("https://login.microsoftonline.com/common/oauth2", pats)
    assert is_login_url("https://learn.uq.edu.au/webapps/login/?action=relogin", pats)
    assert is_login_url("http://127.0.0.1:9999/login", pats)
    assert not is_login_url("http://127.0.0.1:9998/login", pats)
    assert not is_login_url("https://learn.uq.edu.au/ultra/stream", pats)
    # 网址参数里出现登录域名不算
    assert not is_login_url("https://learn.uq.edu.au/x?next=https://auth.uq.edu.au/", pats)
