import json
import tempfile
import unittest
from pathlib import Path

from news.scripts.apply_commons_images import apply
from news.scripts.source_commons_images import plain, search_term


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
