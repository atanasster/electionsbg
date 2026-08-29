#!/usr/bin/env python3

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_standalone_bundle as bundle


def load_uploader():
    path = bundle.ROOT / "news/standalone/upload_to_gcs.py"
    spec = importlib.util.spec_from_file_location("news_upload_to_gcs", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


uploader = load_uploader()


def valid_report(run_id: str = "test-run") -> dict:
    stages = [{"stage": name, "exit": 0}
              for name in uploader.EXPECTED_STAGES]
    return {
        "run_id": run_id,
        "stages": stages,
        "failed_stages": [],
        "stages_run": len(stages),
        "stages_ok": len(stages),
    }


class StandaloneBundle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="news_box_")
        self.out = Path(self.temp.name) / "box"
        self.manifest = bundle.build(self.out, False)
        shutil.copy2(self.out / "config.env.example", self.out / "config.env")

    def tearDown(self):
        self.temp.cleanup()

    def test_bundle_is_complete_verified_and_refuses_overwrite(self):
        self.assertGreaterEqual(len(self.manifest["files"]), 30)
        for rel in ("run_hourly.sh", "upload_to_gcs.py",
                    "news/scripts/run_nightly.sh",
                    "news/scripts/harvest_browser.mjs",
                    "news/prompts/analyze_schema.json",
                    "news/data/gazetteer.json"):
            self.assertTrue((self.out / rel).is_file(), rel)
        verify = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(verify.returncode, 0, verify.stderr + verify.stdout)
        with self.assertRaises(FileExistsError):
            bundle.build(self.out, False)

        common_words = self.out / "news/data/common_words.json"
        common_words.write_text('{"generated_at":"next-hour"}\n', encoding="utf-8")
        verify = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(verify.returncode, 0, verify.stderr + verify.stdout)

    def test_manifest_validation_fails_closed(self):
        manifest_path = self.out / "bundle-manifest.json"
        manifest_path.write_text("{}\n", encoding="utf-8")
        empty = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertNotEqual(empty.returncode, 0)
        self.assertIn("unsupported_or_missing_version", empty.stdout)

        manifest = self.manifest.copy()
        manifest["files"] = {"../escape": "0" * 64}
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        traversal = subprocess.run(
            [sys.executable, str(self.out / "verify_bundle.py")],
            cwd=self.out, text=True, capture_output=True)
        self.assertNotEqual(traversal.returncode, 0)
        self.assertIn("invalid_file_entry", traversal.stdout)

    def test_hourly_dry_run_and_cron_are_self_contained(self):
        cron = subprocess.run(
            ["bash", str(self.out / "install_cron.sh"), "--print"],
            cwd=self.out, text=True, capture_output=True)
        self.assertEqual(cron.returncode, 0, cron.stderr)
        self.assertIn("0 * * * *", cron.stdout)
        self.assertIn(str(self.out / "run_hourly.sh"), cron.stdout)

        run = subprocess.run(
            ["bash", str(self.out / "run_hourly.sh"), "--dry-run"],
            cwd=self.out, text=True, capture_output=True, timeout=60)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
        lines = [json.loads(line) for line in run.stdout.splitlines()
                 if line.strip().startswith("{")]
        self.assertTrue(any(row.get("mode") == "news_hourly" for row in lines))
        combined = list((self.out / "var/reports").glob("*.json"))
        self.assertTrue(combined)


class UploadPolicy(unittest.TestCase):
    def test_archive_versioning_parser(self):
        self.assertTrue(uploader.versioning_enabled(
            "gs://private-bucket: Enabled"))
        self.assertFalse(uploader.versioning_enabled(
            "gs://private-bucket: Suspended"))

    def test_production_uploader_rejects_placeholder_destination(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": str(bundle.ROOT),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "0",
               "NEWS_ARCHIVE_GCS_URI": "gs://REPLACE_ME_PRIVATE/news/archive",
               "NEWS_PUBLIC_GCS_URI": "", "NEWS_MENTIONS_GCS_URI": ""}
        proc = subprocess.run(
            [sys.executable, str(script), "--archive-only"], env=env,
            text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("contains REPLACE_ME", proc.stdout)

    def test_report_gate_and_upload_scopes(self):
        with tempfile.TemporaryDirectory(prefix="news_upload_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            self.assertEqual(
                uploader.load_report(report, "test-run"), (True, "ready"))
            failed = valid_report()
            failed["stages"][-2]["exit"] = 1
            failed["failed_stages"] = ["mention_index"]
            failed["stages_ok"] = len(failed["stages"]) - 1
            report.write_text(json.dumps(failed), encoding="utf-8")
            ready, reason = uploader.load_report(report)
            self.assertFalse(ready)
            self.assertIn("mention_index", reason)
            truncated = valid_report()
            truncated["stages"] = truncated["stages"][-2:]
            report.write_text(json.dumps(truncated), encoding="utf-8")
            ready, reason = uploader.load_report(report)
            self.assertFalse(ready)
            self.assertIn("incomplete", reason)
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            ready, reason = uploader.load_report(report, "different-run")
            self.assertFalse(ready)
            self.assertIn("run_id mismatch", reason)

    def test_public_delete_scope_rejects_bucket_root(self):
        with mock.patch.dict(os.environ, {
            "NEWS_PUBLIC_GCS_URI": "gs://public-bucket",
            "NEWS_MENTIONS_GCS_URI": "gs://public-bucket/news/mentions",
            "NEWS_ARCHIVE_GCS_URI": "gs://private-bucket/news/archive",
        }, clear=False):
            with self.assertRaisesRegex(ValueError, "non-empty prefix"):
                uploader.commands(True, True)

    def test_public_upload_is_opt_in_and_delete_scopes_are_disjoint(self):
        base = {
            "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive",
            "NEWS_PUBLIC_GCS_URI": "gs://public/news/app-data",
            "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
        }
        with mock.patch.dict(os.environ, {**base,
                                          "NEWS_ENABLE_PUBLIC_UPLOAD": "0"},
                             clear=False):
            self.assertEqual([row["name"] for row in
                              uploader.commands(True, uploader.public_upload_enabled())],
                             ["archive"])
        with mock.patch.dict(os.environ, {**base,
                                          "NEWS_ENABLE_PUBLIC_UPLOAD": "1"},
                             clear=False):
            scopes = uploader.commands(True, uploader.public_upload_enabled())
            self.assertEqual(len(scopes), 3)
            self.assertFalse(uploader.same_or_nested_scope(
                base["NEWS_PUBLIC_GCS_URI"], base["NEWS_MENTIONS_GCS_URI"]))
            self.assertTrue(uploader.same_or_nested_scope(
                "gs://public/news", "gs://public/news/mentions"))
            self.assertFalse(uploader.same_or_nested_scope(
                "gs://public/news/a", "gs://public/news/ab"))

            with mock.patch.object(
                    uploader, "run_scope",
                    return_value={"name": "archive", "exit": 1}):
                results = uploader.execute_scopes(scopes, False)
            self.assertEqual(len(results), 3)
            self.assertEqual(results[1]["skipped"], "archive_failed")
            self.assertEqual(results[2]["skipped"], "archive_failed")

    def test_archive_and_public_bucket_must_differ(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": str(bundle.ROOT),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
               "NEWS_PUBLIC_GCS_URI": "gs://same/news/app-data",
               "NEWS_MENTIONS_GCS_URI": "gs://same/news/mentions",
               "NEWS_ARCHIVE_GCS_URI": "gs://same/private/archive"}
        with tempfile.TemporaryDirectory(prefix="news_report_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(script), "--dry-run", "--report", str(report)],
                env=env, text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("different private bucket", proc.stdout)

        archive_only = subprocess.run(
            [sys.executable, str(script), "--dry-run", "--archive-only"],
            env=env, text=True, capture_output=True)
        self.assertEqual(archive_only.returncode, 2)
        self.assertIn("different private bucket", archive_only.stdout)

    def test_nested_public_delete_scopes_are_rejected(self):
        script = bundle.ROOT / "news/standalone/upload_to_gcs.py"
        env = {**os.environ, "DATA_BG_ROOT": str(bundle.ROOT),
               "NEWS_ENABLE_PUBLIC_UPLOAD": "1",
               "NEWS_PUBLIC_GCS_URI": "gs://public/news",
               "NEWS_MENTIONS_GCS_URI": "gs://public/news/mentions",
               "NEWS_ARCHIVE_GCS_URI": "gs://private/news/archive"}
        with tempfile.TemporaryDirectory(prefix="news_report_") as td:
            report = Path(td) / "report.json"
            report.write_text(json.dumps(valid_report()), encoding="utf-8")
            proc = subprocess.run(
                [sys.executable, str(script), "--dry-run", "--report", str(report)],
                env=env, text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("must be disjoint", proc.stdout)


if __name__ == "__main__":
    unittest.main()
