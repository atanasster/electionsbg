#!/usr/bin/env python3
"""Resolve immutable model analysis plus one trusted adjudication snapshot.

The browser never calls this module. It is a build-time boundary between the
private accepted snapshot and every public projection that consumes article
analysis. Original model files are deep-copied and never rewritten.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

from news.eval_contract.canonical import (
    analysis_sha256,
    canonical_sha256,
    content_sha256,
)
from news.eval_contract.validate import validate_article_evaluation


RUBRIC_VERSION = "news-article-evaluation-v1"
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
OPERATION_ID = re.compile(r"^[A-Za-z0-9_-]{16,96}$")
LEANING = {
    "strong_progressive", "progressive", "neutral", "conservative",
    "strong_conservative", "not_applicable",
}
RUSSIA = {
    "strong_pro_russia", "pro_russia", "neutral", "anti_russia",
    "strong_anti_russia", "not_applicable",
}
PARTY_TONES = {"favorable", "unfavorable", "neutral", "mixed"}
RECORD_FIELDS = {
    "schema_version", "rubric_version", "article_key", "url",
    "task_revision", "content_sha256", "analysis_sha256",
    "source_submission_ids", "operator_actor", "adjudicated_at", "revision",
    "evaluation", "model_labels", "public_explanation", "gold_eligible",
    "status", "last_operation_id",
}
MANIFEST_FIELDS = {
    "schema_version", "snapshot_kind", "project_id", "firestore_read_time",
    "rubric_version", "record_count", "records_sha256",
}


class EffectiveAnalysisError(ValueError):
    """The accepted snapshot cannot safely be applied."""


@dataclass(frozen=True)
class AcceptedAdjudications:
    manifest: dict[str, Any]
    by_article: dict[str, dict[str, Any]]

    @property
    def records_sha256(self) -> str:
        return self.manifest["records_sha256"]


def _exact(value: dict[str, Any], fields: set[str], label: str) -> None:
    missing = sorted(fields - value.keys())
    extra = sorted(value.keys() - fields)
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"missing {', '.join(missing)}")
        if extra:
            parts.append(f"unexpected {', '.join(extra)}")
        raise EffectiveAnalysisError(f"{label} fields are invalid: {'; '.join(parts)}")


def _text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise EffectiveAnalysisError(f"{label} must be a bounded non-empty string")
    return value


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise EffectiveAnalysisError(f"{label} must be a positive integer")
    return value


def _version_one(value: Any, label: str) -> None:
    if type(value) is not int or value != 1:  # bool is an int subclass in Python
        raise EffectiveAnalysisError(f"{label} must be integer 1")


def _hash(value: Any, label: str) -> str:
    result = _text(value, label, 71)
    if SHA256.fullmatch(result) is None:
        raise EffectiveAnalysisError(f"{label} must be a SHA-256 value")
    return result


def _timestamp(value: Any, label: str) -> str:
    result = _text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EffectiveAnalysisError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise EffectiveAnalysisError(f"{label} must carry a timezone")
    utc = parsed.astimezone(timezone.utc)
    # JavaScript Date, used by the exporter, canonicalizes to UTC milliseconds.
    milliseconds = utc.microsecond // 1000
    return utc.replace(microsecond=milliseconds * 1000).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


def validate_https_url(value: Any, label: str = "URL") -> str:
    result = _text(value, label, 2048)
    if any(character.isspace() for character in result):
        raise EffectiveAnalysisError(f"{label} must not contain whitespace")
    try:
        parsed = urlparse(result)
        port = parsed.port
    except ValueError as exc:
        raise EffectiveAnalysisError(f"{label} is invalid") from exc
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or (port is not None and not 0 < port <= 65535)):
        raise EffectiveAnalysisError(f"{label} must be an HTTPS URL without credentials")
    return result


def _model_labels(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EffectiveAnalysisError(f"{label} must be an object")
    _exact(value, {"leaning", "russia_stance", "party_tones"}, label)
    if value["leaning"] not in LEANING or value["russia_stance"] not in RUSSIA:
        raise EffectiveAnalysisError(f"{label} contains an unknown scalar label")
    parties = value["party_tones"]
    if not isinstance(parties, list) or len(parties) > 30:
        raise EffectiveAnalysisError(f"{label}.party_tones must be a bounded array")
    normalized = []
    seen: set[str] = set()
    for index, raw in enumerate(parties):
        if not isinstance(raw, dict):
            raise EffectiveAnalysisError(f"{label}.party_tones[{index}] must be an object")
        _exact(raw, {"party", "party_id", "tone"}, f"{label}.party_tones[{index}]")
        party = _text(raw["party"], f"{label}.party_tones[{index}].party", 160)
        party_id = raw["party_id"]
        if party_id is not None:
            party_id = _text(party_id, f"{label}.party_tones[{index}].party_id", 160)
        tone = raw["tone"]
        if tone not in PARTY_TONES:
            raise EffectiveAnalysisError(f"{label}.party_tones[{index}].tone is invalid")
        key = f"id:{party_id}" if party_id else f"surface:{party.strip().casefold()}"
        if key in seen:
            raise EffectiveAnalysisError(f"{label}.party_tones contains duplicates")
        seen.add(key)
        normalized.append({"party": party, "party_id": party_id, "tone": tone})
    return {
        "leaning": value["leaning"],
        "russia_stance": value["russia_stance"],
        "party_tones": normalized,
    }


def validate_accepted_adjudication(value: Any, *, label: str = "adjudication") -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EffectiveAnalysisError(f"{label} must be an object")
    _exact(value, RECORD_FIELDS, label)
    _version_one(value["schema_version"], f"{label}.schema_version")
    if value["rubric_version"] != RUBRIC_VERSION:
        raise EffectiveAnalysisError(f"{label} contract is unsupported")
    article_key = _text(value["article_key"], f"{label}.article_key", 509)
    segments = article_key.split("/")
    if (len(segments) != 2 or not segments[0] or not segments[1]
            or len(segments[0]) > 253 or len(segments[1]) > 255
            or "\\" in article_key or ".." in article_key
            or "%2f" in article_key.lower() or "%5c" in article_key.lower()):
        raise EffectiveAnalysisError(f"{label}.article_key is invalid")
    model_labels = _model_labels(value["model_labels"], f"{label}.model_labels")
    evaluation = value["evaluation"]
    validation = validate_article_evaluation(evaluation, model_labels)
    errors = validation["schema_errors"] + validation["error_codes"]
    if errors:
        raise EffectiveAnalysisError(
            f"{label}.evaluation is invalid: {', '.join(errors)}")
    if value["gold_eligible"] is not validation["gold_eligible"]:
        raise EffectiveAnalysisError(f"{label}.gold_eligible is inconsistent")
    source_ids = value["source_submission_ids"]
    if (not isinstance(source_ids, list) or not source_ids or len(source_ids) > 200
            or any(not isinstance(item, str) or not item or len(item) > 128
                   for item in source_ids)
            or len(source_ids) != len(set(source_ids))
            or source_ids != sorted(source_ids, key=lambda item: item.encode("utf-8"))):
        raise EffectiveAnalysisError(f"{label}.source_submission_ids is invalid")
    actor = value["operator_actor"]
    if not isinstance(actor, dict):
        raise EffectiveAnalysisError(f"{label}.operator_actor must be an object")
    _exact(actor, {"kind", "id"}, f"{label}.operator_actor")
    if actor["kind"] != "maintainer":
        raise EffectiveAnalysisError(f"{label}.operator_actor must be a maintainer")
    _text(actor["id"], f"{label}.operator_actor.id", 128)
    if value["status"] != "accepted":
        raise EffectiveAnalysisError(f"{label}.status is not accepted")
    operation_id = _text(value["last_operation_id"], f"{label}.last_operation_id", 96)
    if OPERATION_ID.fullmatch(operation_id) is None:
        raise EffectiveAnalysisError(f"{label}.last_operation_id is invalid")
    public_explanation = value["public_explanation"]
    if public_explanation is not None:
        _text(public_explanation, f"{label}.public_explanation", 600)
    normalized = copy.deepcopy(value)
    normalized["url"] = validate_https_url(value["url"], f"{label}.url")
    normalized["task_revision"] = _positive_int(
        value["task_revision"], f"{label}.task_revision")
    normalized["content_sha256"] = _hash(
        value["content_sha256"], f"{label}.content_sha256")
    normalized["analysis_sha256"] = _hash(
        value["analysis_sha256"], f"{label}.analysis_sha256")
    normalized["adjudicated_at"] = _timestamp(
        value["adjudicated_at"], f"{label}.adjudicated_at")
    normalized["revision"] = _positive_int(value["revision"], f"{label}.revision")
    normalized["model_labels"] = model_labels
    if canonical_sha256(normalized) != canonical_sha256(value):
        raise EffectiveAnalysisError(f"{label} is not normalized")
    return normalized


def load_accepted_adjudications(path: Path) -> AcceptedAdjudications:
    """Read and fully verify one atomically exported accepted snapshot."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EffectiveAnalysisError(f"cannot read accepted snapshot {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EffectiveAnalysisError("accepted snapshot must be an object")
    _exact(value, {"manifest", "records"}, "accepted snapshot")
    manifest = value["manifest"]
    records = value["records"]
    if not isinstance(manifest, dict):
        raise EffectiveAnalysisError("accepted snapshot manifest must be an object")
    _exact(manifest, MANIFEST_FIELDS, "accepted snapshot manifest")
    _version_one(manifest["schema_version"], "accepted snapshot schema_version")
    if (manifest["snapshot_kind"] != "news-eval-accepted-adjudications"
            or manifest["rubric_version"] != RUBRIC_VERSION):
        raise EffectiveAnalysisError("accepted snapshot contract is unsupported")
    _text(manifest["project_id"], "accepted snapshot project_id", 128)
    read_time = _timestamp(
        manifest["firestore_read_time"], "accepted snapshot firestore_read_time")
    if read_time != manifest["firestore_read_time"]:
        raise EffectiveAnalysisError(
            "accepted snapshot firestore_read_time is not normalized")
    if not isinstance(records, list) or not records:
        raise EffectiveAnalysisError("accepted snapshot must not be empty")
    if type(manifest["record_count"]) is not int or manifest["record_count"] < 1:
        raise EffectiveAnalysisError("accepted snapshot record_count must be positive")
    if manifest["record_count"] != len(records):
        raise EffectiveAnalysisError("accepted snapshot record count does not match")
    expected_hash = _hash(manifest["records_sha256"], "accepted snapshot records_sha256")
    if canonical_sha256(records) != expected_hash:
        raise EffectiveAnalysisError("accepted snapshot records hash does not match")
    normalized: list[dict[str, Any]] = []
    by_article: dict[str, dict[str, Any]] = {}
    prior: bytes | None = None
    for index, record in enumerate(records):
        item = validate_accepted_adjudication(record, label=f"adjudication {index}")
        encoded = item["article_key"].encode("utf-8")
        if prior is not None and prior >= encoded:
            raise EffectiveAnalysisError(
                "accepted snapshot records are duplicated or not sorted")
        prior = encoded
        by_article[item["article_key"]] = item
        normalized.append(item)
    if canonical_sha256(normalized) != expected_hash:
        raise EffectiveAnalysisError("accepted snapshot records are not normalized")
    return AcceptedAdjudications(copy.deepcopy(manifest), by_article)


def _article_identity(base_analysis: dict[str, Any], article: dict[str, Any]) -> tuple[str, str]:
    domain = _text(base_analysis.get("domain"), "analysis.domain", 253)
    path = _text(base_analysis.get("article_path"), "analysis.article_path", 4096)
    parts = PurePosixPath(path).parts
    if len(parts) < 2 or PurePosixPath(parts[-1]).suffix != ".json" or parts[-2] != domain:
        raise EffectiveAnalysisError("analysis.article_path does not identify its domain")
    article_key = f"{domain}/{PurePosixPath(parts[-1]).stem}"
    if article.get("domain") not in (None, domain):
        raise EffectiveAnalysisError("article domain does not match analysis")
    analysis_url = validate_https_url(base_analysis.get("url"), "analysis.url")
    article_url = validate_https_url(article.get("url"), "article.url")
    if analysis_url != article_url:
        raise EffectiveAnalysisError("article URL does not match analysis")
    return article_key, article_url


def effective_analysis(
    base_analysis: dict[str, Any],
    article: dict[str, Any],
    accepted_adjudication: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return a new effective analysis without mutating any input object."""
    if not isinstance(base_analysis, dict) or not isinstance(article, dict):
        raise EffectiveAnalysisError("analysis and article must be objects")
    result = copy.deepcopy(base_analysis)
    if accepted_adjudication is None:
        return result
    accepted = validate_accepted_adjudication(accepted_adjudication)
    article_key, article_url = _article_identity(base_analysis, article)
    if accepted["article_key"] != article_key:
        raise EffectiveAnalysisError("adjudication article_key does not match analysis")
    if accepted["url"] != article_url:
        raise EffectiveAnalysisError("adjudication URL does not match article")
    content = article.get("content")
    if not isinstance(content, str):
        raise EffectiveAnalysisError("article.content must be a string")
    current_content_hash = content_sha256(content)
    current_analysis_hash = analysis_sha256(base_analysis)
    original_model = {
        "model": copy.deepcopy(base_analysis.get("model")),
        "analyzed_at": copy.deepcopy(base_analysis.get("analyzed_at")),
        "analysis_sha256": current_analysis_hash,
        "leaning": copy.deepcopy(base_analysis.get("leaning")),
        "russia_stance": copy.deepcopy(base_analysis.get("russia_stance")),
        "party_tones": copy.deepcopy(base_analysis.get("party_tones")),
    }
    review = {
        "schema_version": 1,
        "status": "accepted",
        "adjudication_revision": accepted["revision"],
        "adjudicated_at": accepted["adjudicated_at"],
        "reviewed_content_sha256": accepted["content_sha256"],
        "reviewed_analysis_sha256": accepted["analysis_sha256"],
        "current_analysis_sha256": current_analysis_hash,
        "analysis_changed_since_review": (
            current_analysis_hash != accepted["analysis_sha256"]),
        "public_explanation": accepted["public_explanation"],
        "fields": {
            "leaning": accepted["evaluation"]["leaning"]["disposition"],
            "russia_stance": accepted["evaluation"]["russia_stance"]["disposition"],
            "party_tones": "accepted",
        },
    }
    result["original_model"] = original_model
    if current_content_hash != accepted["content_sha256"]:
        review["status"] = "needs_revalidation"
        review["stale_reason"] = "content_changed"
        result["human_review"] = review
        return result

    for field in ("leaning", "russia_stance"):
        decision = accepted["evaluation"][field]
        if decision["disposition"] == "unable_to_judge":
            continue
        result[field] = {
            "label": decision["label"],
            "confidence": None,
            "evidence": decision["evidence"],
        }
    result["party_tones"] = [
        {
            "party": item["party"],
            "party_id": item["party_id"],
            "tone": item["tone"],
            "confidence": None,
            "evidence": item["evidence"],
            "evidence_grounded": True,
        }
        for item in accepted["evaluation"]["party_tones"]
    ]
    result["human_review"] = review
    return result
