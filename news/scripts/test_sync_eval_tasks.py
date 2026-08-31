#!/usr/bin/env python3
"""Regression tests for the public evaluation task synchronizer."""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
import sync_eval_tasks as sync  # noqa: E402


class TaskSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eval_task_sync_")
        self.root = Path(self.temp.name)
        self.app = self.root / "news" / "app-data"
        domain = "example.bg"
        ident = "article-1"
        article_dir = self.root / "news" / "data" / domain
        analysis_dir = self.root / "news" / "data" / "analysis" / "articles" / domain
        public_dir = self.app / "articles"
        article_dir.mkdir(parents=True)
        analysis_dir.mkdir(parents=True)
        public_dir.mkdir(parents=True)
        article = {
            "title": "Публична статия",
            "url": "https://example.bg/article-1",
            "content": "Пълният частен текст остава само в локалния архив.",
        }
        analysis = {
            "article_path": f"news/data/{domain}/{ident}.json",
            "model": "test-model",
            "analyzed_at": "2026-08-31T10:00:00Z",
            "quality": {"verdict": "ok"},
            "site_relevant": True,
            "leaning": {"label": "progressive", "confidence": 0.7},
            "russia_stance": {"label": "not_applicable", "confidence": 0.9},
            "party_tones": [{
                "party": "ГЕРБ", "party_id": "gerb", "tone": "neutral",
                "confidence": 0.8, "evidence": "Фактическо споменаване.",
            }],
            "topics": [{"category": "government", "subcategory": None, "primary": True}],
            "entities": {"parties": ["ГЕРБ"]},
        }
        self.write(article_dir / f"{ident}.json", article)
        self.write(analysis_dir / f"{ident}.json", analysis)
        self.write(public_dir / f"{domain}.json", {
            "domain": domain,
            "generated_at": "2026-08-31T11:00:00Z",
            "articles": [{
                "id": ident, "domain": domain, "title": article["title"],
                "url": article["url"], "published": "2026-08-31T09:00:00Z",
                "story_id": "story-1", "analysis": {
                    **analysis,
                    "party_tones": [{
                        "party": "ГЕРБ", "tone": "neutral",
                        "confidence": 0.8,
                    }],
                },
            }],
        })
        self.write(self.root / "news" / "data" / "gold" / "gold_set.json", {
            "version": 1,
            "articles": [{
                "path": "news/data/sealed.example/held-back.json",
                "domain": "sealed.example",
                "url": "https://sealed.example/held-back",
            }],
        })
        self.selection = self.root / "selection.json"
        self.write(self.selection, {
            "schema_version": 1,
            "dataset_id": "community-pilot-v1",
            "purpose": "Anonymous public pilot.",
            "source_kind": "community_sample",
            "answer_visibility": "model_hidden_until_submit",
            "public_eligible": True,
            "article_keys": [f"{domain}/{ident}"],
        })

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def write(path: Path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def test_projection_is_deterministic_and_contains_no_private_text(self):
        first = sync.build(self.root, self.app, [self.selection], False, 0)
        second = sync.build(self.root, self.app, [self.selection], False, 0)
        self.assertEqual(first, second)
        manifest, queue, report = first
        self.assertEqual(report["task_count"], 1)
        self.assertEqual(manifest["tasks"][0]["dataset_ids"], ["community-pilot-v1"])
        serialized = json.dumps(queue, ensure_ascii=False)
        self.assertNotIn("Пълният частен текст", serialized)
        self.assertNotIn("evidence", serialized)
        self.assertEqual(queue["tasks"][0]["model_labels"]["leaning"], "progressive")

    def test_shared_unicode_fixture_matches_python_hash_and_revision_contract(self):
        fixture = sync.read_json(
            ROOT / "news" / "eval_contract" / "fixtures" / "task_sync_pair.json")
        manifest = fixture["manifest"]
        queue = fixture["queue"]
        task = manifest["tasks"][0]
        self.assertEqual(manifest["tasks_sha256"], sync.canonical_sha256(
            manifest["tasks"]))
        self.assertEqual(manifest["queue_sha256"], sync.canonical_sha256(queue))
        self.assertEqual(task["revision"], sync.task_revision(
            task["content_sha256"], task["analysis_sha256"], task["model_labels"]))

    def test_revision_changes_with_analysis_but_not_public_build_timestamp(self):
        manifest, _, _ = sync.build(self.root, self.app, [self.selection], False, 0)
        original = manifest["tasks"][0]["revision"]
        public_file = self.app / "articles" / "example.bg.json"
        public = sync.read_json(public_file)
        public["generated_at"] = "2026-08-31T13:00:00Z"
        self.write(public_file, public)
        rebuilt, _, _ = sync.build(self.root, self.app, [self.selection], False, 0)
        self.assertEqual(rebuilt["tasks"][0]["revision"], original)
        analysis_path = (self.root / "news" / "data" / "analysis" /
                         "articles" / "example.bg" / "article-1.json")
        analysis = sync.read_json(analysis_path)
        analysis["leaning"]["label"] = "neutral"
        self.write(analysis_path, analysis)
        public = sync.read_json(public_file)
        public["articles"][0]["analysis"]["leaning"]["label"] = "neutral"
        self.write(public_file, public)
        changed, _, _ = sync.build(self.root, self.app, [self.selection], False, 0)
        self.assertNotEqual(changed["tasks"][0]["revision"], original)
        article_path = self.root / "news" / "data" / "example.bg" / "article-1.json"
        article = sync.read_json(article_path)
        article["content"] += " Допълнение."
        self.write(article_path, article)
        content_changed, _, _ = sync.build(
            self.root, self.app, [self.selection], False, 0)
        self.assertNotEqual(
            content_changed["tasks"][0]["revision"],
            changed["tasks"][0]["revision"],
        )

    def test_accepted_human_answer_is_removed_from_the_desired_public_queue(self):
        public_file = self.app / "articles" / "example.bg.json"
        public = sync.read_json(public_file)
        public["articles"][0]["analysis"]["human_review"] = {
            "status": "accepted",
        }
        # The effective public label may now differ from the immutable model;
        # exclusion must happen before make_task's model-coherence check.
        public["articles"][0]["analysis"]["leaning"]["label"] = "neutral"
        self.write(public_file, public)
        manifest, queue, report = sync.build(
            self.root, self.app, [self.selection], False, 0)
        self.assertEqual(manifest["task_count"], 0)
        self.assertEqual(queue["tasks"], [])
        self.assertEqual(report["excluded_accepted_count"], 1)

    def test_selection_must_be_explicitly_public_and_never_gold(self):
        selection = sync.read_json(self.selection)
        selection["dataset_id"] = "sealed-gold-v1"
        self.write(self.selection, selection)
        with self.assertRaisesRegex(sync.SyncError, "sealed/gold"):
            sync.build(self.root, self.app, [self.selection], False, 0)
        selection["dataset_id"] = "community-v1"
        selection["public_eligible"] = False
        self.write(self.selection, selection)
        with self.assertRaisesRegex(sync.SyncError, "not public eligible"):
            sync.build(self.root, self.app, [self.selection], False, 0)
        selection["public_eligible"] = True
        selection["article_keys"] = ["example.bg/article-1"]
        self.write(self.selection, selection)
        self.write(self.root / "news" / "data" / "gold" / "gold_set.json", {
            "version": 1,
            "articles": [{
                "path": "news/data/example.bg/article-1.json",
                "domain": "example.bg",
                "url": "https://example.bg/article-1",
            }],
        })
        with self.assertRaisesRegex(sync.SyncError, "overlaps sealed/gold"):
            sync.build(self.root, self.app, [self.selection], False, 0)
        with mock.patch.object(
            sync, "review_reasons", return_value={"leaning": "review"}
        ):
            with self.assertRaisesRegex(sync.SyncError, "no task sources"):
                sync.build(self.root, self.app, [], True, 10)

    def test_missing_public_route_or_label_drift_fails_closed(self):
        selection = sync.read_json(self.selection)
        selection["article_keys"] = ["example.bg/not-public"]
        self.write(self.selection, selection)
        with self.assertRaisesRegex(sync.SyncError, "not in public app-data"):
            sync.build(self.root, self.app, [self.selection], False, 0)
        selection["article_keys"] = ["example.bg/article-1"]
        self.write(self.selection, selection)
        public_path = self.app / "articles" / "example.bg.json"
        public = sync.read_json(public_path)
        public["articles"][0]["analysis"]["leaning"]["label"] = "neutral"
        self.write(public_path, public)
        with self.assertRaisesRegex(sync.SyncError, "public and local"):
            sync.build(self.root, self.app, [self.selection], False, 0)

    def test_dry_run_writes_nothing_and_write_uses_private_manifest_mode(self):
        manifest_out = self.root / "private" / "tasks.json"
        queue_out = self.root / "public" / "queue.json"
        report_out = self.root / "private" / "report.json"
        base = [
            "--root", str(self.root), "--app-data", str(self.app),
            "--selection", str(self.selection), "--manifest-out", str(manifest_out),
            "--queue-out", str(queue_out), "--report", str(report_out),
        ]
        self.assertEqual(sync.main(base), 0)
        self.assertFalse(manifest_out.exists())
        self.assertFalse(queue_out.exists())
        self.assertFalse(report_out.exists())
        self.assertEqual(sync.main([*base, "--write"]), 0)
        self.assertTrue(manifest_out.exists())
        self.assertTrue(queue_out.exists())
        self.assertEqual(stat.S_IMODE(manifest_out.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(queue_out.stat().st_mode), 0o644)
        report = sync.read_json(report_out)
        self.assertFalse(report["dry_run"])

        old_manifest = manifest_out.read_bytes()
        selection = sync.read_json(self.selection)
        selection["dataset_id"] = "community-pilot-v2"
        self.write(self.selection, selection)
        real_write = sync.atomic_write

        def fail_queue(path, value, mode):
            if path.resolve() == queue_out.resolve():
                raise OSError("injected queue failure")
            return real_write(path, value, mode)

        with mock.patch.object(sync, "atomic_write", side_effect=fail_queue):
            self.assertEqual(sync.main([*base, "--write"]), 1)
        self.assertEqual(manifest_out.read_bytes(), old_manifest)

        def fail_manifest(path, value, mode):
            if path.resolve() == manifest_out.resolve():
                raise OSError("injected manifest failure")
            return real_write(path, value, mode)

        with mock.patch.object(sync, "atomic_write", side_effect=fail_manifest):
            self.assertEqual(sync.main([*base, "--write"]), 1)
        self.assertEqual(manifest_out.read_bytes(), old_manifest)


if __name__ == "__main__":
    unittest.main(verbosity=2)
