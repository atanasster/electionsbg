#!/usr/bin/env python3
"""The staleness alarm: each alarm fires on its own failure and only there.

Run:  python3 news/scripts/test_check_staleness.py

No network: the manifest fetch is injected.
"""

import ast
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_staleness as cs  # noqa: E402

NOW = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
SETTINGS = {"NEWS_PUBLIC_GCS_URI": "gs://bucket/news/app-data"}


def manifest_at(when: datetime):
    return lambda url: {"run_id": "r1", "generated_at": when.isoformat()}


class Staleness(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="stale_"))
        self.reports = self.root / "var" / "reports"
        self.reports.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write_run(self, run_id: str, age_s: float, **exits):
        row = {"mode": "news_hourly", "run_id": run_id, "pipeline_exit": 0,
               "upload_exit": 0, "eval_task_sync_exit": 0, **exits}
        path = self.reports / f"{run_id}.json"
        path.write_text(json.dumps(row), encoding="utf-8")
        ts = NOW.timestamp() - age_s
        os.utime(path, (ts, ts))
        # A sidecar with the same run id must never be read as the combined
        # report, even when it is newer.
        side = self.reports / f"{run_id}.upload.json"
        side.write_text(json.dumps({"mode": "news_gcs_upload"}), encoding="utf-8")
        os.utime(side, (ts + 5, ts + 5))

    def alarms(self, status):
        return sorted(a["alarm"] for a in status["alarms"])

    def test_healthy_when_recent_publish_and_clean_run(self):
        self.write_run("r1", 600)
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=40)))
        self.assertTrue(status["ok"], status)
        self.assertEqual(status["manifest_url"],
                         "https://storage.googleapis.com/bucket/news/app-data/manifest.json")

    def test_manifest_stale_is_separate_from_the_scheduler(self):
        # The scheduler runs (fresh report) but nothing publishes: the pair of
        # alarms is what distinguishes "quiet" from "dead".
        self.write_run("r1", 600)
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(days=17)))
        self.assertEqual(self.alarms(status), ["manifest_stale"])

    def test_no_recent_run_when_the_scheduler_stopped(self):
        self.write_run("r1", 3 * 3600)
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertEqual(self.alarms(status), ["no_recent_run"])
        self.assertIn("not firing", status["alarms"][0]["detail"])

    def test_no_recent_run_with_a_fresh_log_points_at_early_exits(self):
        self.write_run("r1", 3 * 3600)
        log = self.root / "var" / "cron.log"
        log.write_text("skipped\n", encoding="utf-8")
        os.utime(log, (NOW.timestamp() - 60, NOW.timestamp() - 60))
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertIn("exit before writing a report",
                      status["alarms"][0]["detail"])

    def test_no_run_report_at_all(self):
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertEqual(self.alarms(status), ["no_recent_run"])

    def test_run_failed_on_any_nonzero_exit(self):
        for key in cs.EXIT_KEYS:
            with self.subTest(key=key):
                for p in self.reports.iterdir():
                    p.unlink()
                self.write_run("r1", 600, **{key: 1})
                status = cs.evaluate(self.root, NOW, SETTINGS,
                                     manifest_at(NOW - timedelta(minutes=30)))
                self.assertEqual(self.alarms(status), ["run_failed"])

    def test_stale_operator_cli_alarms_even_when_every_exit_is_zero(self):
        """The dangerous skew SUCCEEDS; `run_failed` is blind to it.

        On 2026-09-21 the stale build happened to throw, so it rode out on
        `eval_task_sync_exit`. A stale build whose old behaviour merely differs
        returns 0 — which is why this is its own alarm and not a second reading
        of the exit codes.
        """
        self.write_run("r1", 600, eval_task_sync={
            "operator_cli_stale": "news-functions/src/operator.ts"})
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertEqual(self.alarms(status), ["operator_cli_stale"])
        self.assertIn("npm --prefix news-functions run build",
                      status["alarms"][0]["detail"])

    def test_stale_operator_cli_is_also_read_from_the_export_arm(self):
        self.write_run("r1", 600, evals={"export": {
            "operator_cli_stale": "news-functions/src/operator.ts"}})
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertEqual(self.alarms(status), ["operator_cli_stale"])

    def test_a_current_build_raises_no_stale_cli_alarm(self):
        self.write_run("r1", 600, eval_task_sync={"operator_cli_stale": None})
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertTrue(status["ok"], status)

    def test_newest_combined_report_wins(self):
        self.write_run("old", 7000, pipeline_exit=1)
        self.write_run("new", 600)
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertTrue(status["ok"], status)
        self.assertEqual(status["last_run_id"], "new")

    def test_unreadable_or_unconfigured_manifest(self):
        self.write_run("r1", 600)

        def boom(url):
            raise OSError("connection refused")
        status = cs.evaluate(self.root, NOW, SETTINGS, boom)
        self.assertEqual(self.alarms(status), ["manifest_unreadable"])
        status = cs.evaluate(self.root, NOW, SETTINGS,
                             lambda url: {"generated_at": "not a date"})
        self.assertEqual(self.alarms(status), ["manifest_unreadable"])
        status = cs.evaluate(self.root, NOW, {"NEWS_PUBLIC_GCS_URI": ""},
                             manifest_at(NOW))
        self.assertEqual(self.alarms(status), ["manifest_unreadable"])

    def test_a_bad_setting_falls_back_and_is_reported(self):
        self.write_run("r1", 600)
        status = cs.evaluate(self.root, NOW, {**SETTINGS,
                                              "NEWS_STALE_AFTER_S": "2h"},
                             manifest_at(NOW - timedelta(minutes=30)))
        self.assertEqual(status["stale_after_s"], cs.DEFAULT_STALE_AFTER_S)
        self.assertIn("NEWS_STALE_AFTER_S", status["config_problems"][0])
        self.assertTrue(status["ok"])

    def test_threshold_is_configurable(self):
        self.write_run("r1", 600)
        status = cs.evaluate(self.root, NOW, {**SETTINGS,
                                              "NEWS_STALE_AFTER_S": "900"},
                             manifest_at(NOW - timedelta(minutes=20)))
        self.assertEqual(self.alarms(status), ["manifest_stale"])

    def test_should_notify_on_change_recovery_and_renotify_interval(self):
        firing = ["manifest_stale"]
        t = NOW.timestamp()
        self.assertTrue(cs.should_notify(firing, {}, t, 3600))
        prev = {"notified": ["manifest_stale"], "notified_at": t}
        self.assertFalse(cs.should_notify(firing, prev, t + 60, 3600))
        self.assertTrue(cs.should_notify(firing, prev, t + 3600, 3600))
        self.assertTrue(cs.should_notify([], prev, t + 60, 3600))
        self.assertFalse(cs.should_notify([], {"notified": []}, t, 3600))

    def test_a_new_failing_run_is_a_new_alarm(self):
        self.write_run("r1", 600, upload_exit=1)
        first = cs.alarm_keys(cs.evaluate(
            self.root, NOW, SETTINGS, manifest_at(NOW)))
        for p in self.reports.iterdir():
            p.unlink()
        self.write_run("r2", 300, pipeline_exit=2)
        second = cs.alarm_keys(cs.evaluate(
            self.root, NOW, SETTINGS, manifest_at(NOW)))
        self.assertNotEqual(first, second)
        self.assertTrue(cs.should_notify(
            second, {"notified": first, "notified_at": NOW.timestamp()},
            NOW.timestamp() + 60, 3600))

    def run_notify(self, at: datetime, fetch):
        calls = []
        # run() reads the URI from the env files, never from os.environ.
        (self.root / ".env.upload").write_text(
            "NEWS_PUBLIC_GCS_URI=gs://b/x\n", encoding="utf-8")
        orig = cs.notify
        cs.notify = lambda status, keys, settings: calls.append(keys)
        try:
            status = cs.run(self.root, True,
                            {"NEWS_STALENESS_GRACE_S": "2700"}, fetch, at)
        finally:
            cs.notify = orig
        return status, calls

    def test_grace_suppresses_the_wake_gap_the_catch_up_run_closes(self):
        # Woken after a long sleep: stale at t0, healthy 30 min later. No
        # notification either way — the alarm never persisted for the grace.
        self.write_run("r1", 600)
        _, calls = self.run_notify(NOW, manifest_at(NOW - timedelta(hours=5)))
        self.assertEqual(calls, [])
        later = NOW + timedelta(minutes=30)
        _, calls = self.run_notify(later, manifest_at(later))
        self.assertEqual(calls, [])

    def test_a_persistent_alarm_notifies_once_past_the_grace(self):
        self.write_run("r1", 600)
        stale = manifest_at(NOW - timedelta(days=2))
        _, calls = self.run_notify(NOW, stale)
        self.assertEqual(calls, [])
        _, calls = self.run_notify(NOW + timedelta(minutes=50), stale)
        self.assertEqual(calls, [["manifest_stale"]])
        _, calls = self.run_notify(NOW + timedelta(minutes=80), stale)
        self.assertEqual(calls, [])  # no repeat inside the renotify window

    def test_the_checker_never_crashes_silently(self):
        orig = cs.run

        def boom(*a, **k):
            raise RuntimeError("disk vanished")
        cs.run = boom
        try:
            import io
            import contextlib
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = cs.main(["--root", str(self.root)])
        finally:
            cs.run = orig
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(buf.getvalue())["alarms"][0]["alarm"],
                         "checker_error")

    def test_env_files_are_parsed_without_expansion(self):
        (self.root / ".env.upload").write_text(
            '# comment\nNEWS_PUBLIC_GCS_URI="gs://b/x"\n'
            "export NEWS_STALE_AFTER_S=60\nBROKEN LINE\n", encoding="utf-8")
        settings = cs.read_env_files(self.root)
        self.assertEqual(settings["NEWS_PUBLIC_GCS_URI"], "gs://b/x")
        self.assertEqual(settings["NEWS_STALE_AFTER_S"], "60")

    def test_cli_writes_state_and_exits_nonzero_on_alarm(self):
        (self.root / ".env.upload").write_text(
            "NEWS_STALENESS_MANIFEST_URL=http://127.0.0.1:9/manifest.json\n",
            encoding="utf-8")
        out = subprocess.run(
            [sys.executable, str(Path(cs.__file__)), "--root", str(self.root)],
            text=True, capture_output=True, timeout=60,
            env={**os.environ, "NEWS_STALE_AFTER_S": "7200"})
        self.assertEqual(out.returncode, 1, out.stderr)
        status = json.loads(out.stdout)
        self.assertIn("manifest_unreadable", self.alarms(status))
        self.assertIn("no_recent_run", self.alarms(status))

    def test_source_stays_python39_compatible(self):
        # launchd's PATH may only offer macOS's /usr/bin/python3 (3.9).
        source = Path(cs.__file__).read_text(encoding="utf-8")
        ast.parse(source, feature_version=(3, 9))
        py39 = Path("/usr/bin/python3")
        if py39.exists():
            compiled = subprocess.run(
                [str(py39), "-m", "py_compile", str(Path(cs.__file__))],
                capture_output=True, text=True)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)


if __name__ == "__main__":
    unittest.main()
