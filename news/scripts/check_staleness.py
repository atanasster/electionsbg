#!/usr/bin/env python3
"""Staleness alarm for the hourly news pipeline (plan Phase 0 step 0.3).

The pipeline once stopped publishing for 17 days and nothing noticed. This
check is what notices. It is deliberately independent of the hourly job — a
separate LaunchAgent runs it every 30 minutes — because a scheduler that has
stopped cannot report its own absence.

Four alarms, each a distinct failure:

  manifest_stale       the public manifest's `generated_at` is older than
                       NEWS_STALE_AFTER_S (default 2 x the hourly cadence)
  manifest_unreadable  the manifest could not be fetched or parsed
  no_recent_run        the newest combined run report is older than the same
                       bound — the scheduler is not firing, or runs exit before
                       writing their report (var/cron.log tells which)
  run_failed           the newest run reported a non-zero pipeline_exit /
                       upload_exit / eval_task_sync_exit

`manifest_stale` and `no_recent_run` are kept apart on purpose: a scheduler that
runs every hour but whose uploader refuses to publish looks "quiet" to the
first and healthy to the second, and the pair is what tells the two apart.

Output is one JSON line; exit 1 when any alarm is set. With --notify it raises
a macOS notification (and POSTs to NEWS_ALERT_WEBHOOK_URL when set) when the
set of alarms that have persisted for NEWS_STALENESS_GRACE_S CHANGES — including
recovery — and again every NEWS_STALENESS_RENOTIFY_S while it persists. The
grace exists because both agents fire on wake: after a long sleep this check
would otherwise report the gap the catch-up hourly run is about to close.

Runs under launchd's minimal environment, so it reads its settings straight
from the env files and must stay Python 3.9 compatible (/usr/bin/python3 on
macOS is 3.9). It never raises: every internal failure becomes part of the
report rather than a silent crash of the thing meant to catch silence.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

DEFAULT_STALE_AFTER_S = 2 * 3600
DEFAULT_RENOTIFY_S = 6 * 3600
DEFAULT_GRACE_S = 45 * 60
EXIT_KEYS = ("pipeline_exit", "upload_exit", "eval_task_sync_exit")
ENV_FILES = (".env.upload", ".env.pipeline", "config.env")


def read_env_files(root: Path) -> dict:
    """Assignment-only KEY=VALUE lines; quotes stripped, nothing expanded."""
    out: dict = {}
    for name in ENV_FILES:
        path = root / name
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export "):].strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            out[key] = value
    return out


def int_setting(settings: dict, key: str, default: int,
                problems: list) -> int:
    """A positive integer setting; a bad value falls back and is reported."""
    raw = settings.get(key)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
        if value <= 0:
            raise ValueError
        return value
    except ValueError:
        problems.append(f"{key}={raw!r} is not a positive integer; using {default}")
        return default


def manifest_url(settings: dict) -> Optional[str]:
    explicit = settings.get("NEWS_STALENESS_MANIFEST_URL")
    if explicit:
        return explicit
    uri = settings.get("NEWS_PUBLIC_GCS_URI") or ""
    if not uri.startswith("gs://"):
        return None
    return ("https://storage.googleapis.com/" + uri[len("gs://"):].rstrip("/")
            + "/manifest.json")


def parse_instant(value: object) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def fetch_manifest(url: str, timeout: int = 20) -> dict:
    # A query cache-buster, not only a request header: an intermediary that
    # ignores Cache-Control would otherwise serve a stale manifest as fresh.
    busted = url + ("&" if "?" in url else "?") + f"_ts={int(time.time())}"
    req = urllib.request.Request(busted, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def mtime(path: Path) -> Optional[float]:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def newest_run_report(reports: Path) -> Optional[dict]:
    """The newest COMBINED report (`<run-id>.json`, mode news_hourly)."""
    try:
        names = list(reports.glob("*.json"))
    except OSError:
        return None
    stamped = []
    for path in names:
        if path.name.count(".") != 1:  # skip <run-id>.upload.json etc.
            continue
        when = mtime(path)
        if when is not None:
            stamped.append((when, path))
    for when, path in sorted(stamped, reverse=True):
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(row, dict) and row.get("mode") == "news_hourly":
            row["_path"] = str(path)
            row["_mtime"] = when
            return row
    return None


def evaluate(root: Path, now: datetime, settings: dict,
             fetch: Callable[[str], dict] = fetch_manifest) -> dict:
    problems: list = []
    stale_after = int_setting(settings, "NEWS_STALE_AFTER_S",
                              DEFAULT_STALE_AFTER_S, problems)
    alarms: list = []
    status: dict = {"mode": "news_staleness", "checked_at": now.isoformat(),
                    "stale_after_s": stale_after}

    url = manifest_url(settings)
    status["manifest_url"] = url
    if url is None:
        alarms.append({"alarm": "manifest_unreadable",
                       "detail": "NEWS_PUBLIC_GCS_URI is not a gs:// URI"})
    else:
        try:
            manifest = fetch(url)
            generated = parse_instant(manifest.get("generated_at"))
            if generated is None:
                raise ValueError("manifest has no valid generated_at")
            age = (now - generated).total_seconds()
            status.update(manifest_run_id=manifest.get("run_id"),
                          manifest_generated_at=generated.isoformat(),
                          manifest_age_s=round(age))
            if age > stale_after:
                alarms.append({"alarm": "manifest_stale",
                               "detail": f"last publish {round(age / 3600, 1)} h ago"})
        except Exception as exc:  # noqa: BLE001 — every failure IS the alarm
            alarms.append({"alarm": "manifest_unreadable",
                           "detail": str(exc)[:200]})

    run = newest_run_report(root / "var" / "reports")
    run_age = None if run is None else now.timestamp() - run["_mtime"]
    if run is not None:
        status.update(last_run_id=run.get("run_id"),
                      last_run_age_s=round(run_age),
                      last_run_exits={k: run.get(k) for k in EXIT_KEYS})
    if run is None or run_age > stale_after:
        # A fresh scheduler log with no fresh report means runs START and exit
        # early (lock held, verify failed, placeholders) — not a dead agent.
        log_age = None
        log_when = mtime(root / "var" / "cron.log")
        if log_when is not None:
            log_age = now.timestamp() - log_when
        since = ("never" if run_age is None
                 else f"{round(run_age / 3600, 1)} h ago")
        if log_age is not None and log_age <= stale_after:
            hint = ("var/cron.log is fresh, so the scheduler fires but runs "
                    "exit before writing a report — read var/cron.log")
        else:
            hint = "the scheduler is not firing — is the agent loaded?"
        alarms.append({"alarm": "no_recent_run",
                       "detail": f"last combined run report {since}; {hint}"})
    if run is not None:
        failed = sorted(k for k in EXIT_KEYS if run.get(k) not in (0, None))
        if failed:
            alarms.append({"alarm": "run_failed",
                           "key": f"{run.get('run_id')}:{','.join(failed)}",
                           "detail": f"{run.get('run_id')}: "
                                     + ", ".join(f"{k}={run.get(k)}" for k in failed)})
    if problems:
        status["config_problems"] = problems
    status["alarms"] = alarms
    status["ok"] = not alarms
    return status


def alarm_keys(status: dict) -> list:
    """Identity of each alarm; a NEW failing run is a new key, not a repeat."""
    return sorted(a["alarm"] + (":" + a["key"] if a.get("key") else "")
                  for a in status["alarms"])


def track_first_seen(keys: list, previous: dict, now_ts: float) -> dict:
    seen = previous.get("first_seen") or {}
    return {k: float(seen.get(k, now_ts)) for k in keys}


def mature_keys(first_seen: dict, now_ts: float, grace_s: int) -> list:
    return sorted(k for k, t in first_seen.items() if now_ts - t >= grace_s)


def should_notify(mature: list, previous: dict, now_ts: float,
                  renotify_s: int) -> bool:
    notified = sorted(previous.get("notified") or [])
    if mature != notified:
        return True  # a new persistent alarm, or recovery from a notified one
    return bool(mature) and now_ts - float(
        previous.get("notified_at") or 0) >= renotify_s


def notify(status: dict, keys: list, settings: dict) -> None:
    firing = [a for a in status["alarms"]
              if (a["alarm"] + (":" + a["key"] if a.get("key") else "")) in keys]
    summary = "; ".join(f"{a['alarm']}: {a['detail']}" for a in firing)
    title = "Наясно news: " + ("ALARM" if firing else "OK again")
    body = summary or "all checks passing"
    errors = []
    if sys.platform == "darwin":
        script = ("display notification " + json.dumps(body[:240])
                  + " with title " + json.dumps(title))
        try:
            subprocess.run(["osascript", "-e", script], check=False,
                           capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError) as exc:
            errors.append(f"osascript: {exc}"[:200])
    hook = settings.get("NEWS_ALERT_WEBHOOK_URL")
    if hook:
        req = urllib.request.Request(
            hook, data=json.dumps({"title": title, "text": body,
                                   "status": status}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=20).close()  # noqa: S310
        except Exception as exc:  # noqa: BLE001 — never mask the alarm itself
            errors.append(f"webhook: {exc}"[:200])
    if errors:
        status["notify_errors"] = errors


def run(root: Path, notify_enabled: bool, env: dict,
        fetch: Callable[[str], dict] = fetch_manifest,
        now: Optional[datetime] = None) -> dict:
    settings = {**read_env_files(root), **{
        k: v for k, v in env.items()
        if k.startswith("NEWS_STALE") or k == "NEWS_ALERT_WEBHOOK_URL"}}
    now = now or datetime.now(timezone.utc)
    status = evaluate(root, now, settings, fetch)
    if not notify_enabled:
        return status

    problems = status.setdefault("config_problems", [])
    renotify = int_setting(settings, "NEWS_STALENESS_RENOTIFY_S",
                           DEFAULT_RENOTIFY_S, problems)
    grace = int_setting(settings, "NEWS_STALENESS_GRACE_S",
                        DEFAULT_GRACE_S, problems)
    if not problems:
        status.pop("config_problems")
    state_path = root / "var" / "staleness_state.json"
    try:
        previous = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}
    now_ts = now.timestamp()
    first_seen = track_first_seen(alarm_keys(status), previous, now_ts)
    mature = mature_keys(first_seen, now_ts, grace)
    notified = sorted(previous.get("notified") or [])
    notified_at = previous.get("notified_at")
    if should_notify(mature, previous, now_ts, renotify):
        notify(status, mature, settings)
        notified, notified_at = mature, now_ts
        status["notified"] = True
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            "first_seen": first_seen, "notified": notified,
            "notified_at": notified_at, "last_status": status},
            ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError as exc:
        status["state_error"] = str(exc)[:200]
    return status


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path,
                    default=Path(__file__).resolve().parent.parent,
                    help="the folder holding var/ and the env files")
    ap.add_argument("--notify", action="store_true")
    args = ap.parse_args(argv)
    try:
        status = run(args.root.resolve(), args.notify, dict(os.environ))
    except Exception as exc:  # noqa: BLE001 — the alarm itself must report
        status = {"mode": "news_staleness", "ok": False,
                  "alarms": [{"alarm": "checker_error",
                              "detail": f"{type(exc).__name__}: {exc}"[:200]}]}
    print(json.dumps(status, ensure_ascii=False))
    return 0 if status.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
