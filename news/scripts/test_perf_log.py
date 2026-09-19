#!/usr/bin/env python3
"""The shared perf log: append-only, run-joined, and never able to fail a run.

Run:  python3 news/scripts/test_perf_log.py
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import perf_log  # noqa: E402

NEWS = Path(__file__).resolve().parent.parent


class PerfLog(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="perf_"))
        self.env = mock.patch.dict(os.environ, {"NEWS_PERF_DIR": str(self.dir),
                                                "NEWS_RUN_ID": "run-1"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def events(self):
        files = list(self.dir.glob("*.jsonl"))
        self.assertEqual(len(files), 1)
        return perf_log.read_events(files[0].stem, self.dir)

    def test_emit_appends_one_line_per_event_with_run_id(self):
        perf_log.emit("glm", provider="NextBit", latency_s=12.5)
        perf_log.emit("analyze", step="pool_open")
        rows = self.events()
        self.assertEqual([r["event"] for r in rows], ["glm", "analyze"])
        self.assertEqual({r["run_id"] for r in rows}, {"run-1"})
        self.assertEqual(rows[0]["provider"], "NextBit")
        self.assertIn("ts", rows[0])

    def test_concurrent_writers_never_tear_lines(self):
        threads = [threading.Thread(target=lambda i=i: [
            perf_log.emit("glm", worker=i, n=n) for n in range(50)])
            for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(self.events()), 400)

    def test_an_unwritable_directory_is_swallowed(self):
        blocker = self.dir / "file"
        blocker.write_text("x", encoding="utf-8")
        with mock.patch.dict(os.environ, {"NEWS_PERF_DIR": str(blocker / "sub")}):
            perf_log.emit("glm")  # must not raise

    def test_disabled_writes_nothing(self):
        with mock.patch.dict(os.environ, {"NEWS_PERF_LOG": "0"}):
            perf_log.emit("glm")
        self.assertEqual(list(self.dir.glob("*.jsonl")), [])

    def test_torn_lines_are_skipped_on_read(self):
        perf_log.emit("glm", ok=True)
        path = next(self.dir.glob("*.jsonl"))
        with open(path, "a", encoding="utf-8") as fh:
            fh.write('{"event": "gl')
        self.assertEqual(len(self.events()), 1)

    def test_mirror_stages(self):
        # Outside the perf dir: a *.jsonl beside the log is not the log.
        stages = self.dir / "nightly" / "run.stages.jsonl"
        stages.parent.mkdir()
        stages.write_text('{"stage": "analyze", "exit": 0, "seconds": 1530}\n'
                          'garbage\n{"stage": "bundles", "exit": 0, '
                          '"seconds": 13}\n', encoding="utf-8")
        self.assertEqual(perf_log.mirror_stages(stages), 2)
        rows = [r for r in self.events() if r["event"] == "stage"]
        self.assertEqual([r["stage"] for r in rows], ["analyze", "bundles"])

    def test_mirror_upload(self):
        upload = self.dir / "nightly" / "run.upload.json"
        upload.parent.mkdir()
        upload.write_text(json.dumps({
            "public_ready": False, "public_reason": "home_health",
            "scopes": [{"name": "archive", "exit": 0, "seconds": 41.2},
                       "junk"]}), encoding="utf-8")
        self.assertEqual(perf_log.mirror_upload(upload), 1)
        row = next(r for r in self.events() if r["event"] == "publish")
        self.assertEqual((row["scope"], row["exit"], row["seconds"]),
                         ("archive", 0, 41.2))
        self.assertFalse(row["public_ready"])
        self.assertEqual(perf_log.mirror_upload(self.dir / "missing.json"), 0)

    def test_reserved_keys_cannot_be_overridden_or_raise(self):
        perf_log.emit("glm", event="bogus", ts="x", run_id="y", k=1)
        row = self.events()[0]
        self.assertEqual((row["event"], row["run_id"], row["k"]),
                         ("glm", "run-1", 1))
        self.assertNotEqual(row["ts"], "x")

    def test_mirrored_events_land_in_the_run_start_day_file(self):
        # A run that crosses midnight UTC stays in ONE file.
        with mock.patch.dict(os.environ,
                             {"NEWS_RUN_ID": "2026-09-18T235900Z-7"}):
            stages = self.dir / "nightly" / "r.stages.jsonl"
            stages.parent.mkdir()
            stages.write_text('{"stage": "analyze", "exit": 0}\n',
                              encoding="utf-8")
            perf_log.mirror_stages(stages)
        rows = perf_log.read_events("2026-09-18", self.dir)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["mirrored"])
        self.assertEqual(rows[0]["order"], 0)

    def test_under_unittest_the_default_is_never_the_production_log(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NEWS_PERF_DIR", None)
            self.assertNotEqual(perf_log.perf_dir(),
                                NEWS / "data" / "_perf")

    def test_run_hourly_mirrors_best_effort_and_not_on_dry_runs(self):
        source = (NEWS / "standalone" / "run_hourly.sh").read_text(
            encoding="utf-8")
        self.assertIn('export NEWS_RUN_ID="$RUN_ID"', source)
        block = source.split("# Best-effort: the perf log", 1)[1]
        block = block.split("\nfi\n", 1)[0]
        self.assertIn('if [ "$DRY" -eq 0 ]', block)
        for mode in ("mirror-stages", "mirror-upload"):
            self.assertIn(mode, block)
        self.assertEqual(block.count("|| :"), 2)

    def test_perf_dir_is_excluded_from_the_archive_upload(self):
        # news/data/ is the private archive's rsync source: without this the
        # log is re-uploaded on every release (plan §0.5 N2).
        import importlib.util
        import re
        spec = importlib.util.spec_from_file_location(
            "upload_to_gcs", NEWS / "standalone" / "upload_to_gcs.py")
        upload = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(upload)
        pattern = re.compile(upload.ARCHIVE_EXCLUDE)
        self.assertTrue(pattern.search("_perf/2026-09-19.jsonl"))
        self.assertTrue(pattern.search("_perf/diagnose/x/result.json"))
        self.assertFalse(pattern.search("dnevnik.bg/20260919-x.json"))


if __name__ == "__main__":
    unittest.main()
