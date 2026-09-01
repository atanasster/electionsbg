#!/usr/bin/env python3
"""Validate blinded, independent and reconciled entity/link benchmark v2."""

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(os.environ.get("DATA_BG_ROOT") or Path(__file__).resolve().parents[2])
sys.path.insert(0, str(ROOT))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from news.eval_contract.canonical import canonical_json, canonical_sha256  # noqa: E402
from score_analyses import (ENTITY_LINK_KINDS,  # noqa: E402
                            MIN_ENTITY_LINK_KIND_LINKS,
                            MIN_ENTITY_LINK_KIND_MENTIONS,
                            entity_link_items, normalize_entity_surface,
                            score_entity_links)
from build_entity_link_eval import grounding_sha256  # noqa: E402

MIN_ARTICLES = 100
MIN_INDEPENDENT_MENTIONS = 100
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@+-]{7,127}$")
SUPPLEMENT_FIELDS = {
    "schema_version", "benchmark", "version", "generated_at", "seed",
    "blinded_run_id", "target_registry_sha256", "requested_size",
    "actual_size", "articles"}
BINDING_FIELDS = {"blind_id", "path", "url", "grounding_sha256"}
RECORD_FIELDS = {
    "schema_version", "benchmark", "blind_id", "url", "article_path",
    "grounding_sha256", "target_registry_sha256", "entity_links_version",
    "entity_links_complete", "entity_links"}
ITEM_FIELDS = {"kind", "surface", "target_id", "evidence"}
MANIFEST_FIELDS = {
    "schema_version", "benchmark", "package_id", "role", "adjudicator_id",
    "blinded_run_id", "created_at", "supplement_sha256",
    "target_registry_sha256", "record_count", "records_sha256"}
RECONCILIATION_FIELDS = {
    "schema_version", "benchmark", "reconciliation_id", "blinded_run_id",
    "original_primary_package_id", "final_primary_package_id",
    "independent_package_id", "target_registry_sha256",
    "created_at", "actor_id", "status", "disagreement_count",
    "disagreements_sha256", "decisions", "original_primary_records_sha256",
    "final_primary_records_sha256"}
DECISION_FIELDS = {
    "url", "kind", "surface_key", "disposition", "explanation",
    "primary_present", "primary_target_id", "independent_present",
    "independent_target_id", "resolved_present", "resolved_target_id"}


def _exact(value: dict, fields: set[str], label: str) -> None:
    if set(value) != fields:
        raise ValueError(f"{label}_fields")


def _timestamp(value, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label}_timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label}_timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label}_timestamp")
    return value


def _grounding_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def valid_v2_entity_link_contract(row: dict, article: dict | None = None) -> bool:
    try:
        _exact(row, RECORD_FIELDS, "entity_link_record")
    except (TypeError, ValueError):
        return False
    if row.get("schema_version") != 1 or \
            row.get("benchmark") != "news-entity-links-v2" or \
            row.get("entity_links_version") != 2 or \
            row.get("entity_links_complete") is not True:
        return False
    labels = row.get("entity_links")
    if not isinstance(labels, list):
        return False
    seen = set()
    source = ""
    if article is not None:
        source = _grounding_text("\n".join(str(article.get(key) or "")
                                            for key in ("title", "description",
                                                        "content")))
    for item in labels:
        if not isinstance(item, dict) or set(item) != ITEM_FIELDS:
            return False
        kind = item.get("kind")
        surface = normalize_entity_surface(item.get("surface"))
        target = item.get("target_id")
        evidence = item.get("evidence")
        if kind not in ENTITY_LINK_KINDS or not surface or len(surface) > 240 or \
                (target is not None and
                 (not isinstance(target, str) or not target.strip() or
                  len(target) > 240)) or \
                not isinstance(evidence, str) or not evidence.strip() or \
                len(evidence) > 600:
            return False
        key = (kind, surface)
        if key in seen:
            return False
        seen.add(key)
        normalized_evidence = _grounding_text(evidence)
        if surface not in normalized_evidence:
            return False
        if article is not None and normalized_evidence not in source:
            return False
    parsed, duplicates, malformed = entity_link_items(row, reference=True)
    return len(parsed) == len(labels) and not duplicates and not malformed


def load_supplement(path: Path) -> dict:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable_entity_link_supplement:{exc}") from exc
    if not isinstance(document, dict):
        raise ValueError("invalid_entity_link_supplement_shape")
    _exact(document, SUPPLEMENT_FIELDS, "entity_link_supplement")
    articles = document.get("articles")
    if document.get("schema_version") != 1 or \
            document.get("benchmark") != "news-entity-links-v2" or \
            document.get("version") != 2 or not isinstance(articles, list):
        raise ValueError("invalid_entity_link_supplement_shape")
    _timestamp(document.get("generated_at"), "supplement")
    if len(articles) < MIN_ARTICLES or \
            document.get("requested_size") != len(articles) or \
            document.get("actual_size") != len(articles):
        raise ValueError("entity_link_supplement_below_minimum_or_count_mismatch")
    for item in articles:
        if not isinstance(item, dict):
            raise ValueError("entity_link_supplement_bad_article")
        _exact(item, BINDING_FIELDS, "entity_link_binding")
    if len({item["url"] for item in articles}) != len(articles) or \
            len({item["blind_id"] for item in articles}) != len(articles):
        raise ValueError("entity_link_supplement_duplicate_identity")
    return document


def _target_registry(path: Path, expected_hash: str) -> set[tuple[str, str]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        targets = document["targets"]
        if document.get("version") != 1 or \
                document.get("target_count") != len(targets) or \
                document.get("targets_sha256") != canonical_sha256(targets) or \
                document.get("targets_sha256") != expected_hash:
            raise ValueError("integrity")
        return {(item["kind"], item["id"]) for item in targets}
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise ValueError("entity_link_target_registry_unavailable_or_drifted") from exc


def _selected_articles(supplement: dict) -> dict:
    selected = {}
    for item in supplement["articles"]:
        path, url = item["path"], item["url"]
        if not all(isinstance(value, str) and value for value in
                   (path, url, item["blind_id"], item["grounding_sha256"])) or \
                not path.startswith("news/data/"):
            raise ValueError("entity_link_supplement_missing_binding")
        try:
            article = json.loads((ROOT / path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"entity_link_article_unreadable:{path}") from exc
        if article.get("url") != url or \
                grounding_sha256(article) != item["grounding_sha256"]:
            raise ValueError(f"entity_link_article_changed:{path}")
        selected[url] = {"article": article, **item}
    return selected


def _strict_package(directory: Path, role: str, selected: dict,
                    supplement: dict, canonical_targets: set[tuple[str, str]]) \
        -> tuple[dict, dict]:
    try:
        manifest = json.loads((directory / "_manifest.json").read_text(
            encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{role}_manifest_unreadable") from exc
    if not isinstance(manifest, dict):
        raise ValueError(f"{role}_manifest_shape")
    _exact(manifest, MANIFEST_FIELDS, f"{role}_manifest")
    if manifest.get("schema_version") != 1 or \
            manifest.get("benchmark") != "news-entity-links-v2" or \
            manifest.get("role") != role or \
            manifest.get("blinded_run_id") != supplement["blinded_run_id"] or \
            manifest.get("supplement_sha256") != canonical_sha256(supplement) or \
            manifest.get("target_registry_sha256") != \
            supplement["target_registry_sha256"] or \
            not isinstance(manifest.get("package_id"), str) or \
            not IDENTIFIER.fullmatch(manifest["package_id"]) or \
            not isinstance(manifest.get("adjudicator_id"), str) or \
            not IDENTIFIER.fullmatch(manifest["adjudicator_id"]):
        raise ValueError(f"{role}_manifest_binding")
    _timestamp(manifest.get("created_at"), f"{role}_manifest")
    files = sorted(path for path in directory.rglob("*.json")
                   if path.name != "_manifest.json")
    rows, duplicate_urls = {}, set()
    for path in files:
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"{role}_record_unreadable:{path.name}") from exc
        if not isinstance(row, dict) or not isinstance(row.get("url"), str):
            raise ValueError(f"{role}_record_shape:{path.name}")
        if row["url"] in rows:
            duplicate_urls.add(row["url"])
        rows[row["url"]] = row
    if duplicate_urls:
        raise ValueError(f"{role}_duplicate_urls:{len(duplicate_urls)}")
    if set(rows) != set(selected):
        raise ValueError(f"{role}_selected_article_set_mismatch")
    invalid = []
    unknown = []
    for url, binding in selected.items():
        row = rows[url]
        if row.get("blind_id") != binding["blind_id"] or \
                row.get("article_path") != binding["path"] or \
                row.get("grounding_sha256") != binding["grounding_sha256"] or \
                row.get("target_registry_sha256") != \
                supplement["target_registry_sha256"] or \
                not valid_v2_entity_link_contract(row, binding["article"]):
            invalid.append(url)
            continue
        for (kind, _surface), target in entity_link_items(
                row, reference=True)[0].items():
            if target is not None and (kind, target) not in canonical_targets:
                unknown.append((url, kind, target))
    if invalid:
        raise ValueError(f"{role}_invalid_entity_link_labels:{len(invalid)}")
    if unknown:
        raise ValueError(f"{role}_unknown_canonical_targets:{len(unknown)}")
    normalized_records = [rows[url] for url in sorted(rows)]
    if manifest.get("record_count") != len(normalized_records) or \
            manifest.get("records_sha256") != canonical_sha256(normalized_records):
        raise ValueError(f"{role}_manifest_records_mismatch")
    return manifest, rows


def _disagreements(primary: dict, independent: dict) -> list[dict]:
    output = []
    for url in sorted(primary):
        left = entity_link_items(primary[url], reference=True)[0]
        right = entity_link_items(independent[url], reference=True)[0]
        for key in sorted(set(left) | set(right)):
            if key in left and key in right and left[key] == right[key]:
                continue
            kind, surface_key = key
            output.append({
                "url": url, "kind": kind, "surface_key": surface_key,
                "primary_present": key in left,
                "primary_target_id": left.get(key),
                "independent_present": key in right,
                "independent_target_id": right.get(key),
            })
    return output


def _validate_reconciliation(path: Path, supplement: dict,
                             original_primary_manifest: dict,
                             final_primary_manifest: dict,
                             independent_manifest: dict,
                             disagreements: list[dict],
                             original_primary: dict,
                             final_primary: dict) -> dict:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("entity_link_reconciliation_unreadable") from exc
    if not isinstance(document, dict):
        raise ValueError("entity_link_reconciliation_shape")
    _exact(document, RECONCILIATION_FIELDS, "entity_link_reconciliation")
    if document.get("schema_version") != 1 or \
            document.get("benchmark") != "news-entity-links-v2" or \
            document.get("status") != "resolved_and_rechecked" or \
            document.get("blinded_run_id") != supplement["blinded_run_id"] or \
            document.get("original_primary_package_id") != \
            original_primary_manifest["package_id"] or \
            document.get("final_primary_package_id") != \
            final_primary_manifest["package_id"] or \
            document.get("independent_package_id") != \
            independent_manifest["package_id"] or \
            document.get("target_registry_sha256") != \
            supplement["target_registry_sha256"] or \
            document.get("original_primary_records_sha256") != \
            original_primary_manifest["records_sha256"] or \
            document.get("final_primary_records_sha256") != \
            final_primary_manifest["records_sha256"] or \
            not isinstance(document.get("reconciliation_id"), str) or \
            not IDENTIFIER.fullmatch(document["reconciliation_id"]) or \
            not isinstance(document.get("actor_id"), str) or \
            not IDENTIFIER.fullmatch(document["actor_id"]):
        raise ValueError("entity_link_reconciliation_binding")
    _timestamp(document.get("created_at"), "entity_link_reconciliation")
    if document.get("disagreement_count") != len(disagreements) or \
            document.get("disagreements_sha256") != canonical_sha256(disagreements):
        raise ValueError("entity_link_reconciliation_disagreement_hash")
    decisions = document.get("decisions")
    if not isinstance(decisions, list):
        raise ValueError("entity_link_reconciliation_decisions")
    expected = {(row["url"], row["kind"], row["surface_key"]): row
                for row in disagreements}
    actual = set()
    resolved = {}
    for decision in decisions:
        if not isinstance(decision, dict):
            raise ValueError("entity_link_reconciliation_decision_shape")
        _exact(decision, DECISION_FIELDS, "entity_link_reconciliation_decision")
        key = (decision.get("url"), decision.get("kind"),
               decision.get("surface_key"))
        disagreement = expected.get(key)
        if decision.get("disposition") not in {
                "primary_confirmed", "primary_amended"} or \
                not isinstance(decision.get("explanation"), str) or \
                not decision["explanation"].strip() or \
                not isinstance(decision.get("resolved_present"), bool) or \
                (decision.get("resolved_target_id") is not None and
                 not isinstance(decision.get("resolved_target_id"), str)) or \
                (not decision.get("resolved_present") and
                 decision.get("resolved_target_id") is not None) or \
                disagreement is None or any(
                    decision.get(field) != disagreement[field]
                    for field in ("primary_present", "primary_target_id",
                                  "independent_present",
                                  "independent_target_id")):
            raise ValueError("entity_link_reconciliation_decision_value")
        original_value = (decision["primary_present"],
                          decision["primary_target_id"])
        resolved_value = (decision["resolved_present"],
                          decision["resolved_target_id"])
        if (decision["disposition"] == "primary_confirmed") != \
                (resolved_value == original_value):
            raise ValueError("entity_link_reconciliation_disposition_mismatch")
        actual.add(key)
        resolved[key] = resolved_value
    if actual != set(expected) or len(decisions) != len(expected):
        raise ValueError("entity_link_reconciliation_incomplete")
    # The final primary must be exactly the original semantic label set with
    # the enumerated decisions applied. This makes the before/after transition
    # independently reproducible and prevents undeclared amendments.
    for url in original_primary:
        before = entity_link_items(original_primary[url], reference=True)[0]
        after = entity_link_items(final_primary[url], reference=True)[0]
        projected = dict(before)
        for (decision_url, kind, surface), (present, target) in resolved.items():
            if decision_url != url:
                continue
            key = (kind, surface)
            if present:
                projected[key] = target
            else:
                projected.pop(key, None)
        if projected != after:
            raise ValueError("entity_link_reconciliation_final_primary_mismatch")
    return document


def validate(supplement_path: Path, primary_dir: Path,
             independent_dir: Path | None = None,
             reconciliation_path: Path | None = None,
             target_registry_path: Path | None = None,
             original_primary_dir: Path | None = None) -> dict:
    supplement = load_supplement(supplement_path)
    registry_path = target_registry_path or (
        ROOT / "news" / "app-data" / "feedback-targets.json")
    canonical_targets = _target_registry(
        registry_path, supplement["target_registry_sha256"])
    selected = _selected_articles(supplement)
    primary_manifest, primary = _strict_package(
        primary_dir, "primary", selected, supplement, canonical_targets)
    kind_support = {kind: {"mentions": 0, "linked_targets": 0}
                    for kind in ENTITY_LINK_KINDS}
    for row in primary.values():
        for (kind, _surface), target in entity_link_items(
                row, reference=True)[0].items():
            kind_support[kind]["mentions"] += 1
            kind_support[kind]["linked_targets"] += int(target is not None)
    insufficient = {kind: value for kind, value in kind_support.items()
                    if value["mentions"] < MIN_ENTITY_LINK_KIND_MENTIONS or
                    value["linked_targets"] < MIN_ENTITY_LINK_KIND_LINKS}
    if insufficient:
        raise ValueError("primary_entity_link_kind_support_below_minimum")
    result = {
        "benchmark_version": 2,
        "blinded_run_id": supplement["blinded_run_id"],
        "target_registry_sha256": supplement["target_registry_sha256"],
        "supplement_sha256": canonical_sha256(supplement),
        "selected_articles": len(selected),
        "primary_package_id": primary_manifest["package_id"],
        "primary_adjudicator_id": primary_manifest["adjudicator_id"],
        "primary_records_sha256": primary_manifest["records_sha256"],
        "kind_support": kind_support,
        "independent_required_for_release": True,
        "release_ready": False,
    }
    if independent_dir is None:
        return result
    if original_primary_dir is None:
        raise ValueError("entity_link_original_primary_required")
    original_primary_manifest, original_primary = _strict_package(
        original_primary_dir, "original_primary", selected, supplement,
        canonical_targets)
    independent_manifest, independent = _strict_package(
        independent_dir, "independent", selected, supplement, canonical_targets)
    package_ids = {original_primary_manifest["package_id"],
                   primary_manifest["package_id"],
                   independent_manifest["package_id"]}
    if len(package_ids) != 3 or \
            independent_manifest["adjudicator_id"] == \
            original_primary_manifest["adjudicator_id"]:
        raise ValueError("entity_link_adjudicators_or_packages_not_independent")
    comparable = sum(len(set(entity_link_items(
                         original_primary[url], reference=True)[0]) &
                         set(entity_link_items(independent[url], reference=True)[0]))
                     for url in selected)
    if comparable < MIN_INDEPENDENT_MENTIONS:
        raise ValueError("independent_entity_link_mentions_below_minimum")
    disagreements = _disagreements(original_primary, independent)
    if reconciliation_path is None:
        raise ValueError("entity_link_reconciliation_required")
    reconciliation = _validate_reconciliation(
        reconciliation_path, supplement, original_primary_manifest,
        primary_manifest, independent_manifest, disagreements,
        original_primary, primary)
    independent_hypothesis = {url: {"url": url, "mentions": [
        {"kind": item["kind"], "surface": item["surface"],
         "id": item["target_id"]} for item in row["entity_links"]]}
        for url, row in independent.items()}
    result.update({
        "independent_package_id": independent_manifest["package_id"],
        "independent_adjudicator_id": independent_manifest["adjudicator_id"],
        "independent_records_sha256": independent_manifest["records_sha256"],
        "original_primary_package_id": original_primary_manifest["package_id"],
        "original_primary_records_sha256":
            original_primary_manifest["records_sha256"],
        "independent_comparable_mentions": comparable,
        "independent_agreement": score_entity_links(
            primary, independent_hypothesis),
        "disagreement_count": len(disagreements),
        "reconciliation_id": reconciliation["reconciliation_id"],
        "release_ready": True,
    })
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--supplement", required=True)
    parser.add_argument("--original-primary")
    parser.add_argument("--primary", required=True)
    parser.add_argument("--independent")
    parser.add_argument("--reconciliation")
    parser.add_argument("--target-registry")
    args = parser.parse_args()
    try:
        result = validate(
            Path(args.supplement), Path(args.primary),
            Path(args.independent) if args.independent else None,
            Path(args.reconciliation) if args.reconciliation else None,
            Path(args.target_registry) if args.target_registry else None,
            Path(args.original_primary) if args.original_primary else None)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2
    print(canonical_json(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
