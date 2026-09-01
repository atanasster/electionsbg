#!/usr/bin/env python3
"""Tests for blinded entity/link benchmark-v2 selection, validation and scoring."""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import benchmark_entity_links as benchmark  # noqa: E402
import build_entity_link_eval as builder  # noqa: E402
import validate_entity_link_reference as validator  # noqa: E402
from news.eval_contract.canonical import canonical_sha256  # noqa: E402
from news.eval_contract.validate import validate_schema  # noqa: E402
from score_analyses import (ENTITY_LINK_KINDS,  # noqa: E402
                            entity_link_release_gate_results,
                            score_entity_links)

NOW = "2026-09-01T10:00:00+00:00"
REGISTRY_IDS = {
    "person": "p1", "party": "party1", "institution": "i1",
    "company": "c1", "settlement": "68134", "sector": "energy"}
SURFACES = {
    "person": "Иван", "party": "Партия", "institution": "Институция",
    "company": "Компания", "settlement": "София", "sector": "Енергетика"}
CONTENT = "Иван Партия Институция Компания София Енергетика"


def label(kind, index=0, linked=True):
    surface = f"{SURFACES[kind]} {index}"
    return {"kind": kind, "surface": surface,
            "target_id": REGISTRY_IDS[kind] if linked else None,
            "evidence": surface}


def scoring_reference(url, links):
    return {"url": url, "entity_links_version": 2,
            "entity_links_complete": True, "entity_links": links}


def hypothesis_from_reference(row):
    return {"url": row["url"], "mentions": [
        {"kind": item["kind"], "surface": item["surface"],
         "id": item["target_id"]} for item in row["entity_links"]]}


def perfect_scoring_set(per_kind=5, include_empty=False):
    links = [label(kind, index, linked=index < 3)
             for kind in ENTITY_LINK_KINDS for index in range(per_kind)]
    reference = {"u": scoring_reference("u", links)}
    hypothesis = {"u": hypothesis_from_reference(reference["u"])}
    if include_empty:
        reference["empty"] = scoring_reference("empty", [])
    return reference, hypothesis


def write_package(root: Path):
    data = root / "news" / "data" / "example.bg"
    data.mkdir(parents=True)
    app_data = root / "news" / "app-data"
    app_data.mkdir(parents=True)
    targets = [{"kind": kind, "id": ident}
               for kind, ident in REGISTRY_IDS.items()]
    registry = {"version": 1, "generated_at": NOW,
                "target_count": len(targets),
                "targets_sha256": canonical_sha256(targets),
                "targets": targets}
    registry_path = app_data / "feedback-targets.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    selected = []
    articles = {}
    for index in range(100):
        url = f"https://example.bg/{index}"
        article = {"url": url, "title": CONTENT, "description": "",
                   "content": CONTENT}
        relative = f"news/data/example.bg/{index}.json"
        (data / f"{index}.json").write_text(
            json.dumps(article, ensure_ascii=False), encoding="utf-8")
        selected.append({"path": relative, "url": url,
                         "grounding_sha256": builder.grounding_sha256(article),
                         "drawn_for": "private", "sampling_signals": []})
        articles[url] = article
    supplement, blinded_run_id = builder.build_manifest(
        selected, seed="test-seed", generated_at=NOW,
        registry_hash=registry["targets_sha256"])
    supplement_path = root / "supplement.json"
    supplement_path.write_text(json.dumps(supplement, ensure_ascii=False),
                               encoding="utf-8")
    original_primary = root / "original-primary"
    primary = root / "primary"
    independent = root / "independent"
    candidate = root / "candidate"
    original_primary.mkdir()
    primary.mkdir()
    independent.mkdir()
    candidate.mkdir()
    records = {"original_primary": [], "primary": [], "independent": []}
    for binding in supplement["articles"]:
        links = [{"kind": kind, "surface": SURFACES[kind],
                  "target_id": REGISTRY_IDS[kind], "evidence": SURFACES[kind]}
                 for kind in ENTITY_LINK_KINDS]
        row = {
            "schema_version": 1, "benchmark": "news-entity-links-v2",
            "blind_id": binding["blind_id"], "url": binding["url"],
            "article_path": binding["path"],
            "grounding_sha256": binding["grounding_sha256"],
            "target_registry_sha256": registry["targets_sha256"],
            "entity_links_version": 2, "entity_links_complete": True,
            "entity_links": links}
        name = binding["url"].rsplit("/", 1)[1] + ".json"
        for role, directory in (("original_primary", original_primary),
                                ("primary", primary),
                                ("independent", independent)):
            directory.joinpath(name).write_text(
                json.dumps(row, ensure_ascii=False), encoding="utf-8")
            records[role].append(row)
        candidate.joinpath(name).write_text(json.dumps({
            "url": binding["url"], "article_path": binding["path"],
            "mentions": [{"kind": item["kind"], "surface": item["surface"],
                          "id": item["target_id"]} for item in links]},
            ensure_ascii=False), encoding="utf-8")
    manifests = {}
    for role, directory, adjudicator in (
            ("original_primary", original_primary, "adjudicator-primary"),
            ("primary", primary, "adjudicator-primary"),
            ("independent", independent, "adjudicator-independent")):
        manifest = {
            "schema_version": 1, "benchmark": "news-entity-links-v2",
            "package_id": f"package-{role}-0001", "role": role,
            "adjudicator_id": adjudicator, "blinded_run_id": blinded_run_id,
            "created_at": NOW,
            "supplement_sha256": canonical_sha256(supplement),
            "target_registry_sha256": registry["targets_sha256"],
            "record_count": 100,
            "records_sha256": canonical_sha256(sorted(
                records[role], key=lambda row: row["url"]))}
        directory.joinpath("_manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8")
        manifests[role] = manifest
    reconciliation = {
        "schema_version": 1, "benchmark": "news-entity-links-v2",
        "reconciliation_id": "reconciliation-0001",
        "blinded_run_id": blinded_run_id,
        "original_primary_package_id":
            manifests["original_primary"]["package_id"],
        "final_primary_package_id": manifests["primary"]["package_id"],
        "independent_package_id": manifests["independent"]["package_id"],
        "target_registry_sha256": registry["targets_sha256"],
        "created_at": NOW, "actor_id": "maintainer-editor",
        "status": "resolved_and_rechecked", "disagreement_count": 0,
        "disagreements_sha256": canonical_sha256([]), "decisions": [],
        "original_primary_records_sha256":
            manifests["original_primary"]["records_sha256"],
        "final_primary_records_sha256": manifests["primary"]["records_sha256"]}
    reconciliation_path = root / "reconciliation.json"
    reconciliation_path.write_text(json.dumps(reconciliation), encoding="utf-8")
    return {"supplement": supplement_path, "supplement_value": supplement,
            "registry": registry_path, "primary": primary,
            "original_primary": original_primary,
            "independent": independent, "candidate": candidate,
            "reconciliation": reconciliation_path, "data": data}


def rewrite_package_manifest(directory: Path) -> dict:
    path = directory / "_manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    records = [json.loads(item.read_text(encoding="utf-8"))
               for item in sorted(directory.glob("*.json"))
               if item.name != "_manifest.json"]
    manifest["record_count"] = len(records)
    manifest["records_sha256"] = canonical_sha256(sorted(
        records, key=lambda row: row["url"]))
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


class EntityLinkScoring(unittest.TestCase):
    def test_extraction_decision_and_identity_errors_remain_separate(self):
        ref = {"u": scoring_reference("u", [
            {"kind": "person", "surface": "Иван", "target_id": "p1"},
            {"kind": "institution", "surface": "Комисия", "target_id": None},
            {"kind": "settlement", "surface": "София", "target_id": "68134"}])}
        hyp = {"u": {"url": "u", "mentions": [
            {"kind": "person", "surface": "Иван", "id": "wrong"},
            {"kind": "institution", "surface": "Комисия", "id": "i1"},
            {"kind": "sector", "surface": "Енергетика", "id": "energy"}]}}
        got = score_entity_links(ref, hyp)
        self.assertEqual(got["extraction"]["true_positives"], 2)
        self.assertEqual(got["linked_targets"]["wrong_canonical_targets"], 1)
        self.assertEqual(got["linked_targets"]
                         ["unsafe_links_on_unlinked_mentions"], 1)
        self.assertNotIn("f1", got["linked_targets"])

    def test_rounding_cannot_promote_a_below_threshold_ratio(self):
        ref_links = [{"kind": "person", "surface": f"R{i}", "target_id": "p1"}
                     for i in range(189)]
        hyp_mentions = [{"kind": "person", "surface": f"R{i}", "id": "p1"}
                        for i in range(189)] + [
            {"kind": "person", "surface": f"X{i}", "id": None}
            for i in range(10)]
        metrics = score_entity_links(
            {"u": scoring_reference("u", ref_links)},
            {"u": {"url": "u", "mentions": hyp_mentions}})
        self.assertEqual(metrics["extraction"]["precision"], .95)
        gate = entity_link_release_gate_results(metrics)
        self.assertFalse(gate["checks"]["extraction_precision"]["passed"])
        self.assertEqual(gate["checks"]["extraction_precision"]["numerator"], 189)

    def test_missing_zero_label_article_fails_complete_output_gate(self):
        ref, hyp = perfect_scoring_set(include_empty=True)
        gate = entity_link_release_gate_results(score_entity_links(ref, hyp))
        self.assertFalse(gate["passed"])
        self.assertFalse(gate["checks"]["complete_article_output"]["passed"])

    def test_per_kind_gates_prevent_aggregate_masking(self):
        links = [label(kind, index, linked=index < 3)
                 for kind in ENTITY_LINK_KINDS if kind != "sector"
                 for index in range(20)] + [
                     label("sector", index, linked=index < 3)
                     for index in range(5)]
        ref = {"u": scoring_reference("u", links)}
        hyp = {"u": hypothesis_from_reference(ref["u"])}
        hyp["u"]["mentions"] = [item for item in hyp["u"]["mentions"]
                                if item["kind"] != "sector"]
        gate = entity_link_release_gate_results(score_entity_links(ref, hyp))
        self.assertTrue(gate["checks"]["extraction_recall"]["passed"])
        self.assertFalse(gate["checks"]["per_kind"]["detail"]
                         ["sector"]["passed"])
        self.assertFalse(gate["passed"])

    def test_complete_six_kind_candidate_passes(self):
        ref, hyp = perfect_scoring_set()
        self.assertTrue(entity_link_release_gate_results(
            score_entity_links(ref, hyp))["passed"])

    def test_settlement_legacy_id_matches_public_target_id(self):
        ref = {"u": scoring_reference("u", [{
            "kind": "settlement", "surface": "Нова надежда",
            "target_id": "51891"}])}
        hyp = {"u": {"url": "u", "mentions": [{
            "kind": "place", "surface": "нова  надежда",
            "id": "settlement:51891"}]}}
        self.assertEqual(score_entity_links(ref, hyp)
                         ["linked_targets"]["true_positives"], 1)


class BlindedSelection(unittest.TestCase):
    def test_adjudicator_manifest_contains_no_predictions_or_strata(self):
        selected = [{"path": "news/data/x/a.json", "url": "https://x/a",
                     "grounding_sha256": f"sha256:{'a' * 64}",
                     "drawn_for": "linked_person",
                     "sampling_signals": ["linked_person"],
                     "candidate_mentions": [{"id": "leak"}]}]
        manifest, _ = builder.build_manifest(
            selected, seed="seed", generated_at=NOW,
            registry_hash=f"sha256:{'b' * 64}")
        self.assertEqual(set(manifest["articles"][0]), validator.BINDING_FIELDS)
        serialized = json.dumps(manifest)
        self.assertNotIn("drawn_for", serialized)
        self.assertNotIn("sampling_signals", serialized)
        self.assertNotIn("candidate", serialized)
        self.assertNotIn("leak", serialized)

    def test_selector_fails_instead_of_top_up_when_a_cell_is_short(self):
        entries = [{"path": f"p{i}", "url": f"u{i}",
                    "date_bucket": "2026-01",
                    "sampling_signals": ["linked_person"]} for i in range(100)]
        with self.assertRaisesRegex(ValueError, "cell_underfilled"):
            builder.select(entries, 100, "seed")

    def test_cli_rejects_sizes_without_a_v2_fixed_cell_contract(self):
        for size in (99, 101, 125):
            with self.subTest(size=size), patch.object(
                    sys, "argv", ["build_entity_link_eval.py", "--size",
                                  str(size)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(builder.main(), 2)


class ReferencePackage(unittest.TestCase):
    def test_strict_blinded_independent_reconciled_package_passes(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = write_package(Path(temporary))
            old_root = validator.ROOT
            validator.ROOT = Path(temporary)
            try:
                result = validator.validate(
                    paths["supplement"], paths["primary"],
                    paths["independent"], paths["reconciliation"],
                    paths["registry"], paths["original_primary"])
                self.assertTrue(result["release_ready"])
                self.assertEqual(result["disagreement_count"], 0)
                self.assertNotEqual(result["primary_adjudicator_id"],
                                    result["independent_adjudicator_id"])
            finally:
                validator.ROOT = old_root

    def test_amendment_must_match_immutable_before_and_final_primary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = write_package(root)
            independent_path = paths["independent"] / "0.json"
            independent_row = json.loads(independent_path.read_text())
            independent_row["entity_links"][0]["target_id"] = None
            independent_path.write_text(json.dumps(independent_row,
                                                   ensure_ascii=False),
                                        encoding="utf-8")
            independent_manifest = rewrite_package_manifest(
                paths["independent"])
            original_row = json.loads(
                (paths["original_primary"] / "0.json").read_text())
            first = original_row["entity_links"][0]
            disagreement = {
                "url": original_row["url"], "kind": first["kind"],
                "surface_key": validator.normalize_entity_surface(
                    first["surface"]),
                "primary_present": True,
                "primary_target_id": first["target_id"],
                "independent_present": True,
                "independent_target_id": None,
            }
            reconciliation = json.loads(paths["reconciliation"].read_text())
            reconciliation["independent_package_id"] = \
                independent_manifest["package_id"]
            reconciliation["disagreement_count"] = 1
            reconciliation["disagreements_sha256"] = canonical_sha256(
                [disagreement])
            reconciliation["decisions"] = [{
                **disagreement, "disposition": "primary_amended",
                "resolved_present": True, "resolved_target_id": None,
                "explanation": "Independent review confirmed no safe link."}]
            paths["reconciliation"].write_text(
                json.dumps(reconciliation), encoding="utf-8")
            old_root = validator.ROOT
            validator.ROOT = root
            try:
                with self.assertRaisesRegex(
                        ValueError, "final_primary_mismatch"):
                    validator.validate(
                        paths["supplement"], paths["primary"],
                        paths["independent"], paths["reconciliation"],
                        paths["registry"], paths["original_primary"])

                final_path = paths["primary"] / "0.json"
                final_row = json.loads(final_path.read_text())
                final_row["entity_links"][0]["target_id"] = None
                final_path.write_text(json.dumps(final_row,
                                                 ensure_ascii=False),
                                      encoding="utf-8")
                final_manifest = rewrite_package_manifest(paths["primary"])
                reconciliation["final_primary_records_sha256"] = \
                    final_manifest["records_sha256"]
                paths["reconciliation"].write_text(
                    json.dumps(reconciliation), encoding="utf-8")
                result = validator.validate(
                    paths["supplement"], paths["primary"],
                    paths["independent"], paths["reconciliation"],
                    paths["registry"], paths["original_primary"])
                self.assertTrue(result["release_ready"])
                self.assertEqual(result["disagreement_count"], 1)
            finally:
                validator.ROOT = old_root

    def test_title_drift_registry_drift_and_weak_evidence_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = write_package(root)
            old_root = validator.ROOT
            validator.ROOT = root
            try:
                article_path = paths["data"] / "0.json"
                article = json.loads(article_path.read_text())
                article["title"] = "Променено заглавие"
                article_path.write_text(json.dumps(article), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "article_changed"):
                    validator.validate(paths["supplement"], paths["primary"],
                                       target_registry_path=paths["registry"])
                article["title"] = CONTENT
                article_path.write_text(json.dumps(article, ensure_ascii=False),
                                        encoding="utf-8")
                registry = json.loads(paths["registry"].read_text())
                registry["targets"].append({"kind": "person", "id": "p2"})
                registry["target_count"] += 1
                registry["targets_sha256"] = canonical_sha256(registry["targets"])
                paths["registry"].write_text(json.dumps(registry), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "registry_unavailable_or_drifted"):
                    validator.validate(paths["supplement"], paths["primary"],
                                       target_registry_path=paths["registry"])
            finally:
                validator.ROOT = old_root

    def test_strict_loader_rejects_duplicate_url_and_extra_root_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = write_package(root)
            old_root = validator.ROOT
            validator.ROOT = root
            try:
                first = paths["primary"] / "0.json"
                row = json.loads(first.read_text())
                (paths["primary"] / "duplicate.json").write_text(
                    json.dumps(row), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "duplicate_urls"):
                    validator.validate(paths["supplement"], paths["primary"],
                                       target_registry_path=paths["registry"])
                (paths["primary"] / "duplicate.json").unlink()
                row["leaked_model_output"] = True
                first.write_text(json.dumps(row), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "invalid_entity_link_labels"):
                    validator.validate(paths["supplement"], paths["primary"],
                                       target_registry_path=paths["registry"])
            finally:
                validator.ROOT = old_root

    def test_schema_and_python_validator_reject_the_same_extra_fields(self):
        schema = json.loads(Path(
            "news/eval_contract/entity_link_reference_v2.schema.json").read_text())
        article = {"title": "Иван", "description": "", "content": ""}
        row = {"schema_version": 1, "benchmark": "news-entity-links-v2",
               "blind_id": f"sha256:{'a' * 64}", "url": "https://x/a",
               "article_path": "news/data/x/a.json",
               "grounding_sha256": f"sha256:{'b' * 64}",
               "target_registry_sha256": f"sha256:{'c' * 64}",
               "entity_links_version": 2, "entity_links_complete": True,
               "entity_links": [{"kind": "person", "surface": "Иван",
                                   "target_id": None, "evidence": "Иван"}]}
        self.assertEqual(validate_schema(schema, row), [])
        self.assertTrue(validator.valid_v2_entity_link_contract(row, article))
        bad = {**row, "leak": True}
        self.assertTrue(validate_schema(schema, bad))
        self.assertFalse(validator.valid_v2_entity_link_contract(bad, article))


class BenchmarkEnforcement(unittest.TestCase):
    def test_cli_exits_nonzero_for_ineligible_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = write_package(root)
            empty = root / "empty-candidate"
            empty.mkdir()
            old_root = validator.ROOT
            validator.ROOT = root
            argv = ["benchmark_entity_links.py", "--supplement",
                    str(paths["supplement"]), "--original-primary",
                    str(paths["original_primary"]), "--primary",
                    str(paths["primary"]),
                    "--independent", str(paths["independent"]),
                    "--reconciliation", str(paths["reconciliation"]),
                    "--target-registry", str(paths["registry"]),
                    "--candidate", f"bad={empty}"]
            try:
                with patch.object(sys, "argv", argv), \
                        contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(benchmark.main(), 3)
            finally:
                validator.ROOT = old_root

    def test_cli_exits_zero_for_eligible_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = write_package(root)
            old_root = validator.ROOT
            validator.ROOT = root
            argv = ["benchmark_entity_links.py", "--supplement",
                    str(paths["supplement"]), "--original-primary",
                    str(paths["original_primary"]), "--primary",
                    str(paths["primary"]),
                    "--independent", str(paths["independent"]),
                    "--reconciliation", str(paths["reconciliation"]),
                    "--target-registry", str(paths["registry"]),
                    "--candidate", f"good={paths['candidate']}"]
            try:
                with patch.object(sys, "argv", argv), \
                        contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(benchmark.main(), 0)
            finally:
                validator.ROOT = old_root


if __name__ == "__main__":
    unittest.main()
