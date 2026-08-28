#!/usr/bin/env python3
"""Tests for party-tone sampling, scoring, gates and benchmark reporting."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import benchmark_party_tones as bench  # noqa: E402
import build_party_tone_eval as sample  # noqa: E402
from validate_party_tone_reference import validate, valid_v2_party_contract  # noqa: E402
from score_analyses import (party_release_gate_results,  # noqa: E402
                            score_party_tones, apply_reference_revision)


def tone(party, value="neutral", party_id=None, confidence=0.9,
         evidence="Фактологично споменаване"):
    return {"party": party, "party_id": party_id, "tone": value,
            "confidence": confidence, "evidence": evidence}


def rec(url, *tones, review=None):
    value = {"url": url, "party_tones": list(tones),
             "party_tones_version": 2}
    if review is not None:
        value["party_tone_review"] = review
    return value


class Sampling(unittest.TestCase):
    def test_signals_are_discourse_shapes_not_tone_labels(self):
        parties = [{"kind": "party", "id": "p1"}]
        got = sample.sampling_signals(
            'Партията заяви: „Това е корупционен провал на кабинета“.', parties)
        self.assertIn("single_party", got)
        self.assertIn("quoted_attack", got)
        self.assertFalse(got & {"favorable", "unfavorable", "neutral", "mixed"})

    def test_contested_alias_and_multi_party_are_distinct_signals(self):
        parties = [{"kind": "party", "id": "p1"},
                   {"kind": "party", "id": "p2"},
                   {"kind": "party", "id": None, "candidates": ["p3", "p4"]}]
        got = sample.sampling_signals("дума " * 200, parties)
        self.assertIn("multi_party", got)
        self.assertIn("ambiguous_alias", got)

    def test_selector_is_deterministic_and_spreads_cells(self):
        entries = []
        cells = list(sample.TARGET_SHARE)
        for i in range(200):
            cell = cells[i % len(cells)]
            entries.append({"path": f"x/{i}.json", "url": f"u{i}",
                            "domain": f"d{i % 9}.bg",
                            "sampling_signals": [cell]})
        for entry in entries:
            entry["date_bucket"] = f"2026-0{(int(entry['url'][1:]) % 4) + 1}"
        a, report_a, dates_a = sample.select(entries, 80, "seed")
        b, report_b, dates_b = sample.select(entries, 80, "seed")
        self.assertEqual(a, b)
        self.assertEqual(report_a, report_b)
        self.assertEqual(dates_a, dates_b)
        self.assertEqual(len(a), 80)
        self.assertGreaterEqual(len({x["drawn_for"] for x in a}), 5)
        self.assertLessEqual(max(dates_a.values()), 40)


class PartyScoring(unittest.TestCase):
    def test_detection_and_tone_are_separate(self):
        ref = {"u": rec("u", tone("А", "favorable", "p1"),
                         tone("Б", "unfavorable", "p2"))}
        hyp = {"u": rec("u", tone("А", "neutral", "p1"),
                         tone("В", "neutral", "p3"))}
        got = score_party_tones(ref, hyp)
        self.assertEqual(got["detection"]["precision"], 0.5)
        self.assertEqual(got["detection"]["recall"], 0.5)
        self.assertEqual(got["tones"]["n"], 1)
        self.assertEqual(got["tones"]["macro_f1"], 0.0)
        self.assertNotIn("accuracy", got)

    def test_declined_tone_is_a_miss(self):
        ref = {"u": rec("u", tone("А", "favorable", "p1"))}
        hyp = {"u": rec("u", {**tone("А", "neutral", "p1"), "tone": None})}
        got = score_party_tones(ref, hyp)
        self.assertEqual(got["tones"]["declined_by_hyp"], 1)
        self.assertEqual(got["tones"]["macro_f1"], 0.0)

    def test_calibration_reports_accuracy_and_gap_by_band(self):
        ref = {"a": rec("a", tone("А", "neutral", "p1")),
               "b": rec("b", tone("А", "neutral", "p1"))}
        hyp = {"a": rec("a", tone("А", "neutral", "p1", 0.95)),
               "b": rec("b", tone("А", "favorable", "p1", 0.95))}
        row = score_party_tones(ref, hyp)["calibration"]["0.90-1.00"]
        self.assertEqual(row["n"], 2)
        self.assertEqual(row["accuracy"], 0.5)
        self.assertEqual(row["absolute_gap"], 0.45)

    def test_identity_and_grounding_failures_are_auditable(self):
        ref = {"u": rec("u", tone("А", "neutral", "right"))}
        hyp = {"u": rec("u", tone("А", "neutral", "wrong"), review=[
            {"party": "А", "reason": "evidence_not_grounded"}])}
        got = score_party_tones(ref, hyp, {"u": {"content": "друг текст"}})
        self.assertEqual(got["identity"]["wrong_canonical_links"], 1)
        self.assertEqual(got["evidence"]["unsupported"], 1)

    def test_unresolved_reference_name_matches_deterministic_candidate_id(self):
        ref = {"u": rec("u", tone("А", "neutral", None))}
        hyp = {"u": rec("u", tone("А", "neutral", "p1"))}
        got = score_party_tones(ref, hyp)
        self.assertEqual(got["detection"]["true_positives"], 1)
        self.assertEqual(got["detection"]["false_positives"], 0)
        self.assertEqual(got["tones"]["n"], 1)
        self.assertEqual(got["identity"]["wrong_canonical_links"], 0)

    def test_missing_gate_evidence_fails_closed(self):
        perfect = score_party_tones(
            {"u": rec("u", tone("А", "neutral", "p1"))},
            {"u": rec("u", tone("А", "neutral", "p1"))},
            {"u": {"content": "Фактологично споменаване"}})
        got = party_release_gate_results(perfect)
        self.assertFalse(got["passed"])
        self.assertFalse(got["checks"]["valid_schema_after_review"]["passed"])

    def test_every_gate_can_pass(self):
        labels = ("favorable", "unfavorable", "neutral", "mixed")
        ref = {f"u{i}": rec(f"u{i}", tone("А", label, "p1"))
               for i, label in enumerate(labels)}
        hyp = {u: dict(v) for u, v in ref.items()}
        metrics = score_party_tones(
            ref, hyp, {url: {"content": "Фактологично споменаване"}
                       for url in ref})
        got = party_release_gate_results(
            metrics, {"before_retry": .99, "after_review": 1.0})
        self.assertTrue(got["passed"], got)


class Benchmark(unittest.TestCase):
    def test_metadata_sits_beside_accuracy_without_an_overall_score(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run = root / "run"
            run.mkdir()
            (run / "a.json").write_text(json.dumps(
                rec("u", tone("А", "neutral", "p1"))), encoding="utf-8")
            (run / "run.json").write_text(json.dumps({
                "latency_ms": {"p50": 100}, "cost_usd": 0.01,
                "valid_schema_before_retry": 1,
                "valid_schema_after_review": 1}), encoding="utf-8")
            rows = bench.benchmark(
                {"u": rec("u", tone("А", "neutral", "p1"))},
                [("model", run)])
            self.assertEqual(rows[0]["operations"]["cost_usd"], 0.01)
            self.assertIn("party_tones", rows[0])
            self.assertNotIn("overall_score", rows[0])


class ReferenceRevision(unittest.TestCase):
    def test_overlay_is_checked_and_does_not_mutate_base(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            gold = Path(__file__).resolve().parents[1] / "data" / "gold" / "gold_set.json"
            import hashlib
            revision = root / "revision.json"
            revision.write_text(json.dumps({
                "version": 2,
                "base_gold_selection": "news/data/gold/gold_set.json",
                "base_gold_selection_sha256": hashlib.sha256(
                    gold.read_bytes()).hexdigest(),
                "records": {"u": {"entities_parties": ["А"],
                                  "party_tones": [tone("А", "neutral", "p1")]}}}),
                encoding="utf-8")
            base = {"u": rec("u")}
            got = apply_reference_revision(base, revision)
            self.assertEqual(base["u"]["party_tones"], [])
            self.assertEqual(got["u"]["party_tones"][0]["party_id"], "p1")

    def test_hash_mismatch_refuses_the_overlay(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            revision = root / "revision.json"
            revision.write_text(json.dumps({"version": 2,
                "base_gold_selection": "news/data/gold/gold_set.json",
                "base_gold_selection_sha256": "not-the-file", "records": {}}),
                encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "base_hash_mismatch"):
                apply_reference_revision({}, revision)


class ReferencePackage(unittest.TestCase):
    def test_a_v2_empty_party_assessment_is_a_valid_adjudication(self):
        self.assertTrue(valid_v2_party_contract({
            "party_tones_version": 2,
            "entities": {"parties": []}, "party_tones": []}))
        self.assertFalse(valid_v2_party_contract({
            "party_tones_version": 2,
            "entities": {"parties": ["А"]}, "party_tones": []}))

    def test_missing_primary_labels_refuse_the_benchmark_reference(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            # The function must reject before it treats a bare candidate draw
            # as a completed gold supplement; no fake independent count.
            doc = {"version": 1, "articles": []}
            path = root / "supplement.json"
            path.write_text(json.dumps(doc), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "supplement_below_minimum"):
                validate(path, root / "primary")


if __name__ == "__main__":
    unittest.main()
