#!/usr/bin/env python3
"""T4.4 Phase 0 — the measurement harness, over a synthetic corpus.

No network and no live sidecars: every figure is checked against a corpus
built here, so a test failing means the arithmetic moved rather than the
corpus did.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jev_axes as ax  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_sentiment as sm  # noqa: E402
import jev_sentiment_eval as ev  # noqa: E402

FIVE = ax.SUBJECT_TONE


def score_block(value_level, levels=5, confidence=0.9, spread_over=None):
    """⚠️ `confidence` MUST BE THE MODAL PROBABILITY, not a free field.

    The harness derives it from the distribution (`confidence_derived`), so a
    fixture that sets the two independently tests nothing — every row landed in
    the top confidence bucket regardless of the number passed in.
    """
    if spread_over is None:
        rest = (1.0 - confidence) / max(levels - 1, 1)
        probs = {str(i): (confidence if i == value_level else rest)
                 for i in range(levels)}
    else:
        probs = spread_over
    full = {str(i): float(probs.get(str(i), 0.0)) for i in range(levels)}
    total = sum(full.values()) or 1.0
    full = {k: v / total for k, v in full.items()}
    scale = ax.ANCHOR_VARIANTS[levels]
    values = scale.values
    value = sum(p * values[int(i)] for i, p in full.items())
    return {
        "scale": scale.id, "levels": levels, "level": value_level,
        "probabilities": full, "value": value,
        "normalized": js.normalize(value, scale),
        "spread": 0.0, "confidence_reported": confidence,
        "confidence_derived": max(full.values()),
        "confidence_agrees": abs(confidence - max(full.values())) < 0.005,
        "both_directions": js.both_directions(
            {int(k): v for k, v in full.items()}, scale),
        "both_directions_tau": js.BOTH_DIRECTIONS_TAU_PROVISIONAL,
        "both_directions_tail": js.BOTH_DIRECTIONS_TAIL,
        "anchors": list(scale.anchors), "legend": None,
        "legend_matches_anchors": None, "axes_version": ax.AXES_VERSION,
        "contract_version": js.SCALE_CONTRACT_VERSION,
    }


def record(url, *, leaning=2, applies=0.9, truncated=False, subjects=None,
           confidence=0.9, cost=0.0002, ms=400):
    return {
        "version": sm.RECORD_VERSION, "url": url, "status": "ok",
        "truncated": truncated,
        "axes": {
            "leaning": {"applies": applies,
                        "score": score_block(leaning, confidence=confidence)},
            "russia_stance": {"applies": 0.1,
                              "score": score_block(2, confidence=confidence)},
        },
        "subjects": subjects or [],
        "calls": {"axes": {"status": "ok", "cost": cost, "ms": ms,
                           "input_tokens": 1200, "model": "m"}},
    }


def analysis(url, *, leaning="neutral", russia="not_applicable", party_tones=None,
             glm_truncated=False):
    doc = {
        "url": url, "article_path": f"news/data/x/{url[-8:]}.json",
        "leaning": {"label": leaning}, "russia_stance": {"label": russia},
        "party_tones": party_tones or [],
    }
    if glm_truncated is not None:
        doc["analysis_provenance"] = {"body_truncated": glm_truncated,
                                      "max_body_chars": 6000}
    return doc


class Contract(unittest.TestCase):
    def test_an_integral_corpus_reports_score_as_not_fractional(self):
        # Plan §2.3 is OPEN and this is what settles it — by reading the
        # corpus, not by argument.
        found = ev.contract_findings({"u": record("u", leaning=3)})
        self.assertFalse(found["score_is_fractional"])
        self.assertGreater(found["score_integral"], 0)

    def test_one_fractional_level_flips_the_finding(self):
        rec = record("u")
        rec["axes"]["leaning"]["score"]["level"] = 2.99
        found = ev.contract_findings({"u": rec})
        self.assertTrue(found["score_is_fractional"])
        self.assertEqual(found["score_fractional"], 1)

    def test_the_confidence_rule_is_checked_against_every_answer(self):
        # §2.4 held on five captured samples; this is the corpus-scale check.
        good = ev.contract_findings({"u": record("u", confidence=1.0)})
        self.assertTrue(good["confidence_rule_holds"])
        # A genuine disagreement has to be built explicitly: with the fixture
        # above, `confidence` IS the modal probability, so the two agree by
        # construction — which is the point of §2.4 and the reason this case
        # cannot be produced by passing a smaller number.
        rec = record("u", confidence=0.6)
        rec["axes"]["leaning"]["score"]["confidence_reported"] = 0.42
        rec["axes"]["leaning"]["score"]["confidence_agrees"] = False
        bad = ev.contract_findings({"u": rec})
        self.assertFalse(bad["confidence_rule_holds"])
        self.assertGreater(bad["confidence_disagrees"], 0)

    def test_an_empty_corpus_does_not_claim_the_rule_holds(self):
        # ⚠️ "Nothing disagreed" must not read as "the rule is confirmed".
        self.assertFalse(ev.contract_findings({})["confidence_rule_holds"])


class Agreement(unittest.TestCase):
    def test_exact_and_off_by_one_are_counted_separately(self):
        # ⚠️ On an ordinal, one bucket out and a sign flip are different
        # events, and a single accuracy figure cannot tell them apart.
        records = {"a": record("a", leaning=2, confidence=1.0),
                   "b": record("b", leaning=3, confidence=1.0),
                   "c": record("c", leaning=0, confidence=1.0)}
        analyses = {"a": analysis("a", leaning="neutral"),
                    "b": analysis("b", leaning="neutral"),
                    "c": analysis("c", leaning="neutral")}
        summary = ev.axis_agreement(records, analyses, "leaning")["strata"]["glm_full"]
        self.assertEqual(summary["n"], 3)
        self.assertEqual(summary["exact"], 1)
        self.assertAlmostEqual(summary["within_one_rate"], 2 / 3)
        self.assertAlmostEqual(summary["mean_distance"], (0 + 1 + 2) / 3)

    def test_the_stratum_is_about_what_GLM_read_not_what_jev_read(self):
        # ⚠️⚠️ THE INVERSION THAT MATTERS. Splitting on Jev's own flag put 831
        # GLM-truncated articles (9.12%) into the headline `full` stratum while
        # isolating the ~57 only Jev cut — the exact pollution the module
        # forbids, in the direction the pass exists to fix.
        records = {"a": record("a", leaning=2, confidence=1.0),
                   "b": record("b", leaning=4, confidence=1.0),
                   "c": record("c", leaning=4, truncated=True, confidence=1.0)}
        analyses = {"a": analysis("a"),
                    "b": analysis("b", glm_truncated=True),
                    "c": analysis("c")}
        out = ev.axis_agreement(records, analyses, "leaning")
        strata = out["strata"]
        self.assertEqual(strata["glm_full"]["n"], 2)
        self.assertEqual(strata["glm_prefix"]["n"], 1)
        # Jev's own truncation is COUNTED, never used to stratify.
        self.assertEqual(out["jev_truncated"], 1)
        self.assertEqual(strata["glm_prefix"]["exact"], 0)

    def test_an_analysis_with_no_provenance_is_its_own_stratum(self):
        # ⚠️ 371 records carry none. Calling them complete is a claim, and the
        # headline figure is the one place it would land.
        records = {"a": record("a", leaning=2, confidence=1.0)}
        an = analysis("a")
        del an["analysis_provenance"]
        strata = ev.axis_agreement(records, {"a": an}, "leaning")["strata"]
        self.assertEqual(strata["glm_unknown"]["n"], 1)
        self.assertEqual(strata["glm_full"]["n"], 0)

    def test_glm_not_applicable_is_counted_and_never_folded_in(self):
        # Jev answers that with the `noul`, not with a level, so the two are
        # not comparable — and 87.7% of russia_stance is this label.
        records = {"a": record("a")}
        analyses = {"a": analysis("a", leaning="not_applicable")}
        out = ev.axis_agreement(records, analyses, "leaning")
        self.assertEqual(out["not_applicable_skipped"], 1)
        self.assertEqual(out["strata"]["glm_full"]["n"], 0)

    def test_an_article_with_no_glm_record_is_skipped(self):
        out = ev.axis_agreement({"a": record("a")}, {}, "leaning")
        self.assertEqual(out["strata"]["glm_full"]["n"], 0)


class Calibration(unittest.TestCase):
    def test_the_baseline_is_recomputed_inside_every_bucket(self):
        # ⚠️ THE RULE `jev-benchmark-2026-09-20.md` WROTE AFTER BREAKING IT.
        # The high-confidence bucket is the easy articles, so the majority
        # class is stronger there too; publishing accuracy alone made a gate
        # look four times better than it was.
        # ⚠️ THE FIXTURE MUST MAKE THE TWO BASELINES DIFFER, or the test is
        # vacuous: with every GLM label `neutral`, the in-bucket and the
        # corpus-wide baseline are both 1.0 and a mutant computing the wrong
        # one SURVIVES. Here the high-confidence bucket is all `neutral`
        # (in-bucket baseline 1.0) while the corpus is half `conservative`
        # (corpus-wide baseline 0.5).
        records, analyses = {}, {}
        for i in range(8):
            url = f"hi{i}"
            records[url] = record(url, leaning=2, confidence=0.99)
            analyses[url] = analysis(url, leaning="neutral")
        for i in range(8):
            url = f"lo{i}"
            records[url] = record(url, leaning=3, confidence=0.5)
            analyses[url] = analysis(url, leaning="conservative")
        rows = {r["threshold"]: r for r in ev.calibration(records, analyses, "leaning")}
        top, whole = rows[0.95], rows[0.0]
        self.assertEqual(top["n"], 8)
        self.assertAlmostEqual(top["agreement"], 1.0)
        # In-bucket: every label in the bucket is `neutral`.
        self.assertAlmostEqual(top["in_bucket_baseline"], 1.0)
        # Corpus-wide it is 0.5 — a mutant using it would report lift 0.5.
        self.assertAlmostEqual(whole["in_bucket_baseline"], 0.5)
        # The lift is ZERO despite perfect agreement — the whole point.
        self.assertAlmostEqual(top["lift"], 0.0)

    def test_an_empty_bucket_reports_n_zero_rather_than_dividing(self):
        rows = {r["threshold"]: r for r in ev.calibration({}, {}, "leaning")}
        self.assertEqual(rows[0.95]["n"], 0)


class Mixed(unittest.TestCase):
    def test_the_roc_separates_glms_mixed_from_its_neutral(self):
        torn = score_block(2, spread_over={"0": 0.5, "4": 0.5})
        flat = score_block(2, spread_over={"2": 1.0})
        records = {
            "a": {**record("a"), "subjects": [
                {"name": "ГЕРБ", "kind": "party", "subject_role": "secondary",
                 "assessment_status": "assessed", "tone": torn}]},
            "b": {**record("b"), "subjects": [
                {"name": "ГЕРБ", "kind": "party", "subject_role": "secondary",
                 "assessment_status": "assessed", "tone": flat}]},
        }
        analyses = {
            "a": analysis("a", party_tones=[{"party": "ГЕРБ", "tone": "mixed"}]),
            "b": analysis("b", party_tones=[{"party": "ГЕРБ", "tone": "neutral"}]),
        }
        out = ev.mixed_separation(records, analyses)
        self.assertEqual((out["mixed_n"], out["neutral_n"]), (1, 1))
        at_02 = next(r for r in out["roc"] if r["tau"] == 0.2)
        self.assertEqual(at_02["recall"], 1.0)
        self.assertEqual(at_02["false_positive_rate"], 0.0)

    def test_the_tail_mass_is_the_SMALLER_side(self):
        # "Both directions" is bounded by the weaker tail; taking the larger
        # would call a one-sided answer mixed.
        probs = {0: 0.7, 4: 0.1, 2: 0.2}
        self.assertAlmostEqual(ev.tail_mass(probs, FIVE), 0.1)

    def test_a_corpus_with_no_labelled_pair_returns_an_empty_roc(self):
        self.assertEqual(ev.mixed_separation({}, {})["roc"], [])


class Applicability(unittest.TestCase):
    def test_it_measures_the_separation_the_whole_design_rests_on(self):
        # `not_applicable` is 57.1% of leaning and 87.7% of russia_stance —
        # if the gate cannot tell "silent" from "balanced", nothing built on
        # it can either.
        records, analyses = {}, {}
        for i in range(5):
            records[f"y{i}"] = record(f"y{i}", applies=0.9)
            analyses[f"y{i}"] = analysis(f"y{i}", leaning="neutral")
            records[f"n{i}"] = record(f"n{i}", applies=0.1)
            analyses[f"n{i}"] = analysis(f"n{i}", leaning="not_applicable")
        out = ev.applicability_separation(records, analyses, "leaning")
        self.assertEqual(out["groups"]["neutral"]["n"], 5)
        self.assertEqual(out["groups"]["not_applicable"]["n"], 5)
        self.assertEqual(out["separation_vs_neutral"], 1.0)

    def test_a_gate_that_cannot_tell_them_apart_scores_one_half(self):
        records, analyses = {}, {}
        for i in range(4):
            records[f"y{i}"] = record(f"y{i}", applies=0.5)
            analyses[f"y{i}"] = analysis(f"y{i}", leaning="neutral")
            records[f"n{i}"] = record(f"n{i}", applies=0.5)
            analyses[f"n{i}"] = analysis(f"n{i}", leaning="not_applicable")
        self.assertEqual(
            ev.applicability_separation(records, analyses,
                                        "leaning")["separation_vs_neutral"], 0.5)

    def test_the_contrast_class_is_glms_NEUTRAL_not_every_answer(self):
        # ⚠️ THE QUESTION IS "SILENT vs BALANCED". Contrasting against every
        # non-`not_applicable` article folds in the POSITIONED ones — 79.9% of
        # that group on `russia_stance` — which is an easier separation than
        # the one the design rests on. The two must be reported apart, and a
        # fixture with no positioned articles cannot tell them apart at all.
        records, analyses = {}, {}
        for i in range(4):
            records[f"p{i}"] = record(f"p{i}", applies=0.99)
            analyses[f"p{i}"] = analysis(f"p{i}", leaning="conservative")
            records[f"m{i}"] = record(f"m{i}", applies=0.30)
            analyses[f"m{i}"] = analysis(f"m{i}", leaning="neutral")
            records[f"n{i}"] = record(f"n{i}", applies=0.50)
            analyses[f"n{i}"] = analysis(f"n{i}", leaning="not_applicable")
        out = ev.applicability_separation(records, analyses, "leaning")
        self.assertEqual(out["groups"]["positioned"]["n"], 4)
        # Neutral scores BELOW the silent ones here, so the honest figure is
        # poor — while folding the positioned in makes it look middling.
        self.assertEqual(out["separation_vs_neutral"], 0.0)
        self.assertEqual(out["separation_vs_any_answer"], 0.5)

    def test_one_group_missing_is_none_not_a_perfect_score(self):
        self.assertIsNone(ev.separation([0.9], []))
        self.assertIsNone(ev.separation([], [0.1]))


class SubjectAgreement(unittest.TestCase):
    def test_the_subject_axis_is_measured_at_all(self):
        # It was absent from the report entirely — and it is the axis both
        # regression cases and /party/:id depend on.
        rec = {**record("a"), "subjects": [
            {"name": "ГЕРБ", "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed", "tone": score_block(0, confidence=1.0)}]}
        an = analysis("a", party_tones=[{"party": "ГЕРБ", "tone": "unfavorable"}])
        out = ev.subject_agreement({"a": rec}, {"a": an})
        self.assertEqual(out["strata"]["glm_full"]["n"], 1)
        self.assertEqual(out["strata"]["glm_full"]["exact"], 1)

    def test_the_strong_degrees_fold_onto_glms_four_labels(self):
        # `strongly_unfavorable` has no GLM counterpart; folding it to
        # `unfavorable` is a comparison, not a claim that they are the same.
        rec = {**record("a"), "subjects": [
            {"name": "ГЕРБ", "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed", "tone": score_block(4, confidence=1.0)}]}
        an = analysis("a", party_tones=[{"party": "ГЕРБ", "tone": "favorable"}])
        out = ev.subject_agreement({"a": rec}, {"a": an})
        self.assertEqual(out["strata"]["glm_full"]["exact"], 1)

    def test_glms_mixed_and_our_incidental_are_counted_not_scored(self):
        # `mixed` is not a point on the axis — it is measured by the ROC — and
        # an incidental subject was never asked.
        rec = {**record("a"), "subjects": [
            {"name": "ГЕРБ", "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed", "tone": score_block(2, confidence=1.0)},
            {"name": "ПП-ДБ", "kind": "party", "subject_role": "incidental",
             "assessment_status": "not_assessed", "tone": None}]}
        an = analysis("a", party_tones=[{"party": "ГЕРБ", "tone": "mixed"},
                                        {"party": "ПП-ДБ", "tone": "neutral"}])
        out = ev.subject_agreement({"a": rec}, {"a": an})
        self.assertEqual(out["mixed_skipped"], 1)
        self.assertEqual(out["incidental_skipped"], 1)
        self.assertEqual(out["strata"]["glm_full"]["n"], 0)


class RegressionCases(unittest.TestCase):
    def test_the_two_named_articles_are_looked_for_by_path(self):
        out = ev.regression_cases({}, {})
        self.assertEqual(len(out), 2)
        self.assertTrue(all(not row["found"] for row in out))
        self.assertTrue(all(row["why"] for row in out))

    def test_a_nine_anchor_value_is_bucketed_through_ITS_OWN_scale(self):
        # ⚠️ A SIGN FLIP ON THE ACCEPTANCE GATE. A 9-anchor +1.0 is a quarter
        # of the range — `unfavorable`'s neighbour, `neutral` — but bucketed
        # through the 5-anchor display scale it reads `favorable`.
        url = "https://pik.bg/x"
        tone = score_block(6, levels=9, confidence=1.0)   # value +2.0 of ±4
        rec = {**record(url), "subjects": [
            {"name": "ПП-ДБ", "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed", "tone": tone}]}
        an = {**analysis(url),
              "article_path": "news/data/pik.bg/20260922-gyuro-09d05e6c.json"}
        hit = next(r for r in ev.regression_cases({url: rec}, {url: an})
                   if r["slug"] == "09d05e6c")
        self.assertEqual(hit["levels"], 9)
        self.assertAlmostEqual(hit["value"], 2.0)
        self.assertAlmostEqual(hit["normalized"], 0.5)
        self.assertEqual(hit["bucket"], "favorable")
        # The same RAW value read through the 5-anchor display scale is a
        # different bucket — one step too strong. That is the sign flip.
        self.assertEqual(
            ax.SUBJECT_TONE.labels[js.bucket_index(2.0, ax.SUBJECT_TONE)],
            "strongly_favorable")

    def test_a_found_article_reports_its_party_value_and_bucket(self):
        url = "https://pik.bg/x"
        rec = {**record(url), "subjects": [
            {"name": "ПП-ДБ", "kind": "party", "subject_role": "secondary",
             "assessment_status": "assessed", "tone": score_block(2)}]}
        an = {**analysis(url),
              "article_path": "news/data/pik.bg/20260922-gyuro-09d05e6c.json"}
        out = ev.regression_cases({url: rec}, {url: an})
        hit = next(r for r in out if r["slug"] == "09d05e6c")
        self.assertTrue(hit["found"])
        self.assertAlmostEqual(hit["value"], 0.0)
        self.assertEqual(hit["bucket"], "neutral")


class Roc(unittest.TestCase):
    def test_a_point_is_never_excluded_from_its_own_threshold(self):
        # ⚠️ Rounding a threshold UP drops the mass that generated it —
        # measured, 48.7% of realistic renormalized masses round up, costing
        # 5.3 recall points at n=19 on the curve τ is fitted from.
        awkward = 0.19999999999999998
        curve = {r["tau"]: r for r in ev.roc([awkward], [])}
        self.assertIn(awkward, curve)
        self.assertEqual(curve[awkward]["recall"], 1.0)

    def test_the_thresholds_are_the_observed_values_unrounded(self):
        curve = ev.roc([0.123456789], [0.987654321])
        taus = [r["tau"] for r in curve]
        self.assertIn(0.123456789, taus)
        self.assertIn(0.987654321, taus)


class Worksheet(unittest.TestCase):
    def test_it_carries_no_model_answer(self):
        # ⚠️ BLINDED BY CONSTRUCTION. A row carrying either model's answer
        # makes the kappa meaningless rather than merely inconvenient.
        records = {"a": record("a", leaning=0, confidence=1.0)}
        analyses = {"a": analysis("a", leaning="strong_conservative")}
        rows = ev.sharpest_disagreements(records, analyses)
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(set(row), {"axis", "article_path", "distance"})

    def test_agreements_are_not_in_it_and_the_sharpest_come_first(self):
        records = {"a": record("a", leaning=2, confidence=1.0),
                   "b": record("b", leaning=0, confidence=1.0)}
        analyses = {"a": analysis("a", leaning="neutral"),
                    "b": analysis("b", leaning="strong_conservative")}
        rows = ev.sharpest_disagreements(records, analyses)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["distance"], 4)


class Spend(unittest.TestCase):
    def test_cost_and_latency_are_summed_over_calls_not_records(self):
        out = ev.spend({"a": record("a", cost=0.0002, ms=400),
                        "b": record("b", cost=0.0004, ms=800)})
        self.assertEqual(out["calls"], 2)
        self.assertAlmostEqual(out["total_cost"], 0.0006)
        self.assertAlmostEqual(out["cost_per_article"], 0.0003)
        self.assertEqual(out["p50_ms"], 800)

    def test_an_empty_corpus_divides_by_nothing(self):
        out = ev.spend({})
        self.assertIsNone(out["cost_per_article"])
        self.assertIsNone(out["p50_ms"])


class Report(unittest.TestCase):
    def test_it_builds_and_serializes(self):
        records = {"a": record("a")}
        analyses = {"a": analysis("a")}
        report = ev.build_report(records, analyses)
        self.assertEqual(set(report) >= {
            "contract", "agreement", "calibration", "mixed", "applicability",
            "regression_cases", "spend", "worksheet"}, True)
        json.dumps(report, ensure_ascii=False)

    def test_loading_reads_only_well_formed_sidecars(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            sm.sentiment_dir(data).mkdir(parents=True, exist_ok=True)
            (sm.sentiment_dir(data) / "a.json").write_text(
                json.dumps(record("https://a.bg/1")), encoding="utf-8")
            (sm.sentiment_dir(data) / "b.json").write_text("not json",
                                                           encoding="utf-8")
            (sm.sentiment_dir(data) / "c.json").write_text("[1,2]", encoding="utf-8")
            self.assertEqual(list(ev.load_records(data)), ["https://a.bg/1"])


if __name__ == "__main__":
    unittest.main()
