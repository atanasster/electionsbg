#!/usr/bin/env python3
"""Propose, but never publish, correction-log entries from accepted evals.

An accepted adjudication is eligible only when its frozen model labels and
revision match a supplied public-task manifest. Output is private editorial
working state: a maintainer must rewrite/approve an entry before manually
adding it to the public CORRECTIONS log.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from news.eval_contract.canonical import canonical_json, canonical_sha256  # noqa: E402
from news.scripts.effective_analysis import (  # noqa: E402
    EffectiveAnalysisError,
    load_accepted_adjudications,
    validate_https_url,
)

SCHEMA_VERSION = 1
RUBRIC_VERSION = "news-article-evaluation-v1"
PROJECT_ID = "electionsbg-news"
MAX_TASKS = 200
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_DOMAIN = re.compile(r"^[A-Za-z0-9.-]+$")
SAFE_ARTICLE_ID = re.compile(r"^[A-Za-z0-9._~-]+$")
MANIFEST_FIELDS = {
    "schema_version", "manifest_kind", "generated_at", "public_data_revision",
    "rubric_version", "task_count", "tasks_sha256", "queue_sha256", "tasks",
}
TASK_FIELDS = {
    "schema_version", "rubric_version", "article_key", "domain", "article_id",
    "url", "title", "published", "story_id", "primary_topic", "outlet",
    "content_sha256", "public_data_revision", "analysis_sha256", "model",
    "analyzed_at", "prompt_hashes", "model_labels", "review_reasons",
    "dataset_ids", "accepts_public_evals", "revision", "updated_at",
}
LEANING_DISPLAY = {
    "strong_progressive": "силно прогресивно",
    "progressive": "прогресивно",
    "neutral": "без ясно политическо рамкиране",
    "conservative": "консервативно",
    "strong_conservative": "силно консервативно",
    "not_applicable": "неприложимо",
}
RUSSIA_DISPLAY = {
    "strong_pro_russia": "силно проруско",
    "pro_russia": "проруско",
    "neutral": "неутрално",
    "anti_russia": "антируско",
    "strong_anti_russia": "силно антируско",
    "not_applicable": "неприложимо",
}
TONE_DISPLAY = {
    "favorable": "положителен",
    "unfavorable": "отрицателен",
    "neutral": "неутрален",
    "mixed": "смесен",
}


class CorrectionProposalError(ValueError):
    """The proposal cannot be generated safely."""


@dataclass
class PublishedProof:
    article_key: str
    task_revision: int
    url: str
    content_sha256: str
    analysis_sha256: str
    model_labels: dict[str, Any]
    public_data_revisions: set[str] = field(default_factory=set)

    def core(self) -> dict[str, Any]:
        return {
            "article_key": self.article_key,
            "task_revision": self.task_revision,
            "url": self.url,
            "content_sha256": self.content_sha256,
            "analysis_sha256": self.analysis_sha256,
            "model_labels": self.model_labels,
        }


def _exact(value: dict[str, Any], fields: set[str], label: str) -> None:
    missing = sorted(fields - value.keys())
    extra = sorted(value.keys() - fields)
    if missing or extra:
        detail = []
        if missing:
            detail.append("missing " + ", ".join(missing))
        if extra:
            detail.append("unexpected " + ", ".join(extra))
        raise CorrectionProposalError(f"{label} fields are invalid: {'; '.join(detail)}")


def _text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise CorrectionProposalError(f"{label} must be a bounded non-empty string")
    return value


def _positive_int(value: Any, label: str) -> int:
    if type(value) is not int or value < 1:
        raise CorrectionProposalError(f"{label} must be a positive integer")
    return value


def _version_one(value: Any, label: str) -> None:
    if type(value) is not int or value != 1:
        raise CorrectionProposalError(f"{label} must be integer 1")


def _hash(value: Any, label: str) -> str:
    result = _text(value, label, 71)
    if SHA256.fullmatch(result) is None:
        raise CorrectionProposalError(f"{label} must be a SHA-256 value")
    return result


def _timestamp(value: Any, label: str) -> str:
    result = _text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CorrectionProposalError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise CorrectionProposalError(f"{label} must include a timezone")
    normalized = parsed.astimezone(timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")
    if normalized != result:
        raise CorrectionProposalError(f"{label} must be normalized UTC milliseconds")
    return result


def _optional_text(value: Any, label: str, maximum: int) -> str | None:
    return None if value is None else _text(value, label, maximum)


def _optional_timestamp(value: Any, label: str) -> str | None:
    return None if value is None else _timestamp(value, label)


def _sorted_text_map(value: Any, label: str, *, maximum: int,
                     key_maximum: int, value_maximum: int,
                     hash_values: bool = False) -> dict[str, str]:
    if not isinstance(value, dict) or len(value) > maximum:
        raise CorrectionProposalError(f"{label} must be a bounded object")
    result: dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = _text(raw_key, f"{label} key", key_maximum)
        item = (_hash(raw_value, f"{label}.{key}") if hash_values
                else _text(raw_value, f"{label}.{key}", value_maximum))
        result[key] = item
    if list(result) != sorted(result):
        raise CorrectionProposalError(f"{label} must be sorted")
    return result


def _party_key(value: dict[str, Any]) -> str:
    party_id = value.get("party_id")
    return (f"id:{party_id}" if party_id else
            f"surface:{str(value.get('party') or '').strip().casefold()}")


def _validate_model_labels(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CorrectionProposalError(f"{label} must be an object")
    _exact(value, {"leaning", "russia_stance", "party_tones"}, label)
    if value["leaning"] not in LEANING_DISPLAY:
        raise CorrectionProposalError(f"{label}.leaning is invalid")
    if value["russia_stance"] not in RUSSIA_DISPLAY:
        raise CorrectionProposalError(f"{label}.russia_stance is invalid")
    parties = value["party_tones"]
    if not isinstance(parties, list) or len(parties) > 30:
        raise CorrectionProposalError(f"{label}.party_tones must be a bounded array")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(parties):
        item_label = f"{label}.party_tones[{index}]"
        if not isinstance(raw, dict):
            raise CorrectionProposalError(f"{item_label} must be an object")
        _exact(raw, {"party", "party_id", "tone"}, item_label)
        party = _text(raw["party"], f"{item_label}.party", 160)
        party_id = _optional_text(raw["party_id"], f"{item_label}.party_id", 160)
        tone = raw["tone"]
        if tone not in TONE_DISPLAY:
            raise CorrectionProposalError(f"{item_label}.tone is invalid")
        normalized_item = {"party": party, "party_id": party_id, "tone": tone}
        identity = _party_key(normalized_item)
        if identity in seen:
            raise CorrectionProposalError(f"{label}.party_tones contains duplicates")
        seen.add(identity)
        normalized.append(normalized_item)
    if canonical_sha256(normalized) != canonical_sha256(parties):
        raise CorrectionProposalError(f"{label}.party_tones is not normalized")
    return {
        "leaning": value["leaning"],
        "russia_stance": value["russia_stance"],
        "party_tones": normalized,
    }


def _validate_task(raw: Any, label: str) -> tuple[PublishedProof, str]:
    if not isinstance(raw, dict):
        raise CorrectionProposalError(f"{label} must be an object")
    _exact(raw, TASK_FIELDS, label)
    _version_one(raw["schema_version"], f"{label}.schema_version")
    if raw["rubric_version"] != RUBRIC_VERSION:
        raise CorrectionProposalError(f"{label} contract is unsupported")
    if raw["accepts_public_evals"] is not True:
        raise CorrectionProposalError(f"{label} was not a public evaluation task")
    key = _text(raw["article_key"], f"{label}.article_key", 509)
    domain = _text(raw["domain"], f"{label}.domain", 253)
    article_id = _text(raw["article_id"], f"{label}.article_id", 255)
    if (key != f"{domain}/{article_id}" or SAFE_DOMAIN.fullmatch(domain) is None
            or SAFE_ARTICLE_ID.fullmatch(article_id) is None):
        raise CorrectionProposalError(f"{label} has an unsafe article route")
    try:
        url = validate_https_url(raw["url"], f"{label}.url")
    except EffectiveAnalysisError as exc:
        raise CorrectionProposalError(str(exc)) from exc
    labels = _validate_model_labels(raw["model_labels"], f"{label}.model_labels")
    revision = _positive_int(raw["revision"], f"{label}.revision")
    content_hash = _hash(raw["content_sha256"], f"{label}.content_sha256")
    analysis_hash = _hash(raw["analysis_sha256"], f"{label}.analysis_sha256")
    expected_revision_hash = canonical_sha256({
        "rubric_version": RUBRIC_VERSION,
        "content_sha256": content_hash,
        "analysis_sha256": analysis_hash,
        "model_labels": labels,
    }).removeprefix("sha256:")
    expected_revision = int(expected_revision_hash[:12], 16) + 1
    if revision != expected_revision:
        raise CorrectionProposalError(f"{label}.revision is not derived from its frozen inputs")
    public_revision = _timestamp(
        raw["public_data_revision"], f"{label}.public_data_revision")
    if _timestamp(raw["updated_at"], f"{label}.updated_at") != public_revision:
        raise CorrectionProposalError(f"{label}.updated_at disagrees with public revision")
    _text(raw["title"], f"{label}.title", 500)
    _optional_timestamp(raw["published"], f"{label}.published")
    _optional_text(raw["story_id"], f"{label}.story_id", 160)
    _optional_text(raw["primary_topic"], f"{label}.primary_topic", 128)
    outlet = _text(raw["outlet"], f"{label}.outlet", 160)
    if outlet != domain:
        raise CorrectionProposalError(f"{label}.outlet disagrees with domain")
    _optional_text(raw["model"], f"{label}.model", 160)
    _optional_timestamp(raw["analyzed_at"], f"{label}.analyzed_at")
    _sorted_text_map(
        raw["prompt_hashes"], f"{label}.prompt_hashes", maximum=20,
        key_maximum=128, value_maximum=71, hash_values=True)
    _sorted_text_map(
        raw["review_reasons"], f"{label}.review_reasons", maximum=10,
        key_maximum=64, value_maximum=600)
    dataset_ids = raw["dataset_ids"]
    if (not isinstance(dataset_ids, list) or not dataset_ids
            or any(not isinstance(item, str) for item in dataset_ids)):
        raise CorrectionProposalError(f"{label}.dataset_ids must be a non-empty string array")
    normalized_dataset_ids = [
        _text(item, f"{label}.dataset_ids", 128) for item in dataset_ids
    ]
    if normalized_dataset_ids != sorted(set(normalized_dataset_ids)):
        raise CorrectionProposalError(f"{label}.dataset_ids must be sorted and unique")
    proof = PublishedProof(
        article_key=key,
        task_revision=revision,
        url=url,
        content_sha256=content_hash,
        analysis_sha256=analysis_hash,
        model_labels=labels,
        public_data_revisions={public_revision},
    )
    return proof, public_revision


def _load_published_proof_bundle(
    paths: list[Path],
) -> tuple[dict[tuple[str, int], PublishedProof], list[str]]:
    if not paths:
        raise CorrectionProposalError("at least one public-task manifest is required")
    proofs: dict[tuple[str, int], PublishedProof] = {}
    manifest_hashes: list[str] = []
    for path in paths:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CorrectionProposalError(f"cannot read task manifest {path}: {exc}") from exc
        if not isinstance(value, dict):
            raise CorrectionProposalError(f"task manifest {path} must be an object")
        manifest_hashes.append(canonical_sha256(value))
        _exact(value, MANIFEST_FIELDS, f"task manifest {path}")
        _version_one(value["schema_version"], f"task manifest {path}.schema_version")
        if (value["manifest_kind"] != "news-eval-task-sync"
                or value["rubric_version"] != RUBRIC_VERSION):
            raise CorrectionProposalError(f"task manifest {path} contract is unsupported")
        generated = _timestamp(value["generated_at"], f"{path}.generated_at")
        public_revision = _timestamp(
            value["public_data_revision"], f"{path}.public_data_revision")
        if generated != public_revision:
            raise CorrectionProposalError(f"task manifest {path} revision metadata disagrees")
        tasks = value["tasks"]
        if not isinstance(tasks, list) or not 0 < len(tasks) <= MAX_TASKS:
            raise CorrectionProposalError(f"task manifest {path} has an invalid task array")
        if _positive_int(value["task_count"], f"{path}.task_count") != len(tasks):
            raise CorrectionProposalError(f"task manifest {path} task count disagrees")
        if canonical_sha256(tasks) != _hash(value["tasks_sha256"], f"{path}.tasks_sha256"):
            raise CorrectionProposalError(f"task manifest {path} task hash disagrees")
        _hash(value["queue_sha256"], f"{path}.queue_sha256")
        prior: bytes | None = None
        for index, raw in enumerate(tasks):
            proof, task_public_revision = _validate_task(raw, f"{path}.tasks[{index}]")
            if task_public_revision != public_revision:
                raise CorrectionProposalError(f"{path}.tasks[{index}] revision disagrees")
            encoded = proof.article_key.encode("utf-8")
            if prior is not None and prior >= encoded:
                raise CorrectionProposalError(f"task manifest {path} is duplicated or unsorted")
            prior = encoded
            identity = (proof.article_key, proof.task_revision)
            existing = proofs.get(identity)
            if existing is None:
                proofs[identity] = proof
            elif canonical_sha256(existing.core()) != canonical_sha256(proof.core()):
                raise CorrectionProposalError(
                    f"conflicting public proof for {proof.article_key} revision "
                    f"{proof.task_revision}")
            else:
                existing.public_data_revisions.update(proof.public_data_revisions)
    return proofs, sorted(manifest_hashes)


def load_published_proofs(paths: list[Path]) -> dict[tuple[str, int], PublishedProof]:
    """Compatibility helper for callers needing only the validated proof map."""
    return _load_published_proof_bundle(paths)[0]


def _proposal_id(value: dict[str, Any]) -> str:
    return "eval-" + canonical_sha256(value).removeprefix("sha256:")[:24]


def _proposal(record: dict[str, Any], proof: PublishedProof, *, field_name: str,
              change_kind: str, old_label: str | None, new_label: str | None,
              proposed_note: str, party: dict[str, Any] | None = None) -> dict[str, Any]:
    domain, article_id = record["article_key"].split("/", 1)
    identity = {
        "article_key": record["article_key"],
        "accepted_revision": record["revision"],
        "field": field_name,
        "change_kind": change_kind,
        "party": party,
        "old_label": old_label,
        "new_label": new_label,
    }
    return {
        "proposal_id": _proposal_id(identity),
        "status": "proposed",
        "approved_for_publication": False,
        "article_key": record["article_key"],
        "path": f"/article/{domain}/{article_id}",
        "field": field_name,
        "change_kind": change_kind,
        "party": copy.deepcopy(party),
        "old_label": old_label,
        "new_label": new_label,
        "correction_date": record["adjudicated_at"][:10],
        "adjudicated_at": record["adjudicated_at"],
        "proposed_note": proposed_note,
        "editorial_context": record["public_explanation"],
        "accepted_revision": record["revision"],
        "source_public_data_revisions": sorted(proof.public_data_revisions),
    }


def proposals_for_record(record: dict[str, Any], proof: PublishedProof) -> list[dict[str, Any]]:
    evaluation = record["evaluation"]
    model = record["model_labels"]
    proposals: list[dict[str, Any]] = []
    scalar_config = {
        "leaning": ("Политическото рамкиране", LEANING_DISPLAY),
        "russia_stance": ("Позицията спрямо Русия", RUSSIA_DISPLAY),
    }
    for field_name, (display_name, labels) in scalar_config.items():
        decision = evaluation[field_name]
        if decision["disposition"] != "changed":
            continue
        old_label = model[field_name]
        new_label = decision["label"]
        proposals.append(_proposal(
            record, proof, field_name=field_name, change_kind="label_changed",
            old_label=old_label, new_label=new_label,
            proposed_note=(f"{display_name} е коригирано от „{labels[old_label]}“ "
                           f"на „{labels[new_label]}“ след редакционен "
                           "преглед."),
        ))

    model_parties = {_party_key(item): item for item in model["party_tones"]}
    for item in evaluation["party_tones"]:
        if item["disposition"] == "confirmed":
            continue
        original = model_parties.get(_party_key(item))
        old_label = original["tone"] if original else None
        new_label = item["tone"]
        party = {"party": item["party"], "party_id": item["party_id"]}
        if original is None:
            kind = "party_added"
            note = (f"Добавена е оценка за {item['party']}: "
                    f"„{TONE_DISPLAY[new_label]} тон“ след редакционен "
                    "преглед.")
        else:
            kind = "label_changed"
            note = (f"Тонът към {item['party']} е коригиран от "
                    f"„{TONE_DISPLAY[old_label]}“ на „{TONE_DISPLAY[new_label]}“ "
                    "след редакционен преглед.")
        proposals.append(_proposal(
            record, proof, field_name="party_tones", change_kind=kind,
            old_label=old_label, new_label=new_label, proposed_note=note, party=party,
        ))
    for item in evaluation["removed_model_parties"]:
        original = model_parties[_party_key(item)]
        party = {"party": original["party"], "party_id": original["party_id"]}
        proposals.append(_proposal(
            record, proof, field_name="party_tones", change_kind="party_removed",
            old_label=original["tone"], new_label=None, party=party,
            proposed_note=(f"Премахната е оценката за тон към "
                           f"{original['party']} "
                           "след редакционен преглед."),
        ))
    return proposals


def build_report(accepted_path: Path, task_paths: list[Path]) -> dict[str, Any]:
    try:
        accepted = load_accepted_adjudications(
            accepted_path, expected_project_id=PROJECT_ID)
    except EffectiveAnalysisError as exc:
        raise CorrectionProposalError(str(exc)) from exc
    proofs, task_manifest_hashes = _load_published_proof_bundle(task_paths)
    proposals: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    matched_records = 0
    for article_key, record in accepted.by_article.items():
        proof = proofs.get((article_key, record["task_revision"]))
        if proof is None or canonical_sha256(proof.core()) != canonical_sha256({
            "article_key": article_key,
            "task_revision": record["task_revision"],
            "url": record["url"],
            "content_sha256": record["content_sha256"],
            "analysis_sha256": record["analysis_sha256"],
            "model_labels": record["model_labels"],
        }):
            skipped.append({
                "article_key": article_key,
                "reason": "not_proven_previously_public",
            })
            continue
        matched_records += 1
        proposals.extend(proposals_for_record(record, proof))
    proposals.sort(key=lambda item: (
        item["path"].encode("utf-8"), item["field"],
        canonical_json(item["party"]), item["change_kind"], item["proposal_id"],
    ))
    generated_at = accepted.manifest["firestore_read_time"]
    return {
        "schema_version": 1,
        "proposal_kind": "news-analysis-correction-proposals",
        "generated_at": generated_at,
        "publishes_automatically": False,
        "approval_required": "maintainer_edits_and_manually_adds_to_CORRECTIONS",
        "project_id": accepted.manifest["project_id"],
        "accepted_snapshot_records_sha256": accepted.records_sha256,
        "published_task_manifests_sha256": canonical_sha256(task_manifest_hashes),
        "accepted_record_count": len(accepted.by_article),
        "matched_previously_public_record_count": matched_records,
        "proposal_count": len(proposals),
        "proposals_sha256": canonical_sha256(proposals),
        "proposals": proposals,
        "skipped": skipped,
    }


def _private_output(root: Path, path: Path) -> Path:
    resolved_root = root.resolve()
    allowed = (resolved_root / "news" / "data" / "evals" / "corrections").resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(allowed) or resolved.suffix != ".json":
        raise CorrectionProposalError(
            "correction proposals may only be written as JSON under "
            "news/data/evals/corrections")
    return resolved


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(os.environ.get("DATA_BG_ROOT", ROOT)))
    parser.add_argument("--accepted", type=Path)
    parser.add_argument("--published-tasks", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--write", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = args.root.resolve()
    accepted = (args.accepted or root / "news" / "data" / "evals" /
                "accepted" / "current.json").resolve()
    task_paths = ([path.resolve() for path in args.published_tasks]
                  or [(root / "news" / "data" / "evals" /
                       "tasks" / "current.json").resolve()])
    try:
        output = _private_output(
            root, args.out or root / "news" / "data" / "evals" /
            "corrections" / "proposed" / "current.json")
        report = build_report(accepted, task_paths)
        report["dry_run"] = not args.write
        if args.write:
            atomic_write(output, report)
        print(canonical_json(report))
        return 0
    except (CorrectionProposalError, OSError, TypeError, json.JSONDecodeError) as exc:
        print(canonical_json({
            "error": "eval_correction_proposal_failed",
            "message": str(exc),
        }), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
