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
        self.assertTrue(all(axis["measures"]["direction"]["weighted_kappa"] == 1.0
                            for axis in result["axes"].values()))

    def test_constant_label_agreement_is_unscorable_not_perfect(self):
        left, right = self.completed(constant=True)
        result = scoring.score(self.assignments, left, right)
        self.assertEqual(result["status"], "insufficient_label_diversity")
        self.assertTrue(all(axis["measures"]["direction"]["weighted_kappa"] is None
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

    # --- the off-scale category is nominal, not an ordinal position ---------

    def test_applicability_disagreement_costs_the_same_in_both_directions(self):
        """The defect this split fixes: under one six-item ordinal list the
        SAME `not_applicable` confusion scored 0.71 against one pole and 0.99
        against the other, purely because of where the category sat in the
        array. Both directions must now cost identically."""

        base = ["not_applicable"] * 30 + ["neutral"] * 8 + ["pro_russia"] * 6 \
            + ["anti_russia"] * 6
        toward_low, toward_high = list(base), list(base)
        for index in range(3):
            toward_low[index] = "strong_pro_russia"
            toward_high[index] = "strong_anti_russia"
        low = scoring.score_axis("russia_stance", base, toward_low, 7, min_n=0)
        high = scoring.score_axis("russia_stance", base, toward_high, 7, min_n=0)
        self.assertEqual(low["measures"]["applicability"]["weighted_kappa"],
                         high["measures"]["applicability"]["weighted_kappa"])

    def test_moving_the_off_scale_label_cannot_change_the_verdict(self):
        """Mutation guard on the fix itself. Scoring the scale with the
        off-scale label appended in a different place must be impossible,
        because it is never on the scale at all."""

        self.assertNotIn("not_applicable", scoring.AXES["leaning"]["scale"])
        self.assertNotIn("not_applicable", scoring.AXES["russia_stance"]["scale"])
        self.assertIsNone(scoring.AXES["party_tone"]["off_scale"])
        for axis, spec in scoring.AXES.items():
            self.assertEqual(len(spec["scale"]), 5, axis)

    def test_direction_ignores_rows_either_pass_called_not_applicable(self):
        left = ["not_applicable", "neutral", "conservative", "progressive"]
        right = ["conservative", "neutral", "conservative", "progressive"]
        axis = scoring.score_axis("leaning", left, right, 3, min_n=0)
        self.assertEqual(axis["measures"]["direction"]["n"], 3)
        self.assertEqual(axis["measures"]["direction"]["weighted_kappa"], 1.0)
        self.assertFalse(axis["measures"]["applicability"]["passed"])
        self.assertFalse(axis["passed"])

    def test_axis_with_no_not_applicable_row_is_not_exercised_not_failed(self):
        left = ["neutral", "conservative", "progressive", "neutral"]
        axis = scoring.score_axis("leaning", left, list(left), 3, min_n=0)
        self.assertEqual(axis["measures"]["applicability"]["status"],
                         "not_exercised")
        self.assertTrue(axis["passed"])

    def test_every_row_not_applicable_blocks_instead_of_passing(self):
        left = ["not_applicable"] * 6
        axis = scoring.score_axis("russia_stance", left, list(left), 3, min_n=0)
        self.assertEqual(axis["measures"]["direction"]["status"],
                         "unscorable_empty")
        self.assertFalse(axis["passed"])

    def test_thin_direction_sample_is_withheld_not_a_green_tick(self):
        left = ["not_applicable"] * 44 + ["neutral", "pro_russia",
                                          "anti_russia", "neutral",
                                          "pro_russia", "anti_russia"]
        axis = scoring.score_axis("russia_stance", left, list(left), 3)
        self.assertEqual(axis["measures"]["direction"]["weighted_kappa"], 1.0)
        self.assertEqual(axis["status"], "low_precision")
        self.assertFalse(axis["passed"])
        relaxed = scoring.score_axis("russia_stance", left, list(left), 3, min_n=6)
        self.assertTrue(relaxed["passed"])

    def test_bootstrap_interval_is_deterministic_and_brackets_the_estimate(self):
        left = ["neutral"] * 20 + ["favorable"] * 15 + ["unfavorable"] * 15
        right = list(left)
        right[0] = "favorable"
        right[25] = "neutral"
        axis = scoring.score_axis("party_tone", left, right, 11)
        measure = axis["measures"]["direction"]
        low, high = measure["ci95"]
        self.assertLessEqual(low, measure["weighted_kappa"])
        self.assertLessEqual(measure["weighted_kappa"], high)
        again = scoring.score_axis("party_tone", left, right, 11)
        self.assertEqual(measure["ci95"], again["measures"]["direction"]["ci95"])



    def test_a_skewed_applicability_marginal_is_withheld_not_failed(self):
        """The kappa paradox. Three slips against a 48/2 marginal produce
        kappa 0.65 — a number that is neither a pass nor evidence of a rubric
        problem. It must report as low_precision, and relaxing the floor must
        be what turns it into a real verdict."""

        left = ["not_applicable"] * 2 + ["neutral"] * 30 + ["conservative"] * 18
        right = list(left)
        right[0] = "neutral"
        right[5] = "not_applicable"
        right[6] = "not_applicable"
        axis = scoring.score_axis("leaning", left, right, 5, min_n=0)
        measure = axis["measures"]["applicability"]
        self.assertEqual(measure["minority_n"], 2)
        self.assertLess(measure["weighted_kappa"], scoring.GATE)
        self.assertEqual(measure["status"], "low_precision")
        relaxed = scoring.score_axis("leaning", left, right, 5,
                                     min_n=0, min_minority=0)
        self.assertEqual(relaxed["measures"]["applicability"]["status"], "failed")

    def test_a_well_exercised_applicability_axis_still_fails_on_real_drift(self):
        """Mutation guard on the floor: it must not swallow a genuine B4
        regression on an axis where the category IS well represented."""

        left = ["not_applicable"] * 25 + ["neutral"] * 25
        right = ["neutral"] * 12 + ["not_applicable"] * 13 + ["neutral"] * 25
        axis = scoring.score_axis("russia_stance", left, right, 5, min_n=0)
        measure = axis["measures"]["applicability"]
        self.assertGreaterEqual(measure["minority_n"], scoring.MIN_MINORITY_N)
        self.assertEqual(measure["status"], "failed")
        self.assertFalse(axis["passed"])



if __name__ == "__main__":
    unittest.main(verbosity=2)
