#!/usr/bin/env python3

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import editorial_treatment_baseline as baseline  # noqa: E402


class FixtureContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads(baseline.FIXTURES_PATH.read_text(encoding="utf-8"))

    def test_fixture_set_has_at_least_sixty_valid_cases(self):
        self.assertGreaterEqual(len(self.doc["cases"]), 60)
        self.assertEqual(baseline.validate_fixtures(self.doc), [])

    def test_each_axis_has_real_boundary_coverage(self):
        vocab = {
            "party_tone": baseline.PARTY_TONES,
            "russia_stance": baseline.RUSSIA,
            "leaning": baseline.LEANING,
        }
        for axis in ("party_tone", "russia_stance", "leaning"):
            cases = [row for row in self.doc["cases"] if row["axis"] == axis]
            labels = {row["expected"]["label"] for row in cases}
            self.assertEqual(labels, vocab[axis])
            self.assertTrue(any(row["expected"]["mixed_evidence"] for row in cases))
            self.assertTrue(any(row["expected"]["mixed_evidence"]
                                and row["expected"]["label"] not in
                                {"neutral", "not_applicable"} for row in cases))
            self.assertTrue(any(row["expected"]["treatment_basis"] == "clean_amplification"
                                for row in cases))
            self.assertTrue(any(row["expected"]["treatment_basis"] == "authorial_thesis"
                                for row in cases))

    def test_declared_article_shapes_and_russia_scope_boundary_are_locked(self):
        types = {row["article_type"] for row in self.doc["cases"]}
        self.assertTrue({
            "press_release", "wire_copy", "interview", "procedural_report",
            "multi_source_report", "opinion", "profile", "investigation",
        }.issubset(types))
        self.assertTrue(any(
            row["axis"] == "russia_stance"
            and row["article_type"] in {"culture", "human_interest"}
            and row["expected"]["label"] == "not_applicable"
            for row in self.doc["cases"]
        ))
    def test_quote_cardinality_mutation_is_rejected(self):
        mutated = json.loads(json.dumps(self.doc))
        case = next(row for row in mutated["cases"]
                    if row["expected"]["label"] == "favorable")
        case["expected"]["evidence_quotes"] = []
        self.assertTrue(any(case["id"] in error
                            for error in baseline.validate_fixtures(mutated)))

    def test_analytical_reason_is_not_used_as_grounded_quote(self):
        mutated = json.loads(json.dumps(self.doc))
        case = next(row for row in mutated["cases"]
                    if row["expected"]["label"] == "progressive")
        case["expected"]["evidence_quotes"] = [case["expected"]["reason"]]
        errors = baseline.validate_fixtures(mutated)
        self.assertTrue(any("ungrounded quote" in error for error in errors))

    def test_mixed_case_requires_two_separately_grounded_quotes(self):
        mixed = next(row for row in self.doc["cases"]
                     if row["expected"]["mixed_evidence"])
        self.assertEqual(len(mixed["expected"]["evidence_quotes"]), 2)
        for quote in mixed["expected"]["evidence_quotes"]:
            self.assertIn(baseline.normalized(quote),
                          baseline.normalized(mixed["excerpt_bg"]))


class FrozenArtifactTests(unittest.TestCase):
    def test_checked_in_artifacts_are_internally_consistent(self):
        self.assertEqual(baseline.verify_artifacts(), [])

    def test_human_gate_sample_is_blinded_and_hash_bound(self):
        doc = json.loads(baseline.AGREEMENT_PATH.read_text(encoding="utf-8"))
        self.assertEqual(len(doc["assignments"]), 50)
        self.assertFalse(doc["selection"]["old_labels_exposed"])
        self.assertEqual(len({row["article_path"] for row in doc["assignments"]}), 50)
        self.assertTrue(all("v1_tone" not in row and "analysis_path" not in row
                            for row in doc["assignments"]))

    def test_human_passes_are_separate_and_reshuffled(self):
        pass_a = json.loads(baseline.PASS_A_PATH.read_text(encoding="utf-8"))
        pass_b = json.loads(baseline.PASS_B_PATH.read_text(encoding="utf-8"))
        self.assertNotEqual(pass_a["order_sha256"], pass_b["order_sha256"])
        self.assertEqual({row["assignment_id"] for row in pass_a["rows"]},
                         {row["assignment_id"] for row in pass_b["rows"]})
        self.assertTrue(all("analysis_path" not in row for row in pass_a["rows"] + pass_b["rows"]))
        self.assertTrue(all(row["decision"] is None
                            for row in pass_a["rows"] + pass_b["rows"]))

    def test_mutable_review_outputs_are_not_inside_frozen_assignments(self):
        stratum = json.loads(baseline.STRATUM_PATH.read_text(encoding="utf-8"))
        identity = json.loads(baseline.IDENTITY_PATH.read_text(encoding="utf-8"))
        self.assertTrue(all("manual_adjudication" not in row
                            for row in stratum["pairs"]))
        self.assertTrue(all("human_review" not in row for row in identity["rows"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
