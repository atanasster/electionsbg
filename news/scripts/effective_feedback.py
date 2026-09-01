#!/usr/bin/env python3
"""Validate and apply maintainer-accepted all-article feedback at build time.

Raw public submissions never enter this module. Its only input is the strict,
last-known-good accepted snapshot produced by the offline operator workflow.
"""

from __future__ import annotations

import copy
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

try:
    from news.eval_contract.canonical import (
        analysis_sha256, canonical_sha256, content_sha256)
    from news.eval_contract.validate import validate_schema
    from news.scripts.build_feedback_targets import validate_registry
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from news.eval_contract.canonical import (  # type: ignore[no-redef]
        analysis_sha256, canonical_sha256, content_sha256)
    from news.eval_contract.validate import validate_schema  # type: ignore[no-redef]
    from news.scripts.build_feedback_targets import (  # type: ignore[no-redef]
        validate_registry)

SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
LEANING = {"strong_progressive", "progressive", "neutral", "conservative",
           "strong_conservative", "not_applicable"}
RUSSIA = {"strong_pro_russia", "pro_russia", "neutral", "anti_russia",
          "strong_anti_russia", "not_applicable"}
ENTITY_BUCKETS = {
    "person": "people", "party": "parties", "institution": "institutions",
    "company": "companies", "settlement": "places",
}
ANALYSIS_DEPENDENT_FIELDS = {"entity_links", "issue_kinds"}
RECORD_FIELDS = {
    "schema_version", "contract", "article_key", "url", "task_revision",
    "content_sha256", "analysis_sha256", "target_registry_sha256",
    "source_submission_ids", "source_target_registry_sha256s",
    "operator_actor", "adjudicated_at", "revision", "feedback",
    "public_explanation", "status", "last_operation_id",
}
MANIFEST_FIELDS = {
    "schema_version", "snapshot_kind", "project_id", "firestore_read_time",
    "record_count", "records_sha256",
}


class EffectiveFeedbackError(ValueError):
    """Accepted feedback is unsafe or inconsistent with the publication build."""


@dataclass(frozen=True)
class AcceptedFeedback:
    manifest: dict[str, Any]
    by_article: dict[str, dict[str, Any]]

    @property
    def records_sha256(self) -> str:
        return self.manifest["records_sha256"]


def _exact(value: dict, fields: set[str], label: str) -> None:
    if set(value) != fields:
        raise EffectiveFeedbackError(f"{label} fields are invalid")


def _text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise EffectiveFeedbackError(f"{label} must be a bounded string")
    return value


def _hash(value: Any, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    result = _text(value, label, 71)
    if not SHA256.fullmatch(result):
        raise EffectiveFeedbackError(f"{label} must be a SHA-256 value")
    return result


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise EffectiveFeedbackError(f"{label} must be a positive integer")
    return value


def _timestamp(value: Any, label: str) -> str:
    result = _text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(result.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EffectiveFeedbackError(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise EffectiveFeedbackError(f"{label} must carry a timezone")
    utc = parsed.astimezone(timezone.utc)
    milliseconds = utc.microsecond // 1000
    return utc.replace(microsecond=milliseconds * 1000).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


def _article_key(value: Any, label: str) -> str:
    result = _text(value, label, 509)
    parts = result.split("/")
    if (len(parts) != 2 or not all(parts)
            or len(parts[0]) > 253 or len(parts[1]) > 255
            or "\\" in result or ".." in result
            or "%2f" in result.casefold() or "%5c" in result.casefold()):
        raise EffectiveFeedbackError(f"{label} is invalid")
    return result


@lru_cache(maxsize=1)
def _feedback_schema() -> dict:
    path = Path(__file__).resolve().parents[1] / "eval_contract" / \
        "article_feedback_request.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


def validate_record(value: Any, *, label: str = "accepted feedback") -> dict:
    if not isinstance(value, dict):
        raise EffectiveFeedbackError(f"{label} must be an object")
    _exact(value, RECORD_FIELDS, label)
    if (type(value["schema_version"]) is not int or value["schema_version"] != 1
            or value["contract"] != "article-feedback-v1"
            or value["status"] != "accepted"):
        raise EffectiveFeedbackError(f"{label} contract is unsupported")
    article_key = _article_key(value["article_key"], f"{label}.article_key")
    task_revision = _positive_int(value["task_revision"], f"{label}.task_revision")
    content_hash = _hash(value["content_sha256"], f"{label}.content_sha256")
    analysis_hash = _hash(value["analysis_sha256"], f"{label}.analysis_sha256",
                          nullable=True)
    registry_hash = _hash(value["target_registry_sha256"],
                          f"{label}.target_registry_sha256")
    url = _text(value["url"], f"{label}.url", 2048)
    try:
        parsed_url = urlparse(url)
        port = parsed_url.port
    except ValueError as exc:
        raise EffectiveFeedbackError(f"{label}.url is invalid") from exc
    if (parsed_url.scheme != "https" or not parsed_url.hostname
            or parsed_url.username is not None or parsed_url.password is not None
            or (port is not None and not 0 < port <= 65535)
            or any(ch.isspace() for ch in url)):
        raise EffectiveFeedbackError(f"{label}.url is invalid")
    source_ids = value["source_submission_ids"]
    if (not isinstance(source_ids, list) or not 1 <= len(source_ids) <= 100
            or any(not isinstance(item, str) or not item or len(item) > 128
                   for item in source_ids)
            or source_ids != sorted(set(source_ids), key=lambda item: item.encode())):
        raise EffectiveFeedbackError(f"{label}.source_submission_ids is invalid")
    source_hashes = value["source_target_registry_sha256s"]
    if (not isinstance(source_hashes, dict) or set(source_hashes) != set(source_ids)):
        raise EffectiveFeedbackError(f"{label} source registry provenance is incomplete")
    for source_id in source_ids:
        _hash(source_hashes[source_id], f"{label}.source registry {source_id}")
    actor = value["operator_actor"]
    if not isinstance(actor, dict):
        raise EffectiveFeedbackError(f"{label}.operator_actor is invalid")
    _exact(actor, {"kind", "id"}, f"{label}.operator_actor")
    if actor.get("kind") != "maintainer":
        raise EffectiveFeedbackError(f"{label}.operator_actor is not a maintainer")
    _text(actor.get("id"), f"{label}.operator_actor.id", 128)
    adjudicated_at = _timestamp(value["adjudicated_at"], f"{label}.adjudicated_at")
    revision = _positive_int(value["revision"], f"{label}.revision")
    operation_id = _text(value["last_operation_id"],
                         f"{label}.last_operation_id", 128)
    if not IDENTIFIER.fullmatch(operation_id):
        raise EffectiveFeedbackError(f"{label}.last_operation_id is invalid")
    explanation = value["public_explanation"]
    if explanation is not None and (not isinstance(explanation, str)
                                    or not explanation or len(explanation) > 600):
        raise EffectiveFeedbackError(f"{label}.public_explanation is invalid")
    request = {
        "schema_version": 1, "article_key": article_key,
        "base_task_revision": task_revision, "content_sha256": content_hash,
        "analysis_sha256": analysis_hash,
        "target_registry_sha256": registry_hash,
        "idempotency_key": "operator-validation-key",
        "turnstile_token": "operator-validation-token", "browser_nonce": None,
        "feedback": value["feedback"],
    }
    errors = validate_schema(_feedback_schema(), request)
    if errors:
        raise EffectiveFeedbackError(
            f"{label}.feedback is invalid: {'; '.join(errors)}")
    normalized = copy.deepcopy(value)
    normalized["adjudicated_at"] = adjudicated_at
    if canonical_sha256(normalized) != canonical_sha256(value):
        raise EffectiveFeedbackError(f"{label} is not normalized")
    return normalized


def load_accepted_feedback(path: Path, *, expected_project_id: str | None = None) \
        -> AcceptedFeedback:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EffectiveFeedbackError(f"cannot read accepted feedback {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EffectiveFeedbackError("accepted feedback snapshot must be an object")
    _exact(value, {"manifest", "records"}, "accepted feedback snapshot")
    manifest, records = value["manifest"], value["records"]
    if not isinstance(manifest, dict):
        raise EffectiveFeedbackError("accepted feedback manifest must be an object")
    _exact(manifest, MANIFEST_FIELDS, "accepted feedback manifest")
    if (type(manifest["schema_version"]) is not int
            or manifest["schema_version"] != 1
            or manifest["snapshot_kind"] !=
            "news-feedback-accepted-adjudications"):
        raise EffectiveFeedbackError("accepted feedback snapshot is unsupported")
    project_id = _text(manifest["project_id"], "accepted feedback project_id", 128)
    if expected_project_id is not None and project_id != expected_project_id:
        raise EffectiveFeedbackError("accepted feedback project_id is wrong")
    _timestamp(manifest["firestore_read_time"], "accepted feedback read time")
    if not isinstance(records, list) or not records:
        raise EffectiveFeedbackError("accepted feedback snapshot must not be empty")
    if (_positive_int(manifest["record_count"], "accepted feedback record_count")
            != len(records) or _hash(manifest["records_sha256"],
                                     "accepted feedback records_sha256")
            != canonical_sha256(records)):
        raise EffectiveFeedbackError("accepted feedback snapshot hash/count mismatch")
    by_article = {}
    prior: bytes | None = None
    for index, raw in enumerate(records):
        record = validate_record(raw, label=f"accepted feedback {index}")
        encoded = record["article_key"].encode("utf-8")
        if prior is not None and prior >= encoded:
            raise EffectiveFeedbackError("accepted feedback is duplicated or unsorted")
        prior = encoded
        by_article[record["article_key"]] = record
    return AcceptedFeedback(copy.deepcopy(manifest), by_article)


def target_index(registries: list[dict]) -> dict[tuple[str, str], dict]:
    """Validate current registries and refuse canonical identity conflicts."""
    output: dict[tuple[str, str], dict] = {}
    for raw in registries:
        registry = validate_registry(raw)
        for target in registry["targets"]:
            key = (target["kind"], target["id"])
            prior = output.get(key)
            if prior and (prior["canonical"], prior["href"]) != (
                    target["canonical"], target["href"]):
                raise EffectiveFeedbackError(
                    f"current target registry conflicts for {key}")
            output[key] = copy.deepcopy(target)
    return output


def _grounding_text(value: Any) -> str:
    return " ".join(unicodedata.normalize(
        "NFKC", str(value or "")).casefold().split())


def _feedback_fields(feedback: dict) -> list[str]:
    fields = []
    for field in ("leaning", "russia_stance"):
        if feedback[field] is not None:
            fields.append(field)
    if any(item["resolution_status"] == "selected"
           for item in feedback["party_tones"]):
        fields.append("party_tones")
    if any(item["resolution_status"] == "selected"
           for item in feedback["link_proposals"]):
        fields.append("entity_links")
    if feedback["issue_kinds"]:
        fields.append("issue_kinds")
    return fields


def validate_feedback_semantics(record: dict, article: dict,
                                targets: dict[tuple[str, str], dict]) -> dict:
    """Ground selected decisions and bind them to the current target universe."""
    feedback = record["feedback"]
    source = _grounding_text("\n".join(
        str(article.get(key) or "")
        for key in ("title", "description", "content")))
    if not source:
        raise EffectiveFeedbackError("accepted feedback article text is unavailable")

    def require_evidence(value: Any, label: str) -> None:
        evidence = _grounding_text(value)
        if not evidence or evidence not in source:
            raise EffectiveFeedbackError(
                f"{label} evidence is not grounded in the article")

    for field in ("leaning", "russia_stance"):
        proposal = feedback[field]
        if proposal is not None:
            require_evidence(proposal["evidence"], field)

    selected_parties = []
    seen_party_ids: set[str] = set()
    for proposal in feedback["party_tones"]:
        if proposal["resolution_status"] != "selected":
            continue
        require_evidence(proposal["evidence"], "party tone")
        party_id = proposal["party_id"]
        if party_id in seen_party_ids:
            raise EffectiveFeedbackError(
                f"accepted feedback repeats selected party {party_id}")
        seen_party_ids.add(party_id)
        target = targets.get(("party", party_id))
        if target is None:
            raise EffectiveFeedbackError(
                "accepted feedback party is absent from current registry")
        selected_parties.append((proposal, target))

    selected_links = []
    seen_surfaces: set[str] = set()
    for proposal in feedback["link_proposals"]:
        if proposal["resolution_status"] != "selected":
            continue
        surface = _grounding_text(proposal["surface"])
        evidence = _grounding_text(proposal["evidence"])
        context = _grounding_text(proposal["context"])
        if not surface or surface not in evidence or evidence not in source:
            raise EffectiveFeedbackError(
                "accepted feedback link surface/evidence is not grounded")
        if not context or context not in source:
            raise EffectiveFeedbackError(
                "accepted feedback link context is not grounded")
        if surface in seen_surfaces:
            raise EffectiveFeedbackError(
                f"accepted feedback repeats selected surface {proposal['surface']!r}")
        seen_surfaces.add(surface)
        reference = proposal["target_ref"]
        if proposal["target_kind"] != reference["kind"]:
            raise EffectiveFeedbackError(
                "accepted feedback link target kinds conflict")
        key = (reference["kind"], reference["id"])
        target = targets.get(key)
        if target is None:
            raise EffectiveFeedbackError(
                f"accepted feedback target is absent from current registry: {key}")
        selected_links.append((proposal, target))
    return {"parties": selected_parties, "links": selected_links}


def _public_provenance(record: dict, *, content_stale: bool,
                       analysis_stale: bool) -> dict:
    feedback = record["feedback"]
    all_fields = _feedback_fields(feedback)
    stale_fields = (all_fields if content_stale else [
        field for field in all_fields if analysis_stale and
        field in ANALYSIS_DEPENDENT_FIELDS])
    fields = [field for field in all_fields if field not in stale_fields]
    return {
        "status": "accepted" if fields else "needs_revalidation",
        "adjudicated_at": record["adjudicated_at"],
        "revision": record["revision"],
        "fields": fields,
        "needs_revalidation_fields": stale_fields,
        "issue_kinds": ([] if "issue_kinds" in stale_fields else
                        copy.deepcopy(feedback["issue_kinds"])),
        "public_explanation": (None if stale_fields else
                               record["public_explanation"]),
    }


def apply_accepted_feedback(base_analysis: dict | None, article: dict,
                            article_key: str, record: dict,
                            targets: dict[tuple[str, str], dict], *,
                            current_analysis_sha256: str | None = None) \
        -> tuple[dict | None, dict]:
    """Return an in-memory analysis overlay and safe public provenance."""
    accepted = validate_record(record)
    expected_feedback_url = f"https://news.electionsbg.com/article/{article_key}"
    if (accepted["article_key"] != article_key or
            accepted["url"] != expected_feedback_url):
        raise EffectiveFeedbackError("accepted feedback article identity differs")
    content = article.get("content")
    if not isinstance(content, str):
        raise EffectiveFeedbackError("accepted feedback article content is unavailable")
    content_stale = content_sha256(content) != accepted["content_sha256"]
    result = copy.deepcopy(base_analysis) if base_analysis is not None else None
    if current_analysis_sha256 is None and base_analysis is not None:
        current_analysis_sha256 = analysis_sha256(base_analysis)
    if current_analysis_sha256 is not None:
        _hash(current_analysis_sha256, "current analysis_sha256")
    analysis_stale = current_analysis_sha256 != accepted["analysis_sha256"]
    provenance = _public_provenance(
        accepted, content_stale=content_stale, analysis_stale=analysis_stale)
    if content_stale:
        return result, provenance

    semantic = validate_feedback_semantics(accepted, article, targets)
    if result is None:
        return result, provenance

    path = result.get("article_path")
    parts = PurePosixPath(str(path or "")).parts
    derived = (f"{result.get('domain')}/{PurePosixPath(parts[-1]).stem}"
               if parts else "")
    if derived != article_key or result.get("url") != article.get("url"):
        raise EffectiveFeedbackError("accepted feedback analysis identity differs")

    feedback = accepted["feedback"]
    for field in ("leaning", "russia_stance"):
        proposal = feedback[field]
        if proposal is not None:
            result[field] = {"label": proposal["label"], "confidence": None,
                             "evidence": proposal["evidence"]}

    tones = copy.deepcopy(result.get("party_tones") or [])
    keyed = {}
    for index, tone in enumerate(tones):
        if not isinstance(tone, dict):
            continue
        key = (f"id:{tone.get('party_id')}" if tone.get("party_id") else
               f"surface:{str(tone.get('party') or '').strip().casefold()}")
        keyed[key] = index
    for proposal, party_target in semantic["parties"]:
        item = {"party": party_target["canonical"],
                "party_id": proposal["party_id"],
                "tone": proposal["tone"], "confidence": None,
                "evidence": proposal["evidence"], "evidence_grounded": True}
        key = f"id:{proposal['party_id']}"
        if key in keyed:
            tones[keyed[key]] = item
        else:
            keyed[key] = len(tones)
            tones.append(item)
    result["party_tones"] = tones

    entities = copy.deepcopy(result.get("entities") or {})
    overrides = {}
    reviewed_links = []
    for proposal, target in ([] if analysis_stale else semantic["links"]):
        reference = proposal["target_ref"]
        surface = proposal["surface"]
        bucket = ENTITY_BUCKETS.get(reference["kind"])
        if bucket is not None:
            names = entities.setdefault(bucket, [])
            if surface not in names:
                names.append(surface)
        link = {field: target[field]
                for field in ("kind", "id", "canonical", "href")}
        if bucket is not None:
            overrides[surface] = {
                **link,
                "kind": "place" if link["kind"] == "settlement"
                else link["kind"],
                "form_kind": "editorial",
            }
        reviewed_links.append({"surface": surface, **link})
    result["entities"] = entities
    if overrides:
        result["_feedback_link_overrides"] = overrides
        result["_feedback_reviewed_links"] = reviewed_links
    result["_feedback_original_analysis_sha256"] = analysis_sha256(base_analysis)
    return result, provenance
