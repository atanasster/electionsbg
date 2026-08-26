#!/usr/bin/env python3
"""Tests for score_analyses.py — the instrument that decides what „good
enough" means.

⚠️⚠️ A SCORING HARNESS THAT DOES NOT DISCRIMINATE IS WORSE THAN NONE: it
produces confident numbers about a model nobody measured. Perfect
self-agreement proves nothing, so every test here feeds a KNOWN kind of
disagreement and asserts the metric moves the right way.

Measured against the real corpus (365 records, perturbed):

    identical                    lean κ=1.000  F1=1.000  quality acc=1.000
    near miss (one step, same side)     κ=0.792  F1=0.500
    crosses the centre                  κ=-0.905 F1=0.500
    always not_applicable               κ=None   F1=0.237
    always „ok" on quality                                acc=0.652

The third line is the whole argument for ordinal weighting: macro-F1 scores
the near miss and the centre-crossing IDENTICALLY at 0.5, and κ separates
them by 1.7 points of agreement.

Run:  python3 news/scripts/test_score_analyses.py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_app_data import AXIS_POSITIONS  # noqa: E402
from score_analyses import (  # noqa: E402
    load_set, macro_f1, primary_category, score_axis, score_mentions,
    score_quality, score_topics, weighted_kappa)


def rec(url="u1", **over):
    base = {
        "url": url, "domain": "x.bg",
        "quality": {"verdict": "ok", "notes": ""},
        "leaning": {"label": "not_applicable", "confidence": 0.8},
        "russia_stance": {"label": "not_applicable", "confidence": 0.9},
        "ai_generated": {"verdict": "likely_human", "confidence": 0.6},
        "topics": [{"category": "society", "subcategory": None,
                    "primary": True}],
    }
    base.update(over)
    return base


def sets(ref_recs, hyp_recs):
    return ({r["url"]: r for r in ref_recs}, {h["url"]: h for h in hyp_recs})


class OrdinalKappa(unittest.TestCase):
    """⚠️ The reason plain κ is not enough."""

    def pairs(self, *pp):
        return list(pp)

    def test_a_NEAR_MISS_scores_better_than_crossing_the_centre(self):
        # ⚠️⚠️ THE central assertion of this harness. Plain κ scores
        # conservative-for-strong_conservative exactly as badly as
        # progressive-for-conservative; on the real corpus the ordinal
        # version separates them by 1.7 points (0.792 vs -0.905), and
        # macro-F1 gives both 0.500.
        near = weighted_kappa(
            [("conservative", "strong_conservative")] * 10 +
            [("progressive", "progressive")] * 10, "leaning")
        crossed = weighted_kappa(
            [("conservative", "progressive")] * 10 +
            [("progressive", "progressive")] * 10, "leaning")
        self.assertGreater(near["kappa"], crossed["kappa"])
        # ⚠️ „greater than" alone is satisfiable by an UNWEIGHTED κ: with
        # every positioned pair disagreeing, both come out low and the
        # ordering can survive by accident. The weighting's actual claim is
        # that a one-step miss on the same side is still SUBSTANTIAL
        # agreement, which unweighted κ can never produce here.
        self.assertGreater(near["kappa"], 0.5)
        # Chance level or worse. On this fixture it is exactly 0.0 — the
        # model's crossed answers carry no information at all — while on the
        # real corpus the same perturbation reaches -0.905.
        self.assertLessEqual(crossed["kappa"], 0.0)
        # …and the near miss is not scored as agreement either.
        self.assertLess(near["kappa"], 1.0)

    def test_the_distance_is_what_counts_not_the_mismatch(self):
        # One step apart against two steps apart, same number of
        # disagreements — unweighted κ cannot tell these apart at all.
        one = weighted_kappa([("neutral", "conservative")] * 10 +
                             [("progressive", "progressive")] * 10, "leaning")
        two = weighted_kappa([("neutral", "strong_conservative")] * 10 +
                             [("progressive", "progressive")] * 10, "leaning")
        self.assertGreater(one["kappa"], two["kappa"])

    def test_the_weights_are_QUADRATIC_and_the_choice_is_pinned(self):
        # ⚠️ Quadratic and linear are BOTH legitimate ordinal weightings —
        # which is exactly why the choice has to be pinned rather than
        # merely ordered. Every assertion about „near miss beats crossing
        # the centre" holds under both, so a silent switch would move every
        # κ this harness publishes with nothing going red. Quadratic is the
        # standard choice for an ordinal scale and penalises a one-step miss
        # gently; linear penalises it roughly twice as hard.
        got = weighted_kappa([("neutral", "conservative")] * 10 +
                             [("progressive", "progressive")] * 10, "leaning")
        self.assertEqual(got["observed_agreement"], 0.969)
        self.assertEqual(got["kappa"], 0.667)

    def test_perfect_agreement_is_one(self):
        got = weighted_kappa([("progressive", "progressive"),
                              ("conservative", "conservative")] * 5, "leaning")
        self.assertEqual(got["kappa"], 1.0)

    def test_not_applicable_is_EXCLUDED_and_counted(self):
        # ⚠️ It is the majority class, and mapping it to 0 would make it a
        # near neighbour of `neutral` — turning the commonest confusion in
        # the corpus into a rounding error.
        got = weighted_kappa(
            [("not_applicable", "not_applicable")] * 90 +
            [("progressive", "conservative")] * 10, "leaning")
        self.assertEqual(got["n"], 10)
        self.assertEqual(got["excluded"], 90)

    def test_it_REPORTS_when_there_is_nothing_to_score(self):
        # ⚠️ A κ of 0.0 and „no rows carried a position" are different facts,
        # and only one of them is a score.
        got = weighted_kappa([("not_applicable", "not_applicable")] * 50,
                             "leaning")
        self.assertIsNone(got["kappa"])
        self.assertEqual(got["n"], 0)
        self.assertIn("fewer than two", got["why"])

    def test_the_two_axes_use_their_OWN_scales(self):
        # A Russia label scored against the leaning positions would drop
        # every row and report „nothing to score" for a full corpus.
        got = weighted_kappa([("pro_russia", "anti_russia")] * 10,
                             "russia_stance")
        self.assertEqual(got["n"], 10)
        self.assertEqual(weighted_kappa(
            [("pro_russia", "anti_russia")] * 10, "leaning")["n"], 0)


class MacroF1(unittest.TestCase):
    def test_the_majority_class_does_not_carry_the_score(self):
        # ⚠️ Micro-F1 on a 90%-majority field is the majority class's score
        # wearing an average's name. A model that always answers the majority
        # must score badly here — on the corpus it is 0.237.
        pairs = ([("not_applicable", "not_applicable")] * 90 +
                 [("progressive", "not_applicable")] * 10)
        self.assertLess(macro_f1(pairs)["macro_f1"], 0.6)

    def test_the_label_set_comes_from_the_REFERENCE(self):
        # ⚠️ A hypothesis that invents a label must be penalised through the
        # precision of the labels it took them from, not rewarded with a new
        # perfect-recall class of its own.
        got = macro_f1([("neutral", "invented"), ("neutral", "neutral")])
        self.assertEqual(sorted(got["per_label"]), ["neutral"])

    def test_every_label_carries_its_SUPPORT(self):
        got = macro_f1([("a", "a")] * 9 + [("b", "b")])
        self.assertEqual(got["per_label"]["b"]["support"], 1)


class Quality(unittest.TestCase):
    def test_per_class_recall_sits_beside_accuracy(self):
        # ⚠️ Accuracy alone is 65% for a model that only ever says „ok",
        # which is 238 of 365 records — a figure that reads like a pass.
        ref, hyp = sets(
            [rec(f"u{i}") for i in range(7)] +
            [rec(f"s{i}", quality={"verdict": "too_short"}) for i in range(3)],
            [rec(f"u{i}") for i in range(7)] +
            [rec(f"s{i}") for i in range(3)])
        got = score_quality(ref, hyp)
        self.assertEqual(got["accuracy"], 0.7)
        self.assertEqual(got["recall_by_class"]["too_short"]["recall"], 0.0)
        self.assertEqual(got["recall_by_class"]["ok"]["recall"], 1.0)

    def test_the_confusion_names_the_direction(self):
        ref, hyp = sets([rec("u1", quality={"verdict": "too_short"})],
                        [rec("u1")])
        self.assertIn("too_short->ok", score_quality(ref, hyp)["confusion"])


class Topics(unittest.TestCase):
    def test_only_the_PRIMARY_category_is_scored(self):
        # ⚠️ Secondary topics are optional in the rubric, so scoring the set
        # punishes a model for the rubric's own latitude.
        # ⚠️ The primary is deliberately NOT FIRST. With it first, `topics[0]`
        # and „the one flagged primary" return the same category, so a
        # scorer that ignored the flag entirely would pass.
        ref, hyp = sets(
            [rec("u1", topics=[{"category": "economy", "primary": False},
                               {"category": "society", "primary": True}])],
            [rec("u1", topics=[{"category": "society", "primary": True},
                               {"category": "environment", "primary": False}])])
        self.assertEqual(score_topics(ref, hyp)["top1"], 1.0)

    def test_the_PRIMARY_FLAG_decides_not_the_position(self):
        self.assertEqual(primary_category(
            {"topics": [{"category": "economy", "primary": False},
                        {"category": "society", "primary": True}]}), "society")

    def test_a_reference_with_no_primary_is_not_scored_as_a_miss(self):
        ref, hyp = sets([rec("u1", topics=[])], [rec("u1")])
        got = score_topics(ref, hyp)
        self.assertEqual(got["n"], 0)
        self.assertEqual(got["no_primary_in_reference"], 1)


class Mentions(unittest.TestCase):
    def m(self, *ids):
        return [{"kind": "person", "id": i, "surface": i,
                 "basis": "gazetteer_exact", "role": "mention"} for i in ids]

    def test_precision_and_recall_are_reported_SEPARATELY(self):
        # ⚠️⚠️ NO F1. A wrong link asserts that a named person was in the
        # news when they were not; a missing one costs a reader a click.
        # Averaging them lets precision be traded away silently.
        ref, hyp = sets([rec("u1", mentions=self.m("a", "b"))],
                        [rec("u1", mentions=self.m("a", "c"))])
        got = score_mentions(ref, hyp)
        self.assertEqual(got["precision"], 0.5)
        self.assertEqual(got["recall"], 0.5)
        self.assertNotIn("f1", got)
        self.assertIn("worse than a missing one", got["why_no_f1"])

    def test_a_WRONG_link_lands_in_precision(self):
        ref, hyp = sets([rec("u1", mentions=self.m("a"))],
                        [rec("u1", mentions=self.m("a", "wrong"))])
        got = score_mentions(ref, hyp)
        self.assertEqual(got["recall"], 1.0)
        self.assertEqual(got["precision"], 0.5)
        self.assertEqual(got["false_positives"], 1)

    def test_an_UNRESOLVED_mention_counts_for_neither(self):
        # A refusal is not a link, so it can neither be right nor wrong.
        ref, hyp = sets(
            [rec("u1", mentions=self.m("a"))],
            [rec("u1", mentions=self.m("a") + [
                {"kind": "person", "id": None, "surface": "X",
                 "basis": "not_in_gazetteer", "role": "mention"}])])
        got = score_mentions(ref, hyp)
        self.assertEqual((got["precision"], got["recall"]), (1.0, 1.0))

    def test_absent_mentions_report_NULL_not_zero(self):
        # ⚠️ „No records carry mentions" and „every link was wrong" are
        # different facts, and 0.0 says the second.
        ref, hyp = sets([rec("u1")], [rec("u1")])
        got = score_mentions(ref, hyp)
        self.assertIsNone(got["precision"])
        self.assertIsNone(got["recall"])


class RefusalIsAnError(unittest.TestCase):
    """⚠️⚠️ THE defect this class exists for: a model that declined to answer
    scored macro-F1 = 1.000 while one that answered and erred scored 0.334.
    Refusal was the highest-scoring strategy on every axis — and „emits
    nothing on the hard records" is precisely how a local 12B fails."""

    def test_a_declining_hypothesis_scores_ZERO_not_one(self):
        ref = {f"u{i}": rec(f"u{i}", leaning={"label": "progressive",
                                              "confidence": 0.8})
               for i in range(10)}
        hyp = {f"u{i}": {k: v for k, v in rec(f"u{i}").items()
                         if k != "leaning"} for i in range(10)}
        got = score_axis(ref, hyp, "leaning")
        self.assertEqual(got["macro_f1"], 0.0)
        self.assertEqual(got["declined_by_hyp"], 10)

    def test_a_refusal_appears_in_the_confusion_BY_NAME(self):
        ref = {"u1": rec("u1", leaning={"label": "progressive",
                                        "confidence": 0.8})}
        hyp = {"u1": {k: v for k, v in rec("u1").items() if k != "leaning"}}
        got = score_axis(ref, hyp, "leaning")
        self.assertIn("progressive", got["per_label"])
        self.assertEqual(got["per_label"]["progressive"]["recall"], 0.0)

    def test_answering_WRONGLY_still_beats_nothing_being_scored_as_right(self):
        ref = {f"u{i}": rec(f"u{i}", leaning={"label": "progressive",
                                              "confidence": 0.8})
               for i in range(10)}
        wrong = {f"u{i}": rec(f"u{i}", leaning={"label": "conservative",
                                               "confidence": 0.8})
                 for i in range(10)}
        declining = {f"u{i}": {k: v for k, v in rec(f"u{i}").items()
                               if k != "leaning"} for i in range(10)}
        self.assertEqual(score_axis(ref, wrong, "leaning")["macro_f1"],
                         score_axis(ref, declining, "leaning")["macro_f1"])
        # Both are 0.0 — the point is that declining is NOT better.
        self.assertEqual(score_axis(ref, declining, "leaning")["macro_f1"], 0.0)

    def test_the_refusal_sentinel_cannot_COLLIDE_with_a_real_label(self):
        # ⚠️ Set to „neutral", a refusal would be scored as a correct
        # `neutral` answer — turning „the model said nothing" into „the model
        # was right" on every neutral reference row, which is the majority
        # of the positioned corpus.
        import score_analyses as sa
        self.assertNotIn(sa.DECLINED, AXIS_POSITIONS["leaning"])
        self.assertNotIn(sa.DECLINED, AXIS_POSITIONS["russia_stance"])
        ref = {f"u{i}": rec(f"u{i}", leaning={"label": "neutral",
                                              "confidence": 0.8})
               for i in range(10)}
        hyp = {f"u{i}": {k: v for k, v in rec(f"u{i}").items()
                         if k != "leaning"} for i in range(10)}
        got = score_axis(ref, hyp, "leaning")
        self.assertEqual(got["per_label"]["neutral"]["recall"], 0.0,
                         "a refusal was scored as a correct `neutral`")

    def test_a_missing_REFERENCE_label_is_excluded_and_counted(self):
        # No truth to score against — different from a refusal, and counted
        # separately so a shrinking scorable set is visible.
        ref = {"u1": {k: v for k, v in rec("u1").items() if k != "leaning"},
               "u2": rec("u2", leaning={"label": "progressive",
                                        "confidence": 0.8})}
        hyp = {"u1": rec("u1"), "u2": rec("u2", leaning={
            "label": "progressive", "confidence": 0.8})}
        got = score_axis(ref, hyp, "leaning")
        self.assertEqual(got["no_reference_label"], 1)
        self.assertEqual(got["n"], 1)

    def test_quality_does_not_score_None_against_None_as_a_HIT(self):
        # ⚠️ `None == None` counted as correct, so two sets that both
        # answered nothing reported accuracy 1.0.
        ref = {"u1": {k: v for k, v in rec("u1").items() if k != "quality"}}
        hyp = {"u1": {k: v for k, v in rec("u1").items() if k != "quality"}}
        got = score_quality(ref, hyp)
        self.assertEqual(got["no_reference_verdict"], 1)
        self.assertEqual(got["n"], 0)
        self.assertIsNone(got["accuracy"])

    def test_a_declining_QUALITY_hypothesis_scores_zero(self):
        ref = {"u1": rec("u1")}
        hyp = {"u1": {k: v for k, v in rec("u1").items() if k != "quality"}}
        self.assertEqual(score_quality(ref, hyp)["accuracy"], 0.0)


class MissingFieldsDoNotCrash(unittest.TestCase):
    def test_a_None_in_the_confusion_table_does_not_raise(self):
        # ⚠️ `sorted()` over tuples containing None raises TypeError
        # comparing None with a str — from inside the results dict, killing
        # the WHOLE run rather than the one field. 111 of 365 reference
        # records already carry no primary topic.
        ref = {"u1": rec("u1", topics=[]),
               "u2": rec("u2", topics=[{"category": "society",
                                        "primary": True}])}
        hyp = {"u1": rec("u1"), "u2": rec("u2", topics=[
            {"category": "economy", "primary": True}])}
        got = score_topics(ref, hyp)
        self.assertEqual(got["no_primary_in_reference"], 1)
        self.assertIn("society->economy", got["confusion"])

    def test_a_None_HYPOTHESIS_reaches_the_confusion_table(self):
        # ⚠️ The reference side is filtered before the table is built, so
        # only a None on the HYPOTHESIS side actually exercises the sort —
        # and that is the common case: a model that classified nothing.
        ref = {"u1": rec("u1", topics=[{"category": "society",
                                        "primary": True}]),
               "u2": rec("u2", topics=[{"category": "economy",
                                        "primary": True}])}
        hyp = {"u1": rec("u1", topics=[]), "u2": rec("u2", topics=[])}
        got = score_topics(ref, hyp)
        self.assertEqual(got["top1"], 0.0)
        self.assertIn("society->None", got["confusion"])

    def test_two_rows_sharing_a_REFERENCE_label_do_not_raise(self):
        # ⚠️ The exact reachability condition, and the earlier fixture missed
        # it: Python compares tuples element-wise, so ('a','b') vs
        # ('society', None) never reaches the None — 'a' < 'society' settles
        # it first. The TypeError needs two keys sharing their FIRST element
        # and differing on the second with one of them None, which is an
        # ordinary shape: one article the model classified and one it did not,
        # both the same topic in the reference.
        ref = {"u1": rec("u1", topics=[{"category": "society",
                                        "primary": True}]),
               "u2": rec("u2", topics=[{"category": "society",
                                        "primary": True}])}
        hyp = {"u1": rec("u1", topics=[]),
               "u2": rec("u2", topics=[{"category": "economy",
                                        "primary": True}])}
        got = score_topics(ref, hyp)
        self.assertEqual(sorted(got["confusion"]),
                         ["society->None", "society->economy"])


class TheWholeRun(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="score_"))

    def write(self, name, records):
        d = self.root / name / "x.bg"
        d.mkdir(parents=True, exist_ok=True)
        for r in records:
            (d / f"{r['url'].rsplit('/', 1)[-1]}.json").write_text(
                json.dumps(r, ensure_ascii=False), encoding="utf-8")
        return self.root / name

    def run_cli(self, ref, hyp):
        import subprocess
        proc = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("score_analyses.py")),
             "--ref", str(ref), "--hyp", str(hyp), "--json"],
            capture_output=True, text=True)
        return proc.returncode, json.loads(proc.stdout or "{}")

    def test_no_overlap_is_an_ERROR_not_a_table_of_nulls(self):
        # ⚠️ A table of nulls reads like „nothing to report" rather than
        # „these two sets are about different articles".
        a = self.write("a", [rec("https://x.bg/1")])
        b = self.write("b", [rec("https://x.bg/2")])
        code, out = self.run_cli(a, b)
        self.assertEqual(code, 2)
        self.assertEqual(out["error"], "no_overlap")

    def test_the_counts_travel_with_their_denominators(self):
        a = self.write("a", [rec(f"https://x.bg/{i}") for i in range(5)])
        b = self.write("b", [rec(f"https://x.bg/{i}") for i in range(3)])
        _, out = self.run_cli(a, b)
        self.assertEqual((out["ref_records"], out["hyp_records"],
                          out["scored"], out["missing_from_hyp"]),
                         (5, 3, 3, 2))

    def test_there_is_NO_overall_score_and_the_output_says_why(self):
        # ⚠️ A score read out of a JSON blob months from now must carry the
        # reason there is no single number in it.
        a = self.write("a", [rec("https://x.bg/1")])
        _, out = self.run_cli(a, a)
        self.assertNotIn("overall", out)
        self.assertNotIn("score", {k for k in out if k != "no_overall_score"})
        self.assertIn("majority class", out["no_overall_score"])

    def test_identical_sets_score_perfectly_on_every_field(self):
        a = self.write("a", [
            rec("https://x.bg/1", leaning={"label": "progressive",
                                           "confidence": 0.8}),
            rec("https://x.bg/2", leaning={"label": "conservative",
                                           "confidence": 0.8})])
        _, out = self.run_cli(a, a)
        self.assertEqual(out["fields"]["quality"]["accuracy"], 1.0)
        self.assertEqual(out["fields"]["topics"]["top1"], 1.0)
        self.assertEqual(out["fields"]["leaning"]["macro_f1"], 1.0)
        self.assertEqual(
            out["fields"]["leaning"]["ordinal_kappa"]["kappa"], 1.0)

    def test_a_CONSTANT_classifier_does_not_score_well(self):
        # ⚠️ The calibration that matters: `leaning` is not_applicable on 90%
        # of the corpus, so a model that always answers it would score ~90%
        # on accuracy. Macro-F1 must refuse to call that good.
        ref = self.write("ref", (
            [rec(f"https://x.bg/n{i}") for i in range(18)] +
            [rec(f"https://x.bg/p{i}",
                 leaning={"label": "progressive", "confidence": 0.6})
             for i in range(2)]))
        hyp = self.write("hyp", [rec(f"https://x.bg/n{i}") for i in range(18)] +
                         [rec(f"https://x.bg/p{i}") for i in range(2)])
        _, out = self.run_cli(ref, hyp)
        self.assertLess(out["fields"]["leaning"]["macro_f1"], 0.6)


if __name__ == "__main__":
    unittest.main()
