"""核心规则的单元测试：python -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tracker.http import Robots  # noqa: E402
from tracker.matching import Matcher  # noqa: E402
from tracker.model import SourceItem, base_name, map_status, norm_name  # noqa: E402
from tracker.verdict import Claim, apply_hold, decide, mark_stale, scan_release_notes  # noqa: E402


class RobotsTest(unittest.TestCase):
    def test_longest_match(self):
        r = Robots("User-agent: *\nAllow: /\nDisallow: /api/\n")
        self.assertTrue(r.allowed("/app/wechat"))
        self.assertFalse(r.allowed("/api/v1/apps?page=1"))

    def test_itunes_rules(self):
        r = Robots("User-agent: *\nDisallow: /search*\nDisallow: /*/rss/*\nDisallow: /*/lookup?\n")
        self.assertFalse(r.allowed("/search?term=x"))
        self.assertFalse(r.allowed("/cn/rss/topfreeapplications/limit=200/json"))
        self.assertFalse(r.allowed("/cn/lookup?id=1"))
        self.assertTrue(r.allowed("/lookup?id=1&country=cn"))

    def test_specific_group(self):
        r = Robots("User-agent: duotracker\nDisallow: /\n\nUser-agent: *\nAllow: /\n")
        self.assertFalse(r.allowed("/x"))


class KeywordTest(unittest.TestCase):
    def test_strong(self):
        self.assertIn("iPhone Duo", scan_release_notes("适配 iPhone Duo，大屏体验更丝滑")["strong"])
        self.assertIn("Duo+适配语境", scan_release_notes("- Duo layout support")["strong"])

    def test_weak_only(self):
        h = scan_release_notes("Our mascot owl, Duo, is trading")
        self.assertEqual(h["strong"], [])
        self.assertEqual(h["weak"], ["Duo"])
        self.assertEqual(scan_release_notes("友谊画卷徐徐展开")["weak"], ["展开"])
        self.assertEqual(scan_release_notes("Duolingo update")["weak"], [])


def C(src, st, w=30, raw=None, **kw):
    return Claim(src, st, w, raw, **kw)


class DecideTest(unittest.TestCase):
    def test_official_wins(self):
        v = decide([C("apple_story", "perfect", 100), C("duodiscover", "none")])
        self.assertEqual((v.status, v.confidence), ("perfect", "official"))

    def test_conflict_is_disputed(self):
        self.assertEqual(decide([C("xiaoxinnote", "full"), C("foldhunt", "none")]).status, "disputed")

    def test_stale_negative(self):
        cs = [C("xiaoxinnote", "full", observed_at="2026-11-14"), C("foldhunt", "none", observed_at="2026-10-08")]
        mark_stale(cs, "2026-11-10T00:00:00Z")
        self.assertTrue(cs[1].stale)
        self.assertEqual(decide(cs).status, "full")

    def test_multi_source(self):
        v = decide([C("xiaoxinnote", "full"), C("duotoday", "full")])
        self.assertEqual((v.status, v.confidence), ("full", "multi_source"))

    def test_submission_votes(self):
        v = decide([C("shipeiduo_submission", "full", 0, disputed_votes=True, votes={"fit": 1, "unfit": 3})])
        self.assertEqual(v.status, "disputed")
        v = decide([C("shipeiduo_submission", "full", 8)])
        self.assertEqual((v.status, v.confidence), ("full", "submission"))

    def test_weak_keyword_is_only_suspected(self):
        v = decide([C("release_notes", "full", 15, "weak_hit")])
        self.assertEqual((v.status, v.confidence), ("unknown", "suspected"))
        v = decide([C("release_notes", "full", 15, "weak_hit"), C("foldhunt", "none", 7.5)])
        self.assertEqual(v.status, "none")

    def test_strong_keyword(self):
        v = decide([C("release_notes", "full", 60, "strong_hit")])
        self.assertEqual((v.status, v.confidence), ("full", "release_notes"))


class HoldTest(unittest.TestCase):
    prev = {"status": "none", "status_version": "cn:1.0"}

    def test_no_new_version_keeps_verdict(self):
        h = apply_hold(decide([C("xiaoxinnote", "full")]), self.prev, "cn:1.0")
        self.assertEqual((h["status"], h["held"], h["proposed"]), ("none", 1, "full"))

    def test_new_version_allows_change(self):
        h = apply_hold(decide([C("xiaoxinnote", "full")]), self.prev, "cn:1.1")
        self.assertEqual((h["status"], h["changed"]), ("full", 1))

    def test_official_overrides_hold(self):
        h = apply_hold(decide([C("apple_story", "perfect", 100)]), self.prev, "cn:1.0")
        self.assertEqual(h["status"], "perfect")

    def test_missing_sources_do_not_erase(self):
        h = apply_hold(decide([]), {"status": "full", "status_version": "cn:1.0"}, "cn:1.1")
        self.assertEqual(h["status"], "full")

    def test_from_unknown_is_free(self):
        h = apply_hold(decide([C("xiaoxinnote", "full")]), {"status": "unknown", "status_version": "cn:1.0"}, "cn:1.0")
        self.assertEqual(h["status"], "full")


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.m = Matcher({
            "1": {"names": ["微信"], "regions": {"cn", "us"}, "bundle_id": "com.tencent.xin"},
            "2": {"names": ["TikTok - Videos, Shop & LIVE"], "regions": {"us"}, "bundle_id": None},
            "3": {"names": ["绝区零"], "regions": {"cn"}, "bundle_id": None},
            "4": {"names": ["Zenless Zone Zero"], "regions": {"us"}, "bundle_id": None},
        })

    def it(self, name, **kw):
        return SourceItem("x", name, name, "full", "full", **kw)

    def test_paths(self):
        self.assertEqual(self.m.match(self.it("WeChat", store_id="1")).method, "trackId")
        self.assertEqual(self.m.match(self.it("?", bundle_id="com.tencent.xin")).method, "bundleId")
        self.assertEqual(self.m.match(self.it("TikTok", region="us")).app_ids, ["2"])
        self.assertEqual(self.m.match(self.it("ＴｉｋＴｏｋ")).app_ids, ["2"])  # 全角
        self.assertEqual(self.m.match(self.it("Unknown App")).method, "no_candidate")
        self.assertEqual(self.m.match(self.it("Other", store_id="999")).method, "untracked")

    def test_multi_region_name(self):
        r = self.m.match(self.it("Zenless Zone Zero", alt_names=["绝区零"]))
        self.assertEqual((r.method, sorted(r.app_ids)), ("name_multi_region", ["3", "4"]))

    def test_region_filter_no_cross(self):
        self.assertEqual(self.m.match(self.it("绝区零", region="us")).method, "no_candidate")


class ModelTest(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(norm_name("Ｗｅ Ｃｈａｔ"), "wechat")
        self.assertEqual(base_name("抖音 - 记录美好生活"), "抖音")
        self.assertEqual(base_name("Canva: AI Photo"), "canva")

    def test_compatible_is_not_adapted(self):
        self.assertEqual(map_status("duodiscover", "Compatible"), "none")
        self.assertEqual(map_status("foldhunt", "unconfirmed"), "none")
        self.assertEqual(map_status("duoappcheck", "unknown"), "unknown")


if __name__ == "__main__":
    unittest.main()
