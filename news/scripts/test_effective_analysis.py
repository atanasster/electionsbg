#!/usr/bin/env python3

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from news.eval_contract.canonical import (
    analysis_sha256,
    canonical_sha256,
    content_sha256,
)
from news.scripts.effective_analysis import (
    EffectiveAnalysisError,
    effective_analysis,
    load_accepted_adjudications,
    validate_https_url,
)


CONTENT = "Пълният текст на материала."


def base_analysis() -> dict:
    return {
        "domain": "example.bg",
        "article_path": "news/data/example.bg/article-1.json",
        "url": "https://example.bg/article-1",
        "leaning": {
            "label": "neutral",
            "confidence": 0.8,
            "evidence": "Моделова обосновка.",
        },
        "russia_stance": {
            "label": "anti_russia",
            "confidence": 0.7,
            "evidence": "Моделова обосновка за Русия.",
        },
        "party_tones": [
            {
                "party": "ГЕРБ",
                "party_id": "gerb",
                "tone": "neutral",
                "confidence": 0.6,
                "evidence": "Моделова партийна обосновка.",
                "evidence_grounded": True,
            }
        ],
        "model": "model-v1",
        "analyzed_at": "2026-08-31T10:00:00+00:00",
        "summary_bg": "Резюме.",
    }


def article(content: str = CONTENT) -> dict:
    return {
        "domain": "example.bg",
        "url": "https://example.bg/article-1",
        "content": content,
    }


def evaluation() -> dict:
    return {
        "schema_version": 1,
        "leaning": {
            "label": "progressive",
            "disposition": "changed",
            "evidence": "Авторският текст подкрепя по-широка социална защита.",
            "reason_codes": ["model_missed_context"],
        },
        "russia_stance": {
            "label": "anti_russia",
            "disposition": "confirmed",
            "evidence": "Русия е описана като агресор в авторския текст.",
            "reason_codes": [],
        },
        "parties_confirmed_complete": True,
        "party_tones": [
            {
                "party": "ГЕРБ",
                "party_id": "gerb",
                "tone": "unfavorable",
                "evidence": "Партията е пряко критикувана в материала.",
                "disposition": "changed",
                "reason_codes": ["tone_misread"],
            },
            {
                "party": "ПП",
                "party_id": "pp",
                "tone": "favorable",
                "evidence": "Предложението на партията е подкрепено.",
                "disposition": "added",
                "reason_codes": ["party_missing"],
            },
        ],
        "removed_model_parties": [],
        "public_note": "Прочетен е целият оригинален материал.",
    }


def adjudication(*, content: str = CONTENT, base: dict | None = None) -> dict:
    source = base or base_analysis()
    return {
        "schema_version": 1,
        "rubric_version": "news-article-evaluation-v1",
        "article_key": "example.bg/article-1",
        "url": "https://example.bg/article-1",
        "task_revision": 4,
        "content_sha256": content_sha256(content),
        "analysis_sha256": analysis_sha256(source),
        "source_submission_ids": ["submission-0001"],
        "operator_actor": {"kind": "maintainer", "id": "editor@example.test"},
        "adjudicated_at": "2026-08-31T12:00:00.000Z",
        "revision": 1,
        "evaluation": evaluation(),
        "model_labels": {
            "leaning": "neutral",
            "russia_stance": "anti_russia",
            "party_tones": [
                {"party": "ГЕРБ", "party_id": "gerb", "tone": "neutral"}
            ],
        },
        "public_explanation": "Проверено спрямо целия оригинален материал.",
        "gold_eligible": True,
        "status": "accepted",
        "last_operation_id": "accept-operation-0001",
    }


class EffectiveAnalysisTest(unittest.TestCase):
    def test_no_adjudication_returns_an_equal_independent_copy(self):
        base = base_analysis()
        result = effective_analysis(base, article(), None)
        self.assertEqual(result, base)
        self.assertIsNot(result, base)
        result["leaning"]["label"] = "progressive"
        self.assertEqual(base["leaning"]["label"], "neutral")

    def test_accepted_fields_override_without_model_confidence(self):
        base = base_analysis()
        accepted = adjudication(base=base)
        before_base = copy.deepcopy(base)
        before_accepted = copy.deepcopy(accepted)
        result = effective_analysis(base, article(), accepted)

        self.assertEqual(result["leaning"]["label"], "progressive")
        self.assertIsNone(result["leaning"]["confidence"])
        self.assertEqual(result["russia_stance"]["label"], "anti_russia")
        self.assertIsNone(result["russia_stance"]["confidence"])
        self.assertEqual(
            [(item["party_id"], item["tone"]) for item in result["party_tones"]],
            [("gerb", "unfavorable"), ("pp", "favorable")],
        )
        self.assertTrue(all(item["confidence"] is None
                            for item in result["party_tones"]))
        self.assertEqual(result["original_model"]["leaning"]["label"], "neutral")
        self.assertEqual(result["human_review"]["status"], "accepted")
        self.assertEqual(base, before_base)
        self.assertEqual(accepted, before_accepted)

    def test_a_model_rerun_does_not_erase_a_content_bound_decision(self):
        reviewed_base = base_analysis()
        accepted = adjudication(base=reviewed_base)
        rerun = base_analysis()
        rerun["model"] = "model-v2"
        rerun["leaning"]["label"] = "conservative"
        result = effective_analysis(rerun, article(), accepted)
        self.assertEqual(result["leaning"]["label"], "progressive")
        self.assertTrue(result["human_review"]["analysis_changed_since_review"])
        self.assertEqual(result["original_model"]["model"], "model-v2")

    def test_content_change_withholds_the_accepted_overlay(self):
        base = base_analysis()
        result = effective_analysis(
            base, article("Редактиран пълен текст."), adjudication(base=base))
        self.assertEqual(result["leaning"], base["leaning"])
        self.assertEqual(result["party_tones"], base["party_tones"])
        self.assertEqual(result["human_review"]["status"], "needs_revalidation")
        self.assertEqual(result["human_review"]["stale_reason"], "content_changed")

    def test_unable_to_judge_does_not_replace_the_model_axis(self):
        base = base_analysis()
        accepted = adjudication(base=base)
        accepted["evaluation"]["leaning"] = {
            "label": None,
            "disposition": "unable_to_judge",
            "evidence": "Публичният контекст не е достатъчен.",
            "reason_codes": ["insufficient_public_context"],
        }
        accepted["gold_eligible"] = False
        result = effective_analysis(base, article(), accepted)
        self.assertEqual(result["leaning"], base["leaning"])
        self.assertEqual(
            result["human_review"]["fields"]["leaning"], "unable_to_judge")

    def test_identity_url_and_schema_mismatches_fail_closed(self):
        cases = []
        wrong_key = adjudication()
        wrong_key["article_key"] = "example.bg/other"
        cases.append(wrong_key)
        wrong_url = adjudication()
        wrong_url["url"] = "https://example.bg/other"
        cases.append(wrong_url)
        wrong_label = adjudication()
        wrong_label["evaluation"]["leaning"]["label"] = "invented"
        cases.append(wrong_label)
        wrong_disposition = adjudication()
        wrong_disposition["evaluation"]["leaning"]["disposition"] = "confirmed"
        cases.append(wrong_disposition)
        for accepted in cases:
            with self.subTest(accepted=accepted):
                with self.assertRaises(EffectiveAnalysisError):
                    effective_analysis(base_analysis(), article(), accepted)


class AcceptedSnapshotTest(unittest.TestCase):
    def test_shared_https_url_vectors_match_the_python_boundary(self):
        path = Path(__file__).parents[1] / "eval_contract" / "url_vectors.json"
        vectors = json.loads(path.read_text(encoding="utf-8"))
        for value in vectors["valid"]:
            self.assertEqual(validate_https_url(value), value)
        for value in vectors["invalid"]:
            with self.assertRaises(EffectiveAnalysisError):
                validate_https_url(value)

    def test_snapshot_loader_verifies_hash_order_and_returns_article_map(self):
        record = adjudication()
        records = [record]
        snapshot = {
            "manifest": {
                "schema_version": 1,
                "snapshot_kind": "news-eval-accepted-adjudications",
                "project_id": "electionsbg-news",
                "firestore_read_time": "2026-08-31T12:30:00.000Z",
                "rubric_version": "news-article-evaluation-v1",
                "record_count": 1,
                "records_sha256": canonical_sha256(records),
            },
            "records": records,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "accepted.json"
            path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
            loaded = load_accepted_adjudications(path)
        self.assertEqual(loaded.records_sha256, snapshot["manifest"]["records_sha256"])
        self.assertEqual(
            loaded.by_article["example.bg/article-1"]["revision"], 1)

    def test_snapshot_loader_rejects_tampering_and_empty_replacement(self):
        for records, count, digest in [
            ([], 0, canonical_sha256([])),
            ([adjudication()], 1, f"sha256:{'0' * 64}"),
        ]:
            snapshot = {
                "manifest": {
                    "schema_version": 1,
                    "snapshot_kind": "news-eval-accepted-adjudications",
                    "project_id": "electionsbg-news",
                    "firestore_read_time": "2026-08-31T12:30:00.000Z",
                    "rubric_version": "news-article-evaluation-v1",
                    "record_count": count,
                    "records_sha256": digest,
                },
                "records": records,
            }
            with self.subTest(records=records):
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "accepted.json"
                    path.write_text(json.dumps(snapshot), encoding="utf-8")
                    with self.assertRaises(EffectiveAnalysisError):
                        load_accepted_adjudications(path)

    def test_snapshot_loader_rejects_types_segments_and_timestamp_drift(self):
        base_record = adjudication()
        mutations = []

        record = copy.deepcopy(base_record)
        record["schema_version"] = True
        mutations.append((record, {}))

        record = copy.deepcopy(base_record)
        record["article_key"] = "/article-1"
        mutations.append((record, {}))

        record = copy.deepcopy(base_record)
        record["article_key"] = f"{'d' * 254}/article-1"
        mutations.append((record, {}))

        record = copy.deepcopy(base_record)
        record["adjudicated_at"] = "2026-08-31T14:00:00.000+02:00"
        mutations.append((record, {}))

        mutations.append((copy.deepcopy(base_record), {"schema_version": True}))
        mutations.append((copy.deepcopy(base_record), {"record_count": True}))
        mutations.append((
            copy.deepcopy(base_record),
            {"firestore_read_time": "2026-08-31T14:30:00.000+02:00"},
        ))

        for record, manifest_overrides in mutations:
            records = [record]
            manifest = {
                "schema_version": 1,
                "snapshot_kind": "news-eval-accepted-adjudications",
                "project_id": "electionsbg-news",
                "firestore_read_time": "2026-08-31T12:30:00.000Z",
                "rubric_version": "news-article-evaluation-v1",
                "record_count": 1,
                "records_sha256": canonical_sha256(records),
                **manifest_overrides,
            }
            snapshot = {"manifest": manifest, "records": records}
            with self.subTest(record=record, manifest=manifest_overrides):
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "accepted.json"
                    path.write_text(json.dumps(snapshot), encoding="utf-8")
                    with self.assertRaises(EffectiveAnalysisError):
                        load_accepted_adjudications(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
