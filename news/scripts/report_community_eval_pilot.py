#!/usr/bin/env python3
"""Report a public eval pilot without treating community answers as truth."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import canonical_json, canonical_sha256, content_sha256  # noqa: E402
from news.eval_contract.validate import validate_article_evaluation  # noqa: E402
from news.scripts.build_community_eval_sample import sampling_cell  # noqa: E402
from news.scripts.sync_eval_tasks import (  # noqa: E402
    LEANING,
    PARTY_TONES,
    RUSSIA,
    RUBRIC_VERSION,
    SyncError,
    article_key,
    load_public_articles,
    load_selection,
    make_task,
    model_labels,
    read_json,
)

PROJECT_ID = "electionsbg-news"
RAW_MANIFEST_KEYS = {
    "schema_version", "export_kind", "project_id", "firestore_read_time",
    "rubric_version", "record_count", "records_sha256",
}
RAW_RECORD_KEYS = {
    "schema_version", "rubric_version", "submission_id", "mode", "article_key",
    "task_revision", "content_sha256", "analysis_sha256", "submitted_at",
    "evaluation", "model_labels", "status",
}
STATUSES = {"raw", "quarantined", "reviewed", "promoted"}
SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
SAMPLE_MANIFEST_KEYS = {
    "schema_version", "manifest_kind", "dataset_id", "source_public_data_revision",
    "seed", "requested_size", "selected_size", "selection_sha256",
    "article_keys_sha256", "selection_policy", "excluded", "distribution", "records",
}


class PilotReportError(ValueError):
    """The pilot inputs cannot support a trustworthy aggregate report."""


def aware_timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise PilotReportError(f"{label} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PilotReportError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise PilotReportError(f"{label} must include a timezone")
    normalized = parsed.astimezone(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    if value != normalized:
        raise PilotReportError(f"{label} is not a normalized UTC timestamp")
    return normalized


def validate_model_snapshot(value: Any, label: str) -> None:
    if not isinstance(value, dict) or set(value) != {
        "leaning", "russia_stance", "party_tones"
    }:
        raise PilotReportError(f"{label} has the wrong shape")
    if value["leaning"] not in LEANING or value["russia_stance"] not in RUSSIA:
        raise PilotReportError(f"{label} has an invalid scalar label")
    parties = value["party_tones"]
    if not isinstance(parties, list) or len(parties) > 30:
        raise PilotReportError(f"{label} has an invalid party list")
    identities: set[str] = set()
    for index, party in enumerate(parties):
        if (not isinstance(party, dict) or set(party) != {"party", "party_id", "tone"}
                or not isinstance(party["party"], str) or not party["party"]
                or len(party["party"]) > 160
                or (party["party_id"] is not None
                    and (not isinstance(party["party_id"], str)
                         or not party["party_id"] or len(party["party_id"]) > 160))
                or party["tone"] not in PARTY_TONES):
            raise PilotReportError(f"{label}.party_tones[{index}] is invalid")
        identity = (f"id:{party['party_id']}" if party["party_id"]
                    else f"surface:{party['party'].strip().casefold()}")
        if identity in identities:
            raise PilotReportError(f"{label} contains duplicate parties")
        identities.add(identity)


def parse_raw_export(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    except OSError as exc:
        raise PilotReportError(f"cannot read raw export: {exc}") from exc
    if not lines:
        raise PilotReportError("raw export is empty")
    try:
        first = json.loads(lines[0])
        rows = [json.loads(line) for line in lines[1:]]
    except json.JSONDecodeError as exc:
        raise PilotReportError(f"raw export is not JSONL: {exc}") from exc
    if (not isinstance(first, dict) or first.get("kind") != "manifest"
            or set(first) != RAW_MANIFEST_KEYS | {"kind"}):
        raise PilotReportError("raw export manifest has the wrong shape")
    manifest = {key: value for key, value in first.items() if key != "kind"}
    if (manifest["schema_version"] != 1
            or manifest["export_kind"] != "news-eval-community-submissions"
            or manifest["project_id"] != PROJECT_ID
            or manifest["rubric_version"] != RUBRIC_VERSION):
        raise PilotReportError("raw export manifest contract is unsupported")
    aware_timestamp(manifest["firestore_read_time"], "firestore_read_time")
    if type(manifest["record_count"]) is not int or manifest["record_count"] != len(rows):
        raise PilotReportError("raw export record count does not match")
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    prior: tuple[str, str, str] | None = None
    for index, raw in enumerate(rows):
        if (not isinstance(raw, dict) or raw.get("kind") != "submission"
                or set(raw) != RAW_RECORD_KEYS | {"kind"}):
            raise PilotReportError(f"raw export record {index} has the wrong shape")
        record = {key: value for key, value in raw.items() if key != "kind"}
        submission_id = record["submission_id"]
        if not isinstance(submission_id, str) or not submission_id or len(submission_id) > 160:
            raise PilotReportError(f"raw export record {index} has an invalid ID")
        if submission_id in seen_ids:
            raise PilotReportError("raw export contains duplicate submission IDs")
        seen_ids.add(submission_id)
        if (record["schema_version"] != 1 or record["rubric_version"] != RUBRIC_VERSION
                or record["mode"] != "community"
                or not isinstance(record["status"], str)
                or record["status"] not in STATUSES
                or type(record["task_revision"]) is not int
                or not 1 <= record["task_revision"] <= 9_007_199_254_740_991
                or not SHA256.fullmatch(str(record["content_sha256"]))
                or not SHA256.fullmatch(str(record["analysis_sha256"]))):
            raise PilotReportError(f"raw export record {index} has invalid metadata")
        try:
            article_key(record["article_key"])
        except SyncError as exc:
            raise PilotReportError(f"raw export record {index} has invalid metadata") from exc
        aware_timestamp(record["submitted_at"], f"record {index}.submitted_at")
        validate_model_snapshot(record["model_labels"], f"record {index}.model_labels")
        verdict = validate_article_evaluation(record["evaluation"], record["model_labels"])
        if verdict["schema_errors"] or verdict["error_codes"]:
            raise PilotReportError(
                f"raw export record {index} has an invalid evaluation: "
                f"{verdict['schema_errors'] or verdict['error_codes']}"
            )
        order = (record["article_key"], record["submitted_at"], submission_id)
        if prior is not None and order < prior:
            raise PilotReportError("raw export records are not sorted")
        prior = order
        normalized.append(record)
    if manifest["records_sha256"] != canonical_sha256(normalized):
        raise PilotReportError("raw export records hash does not match")
    return manifest, normalized


def validate_sample(
    root: Path,
    app_data: Path,
    selection_path: Path,
    sample_manifest_path: Path,
) -> tuple[
    dict[str, Any],
    dict[str, dict[str, Any]],
    dict[str, str],
    dict[str, dict[str, Any]],
]:
    dataset_id, _purpose, keys = load_selection(selection_path)
    selection = read_json(selection_path)
    manifest = read_json(sample_manifest_path)
    if (set(manifest) != SAMPLE_MANIFEST_KEYS
            or manifest.get("schema_version") != 1
            or manifest.get("manifest_kind") != "news-community-sample"
            or manifest.get("dataset_id") != dataset_id
            or manifest.get("requested_size") != len(keys)
            or manifest.get("selected_size") != len(keys)
            or manifest.get("selection_sha256") != canonical_sha256(selection)
            or manifest.get("article_keys_sha256") != canonical_sha256(keys)):
        raise PilotReportError("community sample manifest does not match its selection")
    policy = manifest.get("selection_policy")
    if (not isinstance(manifest.get("seed"), str) or not manifest["seed"]
            or not isinstance(policy, dict)
            or policy.get("sampling_signals_are_not_labels") is not True
            or policy.get("sealed_and_benchmark_membership_excluded") is not True):
        raise PilotReportError("community sample policy is incomplete")
    public_revision, public = load_public_articles(app_data)
    if manifest.get("source_public_data_revision") != public_revision:
        raise PilotReportError("app-data revision does not match the frozen community sample")
    records = manifest.get("records")
    if not isinstance(records, list) or len(records) != len(keys):
        raise PilotReportError("community sample record inventory is invalid")
    expected_content: dict[str, str] = {}
    strata: dict[str, str] = {}
    expected_tasks: dict[str, dict[str, Any]] = {}
    groups: set[str] = set()
    for index, (key, row) in enumerate(zip(keys, records, strict=True)):
        if (not isinstance(row, dict) or set(row) != {
            "article_key", "group_id", "content_sha256"
        } or row["article_key"] != key or not isinstance(row["group_id"], str)
                or not SHA256.fullmatch(str(row["content_sha256"]))):
            raise PilotReportError(f"community sample record {index} is invalid")
        if row["group_id"] in groups:
            raise PilotReportError("community sample reuses a story group")
        groups.add(row["group_id"])
        if key not in public:
            raise PilotReportError(f"community sample article is absent from app-data: {key}")
        domain, article_id = key.split("/", 1)
        article_path = root / "news/data" / domain / f"{article_id}.json"
        try:
            article = json.loads(article_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PilotReportError(f"cannot read sample article {key}: {exc}") from exc
        body = article.get("content") if isinstance(article, dict) else None
        if not isinstance(body, str) or content_sha256(body) != row["content_sha256"]:
            raise PilotReportError(f"community sample content changed: {key}")
        analysis = public[key].get("analysis")
        if not isinstance(analysis, dict):
            raise PilotReportError(f"community sample article lacks analysis: {key}")
        try:
            labels = model_labels(analysis)
        except SyncError as exc:
            raise PilotReportError(f"community sample labels are invalid: {key}: {exc}") from exc
        expected_content[key] = row["content_sha256"]
        strata[key] = sampling_cell(labels, analysis)
        try:
            expected_tasks[key] = make_task(
                root, public_revision, key, public[key], [], {}, public_revision
            )
        except SyncError as exc:
            raise PilotReportError(
                f"community sample no longer crosses the task contract: {key}: {exc}"
            ) from exc
    return manifest, public, strata, expected_tasks


def answer_signature(record: dict[str, Any]) -> str:
    evaluation = record["evaluation"]
    scalar = {
        field: [evaluation[field]["label"], evaluation[field]["disposition"]]
        for field in ("leaning", "russia_stance")
    }
    parties = sorted([
        item.get("party_id") or f"surface:{item['party'].strip().casefold()}",
        item["tone"], item["disposition"],
    ] for item in evaluation["party_tones"])
    removed = sorted(
        item.get("party_id") or f"surface:{item['party'].strip().casefold()}"
        for item in evaluation["removed_model_parties"]
    )
    return canonical_json({
        "scalar": scalar,
        "parties_confirmed_complete": evaluation["parties_confirmed_complete"],
        "parties": parties,
        "removed": removed,
    })


def build_report(
    root: Path,
    app_data: Path,
    selection_path: Path,
    sample_manifest_path: Path,
    raw_path: Path,
) -> dict[str, Any]:
    sample, _public, strata, expected_tasks = validate_sample(
        root, app_data, selection_path, sample_manifest_path
    )
    raw_manifest, raw_records = parse_raw_export(raw_path)
    selected = set(strata)
    expected_content = {
        row["article_key"]: row["content_sha256"] for row in sample["records"]
    }
    off_batch = [row for row in raw_records if row["article_key"] not in selected]
    scoped = [row for row in raw_records if row["article_key"] in selected]
    stale = [row for row in scoped
             if row["content_sha256"] != expected_content[row["article_key"]]]
    task_stale = [
        row for row in scoped
        if row not in stale and (
            row["task_revision"] != expected_tasks[row["article_key"]]["revision"]
            or row["analysis_sha256"]
            != expected_tasks[row["article_key"]]["analysis_sha256"]
            or canonical_json(row["model_labels"])
            != canonical_json(expected_tasks[row["article_key"]]["model_labels"])
        )
    ]
    usable = [row for row in scoped
              if (row["status"] != "quarantined" and row not in stale
                  and row not in task_stale)]
    by_article: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in usable:
        by_article[row["article_key"]].append(row)

    status_counts = Counter(row["status"] for row in scoped)
    completed = set(by_article)
    per_stratum: dict[str, dict[str, Any]] = {}
    for cell in sorted(set(strata.values())):
        task_keys = {key for key, value in strata.items() if value == cell}
        cell_rows = [row for row in usable if row["article_key"] in task_keys]
        done = task_keys & completed
        per_stratum[cell] = {
            "tasks": len(task_keys),
            "tasks_with_usable_submission": len(done),
            "usable_submissions": len(cell_rows),
            "completion_fraction": round(len(done) / len(task_keys), 4),
        }

    scalar_dispositions = {
        field: dict(sorted(Counter(
            row["evaluation"][field]["disposition"] for row in usable
        ).items()))
        for field in ("leaning", "russia_stance")
    }
    party_dispositions = Counter(
        item["disposition"]
        for row in usable
        for item in row["evaluation"]["party_tones"]
    )
    removed_parties = sum(
        len(row["evaluation"]["removed_model_parties"]) for row in usable
    )

    def disagrees(row: dict[str, Any]) -> bool:
        evaluation = row["evaluation"]
        return (
            any(evaluation[field]["disposition"] == "changed"
                for field in ("leaning", "russia_stance"))
            or any(item["disposition"] in {"changed", "added"}
                   for item in evaluation["party_tones"])
            or bool(evaluation["removed_model_parties"])
        )

    repeated = {key: rows for key, rows in by_article.items() if len(rows) >= 2}
    unanimous = sum(
        len({answer_signature(row) for row in rows}) == 1
        for rows in repeated.values()
    )
    report = {
        "schema_version": 1,
        "report_kind": "news-community-pilot-report",
        "dataset_id": sample["dataset_id"],
        "sample_revision": sample["source_public_data_revision"],
        "sample_selection_sha256": sample["selection_sha256"],
        "raw_export_records_sha256": raw_manifest["records_sha256"],
        "firestore_read_time": raw_manifest["firestore_read_time"],
        "interpretation": {
            "community_answers_are_observations_not_accuracy_truth": True,
            "browser_nonce_does_not_establish_independent_people": True,
            "idempotent_and_same_browser_rejections_are_not_in_the_raw_export": True,
            "quarantined_and_content_stale_rows_are_excluded_from_completion": True,
            "task_identity_stale_rows_are_excluded_from_completion": True,
        },
        "coverage": {
            "tasks": len(selected),
            "tasks_with_usable_submission": len(completed),
            "completion_fraction": round(len(completed) / len(selected), 4),
            "usable_submissions": len(usable),
            "on_batch_submissions": len(scoped),
            "off_batch_submissions": len(off_batch),
            "content_stale_submissions": len(stale),
            "task_identity_stale_submissions": len(task_stale),
            "status_counts": dict(sorted(status_counts.items())),
            "per_sampling_stratum": per_stratum,
        },
        "repeat_annotations": {
            "articles_with_multiple_usable_submissions": len(repeated),
            "submissions_beyond_first_per_article": sum(
                len(rows) - 1 for rows in by_article.values()
            ),
            "articles_with_unanimous_answer_signature": unanimous,
            "articles_with_divergent_answer_signatures": len(repeated) - unanimous,
        },
        "model_comparison": {
            "meaning": "community/model disagreement, not model error",
            "submissions_with_any_model_disagreement": sum(map(disagrees, usable)),
            "scalar_dispositions": scalar_dispositions,
            "party_dispositions": dict(sorted(party_dispositions.items())),
            "removed_model_party_decisions": removed_parties,
        },
    }
    report["report_sha256"] = canonical_sha256(report)
    return report


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--sample-manifest", type=Path, required=True)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        report = build_report(
            root,
            (args.app_data or root / "news/app-data").resolve(),
            args.selection.resolve(),
            args.sample_manifest.resolve(),
            args.raw.resolve(),
        )
        rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        out = args.out.resolve()
        if args.check:
            if not out.is_file() or out.read_text(encoding="utf-8") != rendered:
                print(json.dumps({"error": "stale_community_pilot_report", "path": str(out)}))
                return 1
        else:
            atomic_write(out, report)
        print(json.dumps({
            "mode": "news_community_pilot_report",
            "status": "checked" if args.check else "written",
            "dataset_id": report["dataset_id"],
            "tasks": report["coverage"]["tasks"],
            "completed": report["coverage"]["tasks_with_usable_submission"],
            "report_sha256": report["report_sha256"],
        }))
        return 0
    except (PilotReportError, SyncError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": "community_pilot_report_failed", "message": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
