#!/usr/bin/env python3
"""Contract tests for the unattended nightly news pipeline runner."""

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "news" / "scripts" / "run_nightly.sh"


class NightlyRunnerContractTests(unittest.TestCase):
    def run_runner(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self.run_runner_at(RUNNER, *args)

    def run_runner_at(self, runner: Path, *args: str,
                      env: dict | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(runner), *args], cwd=runner.parents[2], text=True,
            capture_output=True, check=False, env=env)

    def copy_runner(self, root: Path) -> Path:
        runner = root / "news" / "scripts" / "run_nightly.sh"
        runner.parent.mkdir(parents=True)
        runner.write_text(RUNNER.read_text(encoding="utf-8"), encoding="utf-8")
        source_timeout = RUNNER.parent / "bin" / "timeout"
        target_timeout = runner.parent / "bin" / "timeout"
        target_timeout.parent.mkdir(parents=True)
        target_timeout.write_text(source_timeout.read_text(encoding="utf-8"),
                                  encoding="utf-8")
        target_timeout.chmod(0o755)
        return runner

    def test_rejects_missing_or_invalid_option_values_before_running(self):
        for args, expected in (
            (("--limit",), "--limit requires N"),
            (("--limit", "ten"), "--limit must be a non-negative integer"),
            (("--model",), "--model requires NAME"),
            (("--model", ""), "--model requires NAME"),
            (("--workers",), "--workers requires N"),
            (("--workers", "0"), "--workers must be at least 1"),
            (("--workers", "four"), "--workers must be a non-negative integer"),
            (("--schema-retries",), "--schema-retries requires 0 or 1"),
            (("--schema-retries", "2"), "--schema-retries must be 0 or 1"),
            (("--stage-timeout",), "--stage-timeout requires SECONDS"),
            (("--stage-timeout", "slow"),
             "--stage-timeout must be a non-negative integer"),
            (("--articles-per-source",), "--articles-per-source requires N"),
            (("--browser-timeout", "slow"),
             "--browser-timeout must be a non-negative integer"),
            (("--run-id",), "--run-id requires ID"),
            (("--run-id", "bad/id"), "--run-id must contain only"),
        ):
            with self.subTest(args=args):
                proc = self.run_runner(*args)
                self.assertEqual(proc.returncode, 2)
                self.assertIn(expected, proc.stderr)

    def test_dry_run_isolated_artifacts_and_skips_every_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            first = self.run_runner_at(
                runner, "--dry-run", "--articles-per-source", "3",
                "--browser-timeout", "15", "--workers", "4",
                "--schema-retries", "1", "--skip-browser",
                "--run-id", "wrapper-test")
            second = self.run_runner_at(runner, "--dry-run")
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            reports = sorted((root / "news" / "data" / "_nightly").glob("*.json"))
            self.assertEqual(len(reports), 2)
            for report in reports:
                data = __import__("json").loads(report.read_text(encoding="utf-8"))
                self.assertEqual(data["stages_run"], 12)
                self.assertEqual(data["stages_ok"], 12)
                self.assertTrue(all(s["result"] == {"skipped": "dry_run"}
                                    for s in data["stages"]))
                self.assertEqual(data["acquisition"]["direct"]["skipped"], "dry_run")
                self.assertEqual(data["acquisition"]["browser"]["skipped"], "dry_run")
            first_report = __import__("json").loads(
                (root / "news/data/_nightly/wrapper-test.json").read_text(
                    encoding="utf-8"))
            self.assertEqual(first_report["run_id"], "wrapper-test")

            reused = self.run_runner_at(
                runner, "--dry-run", "--run-id", "wrapper-test")
            self.assertEqual(reused.returncode, 2)
            self.assertIn("artifact already exists", reused.stderr)

    def test_live_owner_lock_skips_before_any_stage_starts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            lock = root / "news" / "data" / "_nightly" / "pipeline.lock"
            lock.mkdir(parents=True)
            (lock / "pid").write_text(str(os.getpid()) + "\n", encoding="utf-8")
            proc = self.run_runner_at(runner, "--dry-run")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(__import__("json").loads(proc.stdout)["skipped"],
                             "already_running")
            self.assertEqual(list(lock.parent.glob("*.json")), [])

    def test_runner_supplies_timeout_under_a_minimal_cron_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            env = os.environ.copy()
            env["PATH"] = f"{Path(sys.executable).parent}:/usr/bin:/bin"
            proc = self.run_runner_at(runner, "--dry-run", env=env)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_rejects_invalid_model_parameters_from_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            runner = self.copy_runner(Path(temp))
            for name, value, expected in (
                ("NEWS_LLM_MAX_TOKENS", "0", "must be at least 1"),
                ("NEWS_LLM_MAX_TOKENS", "many", "non-negative integer"),
                ("NEWS_LLM_TEMPERATURE", "hot", "number between 0 and 2"),
                ("NEWS_LLM_TEMPERATURE", "2.1", "number between 0 and 2"),
            ):
                with self.subTest(name=name, value=value):
                    env = {**os.environ, name: value}
                    proc = self.run_runner_at(runner, "--dry-run", env=env)
                    self.assertEqual(proc.returncode, 2)
                    self.assertIn(expected, proc.stderr)

    def test_timeout_wrapper_kills_the_descendant_process_group(self):
        with tempfile.TemporaryDirectory() as temp:
            marker = Path(temp) / "descendant-survived"
            wrapper = RUNNER.parent / "bin" / "timeout"
            child = (
                "import pathlib,time,sys; time.sleep(.4); "
                "pathlib.Path(sys.argv[1]).write_text('bad')")
            parent = (
                "import subprocess,sys,time; "
                "subprocess.Popen([sys.executable,'-c',sys.argv[2],sys.argv[1]]); "
                "time.sleep(5)")
            proc = subprocess.run(
                [str(wrapper), "0.1", sys.executable, "-c", parent,
                 str(marker), child], capture_output=True, text=True,
                check=False)
            self.assertEqual(proc.returncode, 124, proc.stderr)
            time.sleep(.5)
            self.assertFalse(marker.exists(),
                             "a descendant survived the timeout process-group kill")

    def test_model_probe_failure_skips_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            source = runner.read_text(encoding="utf-8")
            source = source.replace(
                'stage acquire_direct bash news/scripts/save_all_direct.sh "$ARTICLES_PER_SOURCE" \\\n    "$DIRECT_SUMMARY"',
                "stage acquire_direct python3 -c 'import json; print(json.dumps({}))'")
            source = source.replace(
                'stage acquire_browser bash news/scripts/save_all_browser.sh "$ARTICLES_PER_SOURCE" \\\n      "$BROWSER_SUMMARY" \\\n      "--timeout=$BROWSER_TIMEOUT"',
                "stage acquire_browser python3 -c 'import json; print(json.dumps({}))'")
            source = source.replace(
                'stage probe_model python3 news/scripts/llm_client.py',
                "stage probe_model python3 -c 'import json,sys; print(json.dumps({})); sys.exit(1)'")
            for name in ("build_prompts.py", "build_gazetteer.py",
                         "build_image_rights_queue.py", "source_commons_images.py",
                         "review_routing.py", "build_mention_index.py",
                         "build_app_data.py", "home_health.py"):
                (runner.parent / name).write_text("print('{}')\n", encoding="utf-8")
            runner.write_text(source, encoding="utf-8")
            proc = self.run_runner_at(runner, "--skip-browser")
            self.assertEqual(proc.returncode, 1, proc.stderr)
            report = next((root / "news" / "data" / "_nightly").glob("*.json"))
            data = __import__("json").loads(report.read_text(encoding="utf-8"))
            direct = next(s for s in data["stages"] if s["stage"] == "acquire_direct")
            browser = next(s for s in data["stages"] if s["stage"] == "acquire_browser")
            self.assertEqual((direct["exit"], browser["exit"]), (0, 0))
            self.assertTrue(all(s["exit"] == 0 for s in data["stages"]
                                if s["stage"] not in {"probe_model"}))
            analysis = next(s for s in data["stages"] if s["stage"] == "analyze")
            self.assertEqual(analysis["result"], {"skipped": "model_unavailable"})


if __name__ == "__main__":
    unittest.main()
