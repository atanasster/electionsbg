#!/usr/bin/env python3
"""Dependency-free validator for the shared news evaluation contract.

The repository's standalone news runtime intentionally has no Python package
dependencies. This module therefore implements the small JSON Schema 2020-12
subset used by the checked-in contract, then adds the task-relative invariants
that JSON Schema cannot express.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from canonical import canonical_json, canonical_sha256


ROOT = Path(__file__).resolve().parent
SCHEMAS = {
    "article_evaluation": ROOT / "article_evaluation.schema.json",
    "submission_request": ROOT / "submission_request.schema.json",
    "event": ROOT / "event.schema.json",
    "dataset_manifest": ROOT / "dataset_manifest.schema.json",
}
CONTRACT = json.loads((ROOT / "contract.json").read_text(encoding="utf-8"))
RFC3339 = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})"
    r"(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$")


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value)


def _type_matches(expected: str, value: Any) -> bool:
    return {
        "null": value is None,
        "boolean": isinstance(value, bool),
        "object": isinstance(value, dict),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "number": _is_number(value),
        "integer": isinstance(value, int) and not isinstance(value, bool),
    }.get(expected, False)


def _pointer(root: dict, reference: str) -> dict:
    if not reference.startswith("#/"):
        raise ValueError(f"only local JSON Schema references are supported: {reference}")
    value: Any = root
    for raw in reference[2:].split("/"):
        key = raw.replace("~1", "/").replace("~0", "~")
        value = value[key]
    if not isinstance(value, dict):
        raise ValueError(f"schema reference does not resolve to an object: {reference}")
    return value


def _format_matches(name: str, value: str) -> bool:
    if name == "uri":
        if any(character.isspace() for character in value):
            return False
        try:
            parsed = urlparse(value)
            port = parsed.port
        except ValueError:
            return False
        return bool(
            parsed.scheme in {"http", "https"}
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and (port is None or 0 < port <= 65535)
        )
    if name == "date-time":
        match = RFC3339.fullmatch(value)
        if match is None:
            return False
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return parsed.tzinfo is not None
    return True


def validate_schema(schema: dict, value: Any, *, root: dict | None = None,
                    path: str = "$") -> list[str]:
    """Return stable human-readable errors for the contract's schema subset."""
    root = root or schema
    errors: list[str] = []

    if "$ref" in schema:
        errors.extend(validate_schema(_pointer(root, schema["$ref"]), value,
                                      root=root, path=path))

    if "allOf" in schema:
        for child in schema["allOf"]:
            errors.extend(validate_schema(child, value, root=root, path=path))
    if "anyOf" in schema and not any(
            not validate_schema(child, value, root=root, path=path)
            for child in schema["anyOf"]):
        errors.append(f"{path}: no anyOf branch matched")
    if "not" in schema and not validate_schema(schema["not"], value,
                                                root=root, path=path):
        errors.append(f"{path}: forbidden schema matched")

    condition = schema.get("if")
    if isinstance(condition, dict):
        branch = "then" if not validate_schema(condition, value, root=root,
                                                path=path) else "else"
        if isinstance(schema.get(branch), dict):
            errors.extend(validate_schema(schema[branch], value, root=root,
                                          path=path))

    expected_type = schema.get("type")
    if expected_type is not None:
        allowed = [expected_type] if isinstance(expected_type, str) else expected_type
        if not any(_type_matches(item, value) for item in allowed):
            errors.append(f"{path}: expected {'|'.join(allowed)}")
            return errors

    if "const" in schema and not _json_equal(value, schema["const"]):
        errors.append(f"{path}: expected const {schema['const']!r}")
    if "enum" in schema and not any(
            _json_equal(value, item) for item in schema["enum"]):
        errors.append(f"{path}: value is outside enum")

    if isinstance(value, dict):
        required = schema.get("required") or []
        for key in required:
            if key not in value:
                errors.append(f"{path}.{key}: required")
        properties = schema.get("properties") or {}
        for key, child in properties.items():
            if key in value:
                errors.extend(validate_schema(child, value[key], root=root,
                                              path=f"{path}.{key}"))
        if schema.get("additionalProperties") is False:
            for key in value.keys() - properties.keys():
                errors.append(f"{path}.{key}: additional property")
        elif isinstance(schema.get("additionalProperties"), dict):
            child = schema["additionalProperties"]
            for key in value.keys() - properties.keys():
                errors.extend(validate_schema(child, value[key], root=root,
                                              path=f"{path}.{key}"))

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: too many items")
        if schema.get("uniqueItems"):
            normalized = [_stable_json(item) for item in value]
            if len(normalized) != len(set(normalized)):
                errors.append(f"{path}: duplicate items")
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                errors.extend(validate_schema(schema["items"], item, root=root,
                                              path=f"{path}[{index}]"))
        if isinstance(schema.get("contains"), dict) and not any(
                not validate_schema(schema["contains"], item, root=root,
                                    path=f"{path}[*]") for item in value):
            errors.append(f"{path}: contains condition not met")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: string too short")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: string too long")
        if "pattern" in schema and re.search(schema["pattern"], value) is None:
            errors.append(f"{path}: pattern mismatch")
        if "format" in schema and not _format_matches(schema["format"], value):
            errors.append(f"{path}: invalid {schema['format']}")

    if _is_number(value):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: above maximum")
    return errors


def _stable_json(value: Any) -> str:
    return canonical_json(value)


def _json_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if _is_number(left) and _is_number(right):
        return left == right
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, str) or isinstance(right, str):
        return isinstance(left, str) and isinstance(right, str) and left == right
    if isinstance(left, list) or isinstance(right, list):
        return (isinstance(left, list) and isinstance(right, list)
                and len(left) == len(right)
                and all(_json_equal(a, b) for a, b in zip(left, right)))
    if isinstance(left, dict) or isinstance(right, dict):
        return (isinstance(left, dict) and isinstance(right, dict)
                and left.keys() == right.keys()
                and all(_json_equal(left[key], right[key]) for key in left))
    return False


def _sha256_json(value: Any) -> str:
    return canonical_sha256(value)


def _party_key(value: dict) -> str:
    party_id = value.get("party_id")
    if party_id:
        return f"id:{party_id}"
    surface = unicodedata.normalize(
        "NFC", str(value.get("party") or "").strip().lower())
    return f"surface:{surface}"


def _party_completeness_codes(evaluation: dict, task: dict) -> set[str]:
    codes: set[str] = set()
    model = (task.get("model_labels") or {}).get("party_tones") or []
    model_keys = {_party_key(item) for item in model}
    retained: set[str] = set()
    for item in evaluation.get("party_tones") or []:
        key = _party_key(item)
        if key in retained:
            codes.add("duplicate_party")
        retained.add(key)
    removed: set[str] = set()
    for item in evaluation.get("removed_model_parties") or []:
        key = _party_key(item)
        if key in removed:
            codes.add("duplicate_removed_party")
        removed.add(key)
        if key not in model_keys:
            codes.add("unknown_removed_party")
    if retained & removed:
        codes.add("party_retained_removed_overlap")
    if model_keys - retained - removed:
        codes.add("unaccounted_model_party")
    return codes


def _reason_scope_codes(evaluation: dict) -> set[str]:
    codes: set[str] = set()
    registry = CONTRACT["reason_codes"]
    for field in ("leaning", "russia_stance"):
        for reason in (evaluation.get(field) or {}).get("reason_codes") or []:
            if reason not in registry or field not in registry[reason]["scopes"]:
                codes.add("invalid_reason_scope")
    for item in evaluation.get("party_tones") or []:
        for reason in item.get("reason_codes") or []:
            if reason not in registry or "party_tones" not in registry[reason]["scopes"]:
                codes.add("invalid_reason_scope")
    return codes


def _evaluation_semantics(value: dict, task: dict) -> tuple[list[str], bool]:
    codes = _reason_scope_codes(value)
    codes.update(_party_completeness_codes(value, task))
    model = task.get("model_labels") or {}
    for field in ("leaning", "russia_stance"):
        decision = value.get(field) or {}
        label = decision.get("label")
        expected = ("unable_to_judge" if label is None else
                    "confirmed" if label == model.get(field) else "changed")
        if decision.get("disposition") != expected:
            codes.add("invalid_disposition")

    model_parties = {_party_key(item): item for item in model.get("party_tones") or []}
    for item in value.get("party_tones") or []:
        key = _party_key(item)
        original = model_parties.get(key)
        expected = ("added" if original is None else
                    "confirmed" if original.get("tone") == item.get("tone") else "changed")
        if item.get("disposition") != expected:
            codes.add("invalid_disposition")

    gold_eligible = all(
        (value.get(field) or {}).get("disposition") != "unable_to_judge"
        for field in ("leaning", "russia_stance")
    ) and value.get("parties_confirmed_complete") is True
    return sorted(codes), gold_eligible


def _submission_semantics(value: dict, task: dict) -> list[str]:
    evaluation = value.get("evaluation") or {}
    codes = _reason_scope_codes(evaluation)
    codes.update(_party_completeness_codes(evaluation, task))
    if value.get("article_key") != task.get("article_key"):
        codes.add("article_key_conflict")
    if value.get("base_task_revision") != task.get("revision"):
        codes.add("task_revision_conflict")
    if value.get("content_sha256") != task.get("content_sha256"):
        codes.add("stale_content")
    if value.get("analysis_sha256") != task.get("analysis_sha256"):
        codes.add("stale_analysis")
    return sorted(codes)


def _event_semantics(value: dict) -> list[str]:
    codes: set[str] = set()
    action = value.get("action")
    target = value.get("target") or {}
    submission_actions = {
        "submission_quarantined", "submission_reviewed", "submission_rejected"
    }
    adjudication_actions = {
        "adjudication_accepted", "adjudication_deferred",
        "adjudication_superseded", "adjudication_stale",
    }
    expected_kind = ("submission" if action in submission_actions else
                     "adjudication" if action in adjudication_actions else
                     "dataset" if action == "gold_promoted" else None)
    article_key = target.get("article_key")
    if (expected_kind and target.get("kind") != expected_kind) or (
            expected_kind == "dataset" and article_key is not None) or (
            expected_kind in {"submission", "adjudication"} and not article_key):
        codes.add("invalid_action_target")
    if value.get("before_sha256") is None and value.get("after_sha256") is None:
        codes.add("missing_state_hash")
    return sorted(codes)


def _manifest_semantics(value: dict, records: list | None) -> list[str]:
    codes: set[str] = set()
    groups: dict[str, str] = {}
    entries = value.get("entries") or []
    entry_keys: set[str] = set()
    for entry in entries:
        article_key = entry.get("article_key")
        if isinstance(article_key, str):
            if article_key in entry_keys:
                codes.add("duplicate_manifest_entry")
            entry_keys.add(article_key)
        group = entry.get("group_id")
        if not group:
            codes.add("missing_group_id")
            continue
        split = entry.get("split")
        if group in groups and groups[group] != split:
            codes.add("group_split_leakage")
        groups[group] = split
    if records is not None:
        try:
            if value.get("records_sha256") != _sha256_json(records):
                codes.add("records_hash_mismatch")
        except (TypeError, ValueError):
            codes.add("noncanonical_record_number")
        statistics = value.get("label_statistics") or {}
        if statistics.get("total_records") != len(records):
            codes.add("statistics_mismatch")
        if len(entries) != len(records):
            codes.add("record_count_mismatch")
        record_keys: set[str] = set()
        for index, record in enumerate(records):
            record_key = (record.get("article_key")
                          if isinstance(record, dict) else None)
            if isinstance(record_key, str):
                if record_key in record_keys:
                    codes.add("duplicate_dataset_record")
                record_keys.add(record_key)
            if index >= len(entries) or not isinstance(record, dict):
                continue
            entry = entries[index]
            if record_key != entry.get("article_key"):
                codes.add("record_entry_mismatch")
            for field in ("content_sha256", "analysis_sha256"):
                if field in record and record.get(field) != entry.get(field):
                    codes.add("record_entry_mismatch")
        if records and all(isinstance(record, dict)
                           and isinstance(record.get("evaluation"), dict)
                           for record in records):
            expected = _label_statistics(records)
            if not _json_equal(statistics, expected):
                codes.add("statistics_mismatch")
    return sorted(codes)


def _label_statistics(records: list[dict]) -> dict:
    result = {
        "total_records": len(records),
        "leaning": {"label_counts": {}, "missing_count": 0,
                    "unable_to_judge_count": 0},
        "russia_stance": {"label_counts": {}, "missing_count": 0,
                          "unable_to_judge_count": 0},
        "party_tones": {"label_counts": {}, "missing_count": 0,
                        "unable_to_judge_count": 0},
    }
    for record in records:
        evaluation = record["evaluation"]
        for field in ("leaning", "russia_stance"):
            decision = evaluation.get(field)
            if not isinstance(decision, dict):
                result[field]["missing_count"] += 1
            elif decision.get("disposition") == "unable_to_judge":
                result[field]["unable_to_judge_count"] += 1
            else:
                label = decision.get("label")
                counts = result[field]["label_counts"]
                counts[label] = counts.get(label, 0) + 1
        parties = evaluation.get("party_tones")
        if not isinstance(parties, list):
            result["party_tones"]["missing_count"] += 1
        else:
            counts = result["party_tones"]["label_counts"]
            for item in parties:
                tone = item.get("tone")
                counts[tone] = counts.get(tone, 0) + 1
    return result


def validate_fixture(fixture: dict) -> dict:
    target = fixture["schema_target"]
    schema = json.loads(SCHEMAS[target].read_text(encoding="utf-8"))
    value = fixture["value"]
    schema_errors = validate_schema(schema, value)
    semantic_codes: list[str]
    gold_eligible = False
    if target == "article_evaluation":
        semantic_codes, gold_eligible = _evaluation_semantics(
            value, fixture.get("task") or {})
        if not gold_eligible:
            semantic_codes = sorted(set(semantic_codes) | {"incomplete_for_gold"})
    elif target == "submission_request":
        semantic_codes = _submission_semantics(value, fixture.get("task") or {})
    elif target == "event":
        semantic_codes = _event_semantics(value)
    else:
        semantic_codes = _manifest_semantics(value, fixture.get("records"))
    semantic_blockers = [code for code in semantic_codes if code != "incomplete_for_gold"]
    gold_eligible = gold_eligible and not schema_errors and not semantic_blockers
    return {
        "id": fixture["id"],
        "schema_valid": not schema_errors,
        "semantic_valid": not semantic_blockers,
        "gold_eligible": gold_eligible,
        "error_codes": semantic_codes,
    }


def validate_fixtures() -> list[dict]:
    fixture_root = ROOT / "fixtures"
    manifest = json.loads((fixture_root / "manifest.json").read_text(encoding="utf-8"))
    return [validate_fixture(json.loads((fixture_root / name).read_text(encoding="utf-8")))
            for name in manifest["cases"]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if not args.fixtures:
        parser.error("--fixtures is required")
    result = validate_fixtures()
    if args.json:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
