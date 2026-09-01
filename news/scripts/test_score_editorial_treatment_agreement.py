#!/usr/bin/env python3

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import score_editorial_treatment_agreement as scoring  # noqa: E402


def judgment(*, leaning: str = "neutral",
             russia: str = "not_applicable", tone: str = "neutral") -> dict:
    return {
        "leaning": leaning,
        "russia_stance": russia,
        "party_tone": tone,
    }


class AgreementScoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assignments = json.loads(scoring.DEFAULT_SAMPLE.read_text(encoding="utf-8"))
        cls.pending_a = json.loads(scoring.DEFAULT_PASS_A.read_text(encoding="utf-8"))
        cls.pending_b = json.loads(scoring.DEFAULT_PASS_B.read_text(encoding="utf-8"))

    def completed(self, first="Human A", second="Human B", *, constant=False):
        left, right = copy.deepcopy(self.pending_a), copy.deepcopy(self.pending_b)
        left.update(adjudicator=first, completed_at="2026-09-01T09:00:00+00:00")
        right.update(adjudicator=second, completed_at="2026-09-01T10:00:00+00:00")
        by_id = {}
        for index, assignment in enumerate(self.assignments["assignments"]):
            if constant:
                decision = judgment()
            else:
                decision = judgment(
                    leaning=scoring.ORDERS["leaning"][index % 5],
                    russia=scoring.ORDERS["russia_stance"][index % 5],
                    tone=scoring.ORDERS["party_tone"][index % 5],
                )
            by_id[assignment["assignment_id"]] = decision
        for doc in (left, right):
            for row in doc["rows"]:
                row["decision"] = copy.deepcopy(by_id[row["assignment_id"]])
            doc["rows_sha256"] = scoring.canonical_sha(doc["rows"])
        return left, right

    def test_checked_in_sample_is_blocked_not_silently_passed(self):
        result = scoring.score(self.assignments, self.pending_a, self.pending_b)
        self.assertEqual(result["status"], "blocked_pending_humans")
        self.assertFalse(result["passed"])

    def test_perfect_two_human_agreement_passes_all_axes(self):
        left, right = self.completed()
        result = scoring.score(self.assignments, left, right)
        self.assertTrue(result["passed"])
        self.assertTrue(all(axis["weighted_kappa"] == 1.0
                            for axis in result["axes"].values()))

    def test_constant_label_agreement_is_unscorable_not_perfect(self):
        left, right = self.completed(constant=True)
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "insufficient_label_diversity")
        self.assertTrue(all(axis["weighted_kappa"] is None
                            for axis in result["axes"].values()))

    def test_model_cannot_be_used_as_kappa_denominator(self):
        left, right = self.completed()
        right["annotator_kind"] = "model"
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "invalid")

    def test_solo_fallback_requires_a_week_between_passes(self):
        left, right = self.completed("Human A", "Human A")
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "invalid")
        right["completed_at"] = "2026-09-08T10:00:00+00:00"
        self.assertTrue(scoring.score(self.assignments, left, right)["passed"])

    def test_malformed_or_naive_timestamp_is_invalid_not_a_crash(self):
        left, right = self.completed()
        for value in ("not-a-date", "2026-09-01T10:00:00"):
            mutated = copy.deepcopy(right)
            mutated["completed_at"] = value
            result = scoring.score(self.assignments, left, mutated)
            self.assertEqual(result["status"], "invalid")

    def test_changed_assignment_field_fails_even_when_pass_is_resealed(self):
        left, right = self.completed()
        left["rows"][0]["article_path"] = "news/data/wrong.json"
        left["rows_sha256"] = scoring.canonical_sha(left["rows"])
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any("immutable article_path" in error
                            for error in result["errors"]))

    def test_unsealed_human_edit_is_rejected(self):
        left = copy.deepcopy(self.pending_a)
        right = copy.deepcopy(self.pending_b)
        left["rows"][0]["decision"] = judgment()
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any("unsealed" in error for error in result["errors"]))

    def test_kappa_detects_ordinal_disagreement(self):
        left = ["strong_unfavorable", "unfavorable", "neutral", "favorable"]
        right = ["strong_favorable", "favorable", "neutral", "unfavorable"]
        value = scoring.weighted_kappa(left, right, scoring.ORDERS["party_tone"])
        self.assertLess(value, 0.8)


if __name__ == "__main__":
    unittest.main(verbosity=2)
