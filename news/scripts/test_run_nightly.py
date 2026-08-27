#!/usr/bin/env python3
"""Contract tests for the unattended nightly news pipeline runner."""

import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "news" / "scripts" / "run_nightly.sh"


class NightlyRunnerContractTests(unittest.TestCase):
    def run_runner(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self.run_runner_at(RUNNER, *args)

    def run_runner_at(self, runner: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(runner), *args], cwd=runner.parents[2], text=True,
            capture_output=True, check=False)

    def copy_runner(self, root: Path) -> Path:
        runner = root / "news" / "scripts" / "run_nightly.sh"
        runner.parent.mkdir(parents=True)
        runner.write_text(RUNNER.read_text(encoding="utf-8"), encoding="utf-8")
        return runner

    def test_rejects_missing_or_invalid_option_values_before_running(self):
        for args, expected in (
            (("--limit",), "--limit requires N"),
            (("--limit", "ten"), "--limit must be a non-negative integer"),
            (("--model",), "--model requires NAME"),
            (("--articles-per-source",), "--articles-per-source requires N"),
            (("--browser-timeout", "slow"),
             "--browser-timeout must be a non-negative integer"),
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
                "--browser-timeout", "15", "--skip-browser")
            second = self.run_runner_at(runner, "--dry-run")
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            reports = sorted((root / "news" / "data" / "_nightly").glob("*.json"))
            self.assertEqual(len(reports), 2)
            for report in reports:
                data = __import__("json").loads(report.read_text(encoding="utf-8"))
                self.assertEqual(data["stages_run"], 9)
                self.assertEqual(data["stages_ok"], 9)
                self.assertTrue(all(s["result"] == {"skipped": "dry_run"}
                                    for s in data["stages"]))


if __name__ == "__main__":
    unittest.main()
