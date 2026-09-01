import json
import tempfile
import unittest
from pathlib import Path

from news.scripts.build_feedback_tasks import build
from news.eval_contract.canonical import canonical_sha256


class FeedbackTaskBuildTests(unittest.TestCase):
    def fixture(self) -> tuple[Path, Path]:
        root = Path(tempfile.mkdtemp())
        app = root / "news" / "app-data"
        (app / "articles").mkdir(parents=True)
        (root / "news" / "data" / "example.bg").mkdir(parents=True)
        revision = "2026-09-01T07:00:00.000Z"
        targets = [{
            "kind": "sector", "id": "health", "canonical": "Здравеопазване",
            "href": "https://electionsbg.com/sector/health",
            "aliases": ["Здравеопазване"],
        }]
        (app / "feedback-targets.json").write_text(json.dumps({
            "version": 1,
            "generated_at": revision,
            "targets_sha256": canonical_sha256(targets),
            "target_count": 1,
            "targets": targets,
        }))
        (app / "articles" / "example.bg.json").write_text(json.dumps({
            "domain": "example.bg",
            "generated_at": revision,
            "articles": [{
                "id": "one",
                "url": "https://example.bg/one",
                "title": "One",
                "analysis": None,
            }],
        }))
        (root / "news" / "data" / "example.bg" / "one.json").write_text(
            json.dumps({"content": "Article body"}))
        return root, app

    def test_includes_articles_without_analysis(self):
        root, app = self.fixture()
        manifest, report = build(root, app)
        self.assertEqual(manifest["task_count"], 1)
        self.assertIsNone(manifest["tasks"][0]["analysis_sha256"])
        self.assertTrue(manifest["tasks"][0]["accepts_public_feedback"])
        self.assertEqual(report["excluded_count"], 0)

    def test_analysis_changes_the_task_revision(self):
        root, app = self.fixture()
        before, _ = build(root, app)
        bundle_path = app / "articles" / "example.bg.json"
        bundle = json.loads(bundle_path.read_text())
        bundle["articles"][0]["analysis"] = {
            "leaning": {"label": "neutral"},
        }
        bundle_path.write_text(json.dumps(bundle))
        after, _ = build(root, app)
        self.assertNotEqual(before["tasks"][0]["revision"],
                            after["tasks"][0]["revision"])
        self.assertIsNotNone(after["tasks"][0]["analysis_sha256"])

    def test_public_effective_analysis_wins_over_unchanged_raw_model(self):
        root, app = self.fixture()
        raw_dir = (root / "news" / "data" / "analysis" / "articles" /
                   "example.bg")
        raw_dir.mkdir(parents=True)
        raw_path = raw_dir / "one.json"
        raw_path.write_text(json.dumps({"leaning": {"label": "neutral"}}))
        before, _ = build(root, app)
        bundle_path = app / "articles" / "example.bg.json"
        bundle = json.loads(bundle_path.read_text())
        bundle["articles"][0]["analysis"] = {
            "leaning": {"label": "progressive"},
            "human_review": {"status": "accepted", "revision": 2},
        }
        bundle_path.write_text(json.dumps(bundle))
        after, _ = build(root, app)
        self.assertEqual(
            json.loads(raw_path.read_text()),
            {"leaning": {"label": "neutral"}},
        )
        self.assertNotEqual(before["tasks"][0]["analysis_sha256"],
                            after["tasks"][0]["analysis_sha256"])
        self.assertNotEqual(before["tasks"][0]["revision"],
                            after["tasks"][0]["revision"])

    def test_missing_archive_body_still_gets_a_revision_bound_task(self):
        root, app = self.fixture()
        (root / "news" / "data" / "example.bg" / "one.json").unlink()
        manifest, report = build(root, app)
        self.assertEqual(manifest["task_count"], 1)
        self.assertRegex(manifest["tasks"][0]["content_sha256"],
                         r"^sha256:[a-f0-9]{64}$")
        self.assertEqual(report["excluded_count"], 0)

    def test_internal_feedback_identity_does_not_depend_on_source_url_or_title(self):
        root, app = self.fixture()
        bundle_path = app / "articles" / "example.bg.json"
        bundle = json.loads(bundle_path.read_text())
        bundle["articles"][0]["url"] = "http://legacy.example/one"
        bundle["articles"][0]["title"] = None
        bundle_path.write_text(json.dumps(bundle))
        manifest, _ = build(root, app)
        task = manifest["tasks"][0]
        self.assertEqual(
            task["url"],
            "https://news.electionsbg.com/article/example.bg/one",
        )
        self.assertEqual(task["title"], "Публична статия")

    def test_self_declared_target_hash_is_rejected(self):
        root, app = self.fixture()
        path = app / "feedback-targets.json"
        registry = json.loads(path.read_text())
        registry["targets"][0]["canonical"] = "Подменен сектор"
        path.write_text(json.dumps(registry))
        with self.assertRaisesRegex(ValueError, "hash does not match"):
            build(root, app)


if __name__ == "__main__":
    unittest.main()
