#!/usr/bin/env python3
"""Build private model-improvement inputs from accepted feedback only."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import (  # noqa: E402
    canonical_json, canonical_sha256, content_sha256)
from news.scripts.build_feedback_targets import (  # noqa: E402
    build as build_feedback_targets, validate_registry)
from news.scripts.build_app_data import compact_analysis  # noqa: E402
from news.scripts.effective_analysis import (  # noqa: E402
    effective_analysis, load_accepted_adjudications)
from news.scripts.effective_feedback import (  # noqa: E402
    EffectiveFeedbackError, load_accepted_feedback, target_index,
    validate_feedback_semantics)


def _read_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EffectiveFeedbackError(f"cannot read {label} {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EffectiveFeedbackError(f"{label} must be an object: {path}")
    return value


def build(snapshot_path: Path, data_dir: Path, *,
          current_registry: dict | None = None,
          current_analyses: dict[str, dict | None] | None = None) -> dict:
    snapshot = load_accepted_feedback(
        snapshot_path, expected_project_id="electionsbg-news")
    registry = validate_registry(current_registry or build_feedback_targets(
        ROOT, snapshot.manifest["firestore_read_time"]))
    targets = target_index([registry])
    accepted_analysis_path = data_dir / "evals" / "accepted" / "current.json"
    accepted_analysis = (load_accepted_adjudications(
        accepted_analysis_path, expected_project_id="electionsbg-news")
        if current_analyses is None and accepted_analysis_path.is_file()
        else None)
    records = []
    stale = missing = analysis_stale_records = analysis_stale_fields = 0
    for article_key, accepted in snapshot.by_article.items():
        domain, article_id = article_key.split("/", 1)
        article_path = data_dir / domain / f"{article_id}.json"
        if not article_path.is_file():
            missing += 1
            continue
        article = _read_json(article_path, "article")
        content = article.get("content")
        expected_feedback_url = (
            f"https://news.electionsbg.com/article/{article_key}")
        if (not isinstance(content, str) or
                accepted["url"] != expected_feedback_url):
            missing += 1
            continue
        if content_sha256(content) != accepted["content_sha256"]:
            stale += 1
            continue
        if current_analyses is not None:
            if article_key not in current_analyses:
                missing += 1
                continue
            analysis = current_analyses[article_key]
        else:
            analysis_path = (data_dir / "analysis" / "articles" / domain /
                             f"{article_id}.json")
            raw_analysis = (_read_json(analysis_path, "analysis")
                            if analysis_path.is_file() else None)
            accepted_record = (accepted_analysis.by_article.get(article_key)
                               if accepted_analysis else None)
            effective = (effective_analysis(
                raw_analysis, article, accepted_record)
                if raw_analysis is not None else None)
            analysis = (compact_analysis(effective, article)
                        if effective is not None else None)
        current_analysis_hash = (
            canonical_sha256(analysis) if analysis is not None else None)
        analysis_stale = current_analysis_hash != accepted["analysis_sha256"]
        semantic = validate_feedback_semantics(accepted, article, targets)
        feedback = accepted["feedback"]
        selected_parties = [
            {key: item[key] for key in ("party", "party_id", "tone", "evidence")}
            for item, _target in semantic["parties"]
        ]
        selected_links = [] if analysis_stale else [
            {"action": item["action"], "surface": item["surface"],
             "target_ref": item["target_ref"], "evidence": item["evidence"]}
            for item, _target in semantic["links"]
        ]
        issue_kinds = [] if analysis_stale else feedback["issue_kinds"]
        stale_count = ((len(semantic["links"]) if analysis_stale else 0) +
                       (len(feedback["issue_kinds"]) if analysis_stale else 0))
        if stale_count:
            analysis_stale_records += 1
            analysis_stale_fields += stale_count
        targets_block = {
            "leaning": feedback["leaning"],
            "russia_stance": feedback["russia_stance"],
            "party_tones": selected_parties,
            "entity_links": selected_links,
            "issue_kinds": issue_kinds,
        }
        if (targets_block["leaning"] is None and
                targets_block["russia_stance"] is None and
                not any(targets_block[name] for name in (
                    "party_tones", "entity_links", "issue_kinds"))):
            continue
        records.append({
            "article_key": article_key,
            "url": accepted["url"],
            "source_url": article.get("url"),
            "content_sha256": accepted["content_sha256"],
            "source_target_registry_sha256":
                accepted["target_registry_sha256"],
            "current_target_registry_sha256": registry["targets_sha256"],
            "title": article.get("title"),
            "description": article.get("description"),
            "content": content,
            "reviewed_model_analysis_sha256": accepted["analysis_sha256"],
            "current_model_analysis_sha256": current_analysis_hash,
            "targets": targets_block,
            "adjudication": {
                "revision": accepted["revision"],
                "adjudicated_at": accepted["adjudicated_at"],
            },
        })
    records.sort(key=lambda row: row["article_key"].encode("utf-8"))
    records_hash = canonical_sha256(records)
    return {
        "manifest": {
            "schema_version": 1,
            "dataset_kind": "news-feedback-adjudicated-improvement-v1",
            "dataset_id": f"feedback-adjudicated-{records_hash.split(':', 1)[1][:16]}",
            "generated_at": snapshot.manifest["firestore_read_time"],
            "source_snapshot_records_sha256": snapshot.records_sha256,
            "current_target_registry_sha256": registry["targets_sha256"],
            "record_count": len(records),
            "records_sha256": records_hash,
            "excluded_stale_content": stale,
            "excluded_missing_article": missing,
            "excluded_analysis_stale_records": analysis_stale_records,
            "excluded_analysis_stale_fields": analysis_stale_fields,
            "raw_community_records_included": 0,
        },
        "records": records,
    }


def atomic_private_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(canonical_json(value) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--snapshot", type=Path,
        default=ROOT / "news/data/evals/feedback-accepted/current.json")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "news/data")
    parser.add_argument(
        "--out", type=Path,
        default=ROOT / "news/data/evals/feedback-improvement/current.json")
    args = parser.parse_args()
    try:
        document = build(args.snapshot, args.data_dir)
        atomic_private_write(args.out, document)
    except (EffectiveFeedbackError, OSError, TypeError,
            json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    print(json.dumps({
        "out": str(args.out),
        "record_count": document["manifest"]["record_count"],
        "records_sha256": document["manifest"]["records_sha256"],
        "raw_community_records_included": 0,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
