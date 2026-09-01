#!/usr/bin/env python3
"""Tests for accepted all-article feedback publication and training boundary."""

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

from news.eval_contract.canonical import (
    analysis_sha256, canonical_sha256, content_sha256)
from news.scripts.effective_feedback import (
    EffectiveFeedbackError, apply_accepted_feedback, load_accepted_feedback,
    target_index)
from news.scripts.build_feedback_improvement_dataset import build as build_improvement
from news.scripts.build_app_data import compact_analysis

NOW = "2026-09-01T10:00:00.000Z"


def feedback_record(article: dict, *, article_key="example.bg/a") -> dict:
    target_hash = f"sha256:{'b' * 64}"
    return {
        "schema_version": 1, "contract": "article-feedback-v1",
        "article_key": article_key,
        "url": f"https://news.electionsbg.com/article/{article_key}",
        "task_revision": 1,
        "content_sha256": content_sha256(article["content"]),
        "analysis_sha256": f"sha256:{'a' * 64}",
        "target_registry_sha256": target_hash,
        "source_submission_ids": ["submission-00000001"],
        "source_target_registry_sha256s": {
            "submission-00000001": target_hash},
        "operator_actor": {"kind": "maintainer", "id": "editor"},
        "adjudicated_at": NOW, "revision": 1,
        "feedback": {
            "leaning": {"label": "conservative", "evidence": "Иван"},
            "russia_stance": None,
            "party_tones": [{
                "party": "Партия", "party_id": "party-1",
                "resolution_status": "selected", "tone": "mixed",
                "evidence": "Партия",
            }],
            "link_proposals": [{
                "action": "add", "surface": "Иван", "target_kind": "person",
                "resolution_status": "selected",
                "target_ref": {"kind": "person", "id": "person-1"},
                "current_href": None, "context": "Иван", "evidence": "Иван",
            }, {
                "action": "add", "surface": "Енергетика",
                "target_kind": "sector", "resolution_status": "selected",
                "target_ref": {"kind": "sector", "id": "energy"},
                "current_href": None, "context": "Енергетика",
                "evidence": "Енергетика",
            }],
            "issue_kinds": ["missing_entity", "missing_sector"],
            "public_note": None,
        },
        "public_explanation": "Редакционно проверено.", "status": "accepted",
        "last_operation_id": "feedback-operation-0001",
    }


def analysis(article: dict) -> dict:
    return {
        "article_path": "news/data/example.bg/a.json", "domain": "example.bg",
        "url": article["url"],
        "leaning": {"label": "progressive", "confidence": .8, "evidence": ""},
        "russia_stance": {"label": "neutral", "confidence": .7, "evidence": ""},
        "party_tones": [],
        "entities": {"people": [], "parties": [], "institutions": [],
                     "companies": [], "places": []},
    }


def registries() -> list[dict]:
    targets = [
        {"kind": "party", "id": "party-1", "canonical": "Партия",
         "href": "https://electionsbg.com/party/party-1",
         "aliases": ["Партия"]},
        {"kind": "person", "id": "person-1", "canonical": "Иван Иванов",
         "href": "https://electionsbg.com/person/person-1", "aliases": ["Иван"]},
        {"kind": "sector", "id": "energy", "canonical": "Енергетика",
         "href": "https://electionsbg.com/sector/energy",
         "aliases": ["Енергетика"]},
    ]
    return [{"version": 1, "generated_at": NOW,
             "targets_sha256": canonical_sha256(targets),
             "target_count": len(targets), "targets": targets}]


class EffectiveFeedbackTest(unittest.TestCase):
    def setUp(self):
        self.article = {"url": "https://example.bg/a", "content": "Иван Партия Енергетика"}
        self.record = feedback_record(self.article)
        self.record["analysis_sha256"] = analysis_sha256(analysis(self.article))
        self.targets = target_index(registries())

    def test_applies_only_accepted_fields_and_canonical_links(self):
        base = analysis(self.article)
        got, provenance = apply_accepted_feedback(
            base, self.article, "example.bg/a", self.record, self.targets)
        self.assertEqual(got["leaning"], {
            "label": "conservative", "confidence": None, "evidence": "Иван"})
        self.assertEqual(got["russia_stance"], base["russia_stance"])
        self.assertEqual(got["party_tones"][0]["party_id"], "party-1")
        self.assertIn("Иван", got["entities"]["people"])
        self.assertEqual(got["_feedback_link_overrides"]["Иван"]["form_kind"],
                         "editorial")
        self.assertEqual(got["_feedback_reviewed_links"][1]["kind"], "sector")
        self.assertEqual(provenance["status"], "accepted")
        self.assertEqual(provenance["needs_revalidation_fields"], [])
        self.assertEqual(base["leaning"]["label"], "progressive")

    def test_stale_and_missing_analysis_never_synthesize_model_analysis(self):
        edited = {**self.article, "content": "Променено"}
        got, provenance = apply_accepted_feedback(
            analysis(self.article), edited, "example.bg/a", self.record,
            self.targets)
        self.assertEqual(got["leaning"]["label"], "progressive")
        self.assertEqual(provenance["status"], "needs_revalidation")
        self.assertEqual(provenance["issue_kinds"], [])
        self.assertIsNone(provenance["public_explanation"])
        none, current = apply_accepted_feedback(
            None, self.article, "example.bg/a", self.record, self.targets)
        self.assertIsNone(none)
        self.assertEqual(current["status"], "accepted")

    def test_selected_target_must_exist_in_current_registry(self):
        with self.assertRaisesRegex(EffectiveFeedbackError, "absent"):
            apply_accepted_feedback(
                analysis(self.article), self.article, "example.bg/a",
                self.record, {})

    def test_selected_links_are_grounded_unique_and_kind_consistent(self):
        for mutate, message in (
            (lambda row: row["feedback"]["link_proposals"][0].update(
                surface="Несъществуващ"), "grounded"),
            (lambda row: row["feedback"]["link_proposals"].append(
                copy.deepcopy(row["feedback"]["link_proposals"][0])),
             "repeats selected surface"),
            (lambda row: row["feedback"]["link_proposals"][0].update(
                target_kind="sector"), "target kinds conflict"),
        ):
            candidate = copy.deepcopy(self.record)
            mutate(candidate)
            with self.assertRaisesRegex(EffectiveFeedbackError, message):
                apply_accepted_feedback(
                    analysis(self.article), self.article, "example.bg/a",
                    candidate, self.targets)

    def test_analysis_drift_withholds_only_analysis_dependent_claims(self):
        candidate = copy.deepcopy(self.record)
        candidate["analysis_sha256"] = f"sha256:{'c' * 64}"
        got, provenance = apply_accepted_feedback(
            analysis(self.article), self.article, "example.bg/a", candidate,
            self.targets)
        self.assertEqual(got["leaning"]["label"], "conservative")
        self.assertNotIn("_feedback_reviewed_links", got)
        self.assertEqual(provenance["fields"], ["leaning", "party_tones"])
        self.assertEqual(provenance["needs_revalidation_fields"],
                         ["entity_links", "issue_kinds"])
        self.assertEqual(provenance["issue_kinds"], [])

    def test_snapshot_is_strict_hashed_sorted_and_accepted_only(self):
        records = [self.record]
        snapshot = {"manifest": {
            "schema_version": 1,
            "snapshot_kind": "news-feedback-accepted-adjudications",
            "project_id": "electionsbg-news", "firestore_read_time": NOW,
            "record_count": 1, "records_sha256": canonical_sha256(records),
        }, "records": records}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "accepted.json"
            path.write_text(json.dumps(snapshot), encoding="utf-8")
            loaded = load_accepted_feedback(
                path, expected_project_id="electionsbg-news")
            self.assertEqual(loaded.records_sha256,
                             snapshot["manifest"]["records_sha256"])
            bad = copy.deepcopy(snapshot)
            bad["records"][0]["status"] = "raw"
            bad["manifest"]["records_sha256"] = canonical_sha256(bad["records"])
            path.write_text(json.dumps(bad), encoding="utf-8")
            with self.assertRaisesRegex(EffectiveFeedbackError, "unsupported"):
                load_accepted_feedback(path)

    def test_improvement_dataset_contains_only_adjudicated_current_records(self):
        records = [self.record]
        snapshot = {"manifest": {
            "schema_version": 1,
            "snapshot_kind": "news-feedback-accepted-adjudications",
            "project_id": "electionsbg-news", "firestore_read_time": NOW,
            "record_count": 1, "records_sha256": canonical_sha256(records),
        }, "records": records}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "accepted.json"
            path.write_text(json.dumps(snapshot), encoding="utf-8")
            article_path = root / "data" / "example.bg" / "a.json"
            article_path.parent.mkdir(parents=True)
            article_path.write_text(json.dumps(self.article), encoding="utf-8")
            dataset = build_improvement(
                path, root / "data", current_registry=registries()[0],
                current_analyses={"example.bg/a": analysis(self.article)})
            self.assertEqual(dataset["manifest"]["raw_community_records_included"], 0)
            self.assertEqual(dataset["manifest"]["record_count"], 1)
            self.assertNotIn("source_submission_ids",
                             json.dumps(dataset["records"][0]))
            self.assertNotIn("public_note", json.dumps(dataset["records"][0]))
            self.assertEqual(
                dataset["records"][0]["targets"]["entity_links"][0]
                ["target_ref"]["id"], "person-1")
            self.assertEqual(
                dataset["manifest"]["current_target_registry_sha256"],
                registries()[0]["targets_sha256"])
            self.assertEqual(
                dataset["records"][0]["source_target_registry_sha256"],
                self.record["target_registry_sha256"])

            changed_analysis = {**analysis(self.article), "model": "new-model"}
            drifted = build_improvement(
                path, root / "data", current_registry=registries()[0],
                current_analyses={"example.bg/a": changed_analysis})
            self.assertEqual(
                drifted["records"][0]["targets"]["entity_links"], [])
            self.assertEqual(
                drifted["records"][0]["targets"]["issue_kinds"], [])
            self.assertEqual(
                drifted["manifest"]["excluded_analysis_stale_records"], 1)

            archived_only = copy.deepcopy(registries()[0])
            archived_only["targets"] = [
                target for target in archived_only["targets"]
                if target["id"] != "person-1"]
            archived_only["target_count"] = len(archived_only["targets"])
            archived_only["targets_sha256"] = canonical_sha256(
                archived_only["targets"])
            with self.assertRaisesRegex(EffectiveFeedbackError, "absent"):
                build_improvement(
                    path, root / "data", current_registry=archived_only,
                    current_analyses={"example.bg/a": analysis(self.article)})

    def test_improvement_uses_current_pre_feedback_analysis_not_old_app_data(self):
        base = analysis(self.article)
        self.record["analysis_sha256"] = canonical_sha256(
            compact_analysis(base, self.article))
        records = [self.record]
        snapshot = {"manifest": {
            "schema_version": 1,
            "snapshot_kind": "news-feedback-accepted-adjudications",
            "project_id": "electionsbg-news", "firestore_read_time": NOW,
            "record_count": 1, "records_sha256": canonical_sha256(records),
        }, "records": records}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot_path = root / "accepted.json"
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
            article_path = root / "data" / "example.bg" / "a.json"
            article_path.parent.mkdir(parents=True)
            article_path.write_text(json.dumps(self.article), encoding="utf-8")
            analysis_path = (root / "data" / "analysis" / "articles" /
                             "example.bg" / "a.json")
            analysis_path.parent.mkdir(parents=True)
            analysis_path.write_text(json.dumps(base), encoding="utf-8")
            current = build_improvement(
                snapshot_path, root / "data",
                current_registry=registries()[0])
            self.assertEqual(len(
                current["records"][0]["targets"]["entity_links"]), 2)

            changed = copy.deepcopy(base)
            changed["model"] = "new-model"
            analysis_path.write_text(json.dumps(changed), encoding="utf-8")
            drifted = build_improvement(
                snapshot_path, root / "data",
                current_registry=registries()[0])
            self.assertEqual(
                drifted["records"][0]["targets"]["entity_links"], [])
            self.assertEqual(
                drifted["manifest"]["excluded_analysis_stale_records"], 1)


if __name__ == "__main__":
    unittest.main()
