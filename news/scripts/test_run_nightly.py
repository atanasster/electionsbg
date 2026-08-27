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

    def test_model_probe_failure_skips_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            runner = self.copy_runner(root)
            source = runner.read_text(encoding="utf-8")
            source = source.replace(
                'stage acquire_direct bash news/scripts/save_all_direct.sh "$ARTICLES_PER_SOURCE" \\\n    "news/data/_nightly/$RUN_ID.direct.jsonl"',
                "stage acquire_direct python3 -c 'import json; print(json.dumps({}))'")
            source = source.replace(
                'stage acquire_browser bash news/scripts/save_all_browser.sh "$ARTICLES_PER_SOURCE" \\\n      "news/data/_nightly/$RUN_ID.browser.jsonl" \\\n      "--timeout=$BROWSER_TIMEOUT"',
                "stage acquire_browser python3 -c 'import json; print(json.dumps({}))'")
            source = source.replace(
                'stage probe_model python3 news/scripts/llm_client.py',
                "stage probe_model python3 -c 'import json,sys; print(json.dumps({})); sys.exit(1)'")
            for stage in ("check_prompts", "common_words", "review_queue",
                          "mention_index", "bundles"):
                start = f"stage {stage} "
                pos = source.index(start)
                end = source.index("\n", pos)
                source = source[:pos] + (
                    f"stage {stage} python3 -c 'import json; print(json.dumps({{}}))'") + source[end:]
            runner.write_text(source, encoding="utf-8")
            proc = self.run_runner_at(runner, "--skip-browser")
            self.assertEqual(proc.returncode, 1, proc.stderr)
            report = next((root / "news" / "data" / "_nightly").glob("*.json"))
            data = __import__("json").loads(report.read_text(encoding="utf-8"))
            direct = next(s for s in data["stages"] if s["stage"] == "acquire_direct")
            browser = next(s for s in data["stages"] if s["stage"] == "acquire_browser")
            self.assertEqual((direct["exit"], browser["exit"]), (0, 0))
            analysis = next(s for s in data["stages"] if s["stage"] == "analyze")
            self.assertEqual(analysis["result"], {"skipped": "model_unavailable"})


if __name__ == "__main__":
    unittest.main()
