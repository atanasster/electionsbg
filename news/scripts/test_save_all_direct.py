#!/usr/bin/env python3
"""Regression tests for the exported direct-sweep worker function."""

import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("save_all_direct.sh")


def run_one_source() -> str:
    """Extract the exact function Bash exports to each xargs worker."""
    lines = SCRIPT.read_text(encoding="utf-8").splitlines()
    start = lines.index("run_one() {")
    for end in range(start + 1, len(lines)):
        if lines[end] == "}":
            return "\n".join(lines[start:end + 1])
    raise AssertionError("run_one closing brace not found")


class ExportedWorker(unittest.TestCase):
    def invoke(self, status: int, output: str = "") -> tuple[list, list]:
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "python-calls.txt"
            shell = f"""
{run_one_source()}
timeout() {{
  if [ -n "$STUB_OUTPUT" ]; then printf '%s\\n' "$STUB_OUTPUT"; fi
  return "$STUB_STATUS"
}}
python3() {{
  local previous="" last="" argument
  for argument in "$@"; do previous="$last"; last="$argument"; done
  printf '%s|%s|%s\\n' "$1" "$previous" "$last" >> "$STUB_MARKER"
}}
export -f run_one timeout python3
export STUB_STATUS={status}
export STUB_OUTPUT={shlex.quote(output)}
export STUB_MARKER={shlex.quote(str(marker))}
/bin/bash -c 'run_one example.bg'
"""
            proc = subprocess.run(
                ["/bin/bash", "-c", shell], capture_output=True, text=True,
                cwd=SCRIPT.parent.parent, env=os.environ.copy(), check=True)
            summaries = [json.loads(line) for line in proc.stdout.splitlines()
                         if line.strip()]
            calls = (marker.read_text(encoding="utf-8").splitlines()
                     if marker.exists() else [])
            return summaries, calls

    def test_function_exports_and_imports_in_child_bash(self):
        proc = subprocess.run(
            ["/bin/bash", "-c",
             f"{run_one_source()}\nexport -f run_one\n"
             "/bin/bash -c 'declare -f run_one' | /bin/bash -n"],
            capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_every_empty_output_status_is_persisted(self):
        for status in (0, 1, 124, 127, 137):
            with self.subTest(status=status):
                summaries, calls = self.invoke(status)
                self.assertEqual(summaries, [{
                    "domain": "example.bg", "error": "timeout_or_crash"}])
                self.assertEqual(calls, [f"-c|example.bg|{status}"])

    def test_nonempty_saver_result_is_not_double_recorded(self):
        owned = '{"domain":"example.bg","error":"owned"}'
        summaries, calls = self.invoke(1, owned)
        self.assertEqual(summaries, [json.loads(owned)])
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
