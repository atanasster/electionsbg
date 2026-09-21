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
    _export_alert,
    _stale_operator_cli,
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


class ExportAlertTest(unittest.TestCase):
    """A cold start and a regression are different incidents.

    Both used to render as `*_failed_last_good_retained`, which sends an
    operator hunting a credential for a collection that is simply empty — and
    lets a real regression hide inside a permanently-red cold-start alert.
    Measured 2026-09-21: the public evaluation surface has collected zero
    submissions since it shipped, so this alert is red forever by default.
    """

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="export_alert_")
        self.path = Path(self.temp.name) / "current.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_success_raises_no_alert(self) -> None:
        self.assertEqual(
            _export_alert({"exit": 0}, self.path, "accepted_export"), "")

    def test_empty_collection_with_no_file_is_a_cold_start(self) -> None:
        outcome = {"exit": 1, "error": json.dumps({
            "error": "operator_failed",
            "message": ("Firestore returned no accepted adjudications; "
                        "retaining the last known-good snapshot")})}
        self.assertEqual(_export_alert(outcome, self.path, "accepted_export"),
                         "accepted_export_cold_start_no_records")

    def test_a_retained_file_keeps_the_established_name_whatever_the_cause(self) -> None:
        """With no status to consult — the raw .jsonl export — retention falls
        back to the filesystem. That is why this case passes no `retained`."""
        self.path.write_text("{}", encoding="utf-8")
        for message in ("Firestore returned no accepted adjudications; "
                        "retaining the last known-good snapshot",
                        "PERMISSION_DENIED: caller lacks datastore.entities.list"):
            with self.subTest(message=message[:24]):
                outcome = {"exit": 1, "error": json.dumps({"message": message})}
                self.assertEqual(
                    _export_alert(outcome, self.path, "accepted_export"),
                    "accepted_export_failed_last_good_retained")

    def test_any_other_failure_stays_a_plain_failure(self) -> None:
        """A credential or query fault must NOT be softened into a cold start."""
        outcome = {"exit": 1, "error": json.dumps({
            "message": "PERMISSION_DENIED: caller lacks datastore.entities.list"})}
        self.assertEqual(_export_alert(outcome, self.path, "accepted_export"),
                         "accepted_export_failed")

    def test_a_status_overrides_the_filesystem_in_both_directions(self) -> None:
        """`retained` is the caller's snapshot_status, not a second is_file().

        Two independent notions of "do we have a snapshot" are free to
        disagree, and the one that drives `blocked_reasons` must win.
        """
        outcome = {"exit": 1, "error": json.dumps({"message": "offline"})}
        self.assertFalse(self.path.is_file())
        self.assertEqual(
            _export_alert(outcome, self.path, "accepted_export", True),
            "accepted_export_failed_last_good_retained")
        self.path.write_text("{}", encoding="utf-8")
        self.assertEqual(
            _export_alert(outcome, self.path, "accepted_export", False),
            "accepted_export_failed")

    def test_an_unreadable_retained_file_is_not_last_known_good(self) -> None:
        """A corrupt snapshot satisfies "retained" and not "known-good".

        Announcing it as `_last_good_retained` is the same false claim this
        function exists to remove, one state over.
        """
        outcome = {"exit": 1, "error": json.dumps({"message": "offline"})}
        self.assertEqual(
            _export_alert(outcome, self.path, "accepted_export", True,
                          usable=False),
            "accepted_export_failed_last_good_invalid")

    def test_an_empty_collection_beside_a_corrupt_file_is_never_a_cold_start(
            self) -> None:
        """The reason `usable` is a third name rather than a flipped `retained`.

        Flipping it would render a corrupt retained file as "nobody has
        submitted yet" — about a surface whose records we hold and cannot read.
        """
        outcome = {"exit": 1, "error": json.dumps({
            "message": "Firestore returned no accepted adjudications; "
                       "retaining the last known-good snapshot"})}
        self.assertEqual(
            _export_alert(outcome, self.path, "accepted_export", True,
                          usable=False),
            "accepted_export_failed_last_good_invalid")

    def test_the_marker_survives_a_stray_stdout_payload_and_truncation(
            self) -> None:
        """Both channels are scanned, so `result` cannot out-compete `error`."""
        outcome = {"exit": 1, "result": {"note": "partial"}, "error": json.dumps({
            "message": "Firestore returned no submissions; "
                       "retaining the last known-good export"})}
        self.assertEqual(_export_alert(outcome, self.path, "raw_export"),
                         "raw_export_cold_start_no_records")

    def test_a_permission_error_is_a_failure_even_with_no_file(self) -> None:
        """Absence of a file must not turn every error into a cold start."""
        outcome = {"exit": 1, "error": json.dumps({"message": "UNAUTHENTICATED"})}
        self.assertFalse(self.path.is_file())
        self.assertEqual(_export_alert(outcome, self.path, "accepted_export"),
                         "accepted_export_failed")


class StaleOperatorCliTest(unittest.TestCase):
    """The pipeline runs `lib/`; nothing in the pipeline builds it.

    A fix written in `src/operator.ts` is invisible to the unattended run until
    somebody remembers a separate build, and the run reports the OLD behaviour.
    Measured 2026-09-21: the rebrand added `naiasno.bg` to the canonical host
    list in `src/` while `lib/` carried neither spelling.
    """

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="stale_cli_")
        self.root = Path(self.temp.name)
        source_dir = self.root / "news-functions" / "src"
        source_dir.mkdir(parents=True)
        lib_dir = self.root / "news-functions" / "lib"
        lib_dir.mkdir(parents=True)
        self.source = source_dir / "operator.ts"
        self.source.write_text("export const x = 1;\n", encoding="utf-8")
        self.cli = lib_dir / "operator-cli.js"
        self.cli.write_text("module.exports = {};\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _set_times(self, *, source: float, built: float) -> None:
        os.utime(self.source, (source, source))
        os.utime(self.cli, (built, built))

    def test_source_newer_than_build_names_the_offending_file(self) -> None:
        self._set_times(source=2_000, built=1_000)
        self.assertEqual(_stale_operator_cli(self.cli, self.root),
                         "news-functions/src/operator.ts")

    def test_current_build_reports_no_skew(self) -> None:
        self._set_times(source=1_000, built=2_000)
        self.assertIsNone(_stale_operator_cli(self.cli, self.root))

    def test_a_stale_build_is_reported_but_never_makes_the_operator_unavailable(
            self) -> None:
        """Refusing to run would convert a loud error into a silent skip.

        In `optional` mode an unavailable operator exits 0, so treating skew as
        an `unavailable_reason` would HIDE exactly what this guard exists to
        surface. The stale CLI still runs; the skew rides out on the result.
        """
        self._set_times(source=2_000, built=1_000)
        stale = RuntimeConfig(
            mode="optional", credential=Path("/private/eval.json"),
            operator_cli=self.cli, unavailable_reason=None,
            max_snapshot_age_hours=26,
            live_manifest_url=(
                "https://storage.googleapis.com/data-electionsbg-com/"
                "news/app-data/manifest.json"),
            stale_operator_cli=_stale_operator_cli(self.cli, self.root))
        self.assertTrue(stale.available)
        self.assertEqual(stale.stale_operator_cli,
                         "news-functions/src/operator.ts")

    def test_a_missing_source_tree_is_not_an_alarm(self) -> None:
        """A deployment shipping only `lib/` is a normal shape, not skew."""
        self._set_times(source=2_000, built=1_000)
        self.source.unlink()
        (self.root / "news-functions" / "src").rmdir()
        self.assertIsNone(_stale_operator_cli(self.cli, self.root))


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
        ) as exporter, mock.patch(
            "news.scripts.eval_runtime.feedback_snapshot_status",
            return_value={"status": "missing", "record_count": 0},
        ), mock.patch(
            "news.scripts.eval_runtime.snapshot_status", return_value=accepted,
        ):
            result, code = export_operation(self.root)
        self.assertEqual(code, 0)
        self.assertFalse(result["publication_blocked"])
        self.assertIn("accepted_export_failed_last_good_retained", result["alerts"])
        self.assertEqual(exporter.call_count, 3)
        self.assertEqual(exporter.call_args_list[2].args[1],
                         "export-accepted-feedback")

    def test_a_never_populated_surface_reports_cold_start_not_failure(self):
        """The live 2026-09-21 state: zero submissions since the surface shipped.

        `export_operation` must say so in those words. Reporting it as
        `*_failed_last_good_retained` asserts a retained file that has never
        existed and sends an operator debugging an empty collection.
        """
        empty = {"exit": 1, "result": None, "error": json.dumps({
            "error": "operator_failed",
            "message": ("Firestore returned no accepted adjudications; "
                        "retaining the last known-good snapshot")})}
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime._operator_export", return_value=empty,
        ), mock.patch(
            "news.scripts.eval_runtime.feedback_snapshot_status",
            return_value={"status": "missing", "record_count": 0},
        ), mock.patch(
            "news.scripts.eval_runtime.snapshot_status",
            return_value={"status": "missing", "record_count": 0},
        ):
            result, _ = export_operation(self.root)
        self.assertIn("accepted_export_cold_start_no_records", result["alerts"])
        self.assertIn("feedback_accepted_export_cold_start_no_records",
                      result["alerts"])
        # The raw .jsonl arm is the only one whose retention is NOT read from a
        # status, so it is the only one that can diverge from the other two.
        self.assertIn("raw_export_cold_start_no_records", result["alerts"])
        self.assertNotIn("accepted_export_failed_last_good_retained",
                         result["alerts"])
        # ⚠️ A cold start must still BLOCK in `required` mode — "nobody has
        # submitted yet" is a reason the gate cannot pass, not a reason to
        # waive it. This is the fail-closed-on-empty rule.
        self.assertIn("accepted_snapshot_missing", result["block_reasons"])

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

    def test_valid_accepted_feedback_builds_only_the_private_improvement_dataset(self):
        accepted = {"status": "valid", "record_count": 1, "age_hours": 1,
                    "future_clock_skew": False}
        feedback = {"status": "valid", "record_count": 1,
                    "records_sha256": "sha256:" + "a" * 64}
        completed = mock.Mock(
            returncode=0,
            stdout='{"record_count":1,"raw_community_records_included":0}\n',
            stderr="")
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime._operator_export",
            return_value={"exit": 0, "result": {}},
        ), mock.patch(
            "news.scripts.eval_runtime.snapshot_status", return_value=accepted,
        ), mock.patch(
            "news.scripts.eval_runtime.feedback_snapshot_status",
            return_value=feedback,
        ), mock.patch(
            "news.scripts.eval_runtime.subprocess.run", return_value=completed,
        ) as invoked:
            result, code = export_operation(self.root)
        self.assertEqual(code, 0)
        self.assertEqual(
            result["feedback_improvement_dataset"]["result"]
            ["raw_community_records_included"], 0)
        command = invoked.call_args.args[0]
        self.assertTrue(command[1].endswith(
            "build_feedback_improvement_dataset.py"))
        self.assertNotIn("feedback-submissions", " ".join(command))

    def test_task_sync_runs_only_after_successful_public_manifest_commit(self):
        upload_path = self.root / "upload.json"
        task_path = self.root / "news" / "data" / "evals" / "tasks" / "current.json"
        feedback_path = (self.root / "news" / "data" / "evals" /
                         "feedback-tasks" / "current.json")
        task_path.parent.mkdir(parents=True)
        task_path.write_text("{}", encoding="utf-8")
        feedback_path.parent.mkdir(parents=True)
        feedback_path.write_text("{}", encoding="utf-8")
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
        self.assertEqual(operator.call_count, 2)
        self.assertIn("sync-tasks", operator.call_args_list[0].args[1])
        self.assertIn("sync-feedback-tasks",
                      operator.call_args_list[1].args[1])
        self.assertEqual(result["feedback_sync"]["exit"], 0)

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

    def test_task_build_creates_eval_and_all_article_feedback_manifests(self):
        app_data = self.root / "news" / "app-data"
        app_data.mkdir(parents=True)
        (app_data / "home.json").write_text(json.dumps({
            "generated_at": STAMP,
        }), encoding="utf-8")
        completed = [
            mock.Mock(returncode=0, stdout='{"task_count":50}\n', stderr=""),
            mock.Mock(returncode=0, stdout='{"task_count":5960}\n', stderr=""),
        ]
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime.subprocess.run", side_effect=completed,
        ) as invoked:
            result, code = task_build_operation(self.root)
        self.assertEqual(code, 0)
        self.assertEqual(result["eval_tasks"]["result"]["task_count"], 50)
        self.assertEqual(result["feedback_tasks"]["result"]["task_count"], 5960)
        self.assertEqual(invoked.call_count, 2)
        self.assertTrue(str(invoked.call_args_list[0].args[0][1]).endswith(
            "sync_eval_tasks.py"))
        self.assertTrue(str(invoked.call_args_list[1].args[0][1]).endswith(
            "build_feedback_tasks.py"))

    def test_task_sync_reports_feedback_activation_failure(self):
        upload_path = self.root / "upload.json"
        upload_path.write_text(json.dumps({
            "mode": "news_gcs_upload",
            "public_ready": True,
            "public_enabled": True,
            "failed_scopes": [],
            "scopes": [{"name": "public_app_data_manifest", "exit": 0}],
        }), encoding="utf-8")
        for relative in [
            "news/data/evals/tasks/current.json",
            "news/data/evals/feedback-tasks/current.json",
        ]:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}", encoding="utf-8")
        with mock.patch(
            "news.scripts.eval_runtime.runtime_config", return_value=config()
        ), mock.patch(
            "news.scripts.eval_runtime.run_operator",
            side_effect=[
                {"exit": 0, "result": {"synced": 50}},
                {"exit": 1, "error": "feedback sync failed", "result": None},
            ],
        ):
            result, code = task_sync_operation(upload_path, self.root)
        self.assertEqual(code, 1)
        self.assertEqual(result["sync"]["exit"], 0)
        self.assertEqual(result["feedback_sync"]["exit"], 1)


if __name__ == "__main__":
    unittest.main()
