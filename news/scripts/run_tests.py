#!/usr/bin/env python3
"""Run every Python test file in news/scripts/, discovered rather than listed.

⚠️⚠️ THE LIST WAS THE BUG. `news:test` named three files by hand
(test_save_articles, test_analyze_articles, test_build_app_data) while eight
existed — so the tests for the mention resolver, the gazetteer, the
reciprocal index, the standalone runner, the gold set and the review routing
were in NO runner at all. They had only ever run because somebody ran them,
and a test nobody runs is a comment.

Discovery means a new `test_*.py` is covered the moment it is written, which
is the only version of this that stays true.

Run:  python3 news/scripts/run_tests.py [-v]
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def main() -> int:
    files = sorted(p for p in HERE.glob("test_*.py"))
    if not files:
        # ⚠️ An empty discovery is a FAILURE, not a clean run. A renamed
        # directory or a changed prefix would otherwise report „all tests
        # passed" for a suite it never found.
        print("no test_*.py found in news/scripts — refusing to report "
              "success for a suite that was never discovered", file=sys.stderr)
        return 2

    failed = []
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(ROOT), env.get("PYTHONPATH", "")) if part
    )
    for path in files:
        proc = subprocess.run([sys.executable, str(path), *sys.argv[1:]],
                              cwd=ROOT, env=env)
        mark = "ok  " if proc.returncode == 0 else "FAIL"
        print(f"  {mark}  {path.name}", file=sys.stderr)
        if proc.returncode != 0:
            failed.append(path.name)

    # Counts beside their denominator, never a bare "ok".
    print(f"\n{len(files) - len(failed)}/{len(files)} test files passed",
          file=sys.stderr)
    if failed:
        print("failed: " + ", ".join(failed), file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
