#!/usr/bin/env python3
"""Upload private news history and hot derived JSON to isolated GCS prefixes."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
GS_URI = re.compile(r"^gs://([^/]+)(?:/(.+?))?/?$")
EXPECTED_STAGES = (
    "acquire_direct", "acquire_browser", "probe_model", "check_prompts",
    "common_words", "analyze", "image_rights_queue", "image_candidates",
    "review_queue", "mention_index", "bundles",
)
ARCHIVE_EXCLUDE = (
    r"(^|/)(_browser|_html|_nightly|evals|gold)(/|$)|"
    r"(^|/)\.DS_Store$|(^|/)_summaries.*\.jsonl$"
)
PUBLIC_CACHE = "Cache-Control:public,max-age=300,stale-while-revalidate=3600"
PRIVATE_CACHE = "Cache-Control:private,no-store"


def uri(name: str, *, delete_scope: bool) -> str:
    value = (os.environ.get(name) or "").rstrip("/")
    match = GS_URI.fullmatch(value)
    if not match:
        raise ValueError(f"{name} must be a gs://bucket/prefix URI")
    if delete_scope and not match.group(2):
        raise ValueError(f"{name} needs a non-empty prefix because rsync uses -d")
    prefix = match.group(2)
    if prefix and any(part in ("", ".", "..") for part in prefix.split("/")):
        raise ValueError(f"{name} contains an unsafe or empty path segment")
    return value


def load_report(path: Path | None, expected_run_id: str | None = None) -> tuple[bool, str]:
    if path is None:
        return False, "archive_only"
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"unreadable_pipeline_report: {exc}"
    if not isinstance(report, dict):
        return False, "invalid_pipeline_report: root must be an object"
    if expected_run_id is not None and report.get("run_id") != expected_run_id:
        return False, "invalid_pipeline_report: run_id mismatch"
    rows = report.get("stages")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        return False, "invalid_pipeline_report: stages must be an object array"
    names = [row.get("stage") for row in rows]
    if (names != list(EXPECTED_STAGES)
            or report.get("stages_run") != len(EXPECTED_STAGES)):
        return False, "invalid_pipeline_report: incomplete or reordered stages"
    if any(not isinstance(row.get("exit"), int) for row in rows):
        return False, "invalid_pipeline_report: stage exits must be integers"
    stages = dict(zip(names, rows))
    failed_all = [name for name, row in stages.items() if row["exit"] != 0]
    if (report.get("failed_stages") != failed_all
            or report.get("stages_ok") != len(rows) - len(failed_all)):
        return False, "invalid_pipeline_report: summary does not match stages"
    failed = [name for name in ("mention_index", "bundles")
              if stages[name]["exit"] != 0]
    if failed:
        return False, f"public_not_ready: failed={failed}"
    return True, "ready"


def public_upload_enabled() -> bool:
    value = os.environ.get("NEWS_ENABLE_PUBLIC_UPLOAD", "0")
    if value not in ("0", "1"):
        raise ValueError("NEWS_ENABLE_PUBLIC_UPLOAD must be 0 or 1")
    return value == "1"


def commands(public_ready: bool, public_enabled: bool) -> list[dict]:
    archive = uri("NEWS_ARCHIVE_GCS_URI", delete_scope=False)
    mentions_source = Path(os.environ.get("NEWS_MENTIONS_DIR") or
                           ROOT / "data" / "news" / "mentions")
    scopes = [{
        "name": "archive",
        "source": ROOT / "news" / "data",
        "destination": archive,
        "argv": ["gsutil", "-m", "-h", PRIVATE_CACHE, "rsync", "-r",
                 "-x", ARCHIVE_EXCLUDE, str(ROOT / "news" / "data"), archive],
        "deletes_remote": False,
    }]
    if public_ready and public_enabled:
        public = uri("NEWS_PUBLIC_GCS_URI", delete_scope=True)
        mentions = uri("NEWS_MENTIONS_GCS_URI", delete_scope=True)
        scopes += [
            {
                "name": "public_app_data",
                "source": ROOT / "news" / "app-data",
                "destination": public,
                "argv": ["gsutil", "-m", "-h", PUBLIC_CACHE, "rsync",
                         "-r", "-d", "-j", "json",
                         str(ROOT / "news" / "app-data"), public],
                "deletes_remote": True,
            },
            {
                "name": "public_mentions",
                "source": mentions_source,
                "destination": mentions,
                "argv": ["gsutil", "-m", "-h", PUBLIC_CACHE, "rsync",
                         "-r", "-d", "-j", "json",
                         str(mentions_source), mentions],
                "deletes_remote": True,
            },
        ]
    return scopes


def run_scope(scope: dict, dry_run: bool) -> dict:
    source = scope["source"]
    result = {key: scope[key] for key in
              ("name", "destination", "deletes_remote")}
    result["source"] = str(source)
    result["command"] = scope["argv"]
    if dry_run:
        result.update(exit=0, skipped="dry_run")
        return result
    if not source.is_dir():
        result.update(exit=2, error="source_directory_missing")
        return result
    proc = subprocess.run(scope["argv"], stdout=sys.stderr, stderr=sys.stderr)
    result["exit"] = proc.returncode
    return result


def execute_scopes(scopes: list[dict], dry_run: bool) -> list[dict]:
    results = [run_scope(scopes[0], dry_run)]
    if results[0]["exit"] == 0 or dry_run:
        results.extend(run_scope(scope, dry_run) for scope in scopes[1:])
    else:
        for scope in scopes[1:]:
            results.append({
                "name": scope["name"],
                "source": str(scope["source"]),
                "destination": scope["destination"],
                "deletes_remote": scope["deletes_remote"],
                "command": scope["argv"],
                "exit": None,
                "skipped": "archive_failed",
            })
    return results


def same_or_nested_scope(first: str, second: str) -> bool:
    first_match = GS_URI.fullmatch(first)
    second_match = GS_URI.fullmatch(second)
    if first_match.group(1) != second_match.group(1):
        return False
    first_parts = tuple((first_match.group(2) or "").split("/"))
    second_parts = tuple((second_match.group(2) or "").split("/"))
    shorter = min(len(first_parts), len(second_parts))
    return first_parts[:shorter] == second_parts[:shorter]


def versioning_enabled(output: str) -> bool:
    return bool(re.search(r"\bEnabled\b", output, re.IGNORECASE))


def check_archive_versioning(archive_uri: str) -> tuple[bool, str]:
    match = GS_URI.fullmatch(archive_uri)
    bucket = f"gs://{match.group(1)}"
    proc = subprocess.run(
        ["gsutil", "versioning", "get", bucket],
        text=True, capture_output=True)
    output = "\n".join((proc.stdout, proc.stderr)).strip()
    if proc.returncode != 0:
        return False, f"versioning check failed: {output[:300]}"
    if not versioning_enabled(output):
        return False, f"object versioning is not enabled on {bucket}"
    return True, "enabled"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", type=Path)
    ap.add_argument("--expected-run-id")
    ap.add_argument("--archive-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.report and args.archive_only:
        ap.error("choose --report or --archive-only")
    if args.expected_run_id and not args.report:
        ap.error("--expected-run-id requires --report")
    public_ready, reason = load_report(
        None if args.archive_only else args.report, args.expected_run_id)
    try:
        public_enabled = public_upload_enabled()
        scopes = commands(public_ready, public_enabled)
    except ValueError as exc:
        print(json.dumps({"mode": "news_gcs_upload", "error": str(exc)}))
        return 2
    if not args.dry_run and any("REPLACE_ME" in scope["destination"]
                                for scope in scopes):
        print(json.dumps({"mode": "news_gcs_upload",
                          "error": "GCS destination contains REPLACE_ME"}))
        return 2
    if not args.dry_run and shutil.which("gsutil") is None:
        print(json.dumps({"mode": "news_gcs_upload", "error": "gsutil_missing"}))
        return 2
    destinations = [scope["destination"] for scope in scopes]
    if len(destinations) != len(set(destinations)):
        print(json.dumps({"mode": "news_gcs_upload",
                          "error": "GCS destinations must be distinct"}))
        return 2
    archive_bucket = GS_URI.fullmatch(destinations[0]).group(1)
    try:
        configured_public = [
            uri(name, delete_scope=True) for name in
            ("NEWS_PUBLIC_GCS_URI", "NEWS_MENTIONS_GCS_URI")
            if os.environ.get(name)
        ]
    except ValueError as exc:
        print(json.dumps({"mode": "news_gcs_upload", "error": str(exc)}))
        return 2
    public_buckets = {GS_URI.fullmatch(value).group(1)
                      for value in configured_public}
    if archive_bucket in public_buckets:
        print(json.dumps({
            "mode": "news_gcs_upload",
            "error": "archive must use a different private bucket",
        }))
        return 2
    if len(configured_public) == 2 and same_or_nested_scope(*configured_public):
        print(json.dumps({
            "mode": "news_gcs_upload",
            "error": "public rsync delete scopes must be disjoint",
        }))
        return 2
    if (not args.dry_run
            and os.environ.get("NEWS_REQUIRE_ARCHIVE_VERSIONING", "1") != "0"):
        enabled, detail = check_archive_versioning(destinations[0])
        if not enabled:
            print(json.dumps({"mode": "news_gcs_upload",
                              "error": detail}))
            return 2
    results = execute_scopes(scopes, args.dry_run)
    failed = [row["name"] for row in results
              if isinstance(row["exit"], int) and row["exit"] != 0]
    output = {
        "mode": "news_gcs_upload",
        "public_ready": public_ready,
        "public_enabled": public_enabled,
        "public_reason": reason,
        "scopes": results,
        "failed_scopes": failed,
    }
    print(json.dumps(output, ensure_ascii=False))
    return 1 if failed or (args.report is not None and not public_ready) else 0


if __name__ == "__main__":
    raise SystemExit(main())
