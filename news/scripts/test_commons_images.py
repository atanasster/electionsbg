import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from news.scripts import source_commons_images as source
from news.scripts.apply_commons_images import apply
from news.scripts.source_commons_images import (
    load_search_cache,
    needs_commons_replacement,
    plain,
    search_cache_key,
    search_term,
)


class CommonsImagesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "news" / "data"
        self.article = self.root / "example.bg" / "a.json"
        self.article.parent.mkdir(parents=True)
        self.article.write_text(json.dumps({
            "domain": "example.bg", "url": "https://example.bg/a"
        }))
        self.selection = Path(self.tmp.name) / "selections.json"

    def row(self, **updates):
        row = {
            "article_id": "example.bg/a", "article_path": "news/data/example.bg/a.json",
            "article_url": "https://example.bg/a", "subject": "София",
            "file_title": "File:A.jpg", "image_url": "https://upload.wikimedia.org/a.jpg",
            "source_url": "https://commons.wikimedia.org/wiki/File:A.jpg",
            "creator": "Author", "commons_credit": "Designated credit",
            "credit_text": "Илюстрация · A.jpg · Designated credit · Author · CC BY 4.0",
            "licence_name": "CC BY 4.0",
            "licence_url": "https://creativecommons.org/licenses/by/4.0/",
            "reviewed_at": "2026-08-28",
            "relationship_to_article": "illustrates_named_subject",
        }
        row.update(updates)
        return row

    def write(self, rows):
        self.selection.write_text(json.dumps({"selections": rows}))

    def test_metadata_text_is_plain_and_search_prefers_people(self):
        self.assertEqual(plain("<b>A &amp; B</b>"), "A & B")
        self.assertEqual(search_term(
            {"entities": {"people": ["Име"], "places": ["София"]}}, "Заглавие"
        ), "Име")

    def test_missing_publisher_review_gets_a_licensed_replacement_search(self):
        self.assertTrue(needs_commons_replacement({"reason": "missing_image"}))
        self.assertTrue(needs_commons_replacement({"reason": "missing_review"}))
        self.assertFalse(needs_commons_replacement({"reason": "unknown_rights"}))
        self.assertFalse(needs_commons_replacement({"reason": "blocked"}))

    def test_search_cache_reuses_subjects_and_preserves_empty_results(self):
        prior = {
            "search_cache": {
                "ормузки проток": {
                    "term": "Ормузки  проток",
                    "candidates": [],
                },
            },
            "items": [{
                "search_term": "Едуар Филип",
                "candidates": [{"file_title": "File:E.jpg"}],
            }],
        }
        cache = load_search_cache(prior)
        self.assertIn(search_cache_key(" Ормузки\nпроток "), cache)
        self.assertEqual(cache["ормузки проток"]["candidates"], [])
        self.assertEqual(
            cache[search_cache_key("едуар филип")]["candidates"][0]["file_title"],
            "File:E.jpg",
        )

    def test_main_reuses_one_empty_query_across_articles_and_runs(self):
        queue = Path(self.tmp.name) / "queue.json"
        out = Path(self.tmp.name) / "cache.json"
        analysis_dir = self.root / "analysis" / "articles" / "example.bg"
        analysis_dir.mkdir(parents=True)
        items = []
        for name in ("a", "b"):
            url = f"https://example.bg/{name}"
            (analysis_dir / f"{name}.json").write_text(json.dumps({
                "domain": "example.bg", "url": url, "site_relevant": True,
                "entities": {"places": ["Ормузки проток"]},
            }))
            items.append({
                "id": f"example.bg/{name}", "domain": "example.bg",
                "article_url": url,
                "article_path": f"news/data/example.bg/{name}.json",
                "title": name, "reason": "missing_review",
            })
        queue.write_text(json.dumps({"items": items}))
        argv = ["source_commons_images.py", "--data-dir", str(self.root),
                "--queue", str(queue), "--out", str(out), "--limit", "8"]
        calls = []

        def empty(term, *, limit=8, attempt_budget=3):
            calls.append((term, attempt_budget))
            return [], 1

        with patch.object(source, "commons_search", side_effect=empty), patch.object(
                sys, "argv", argv):
            self.assertEqual(source.main(), 0)
            self.assertEqual(source.main(), 0)
        self.assertEqual(len(calls), 1)
        saved = json.loads(out.read_text())
        self.assertEqual(saved["items"], [])
        self.assertEqual(
            saved["search_cache"][search_cache_key("Ормузки проток")]["candidates"],
            [],
        )

    def test_retry_loop_never_exceeds_raw_request_budget(self):
        with patch.object(source.urllib.request, "urlopen",
                          side_effect=source.urllib.error.URLError("offline")) as opened, \
                patch.object(source.time, "sleep"), patch.object(
                    source.random, "random", return_value=0):
            with self.assertRaises(source.urllib.error.URLError):
                source.commons_search("subject", attempt_budget=2)
        self.assertEqual(opened.call_count, 2)

    def test_apply_preserves_exact_credit_and_is_idempotent(self):
        self.write([self.row()])
        apply(self.selection, self.root)
        first = self.article.read_bytes()
        saved = json.loads(first)
        self.assertEqual(saved["image_alt"], "Илюстрация: София")
        self.assertEqual(saved["image_rights"]["credit_text"], self.row()["credit_text"])
        self.assertEqual(saved["image_rights"]["checked_at"], "2026-08-28")
        apply(self.selection, self.root)
        self.assertEqual(self.article.read_bytes(), first)

    def test_stale_replay_cannot_reopen_blocked_decision(self):
        self.write([self.row()])
        apply(self.selection, self.root)
        article = json.loads(self.article.read_text())
        article["image_rights"]["status"] = "blocked"
        article["image_rights"]["display_home"] = False
        self.article.write_text(json.dumps(article))
        before = self.article.read_bytes()
        with self.assertRaisesRegex(ValueError, "refusing to overwrite blocked"):
            apply(self.selection, self.root)
        self.assertEqual(self.article.read_bytes(), before)

    def test_identity_duplicates_hosts_and_licence_are_preflighted(self):
        cases = (
            (self.row(article_id="wrong/a"), "article_id mismatch"),
            (self.row(image_url="https://evil.example/a.jpg"), "Wikimedia upload"),
            (self.row(source_url="https://evil.example/File:A.jpg"), "Commons HTTPS"),
            (self.row(licence_url="https://example.org/fake"), "unsupported Commons"),
        )
        for row, message in cases:
            with self.subTest(message=message):
                self.write([row])
                with self.assertRaisesRegex(ValueError, message):
                    apply(self.selection, self.root)
        self.write([self.row(), self.row()])
        with self.assertRaisesRegex(ValueError, "duplicate selection"):
            apply(self.selection, self.root)

    def test_late_failure_leaves_every_article_unchanged(self):
        second = self.root / "example.bg" / "b.json"
        second.write_text(json.dumps({"domain": "example.bg", "url": "https://example.bg/b"}))
        before = self.article.read_bytes(), second.read_bytes()
        bad = self.row(article_id="example.bg/b", article_path="news/data/example.bg/b.json",
                       article_url="https://wrong.example/b")
        self.write([self.row(), bad])
        with self.assertRaisesRegex(ValueError, "URL mismatch"):
            apply(self.selection, self.root)
        self.assertEqual((self.article.read_bytes(), second.read_bytes()), before)

    def test_traversal_is_rejected(self):
        self.write([self.row(article_path="news/data/../../escape.json")])
        with self.assertRaisesRegex(ValueError, "escapes"):
            apply(self.selection, self.root)
