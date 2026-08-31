#!/usr/bin/env python3
"""Tests for the unattended eval export/task-sync ordering boundary."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from news.eval_contract.canonical import content_sha256
from news.scripts.effective_analysis import AcceptedAdjudications
from news.scripts.eval_runtime import (
    EvalRuntimeError,
    RuntimeConfig,
    export_operation,
    run_operator,
    runtime_config,
    snapshot_status,
    task_build_operation,
    task_sync_operation,
)

STAMP = "2026-08-31T12:00:00.000Z"


def config(*, mode: str = "required", available: bool = True) -> RuntimeConfig:
    return RuntimeConfig(
        mode=mode,
        credential=Path("/private/eval.json") if available else None,
        operator_cli=Path("/private/operator-cli.js") if available else None,
        unavailable_reason=None if available else "eval_credential_unset",
        max_snapshot_age_hours=26,
        live_manifest_url=(
            "https://storage.googleapis.com/data-electionsbg-com/"
            "news/app-data/manifest.json"
        ),
    )


class EvalRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="eval_runtime_")
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_dedicated_eval_credential_cannot_reuse_uploader_identity(self):
        credential = self.root / "shared.json"
        credential.write_text("{}", encoding="utf-8")
        with mock.patch.dict(os.environ, {
            "NEWS_EVAL_MODE": "required",
            "NEWS_EVAL_GOOGLE_APPLICATION_CREDENTIALS": str(credential),
            "GOOGLE_APPLICATION_CREDENTIALS": str(credential),
        }, clear=False):
            with self.assertRaisesRegex(EvalRuntimeError, "dedicated credential"):
                runtime_config(self.root)

    def test_operator_receives_only_the_dedicated_credential(self):
        chosen = config()
        completed = mock.Mock(returncode=0, stdout='{"ok":true}\n', stderr="")
        with mock.patch("subprocess.run", return_value=completed) as invoked:
            result = run_operator(chosen, ["export", "--project", "electionsbg-news"])
        self.assertEqual(result["exit"], 0)
        environment = invoked.call_args.kwargs["env"]
        self.assertEqual(environment["GOOGLE_APPLICATION_CREDENTIALS"],
                         "/private/eval.json")

    def test_optional_missing_credentials_are_visible_but_do_not_block_initial_run(self):
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config",
            return_value=config(mode="optional", available=False),
        ):
            result, code = export_operation(self.root)
            task_result, task_code = task_build_operation(self.root)
        self.assertEqual(code, 0)
        self.assertFalse(result["publication_blocked"])
        self.assertEqual(result["accepted_snapshot"]["status"], "missing")
        self.assertIn("eval_credential_unset", result["alerts"])
        self.assertEqual(task_code, 0)
        self.assertEqual(task_result["skipped"], "eval_credential_unset")

    def test_required_or_expired_accepted_state_blocks_publication(self):
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config",
            return_value=config(mode="required", available=False),
        ):
            missing, missing_code = export_operation(self.root)
        self.assertEqual(missing_code, 1)
        self.assertIn("accepted_snapshot_missing", missing["block_reasons"])
        self.assertIn("eval_credential_unset", missing["block_reasons"])

        accepted = {
            "status": "valid", "record_count": 2, "age_hours": 27.001,
            "future_clock_skew": False,
        }
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime._operator_export",
            return_value={"exit": 1, "error": "offline", "result": None},
        ), mock.patch(
            "news.scripts.eval_runtime.snapshot_status", return_value=accepted,
        ):
            expired, expired_code = export_operation(self.root)
        self.assertEqual(expired_code, 1)
        self.assertEqual(expired["block_reasons"], ["accepted_snapshot_expired"])
        self.assertIn("accepted_export_failed_last_good_retained", expired["alerts"])

    def test_fresh_last_good_snapshot_survives_transient_export_failure(self):
        accepted = {
            "status": "valid", "record_count": 2, "age_hours": 1.5,
            "future_clock_skew": False,
        }
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime._operator_export",
            return_value={"exit": 1, "error": "offline", "result": None},
        ), mock.patch(
            "news.scripts.eval_runtime.snapshot_status", return_value=accepted,
        ):
            result, code = export_operation(self.root)
        self.assertEqual(code, 0)
        self.assertFalse(result["publication_blocked"])
        self.assertIn("accepted_export_failed_last_good_retained", result["alerts"])

    def test_snapshot_report_counts_current_stale_and_missing_content(self):
        records = {
            "example.bg/current": {
                "content_sha256": content_sha256("current text"),
            },
            "example.bg/stale": {
                "content_sha256": content_sha256("old text"),
            },
            "example.bg/missing": {
                "content_sha256": content_sha256("missing text"),
            },
        }
        accepted = AcceptedAdjudications({
            "project_id": "electionsbg-news",
            "firestore_read_time": STAMP,
            "records_sha256": "sha256:" + "a" * 64,
        }, records)
        article_dir = self.root / "news" / "data" / "example.bg"
        article_dir.mkdir(parents=True)
        (article_dir / "current.json").write_text(
            json.dumps({"content": "current text"}), encoding="utf-8")
        (article_dir / "stale.json").write_text(
            json.dumps({"content": "new text"}), encoding="utf-8")
        snapshot = self.root / "accepted.json"
        snapshot.write_text("{}", encoding="utf-8")
        now = __import__("datetime").datetime.fromisoformat(
            "2026-08-31T13:00:00+00:00")
        with mock.patch(
            "news.scripts.eval_runtime.load_accepted_adjudications",
            return_value=accepted,
        ):
            result = snapshot_status(snapshot, root=self.root, now=now)
        self.assertEqual(result["fresh_content_count"], 1)
        self.assertEqual(result["stale_content_count"], 1)
        self.assertEqual(result["missing_content_count"], 1)
        self.assertEqual(result["age_hours"], 1.0)

    def test_task_sync_runs_only_after_successful_public_manifest_commit(self):
        upload_path = self.root / "upload.json"
        task_path = self.root / "news" / "data" / "evals" / "tasks" / "current.json"
        task_path.parent.mkdir(parents=True)
        task_path.write_text("{}", encoding="utf-8")
        upload_path.write_text(json.dumps({
            "mode": "news_gcs_upload",
            "public_ready": True,
            "public_enabled": True,
            "failed_scopes": [],
            "scopes": [{"name": "public_app_data_manifest", "exit": 0}],
        }), encoding="utf-8")
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime.run_operator",
            return_value={"exit": 0, "result": {"synced": 3}},
        ) as operator:
            result, code = task_sync_operation(upload_path, self.root)
        self.assertEqual(code, 0)
        self.assertEqual(result["sync"]["result"]["synced"], 3)
        self.assertIn("sync-tasks", operator.call_args.args[1])

        upload_path.write_text(json.dumps({
            "mode": "news_gcs_upload",
            "public_ready": True,
            "public_enabled": True,
            "failed_scopes": ["public_app_data_manifest"],
            "scopes": [{"name": "public_app_data_manifest", "exit": 1}],
        }), encoding="utf-8")
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch("news.scripts.eval_runtime.run_operator") as operator:
            skipped, skipped_code = task_sync_operation(upload_path, self.root)
        self.assertEqual(skipped_code, 0)
        self.assertEqual(skipped["skipped"], "public_manifest_not_advanced")
        operator.assert_not_called()


if __name__ == "__main__":
    unittest.main()
