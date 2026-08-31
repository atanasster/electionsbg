#!/usr/bin/env python3
"""Tests for truthfully reporting anonymous community eval pilots."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from news.eval_contract.canonical import canonical_sha256, content_sha256
from news.scripts import report_community_eval_pilot as pilot
from news.scripts.sync_eval_tasks import SyncError

STAMP = "2026-09-01T10:00:00.000Z"


def decision(label: str, disposition: str) -> dict:
    return {
        "label": label,
        "disposition": disposition,
        "evidence": "Кратко основание.",
        "reason_codes": [] if disposition == "confirmed" else ["model_missed_context"],
    }


def submission(
    submission_id: str,
    article_key: str,
    *,
    status: str = "raw",
    changed: bool = False,
    task: dict,
) -> dict:
    model = copy.deepcopy(task["model_labels"])
    evaluation = {
        "schema_version": 1,
        "leaning": decision("progressive" if changed else model["leaning"],
                            "changed" if changed else "confirmed"),
        "russia_stance": decision(model["russia_stance"], "confirmed"),
        "parties_confirmed_complete": True,
        "party_tones": [],
        "removed_model_parties": [],
        "public_note": "This note must never enter the report.",
    }
    return {
        "schema_version": 1,
        "rubric_version": "news-article-evaluation-v1",
        "submission_id": submission_id,
        "mode": "community",
        "article_key": article_key,
        "task_revision": task["revision"],
        "content_sha256": task["content_sha256"],
        "analysis_sha256": task["analysis_sha256"],
        "submitted_at": STAMP,
        "evaluation": evaluation,
        "model_labels": model,
        "status": status,
    }


class CommunityPilotReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="pilot_report_")
        self.root = Path(self.temp.name)
        self.app_data = self.root / "news/app-data/articles"
        self.app_data.mkdir(parents=True)
        self.keys = ["a.bg/one", "b.bg/two", "c.bg/three"]
        records = []
        for index, key in enumerate(self.keys):
            domain, article_id = key.split("/")
            body = f"Body {index}"
            article_dir = self.root / "news/data" / domain
            article_dir.mkdir(parents=True, exist_ok=True)
            (article_dir / f"{article_id}.json").write_text(
                json.dumps({"content": body}), encoding="utf-8"
            )
            analysis = {
                "leaning": {"label": "neutral" if index < 2 else "not_applicable"},
                "russia_stance": {"label": "not_applicable"},
                "party_tones": [],
                "entities": {"parties": ["Party"] if index == 1 else []},
                "topics": [],
            }
            local_analysis = {
                **analysis,
                "article_path": f"news/data/{domain}/{article_id}.json",
                "model": "test-model",
                "prompt_hashes": {},
            }
            analysis_dir = self.root / "news/data/analysis/articles" / domain
            analysis_dir.mkdir(parents=True, exist_ok=True)
            (analysis_dir / f"{article_id}.json").write_text(
                json.dumps(local_analysis), encoding="utf-8"
            )
            (self.app_data / f"{domain}.json").write_text(json.dumps({
                "domain": domain,
                "generated_at": STAMP,
                "articles": [{
                    "id": article_id,
                    "domain": domain,
                    "url": f"https://{domain}/{article_id}",
                    "title": f"Article {index}",
                    "analysis": analysis,
                }],
            }), encoding="utf-8")
            records.append({
                "article_key": key,
                "group_id": f"group-{index}",
                "content_sha256": content_sha256(body),
            })
        self.selection = self.root / "selection.json"
        selection = {
            "schema_version": 1,
            "dataset_id": "community-pilot-v1",
            "purpose": "Public community pilot.",
            "source_kind": "community_sample",
            "answer_visibility": "model_hidden_until_submit",
            "public_eligible": True,
            "article_keys": self.keys,
        }
        self.selection.write_text(json.dumps(selection), encoding="utf-8")
        self.sample_manifest = self.root / "sample-manifest.json"
        self.sample_manifest.write_text(json.dumps({
            "schema_version": 1,
            "manifest_kind": "news-community-sample",
            "dataset_id": "community-pilot-v1",
            "source_public_data_revision": STAMP,
            "seed": "fixture-seed",
            "requested_size": 3,
            "selected_size": 3,
            "selection_sha256": canonical_sha256(selection),
            "article_keys_sha256": canonical_sha256(self.keys),
            "selection_policy": {
                "sampling_signals_are_not_labels": True,
                "sealed_and_benchmark_membership_excluded": True,
            },
            "excluded": {},
            "distribution": {},
            "records": records,
        }), encoding="utf-8")
        _sample, _public, _strata, self.expected_tasks = pilot.validate_sample(
            self.root, self.root / "news/app-data", self.selection,
            self.sample_manifest,
        )
        outside_task = {
            "revision": 1,
            "content_sha256": "sha256:" + "4" * 64,
            "analysis_sha256": "sha256:" + "5" * 64,
            "model_labels": {
                "leaning": "neutral",
                "russia_stance": "not_applicable",
                "party_tones": [],
            },
        }
        self.records = [
            submission("s1", "a.bg/one", changed=False,
                       task=self.expected_tasks["a.bg/one"]),
            submission("s2", "a.bg/one", changed=True,
                       task=self.expected_tasks["a.bg/one"]),
            submission("s3", "b.bg/two", status="quarantined", changed=False,
                       task=self.expected_tasks["b.bg/two"]),
            submission("s4", "outside.bg/four", changed=False,
                       task=outside_task),
        ]
        self.records.sort(key=lambda row: (
            row["article_key"], row["submitted_at"], row["submission_id"]
        ))
        self.raw = self.root / "raw.jsonl"
        self.write_raw(self.records)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_raw(self, records: list[dict]) -> None:
        manifest = {
            "schema_version": 1,
            "export_kind": "news-eval-community-submissions",
            "project_id": "electionsbg-news",
            "firestore_read_time": STAMP,
            "rubric_version": "news-article-evaluation-v1",
            "record_count": len(records),
            "records_sha256": canonical_sha256(records),
        }
        lines = [
            json.dumps({"kind": "manifest", **manifest}, ensure_ascii=False),
            *(json.dumps({"kind": "submission", **row}, ensure_ascii=False)
              for row in records),
        ]
        self.raw.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def report(self) -> dict:
        return pilot.build_report(
            self.root, self.root / "news/app-data", self.selection,
            self.sample_manifest, self.raw,
        )

    def test_reports_coverage_repeats_quarantine_and_disagreement_without_accuracy(self):
        report = self.report()
        self.assertEqual(report["coverage"]["tasks"], 3)
        self.assertEqual(report["coverage"]["tasks_with_usable_submission"], 1)
        self.assertEqual(report["coverage"]["off_batch_submissions"], 1)
        self.assertEqual(report["coverage"]["status_counts"]["quarantined"], 1)
        self.assertEqual(report["repeat_annotations"]
                         ["articles_with_multiple_usable_submissions"], 1)
        self.assertEqual(report["repeat_annotations"]
                         ["articles_with_divergent_answer_signatures"], 1)
        self.assertEqual(report["model_comparison"]
                         ["submissions_with_any_model_disagreement"], 1)
        rendered = json.dumps(report)
        self.assertTrue(report["interpretation"]
                        ["community_answers_are_observations_not_accuracy_truth"])
        self.assertNotIn('"accuracy":', rendered.casefold())
        self.assertNotIn("This note must never enter the report", rendered)
        self.assertNotIn("Кратко основание", rendered)

    def test_content_stale_rows_are_excluded_from_completion(self):
        stale = copy.deepcopy(self.records)
        row = next(item for item in stale if item["submission_id"] == "s1")
        row["content_sha256"] = "sha256:" + "9" * 64
        stale.sort(key=lambda item: (
            item["article_key"], item["submitted_at"], item["submission_id"]
        ))
        self.write_raw(stale)
        report = self.report()
        self.assertEqual(report["coverage"]["content_stale_submissions"], 1)
        self.assertEqual(report["coverage"]["usable_submissions"], 1)

    def test_each_task_identity_mismatch_is_excluded_from_completion(self):
        mutations = {
            "revision": lambda row: row.__setitem__(
                "task_revision", row["task_revision"] + 1
            ),
            "analysis hash": lambda row: row.__setitem__(
                "analysis_sha256", "sha256:" + "9" * 64
            ),
            "coherent model snapshot": self.mutate_model_snapshot,
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                changed = copy.deepcopy(self.records)
                row = next(item for item in changed if item["submission_id"] == "s2")
                mutate(row)
                changed.sort(key=lambda item: (
                    item["article_key"], item["submitted_at"], item["submission_id"]
                ))
                self.write_raw(changed)
                report = self.report()
                self.assertEqual(
                    report["coverage"]["task_identity_stale_submissions"], 1
                )
                self.assertEqual(report["coverage"]["usable_submissions"], 1)
                self.assertEqual(
                    report["model_comparison"]
                    ["submissions_with_any_model_disagreement"], 0
                )

    @staticmethod
    def mutate_model_snapshot(row: dict) -> None:
        row["model_labels"]["leaning"] = "progressive"
        row["evaluation"]["leaning"] = decision("progressive", "confirmed")

    def test_answer_signature_includes_party_completeness_confirmation(self):
        confirmed = copy.deepcopy(self.records[0])
        incomplete = copy.deepcopy(confirmed)
        incomplete["evaluation"]["parties_confirmed_complete"] = False
        self.assertNotEqual(
            pilot.answer_signature(confirmed), pilot.answer_signature(incomplete)
        )

    def test_tampered_hash_wrong_revision_and_invalid_evaluation_fail_closed(self):
        text = self.raw.read_text(encoding="utf-8")
        self.raw.write_text(text.replace('"status": "raw"', '"status": "reviewed"', 1),
                            encoding="utf-8")
        with self.assertRaisesRegex(pilot.PilotReportError, "hash"):
            self.report()
        self.write_raw(self.records)
        invalid = copy.deepcopy(self.records)
        invalid[0]["evaluation"]["leaning"]["label"] = "invented"
        self.write_raw(invalid)
        with self.assertRaisesRegex(pilot.PilotReportError, "invalid evaluation"):
            self.report()
        malformed_status = copy.deepcopy(self.records)
        malformed_status[0]["status"] = []
        self.write_raw(malformed_status)
        with self.assertRaisesRegex(pilot.PilotReportError, "invalid metadata"):
            self.report()
        self.write_raw(self.records)
        bundle = json.loads((self.app_data / "a.bg.json").read_text(encoding="utf-8"))
        bundle["generated_at"] = "2026-09-02T00:00:00Z"
        (self.app_data / "a.bg.json").write_text(json.dumps(bundle), encoding="utf-8")
        with self.assertRaisesRegex(SyncError, "multiple revisions"):
            self.report()


if __name__ == "__main__":
    unittest.main()
