#!/usr/bin/env python3
"""Orchestrate private eval export and post-publication task activation.

This is the unattended boundary used by the standalone news runtime. It never
deploys infrastructure and never falls back to the GCS uploader credential.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import content_sha256  # noqa: E402
from news.scripts.app_data_inventory import tree_inventory  # noqa: E402
from news.scripts.effective_analysis import (  # noqa: E402
    EffectiveAnalysisError,
    load_accepted_adjudications,
)
from news.scripts.propose_eval_corrections import (  # noqa: E402
    CorrectionProposalError,
    atomic_write as write_correction_report,
    build_report as build_correction_report,
)

PROJECT_ID = "electionsbg-news"
LIVE_MANIFEST_URL = (
    "https://storage.googleapis.com/data-electionsbg-com/"
    "news/app-data/manifest.json"
)
MODES = {"disabled", "optional", "required"}
SAFE_HTTPS_MANIFEST = re.compile(
    r"^https://storage\.googleapis\.com/[A-Za-z0-9._-]+/"
    r"(?:[A-Za-z0-9._~-]+/)*manifest\.json$"
)


class EvalRuntimeError(ValueError):
    """The unattended eval operation cannot run safely."""


@dataclass(frozen=True)
class RuntimeConfig:
    mode: str
    credential: Path | None
    operator_cli: Path | None
    unavailable_reason: str | None
    max_snapshot_age_hours: float
    live_manifest_url: str

    @property
    def available(self) -> bool:
        return self.unavailable_reason is None


def _bounded_number(raw: str, label: str, *, minimum: float,
                    maximum: float) -> float:
    try:
        value = float(raw)
    except ValueError as exc:
        raise EvalRuntimeError(f"{label} must be a number") from exc
    if not minimum <= value <= maximum:
        raise EvalRuntimeError(f"{label} must be between {minimum:g} and {maximum:g}")
    return value


def runtime_config(root: Path = ROOT) -> RuntimeConfig:
    mode = os.environ.get("NEWS_EVAL_MODE", "disabled")
    if mode not in MODES:
        raise EvalRuntimeError("NEWS_EVAL_MODE must be disabled, optional, or required")
    max_age = _bounded_number(
        os.environ.get("NEWS_EVAL_ACCEPTED_MAX_AGE_HOURS", "26"),
        "NEWS_EVAL_ACCEPTED_MAX_AGE_HOURS", minimum=1, maximum=168)
    live_url = os.environ.get("NEWS_EVAL_LIVE_MANIFEST_URL", LIVE_MANIFEST_URL)
    if SAFE_HTTPS_MANIFEST.fullmatch(live_url) is None:
        raise EvalRuntimeError("NEWS_EVAL_LIVE_MANIFEST_URL is not a safe GCS manifest URL")
    if mode == "disabled":
        return RuntimeConfig(mode, None, None, "configured_disabled", max_age, live_url)

    raw_credential = os.environ.get("NEWS_EVAL_GOOGLE_APPLICATION_CREDENTIALS", "")
    if not raw_credential:
        return RuntimeConfig(mode, None, None, "eval_credential_unset", max_age, live_url)
    credential = Path(raw_credential).expanduser().resolve()
    upload_raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    upload_credential = Path(upload_raw).expanduser().resolve() if upload_raw else None
    if upload_credential is not None and upload_credential == credential:
        raise EvalRuntimeError(
            "news evals require a dedicated credential distinct from the GCS uploader")
    if not credential.is_file():
        return RuntimeConfig(mode, credential, None, "eval_credential_missing", max_age, live_url)
    raw_cli = os.environ.get("NEWS_EVAL_OPERATOR_CLI", "")
    operator_cli = (Path(raw_cli).expanduser().resolve() if raw_cli else
                    (root / "news-functions" / "lib" / "operator-cli.js").resolve())
    if not operator_cli.is_file():
        return RuntimeConfig(mode, credential, operator_cli,
                             "eval_operator_cli_missing", max_age, live_url)
    if shutil.which("node") is None:
        return RuntimeConfig(mode, credential, operator_cli,
                             "node_missing", max_age, live_url)
    return RuntimeConfig(mode, credential, operator_cli, None, max_age, live_url)


def _last_json(output: str) -> dict[str, Any] | None:
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def run_operator(config: RuntimeConfig, arguments: list[str]) -> dict[str, Any]:
    if not config.available or config.credential is None or config.operator_cli is None:
        raise EvalRuntimeError("eval operator is unavailable")
    environment = os.environ.copy()
    environment["GOOGLE_APPLICATION_CREDENTIALS"] = str(config.credential)
    process = subprocess.run(
        ["node", str(config.operator_cli), *arguments],
        cwd=ROOT, env=environment, text=True, capture_output=True)
    payload = _last_json(process.stdout)
    result: dict[str, Any] = {
        "exit": process.returncode,
        "result": payload,
    }
    if process.returncode != 0:
        detail = (process.stderr or process.stdout).strip().replace("\n", " ")
        result["error"] = detail[:600] or "operator_failed_without_output"
    return result


def snapshot_status(path: Path, *, root: Path = ROOT,
                    now: datetime | None = None) -> dict[str, Any]:
    if not path.is_file():
        return {"status": "missing", "record_count": 0}
    try:
        accepted = load_accepted_adjudications(path, expected_project_id=PROJECT_ID)
    except EffectiveAnalysisError as exc:
        return {"status": "invalid", "record_count": 0, "error": str(exc)[:600]}
    read_time = datetime.fromisoformat(
        accepted.manifest["firestore_read_time"].replace("Z", "+00:00"))
    clock = now or datetime.now(timezone.utc)
    age_hours = (clock.astimezone(timezone.utc) - read_time).total_seconds() / 3600
    fresh = stale = missing = 0
    for article_key, record in accepted.by_article.items():
        domain, article_id = article_key.split("/", 1)
        article_path = root / "news" / "data" / domain / f"{article_id}.json"
        try:
            article = json.loads(article_path.read_text(encoding="utf-8"))
            content = article.get("content") if isinstance(article, dict) else None
        except (OSError, UnicodeError, json.JSONDecodeError):
            content = None
        if not isinstance(content, str):
            missing += 1
        elif content_sha256(content) == record["content_sha256"]:
            fresh += 1
        else:
            stale += 1
    return {
        "status": "valid",
        "project_id": accepted.manifest["project_id"],
        "firestore_read_time": accepted.manifest["firestore_read_time"],
        "records_sha256": accepted.records_sha256,
        "record_count": len(accepted.by_article),
        "fresh_content_count": fresh,
        "stale_content_count": stale,
        "missing_content_count": missing,
        "age_hours": round(age_hours, 3),
        "future_clock_skew": age_hours < -(5 / 60),
    }


def _operator_export(config: RuntimeConfig, command: str, output: Path) -> dict[str, Any]:
    return run_operator(config, [
        command, "--project", PROJECT_ID, "--out", str(output),
    ])


def export_operation(root: Path = ROOT, *, dry_run: bool = False,
                     now: datetime | None = None) -> tuple[dict[str, Any], int]:
    config = runtime_config(root)
    if dry_run:
        return {
            "mode": "news_eval_runtime", "operation": "export",
            "configuration": config.mode, "skipped": "dry_run",
            "publication_blocked": False,
        }, 0
    eval_root = root / "news" / "data" / "evals"
    raw_path = eval_root / "public-submissions" / "current.jsonl"
    accepted_path = eval_root / "accepted" / "current.json"
    task_path = eval_root / "tasks" / "current.json"
    correction_path = eval_root / "corrections" / "proposed" / "current.json"
    alerts: list[str] = []
    if config.available:
        raw_export = _operator_export(config, "export", raw_path)
        accepted_export = _operator_export(config, "export-accepted", accepted_path)
        if raw_export["exit"] != 0:
            alerts.append("raw_export_failed")
        if accepted_export["exit"] != 0:
            alerts.append("accepted_export_failed_last_good_retained")
    else:
        skipped = config.unavailable_reason or "unavailable"
        raw_export = {"exit": None, "skipped": skipped}
        accepted_export = {"exit": None, "skipped": skipped}
        if config.mode != "disabled":
            alerts.append(skipped)

    accepted = snapshot_status(accepted_path, root=root, now=now)
    blocked_reasons: list[str] = []
    if config.mode == "required" and not config.available:
        blocked_reasons.append(config.unavailable_reason or "eval_operator_unavailable")
    if accepted["status"] == "invalid":
        blocked_reasons.append("accepted_snapshot_invalid")
    elif accepted["status"] == "valid":
        if accepted.get("future_clock_skew"):
            blocked_reasons.append("accepted_snapshot_time_is_in_the_future")
        elif accepted.get(
            "age_hours", config.max_snapshot_age_hours + 1
        ) > config.max_snapshot_age_hours:
            blocked_reasons.append("accepted_snapshot_expired")
    elif config.mode == "required":
        blocked_reasons.append("accepted_snapshot_missing")

    correction: dict[str, Any]
    if accepted["status"] != "valid":
        correction = {"status": "skipped", "reason": "accepted_snapshot_unavailable"}
    elif not task_path.is_file():
        correction = {"status": "skipped", "reason": "published_task_proof_unavailable"}
    else:
        try:
            proposal = build_correction_report(accepted_path, [task_path])
            proposal["dry_run"] = False
            write_correction_report(correction_path, proposal)
            correction = {
                "status": "written",
                "proposal_count": proposal["proposal_count"],
                "proposals_sha256": proposal["proposals_sha256"],
            }
        except (CorrectionProposalError, OSError, TypeError, json.JSONDecodeError) as exc:
            correction = {"status": "failed", "error": str(exc)[:600]}
            alerts.append("correction_proposal_failed")
    result = {
        "mode": "news_eval_runtime",
        "operation": "export",
        "configuration": config.mode,
        "operator_available": config.available,
        "raw_export": raw_export,
        "accepted_export": accepted_export,
        "accepted_snapshot": accepted,
        "correction_proposals": correction,
        "snapshot_sla_hours": config.max_snapshot_age_hours,
        "alerts": sorted(set(alerts + blocked_reasons)),
        "publication_blocked": bool(blocked_reasons),
        "block_reasons": sorted(set(blocked_reasons)),
    }
    return result, 1 if blocked_reasons else 0


def task_build_operation(root: Path = ROOT, *, dry_run: bool = False) -> tuple[dict[str, Any], int]:
    config = runtime_config(root)
    base = {
        "mode": "news_eval_runtime", "operation": "task_build",
        "configuration": config.mode,
    }
    if dry_run:
        return {**base, "skipped": "dry_run"}, 0
    if config.mode == "disabled":
        return {**base, "skipped": "configured_disabled"}, 0
    if not config.available:
        result = {**base, "skipped": config.unavailable_reason}
        return result, 1 if config.mode == "required" else 0
    review_limit = os.environ.get("NEWS_EVAL_REVIEW_LIMIT", "50")
    if not review_limit.isdigit() or not 0 <= int(review_limit) <= 200:
        raise EvalRuntimeError("NEWS_EVAL_REVIEW_LIMIT must be an integer from 0 to 200")
    raw_selections = os.environ.get("NEWS_EVAL_SELECTIONS_JSON", "[]")
    try:
        selections = json.loads(raw_selections)
    except json.JSONDecodeError as exc:
        raise EvalRuntimeError("NEWS_EVAL_SELECTIONS_JSON must be a JSON array") from exc
    if (not isinstance(selections, list) or len(selections) > 20
            or any(not isinstance(item, str) or not item for item in selections)):
        raise EvalRuntimeError(
            "NEWS_EVAL_SELECTIONS_JSON must contain at most 20 non-empty paths")
    selection_args: list[str] = []
    resolved_root = root.resolve()
    for item in selections:
        path = (root / item).resolve() if not Path(item).is_absolute() else Path(item).resolve()
        if not path.is_relative_to(resolved_root) or not path.is_file():
            raise EvalRuntimeError(f"eval selection is missing or outside the runtime: {item}")
        selection_args.extend(("--selection", str(path)))
    eval_script = root / "news" / "scripts" / "sync_eval_tasks.py"
    eval_process = subprocess.run([
        sys.executable, str(eval_script), "--root", str(root),
        "--include-review-reasons", "--review-limit", review_limit, "--write",
        *selection_args,
    ], cwd=root, text=True, capture_output=True)
    eval_build: dict[str, Any] = {
        "exit": eval_process.returncode,
        "result": _last_json(eval_process.stdout),
    }
    if eval_process.returncode != 0:
        eval_build["error"] = (
            eval_process.stderr or eval_process.stdout).strip()[:600]

    feedback_script = root / "news" / "scripts" / "build_feedback_tasks.py"
    feedback_process = subprocess.run([
        sys.executable, str(feedback_script), "--root", str(root), "--write",
    ], cwd=root, text=True, capture_output=True)
    feedback_build: dict[str, Any] = {
        "exit": feedback_process.returncode,
        "result": _last_json(feedback_process.stdout),
    }
    if feedback_process.returncode != 0:
        feedback_build["error"] = (
            feedback_process.stderr or feedback_process.stdout).strip()[:600]

    failed = eval_process.returncode != 0 or feedback_process.returncode != 0
    result = {
        **base,
        "exit": 1 if failed else 0,
        "eval_tasks": eval_build,
        "feedback_tasks": feedback_build,
    }
    if not failed:
        app_data = root / "news" / "app-data"
        try:
            home = json.loads((app_data / "home.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise EvalRuntimeError(
                f"cannot inventory task-built app-data: {exc}"
            ) from exc
        generated_at = home.get("generated_at") if isinstance(home, dict) else None
        if not isinstance(generated_at, str) or not generated_at:
            raise EvalRuntimeError(
                "cannot inventory task-built app-data: home generated_at is missing"
            )
        inventory = tree_inventory(app_data)
        result["publication_inventory"] = {
            "generated_at": generated_at,
            "sha256": inventory["sha256"],
            "files": inventory["files"],
            "bytes": inventory["bytes"],
        }
    return result, 1 if failed else 0


def _load_upload_result(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"upload_result_unreadable:{exc}"
    if not isinstance(value, dict) or value.get("mode") != "news_gcs_upload":
        return None, "upload_result_invalid"
    if value.get("public_ready") is not True or value.get("public_enabled") is not True:
        return value, "public_manifest_not_advanced"
    scopes = value.get("scopes")
    if not isinstance(scopes, list):
        return None, "upload_scopes_invalid"
    manifest = [row for row in scopes
                if isinstance(row, dict) and row.get("name") == "public_app_data_manifest"]
    if (len(manifest) != 1 or manifest[0].get("exit") != 0
            or value.get("failed_scopes") != []):
        return value, "public_manifest_not_advanced"
    return value, None


def task_sync_operation(upload_result: Path, root: Path = ROOT, *,
                        dry_run: bool = False) -> tuple[dict[str, Any], int]:
    config = runtime_config(root)
    base = {
        "mode": "news_eval_runtime", "operation": "task_sync",
        "configuration": config.mode,
    }
    if dry_run:
        return {**base, "skipped": "dry_run"}, 0
    upload, upload_error = _load_upload_result(upload_result)
    if upload_error is not None:
        return {**base, "skipped": upload_error}, 0
    if config.mode == "disabled":
        return {**base, "skipped": "configured_disabled"}, 0
    if not config.available:
        result = {**base, "skipped": config.unavailable_reason}
        return result, 1 if config.mode == "required" else 0
    task_path = root / "news" / "data" / "evals" / "tasks" / "current.json"
    feedback_path = (root / "news" / "data" / "evals" /
                     "feedback-tasks" / "current.json")
    missing = []
    if not task_path.is_file():
        missing.append("eval_task_manifest")
    if not feedback_path.is_file():
        missing.append("feedback_task_manifest")
    if missing:
        return {**base, "error": "task_manifest_missing", "missing": missing}, 1
    eval_outcome = run_operator(config, [
        "sync-tasks", "--project", PROJECT_ID, "--file", str(task_path),
        "--live-manifest-url", config.live_manifest_url,
    ])
    feedback_outcome = run_operator(config, [
        "sync-feedback-tasks", "--project", PROJECT_ID,
        "--file", str(feedback_path),
        "--live-manifest-url", config.live_manifest_url,
    ])
    failed = eval_outcome["exit"] != 0 or feedback_outcome["exit"] != 0
    result = {
        **base,
        "upload_run": upload.get("mode"),
        "sync": eval_outcome,
        "feedback_sync": feedback_outcome,
    }
    return result, 1 if failed else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("export", "task-build", "task-sync"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--upload-result", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.resolve()
    try:
        if args.operation == "export":
            result, code = export_operation(root, dry_run=args.dry_run)
        elif args.operation == "task-build":
            result, code = task_build_operation(root, dry_run=args.dry_run)
        else:
            if args.upload_result is None:
                raise EvalRuntimeError("task-sync requires --upload-result")
            result, code = task_sync_operation(
                args.upload_result.resolve(), root, dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return code
    except (EvalRuntimeError, OSError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({
            "mode": "news_eval_runtime", "operation": args.operation,
            "error": str(exc), "publication_blocked": True,
        }, ensure_ascii=False, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
