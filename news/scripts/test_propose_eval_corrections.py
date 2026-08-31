#!/usr/bin/env python3
"""Tests for private correction-proposal generation."""

from __future__ import annotations

import copy
import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from news.eval_contract.canonical import canonical_sha256
from news.scripts.propose_eval_corrections import (
    CorrectionProposalError,
    atomic_write,
    build_report,
    load_published_proofs,
    main,
)
from news.scripts.sync_eval_tasks import task_revision

STAMP = "2026-08-31T12:00:00.000Z"
HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64


def model_labels() -> dict:
    return {
        "leaning": "neutral",
        "russia_stance": "anti_russia",
        "party_tones": [
            {"party": "ГЕРБ", "party_id": "gerb", "tone": "neutral"},
            {"party": "ДПС", "party_id": "dps", "tone": "favorable"},
        ],
    }


def evaluation() -> dict:
    return {
        "schema_version": 1,
        "leaning": {
            "label": "progressive",
            "disposition": "changed",
            "evidence": "Контекстът подкрепя социални политики.",
            "reason_codes": ["model_missed_context"],
        },
        "russia_stance": {
            "label": "anti_russia",
            "disposition": "confirmed",
            "evidence": "Русия е описана като агресор.",
            "reason_codes": [],
        },
        "parties_confirmed_complete": True,
        "party_tones": [
            {
                "party": "ГЕРБ", "party_id": "gerb", "tone": "unfavorable",
                "evidence": "Партията е критикувана.", "disposition": "changed",
                "reason_codes": ["tone_misread"],
            },
            {
                "party": "ПП", "party_id": "pp", "tone": "favorable",
                "evidence": "Предложението е подкрепено.",
                "disposition": "added",
                "reason_codes": ["party_missing"],
            },
        ],
        "removed_model_parties": [
            {"party": "ДПС", "party_id": "dps", "reason_code": "party_not_meaningful"}
        ],
        "public_note": "Проверен е целият материал.",
    }


def accepted_record(*, key: str = "example.bg/article-1", revision: int = 4) -> dict:
    domain, article_id = key.split("/", 1)
    return {
        "schema_version": 1,
        "rubric_version": "news-article-evaluation-v1",
        "article_key": key,
        "url": f"https://{domain}/{article_id}",
        "task_revision": revision,
        "content_sha256": HASH_A,
        "analysis_sha256": HASH_B,
        "source_submission_ids": ["private-submission-id"],
        "operator_actor": {"kind": "maintainer", "id": "private-editor"},
        "adjudicated_at": STAMP,
        "revision": 2,
        "evaluation": evaluation(),
        "model_labels": model_labels(),
        "public_explanation": (
            "Проверено спрямо оригиналния материал."
        ),
        "gold_eligible": True,
        "status": "accepted",
        "last_operation_id": "accept-operation-0001",
    }


def accepted_snapshot(records: list[dict] | None = None) -> dict:
    values = records or [accepted_record()]
    values.sort(key=lambda item: item["article_key"].encode("utf-8"))
    return {
        "manifest": {
            "schema_version": 1,
            "snapshot_kind": "news-eval-accepted-adjudications",
            "project_id": "electionsbg-news",
            "firestore_read_time": STAMP,
            "rubric_version": "news-article-evaluation-v1",
            "record_count": len(values),
            "records_sha256": canonical_sha256(values),
        },
        "records": values,
    }


def task(record: dict | None = None) -> dict:
    source = record or accepted_record()
    domain, article_id = source["article_key"].split("/", 1)
    return {
        "schema_version": 1,
        "rubric_version": "news-article-evaluation-v1",
        "article_key": source["article_key"],
        "domain": domain,
        "article_id": article_id,
        "url": source["url"],
        "title": "Заглавие",
        "published": STAMP,
        "story_id": "story-1",
        "primary_topic": "politics",
        "outlet": domain,
        "content_sha256": source["content_sha256"],
        "public_data_revision": STAMP,
        "analysis_sha256": source["analysis_sha256"],
        "model": "test-model",
        "analyzed_at": STAMP,
        "prompt_hashes": {"analysis": HASH_A},
        "model_labels": copy.deepcopy(source["model_labels"]),
        "review_reasons": {"leaning": "Ниска увереност"},
        "dataset_ids": ["community-sample-v1"],
        "accepts_public_evals": True,
        "revision": task_revision(
            source["content_sha256"], source["analysis_sha256"], source["model_labels"]),
        "updated_at": STAMP,
    }


def task_manifest(tasks: list[dict] | None = None) -> dict:
    values = tasks or [task()]
    values.sort(key=lambda item: item["article_key"].encode("utf-8"))
    return {
        "schema_version": 1,
        "manifest_kind": "news-eval-task-sync",
        "generated_at": STAMP,
        "public_data_revision": STAMP,
        "rubric_version": "news-article-evaluation-v1",
        "task_count": len(values),
        "tasks_sha256": canonical_sha256(values),
        "queue_sha256": HASH_A,
        "tasks": values,
    }


class CorrectionProposalTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.accepted = self.root / "accepted.json"
        self.tasks = self.root / "tasks.json"
        record = accepted_record()
        record["task_revision"] = task_revision(
            record["content_sha256"], record["analysis_sha256"], record["model_labels"])
        self.accepted.write_text(
            json.dumps(accepted_snapshot([record]), ensure_ascii=False), encoding="utf-8")
        self.tasks.write_text(
            json.dumps(task_manifest(), ensure_ascii=False), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_changed_fields_generate_private_review_proposals_only(self):
        report = build_report(self.accepted, [self.tasks])
        self.assertFalse(report["publishes_automatically"])
        self.assertEqual(report["matched_previously_public_record_count"], 1)
        self.assertEqual(report["proposal_count"], 4)
        self.assertEqual(
            [(item["field"], item["change_kind"]) for item in report["proposals"]],
            [
                ("leaning", "label_changed"),
                ("party_tones", "label_changed"),
                ("party_tones", "party_removed"),
                ("party_tones", "party_added"),
            ],
        )
        first = report["proposals"][0]
        self.assertEqual(first["path"], "/article/example.bg/article-1")
        self.assertEqual(first["old_label"], "neutral")
        self.assertEqual(first["new_label"], "progressive")
        self.assertEqual(first["correction_date"], "2026-08-31")
        self.assertFalse(first["approved_for_publication"])
        serialized = json.dumps(report, ensure_ascii=False)
        for secret in (
            "private-submission-id", "private-editor", "Контекстът подкрепя",
            "Русия е описана", "Проверен е целият материал",
        ):
            self.assertNotIn(secret, serialized)
        self.assertIn(
            "Проверено спрямо оригиналния материал", serialized)

    def test_confirmations_and_unable_to_judge_create_no_entries(self):
        record = accepted_record()
        record["task_revision"] = task_revision(
            record["content_sha256"], record["analysis_sha256"], record["model_labels"])
        record["evaluation"] = {
            "schema_version": 1,
            "leaning": {
                "label": None, "disposition": "unable_to_judge", "evidence": None,
                "reason_codes": ["insufficient_public_context"],
            },
            "russia_stance": {
                "label": "anti_russia", "disposition": "confirmed",
                "evidence": "Потвърдено.", "reason_codes": [],
            },
            "parties_confirmed_complete": True,
            "party_tones": [{
                **item, "evidence": "Потвърдено.", "disposition": "confirmed",
                "reason_codes": [],
            } for item in model_labels()["party_tones"]],
            "removed_model_parties": [],
            "public_note": None,
        }
        record["gold_eligible"] = False
        self.accepted.write_text(
            json.dumps(accepted_snapshot([record]), ensure_ascii=False), encoding="utf-8")
        report = build_report(self.accepted, [self.tasks])
        self.assertEqual(report["proposal_count"], 0)
        self.assertEqual(report["proposals_sha256"], canonical_sha256([]))

    def test_unproven_record_is_skipped_instead_of_claimed_as_published(self):
        record = accepted_record(revision=9)
        self.accepted.write_text(
            json.dumps(accepted_snapshot([record]), ensure_ascii=False), encoding="utf-8")
        report = build_report(self.accepted, [self.tasks])
        self.assertEqual(report["proposal_count"], 0)
        self.assertEqual(report["matched_previously_public_record_count"], 0)
        self.assertEqual(report["skipped"], [{
            "article_key": "example.bg/article-1",
            "reason": "not_proven_previously_public",
        }])

    def test_manifest_hash_and_conflicting_public_proof_fail_closed(self):
        invalid = task_manifest()
        invalid["tasks"][0]["content_sha256"] = "sha256:" + "c" * 64
        self.tasks.write_text(json.dumps(invalid), encoding="utf-8")
        with self.assertRaisesRegex(CorrectionProposalError, "task hash disagrees"):
            load_published_proofs([self.tasks])

        first = self.root / "first.json"
        second = self.root / "second.json"
        first.write_text(json.dumps(task_manifest()), encoding="utf-8")
        changed = task()
        changed["url"] = "https://example.bg/a-different-url"
        second.write_text(json.dumps(task_manifest([changed])), encoding="utf-8")
        with self.assertRaisesRegex(CorrectionProposalError, "conflicting public proof"):
            load_published_proofs([first, second])

    def test_every_task_field_is_strictly_validated_after_outer_rehash(self):
        mutations = {
            "schema_version": True,
            "title": [],
            "published": "not-a-timestamp",
            "story_id": [],
            "primary_topic": {},
            "outlet": "another.example",
            "model": [],
            "analyzed_at": "2026-08-31",
            "prompt_hashes": {"analysis": "not-a-hash"},
            "review_reasons": {"leaning": []},
            "dataset_ids": ["duplicate", "duplicate"],
            "revision": 1,
        }
        for field, invalid_value in mutations.items():
            value = task_manifest()
            value["tasks"][0][field] = invalid_value
            value["tasks_sha256"] = canonical_sha256(value["tasks"])
            path = self.root / f"invalid-{field}.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            with self.subTest(field=field):
                with self.assertRaises(CorrectionProposalError):
                    load_published_proofs([path])

    def test_foreign_project_fails_without_replacing_last_good_output(self):
        foreign = accepted_snapshot()
        foreign["manifest"]["project_id"] = "demo-news-evals"
        self.accepted.write_text(json.dumps(foreign), encoding="utf-8")
        output = (self.root / "news" / "data" / "evals" / "corrections" /
                  "proposed" / "current.json")
        output.parent.mkdir(parents=True)
        output.write_text("last-good\n", encoding="utf-8")
        args = [
            "--root", str(self.root), "--accepted", str(self.accepted),
            "--published-tasks", str(self.tasks), "--out", str(output),
        ]
        for extra in ([], ["--write"]):
            with self.subTest(write=bool(extra)):
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    self.assertEqual(main([*args, *extra]), 1)
                self.assertEqual(output.read_text(encoding="utf-8"), "last-good\n")

    def test_manifest_is_read_once_and_report_hashes_the_authorizing_value(self):
        original = self.tasks.read_text(encoding="utf-8")
        replacement = task_manifest()
        replacement["tasks"][0]["url"] = "https://example.bg/replaced"
        replacement["tasks_sha256"] = canonical_sha256(replacement["tasks"])
        changed = json.dumps(replacement)
        original_read_text = Path.read_text
        task_reads = 0

        def changing_read(path: Path, *args, **kwargs) -> str:
            nonlocal task_reads
            if path == self.tasks:
                task_reads += 1
                return original if task_reads == 1 else changed
            return original_read_text(path, *args, **kwargs)

        with mock.patch.object(Path, "read_text", autospec=True,
                               side_effect=changing_read):
            report = build_report(self.accepted, [self.tasks])
        self.assertEqual(task_reads, 1)
        self.assertEqual(
            report["published_task_manifests_sha256"],
            canonical_sha256([canonical_sha256(json.loads(original))]),
        )
        self.assertEqual(report["project_id"], "electionsbg-news")

    def test_output_is_deterministic(self):
        first = build_report(self.accepted, [self.tasks])
        second = build_report(self.accepted, [self.tasks])
        self.assertEqual(first, second)
        self.assertEqual(
            first["proposals_sha256"], canonical_sha256(first["proposals"]))
        self.assertEqual(
            len({item["proposal_id"] for item in first["proposals"]}), 4)

    def test_cli_is_dry_by_default_and_writes_private_mode_0600(self):
        private = self.root / "news" / "data" / "evals" / "corrections"
        output = private / "proposed" / "current.json"
        args = [
            "--root", str(self.root), "--accepted", str(self.accepted),
            "--published-tasks", str(self.tasks), "--out", str(output),
        ]
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main(args), 0)
        self.assertFalse(output.exists())
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main([*args, "--write"]), 0)
        self.assertTrue(output.is_file())
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        report = json.loads(output.read_text(encoding="utf-8"))
        self.assertFalse(report["dry_run"])

        public_source = self.root / "newsapp" / "app" / "corrections.ts"
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(main([*args[:-2], "--out", str(public_source), "--write"]), 1)
        self.assertFalse(public_source.exists())

    def test_atomic_failure_preserves_last_good_report(self):
        destination = self.root / "last-good.json"
        destination.write_text("last-good\n", encoding="utf-8")
        with mock.patch("os.replace", side_effect=OSError("injected")):
            with self.assertRaisesRegex(OSError, "injected"):
                atomic_write(destination, {"new": True})
        self.assertEqual(destination.read_text(encoding="utf-8"), "last-good\n")
        self.assertEqual(list(self.root.glob(".last-good.json.*")), [])


if __name__ == "__main__":
    unittest.main()
