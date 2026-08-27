#!/usr/bin/env python3
"""Contract tests for the unattended nightly news pipeline runner."""

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "news" / "scripts" / "run_nightly.sh"


class NightlyRunnerContractTests(unittest.TestCase):
    def run_runner(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(RUNNER), *args], cwd=ROOT, text=True,
            capture_output=True, check=False)

    def test_rejects_missing_or_invalid_option_values_before_running(self):
        for args, expected in (
            (("--limit",), "--limit requires N"),
            (("--limit", "ten"), "--limit must be a non-negative integer"),
            (("--model",), "--model requires NAME"),
        ):
            with self.subTest(args=args):
                proc = self.run_runner(*args)
                self.assertEqual(proc.returncode, 2)
                self.assertIn(expected, proc.stderr)

    def test_uses_a_per_invocation_run_id_for_every_artifact(self):
        source = RUNNER.read_text(encoding="utf-8")
        self.assertIn('RUN_ID="$(date -u +%Y-%m-%dT%H%M%SZ)-$$"', source)
        self.assertIn('REPORT="$OUT_DIR/$RUN_ID.json"', source)
        self.assertIn('STAGES="$OUT_DIR/$RUN_ID.stages.jsonl"', source)
        self.assertIn('"news/data/_nightly/$RUN_ID.direct.jsonl"', source)
        self.assertIn('"news/data/_nightly/$RUN_ID.browser.jsonl"', source)


if __name__ == "__main__":
    unittest.main()
