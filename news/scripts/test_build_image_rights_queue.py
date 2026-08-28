import json
import tempfile
import unittest
from pathlib import Path

from news.scripts.build_image_rights_queue import build_queue


class ImageRightsQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "news" / "data"

    @staticmethod
    def rights(status, display=False):
        permitted = status not in {"unknown", "blocked"}
        return {
            "status": status, "creator": "A" if permitted else None,
            "credit_text": "Credit", "credit_url": "https://example.org/credit",
            "licence_name": "CC0" if permitted else None,
            "licence_url": (
                "https://creativecommons.org/publicdomain/zero/1.0/"
                if permitted else None
            ),
            "source_url": "https://example.org/source",
            "checked_at": "2026-08-28", "display_home": display,
        }

    def add(self, stem, *, image="https://img.example/a.jpg", rights=None,
            published="2026-08-28T10:00:00+00:00"):
        raw = self.data / "example.bg" / f"{stem}.json"
        analysis = self.data / "analysis" / "articles" / "example.bg" / f"{stem}.json"
        raw.parent.mkdir(parents=True, exist_ok=True)
        analysis.parent.mkdir(parents=True, exist_ok=True)
        article = {"domain": "example.bg", "title": stem, "url": f"https://example.bg/{stem}",
                   "published": published, "image": image}
        if rights is not None:
            article["image_rights"] = rights
        raw.write_text(json.dumps(article))
        analysis.write_text(json.dumps({
            "domain": "example.bg",
            "article_path": f"news/data/example.bg/{stem}.json",
            "url": f"https://example.bg/{stem}",
        }))

    def test_queue_is_actionable_deterministic_and_fail_closed(self):
        self.add("missing-review")
        self.add("missing-image", image=None, published="2026-08-29T10:00:00+00:00")
        self.add("unknown", rights=self.rights("unknown"))
        self.add("blocked", rights=self.rights("blocked"))
        self.add("cleared", rights=self.rights("cc", True))
        queue = build_queue(self.data)
        self.assertEqual(queue["publication_default"], "deny")
        self.assertEqual(queue["counts"], {
            "total": 3, "missing_image": 1, "missing_review": 1,
            "unknown_rights": 1, "invalid_review": 0,
        })
        self.assertEqual(
            [item["reason"] for item in queue["items"]],
            ["missing_image", "unknown_rights", "missing_review"],
        )
        self.assertNotIn("blocked", [item["title"] for item in queue["items"]])
        self.assertNotIn("cleared", [item["title"] for item in queue["items"]])

    def test_missing_article_path_fails_instead_of_silently_dropping(self):
        analysis = self.data / "analysis" / "articles" / "example.bg" / "bad.json"
        analysis.parent.mkdir(parents=True)
        analysis.write_text("{}")
        with self.assertRaisesRegex(ValueError, "missing article_path"):
            build_queue(self.data)

    def test_stale_article_path_recovers_by_canonical_url(self):
        self.add("renamed")
        analysis = (
            self.data / "analysis" / "articles" / "example.bg" / "renamed.json"
        )
        record = json.loads(analysis.read_text())
        record["article_path"] = "news/data/example.bg/old-name.json"
        analysis.write_text(json.dumps(record))
        queue = build_queue(self.data)
        self.assertEqual(queue["items"][0]["article_path"],
                         "news/data/example.bg/renamed.json")

    def test_blocked_and_cleared_stay_out_even_without_an_image(self):
        self.add("blocked", image=None, rights=self.rights("blocked"))
        self.add("cleared", image=None, rights=self.rights("cc", True))
        self.assertEqual(build_queue(self.data)["items"], [])

    def test_malformed_review_is_actionable(self):
        self.add("bad", rights={"status": "invented"})
        queue = build_queue(self.data)
        self.assertEqual(queue["counts"]["invalid_review"], 1)
        self.assertEqual(queue["items"][0]["reason"], "invalid_review")

    def test_traversal_and_ambiguous_url_fail_closed(self):
        self.add("one")
        analysis = self.data / "analysis" / "articles" / "example.bg" / "one.json"
        record = json.loads(analysis.read_text())
        record["article_path"] = "news/data/../../outside.json"
        analysis.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError, "escapes"):
            build_queue(self.data)

        record["article_path"] = "news/data/example.bg/missing.json"
        analysis.write_text(json.dumps(record))
        duplicate = self.data / "example.bg" / "duplicate.json"
        duplicate.write_text((self.data / "example.bg" / "one.json").read_text())
        with self.assertRaisesRegex(ValueError, "2 matches"):
            build_queue(self.data)
