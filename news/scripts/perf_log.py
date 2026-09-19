#!/usr/bin/env python3
"""The shared, append-only performance log (plan §7 "Shared instrumentation").

One JSON object per line in news/data/_perf/<UTC date>.jsonl, never rewritten.
Every phase of the real-time plan reads its numbers from here, so the rule is
the same for every emitter: record what happened, when, and at what cost —
and NEVER let logging change what the pipeline does. `emit` never raises; an
I/O failure costs the log, not the run.

Under a test runner (`unittest` imported) with NEWS_PERF_DIR unset, events go
to a temp directory, never to the production log: safe by default, rather
than relying on every test module remembering to redirect it.

Events (fields beyond `ts`, `event`, `run_id`):

  glm        one model response or transport failure: provider, model,
             tokens, cost, latency, attempt, outcome
  stage      one pipeline stage, mirrored from _nightly/<run>.stages.jsonl
             after the run: `ts` is the MIRROR time, `order` the stage's
             position, `mirrored: true`
  publish    one upload scope: name, exit, wall seconds — mirrored from
             var/reports/<run>.upload.json, same `ts` caveat

Further events (the analyze timeline, fetch, publish latency) are added by the
plan phases that measure them.

Mirrored events are written to the day file of the run's START (the date in
NEWS_RUN_ID), so one run's events stay in one file across midnight UTC.

`run_id` comes from NEWS_RUN_ID, which run_hourly.sh exports, so events from
every child process of one transaction join on it.

⚠️ `_perf` is in upload_to_gcs.py's ARCHIVE_EXCLUDE. news/data/ is the private
archive's rsync source; without the exclusion this log would be re-uploaded on
every release and inflate exactly the per-publish bytes it exists to measure.

CLI:  python3 perf_log.py mirror-stages <run>.stages.jsonl
      python3 perf_log.py mirror-upload <run>.upload.json
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

NEWS = Path(__file__).resolve().parent.parent
_LOCK = threading.Lock()


def perf_dir() -> Path:
    configured = os.environ.get("NEWS_PERF_DIR")
    if configured:
        return Path(configured)
    if "unittest" in sys.modules:
        return Path(tempfile.gettempdir()) / "news_perf_unittest"
    return NEWS / "data" / "_perf"


def run_day() -> Optional[str]:
    """The UTC date a run started, from NEWS_RUN_ID (`YYYY-MM-DDTHHMMSSZ-pid`)."""
    run_id = os.environ.get("NEWS_RUN_ID") or ""
    day = run_id[:10]
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return None
    return day


def enabled() -> bool:
    return os.environ.get("NEWS_PERF_LOG", "1") != "0"


def emit(event: str, /, *, day: Optional[str] = None, **fields) -> None:
    """Append one event. Never raises; never blocks the caller on I/O errors.

    `event` is positional-only and the reserved keys are written LAST, so a
    field named `event`, `ts` or `run_id` can neither raise nor overwrite them.
    """
    try:
        if not enabled():
            return
        now = datetime.now(timezone.utc)
        row = {**fields, "ts": now.isoformat(timespec="milliseconds"),
               "event": event,
               "run_id": os.environ.get("NEWS_RUN_ID") or None}
        line = json.dumps(row, ensure_ascii=False, default=str) + "\n"
        target = perf_dir() / f"{day or now.date().isoformat()}.jsonl"
        with _LOCK:
            target.parent.mkdir(parents=True, exist_ok=True)
            # One write() of one line in append mode: concurrent processes'
            # lines do not interleave for writes this small.
            with open(target, "a", encoding="utf-8") as fh:
                fh.write(line)
    except Exception:  # noqa: BLE001 — logging must never fail the pipeline
        return


def read_events(day: str, directory: Optional[Path] = None) -> list:
    """Every parseable event for one UTC day; torn lines are skipped."""
    path = (directory or perf_dir()) / f"{day}.jsonl"
    rows = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict):
                    rows.append(row)
    except OSError:
        pass
    return rows


def mirror_stages(stages_path: Path) -> int:
    """Copy one run's stage lines into the perf log as `stage` events."""
    count = 0
    try:
        lines = stages_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    day = run_day()
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or "stage" not in row:
            continue
        emit("stage", day=day, stage=row.get("stage"), exit=row.get("exit"),
             seconds=row.get("seconds"), order=count, mirrored=True)
        count += 1
    return count


def mirror_upload(upload_path: Path) -> int:
    """Copy one run's upload scopes into the perf log as `publish` events."""
    try:
        doc = json.loads(upload_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    scopes = doc.get("scopes") if isinstance(doc, dict) else None
    count = 0
    day = run_day()
    for scope in scopes or []:
        if not isinstance(scope, dict):
            continue
        emit("publish", day=day, order=count, mirrored=True,
             scope=scope.get("name"), exit=scope.get("exit"),
             seconds=scope.get("seconds"), skipped=scope.get("skipped"),
             public_ready=doc.get("public_ready"),
             public_reason=doc.get("public_reason"))
        count += 1
    return count


def main(argv: Optional[list] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) == 2 and args[0] == "mirror-stages":
        print(json.dumps({"mode": "perf_mirror_stages",
                          "stages": mirror_stages(Path(args[1]))}))
        return 0
    if len(args) == 2 and args[0] == "mirror-upload":
        print(json.dumps({"mode": "perf_mirror_upload",
                          "scopes": mirror_upload(Path(args[1]))}))
        return 0
    print("usage: perf_log.py mirror-stages <run>.stages.jsonl | "
          "mirror-upload <run>.upload.json", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
