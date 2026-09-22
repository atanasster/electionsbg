#!/usr/bin/env python3
"""T4.5 — the person-treatment gate and its sampler.

⚠️ THE FIXTURES HERE ARE TEST INPUTS, NOT ADJUDICATIONS. They exist to prove
the arithmetic and the refusals; none of them is written to
`news/evals/person_adjudications.json`, which stays empty until a human
labels pairs. The first test asserts exactly that.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import person_accuracy_gate as gate  # noqa: E402
import sample_person_pairs as sampler  # noqa: E402

TONES = ("favorable", "unfavorable", "neutral", "mixed")


def pair(i, tone="neutral", **over):
    row = {
        "article_id": over.pop("article_id", f"a{i}"),
        "news_person_id": f"np_{i:04d}",
        "rubric_version": "person-treatment-v1",
        "identity_version": "v1",
        "split": "test",
        "sample": "natural",
        "annotator": "ann-1",
        "tone": tone,
        "pipeline_tone": tone,
        "pipeline_status": "assessed",
        "surface": over.pop("surface", f"Лице {i}"),
        "pipeline_subject_role": "primary",
        "subject_role": "primary",
        "human_assessable": True,
        "pipeline_assessed": True,
        "pipeline_resolved": True,
        "evidence_supports": True,
        "wrong_canonical_target": False,
        "strata": list(gate.PERSON_STRATA),
    }
    row.update(over)
    return row


def perfect_sample(n=200, *, doubly=40):
    """A sample that clears every floor — so the gate is provably passable
    rather than red by construction. `doubly` rows carry a second annotator
    who agreed, which is what the κ floor is over."""
    rows = []
    for i in range(n):
        rows.append(pair(i, TONES[i % len(TONES)]))
    for row in rows[:doubly]:
        rows.append(dict(row, annotator="ann-2"))
    return rows


def report_for(rows, **kw):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "adj.json"
        path.write_text(json.dumps({"version": 1, "pairs": rows}),
                        encoding="utf-8")
        return gate.build_report(path, app_data=Path(tmp), **kw)


class TheRealFileIsEmpty(unittest.TestCase):
    def test_the_committed_adjudications_hold_no_pairs_and_the_gate_says_so(self):
        # ⚠️ If this ever fails because pairs appeared, check WHO wrote them.
        # A model may not fill this file; the gate is worthless if it can.
        data = json.loads(gate.ADJUDICATIONS.read_text(encoding="utf-8"))
        self.assertEqual(data["pairs"], [])
        report = gate.build_report()
        self.assertEqual(report["status"],
                         "UNMET — 0 adjudicated pairs; nothing here is a "
                         "measured accuracy")
        self.assertEqual(report["reason"], "no adjudicated pairs")
        self.assertTrue(report["review_only"])
        self.assertEqual(gate.main(["--enforce"]), 1)

    def test_a_zero_over_an_empty_sample_is_not_a_pass(self):
        report = gate.build_report()
        checks = report["gate"]["checks"]
        # ⚠️ THE MUTATION THIS CATCHES: evaluating `<= 0` against a count of
        # zero errors in zero pairs. It reads `ok` beside four unmet floors,
        # and „0 wrong canonical targets" is exactly the line that would get
        # quoted out of this report.
        self.assertFalse(checks["wrong_canonical_targets"]["passed"])
        self.assertFalse(checks["unsupported_evidence"]["passed"])
        self.assertIsNone(report["zero_claims"]["upper_bound_95_at_this_n"])


class SupportIsAGate(unittest.TestCase):
    def test_a_tiny_flawless_sample_is_review_only_not_a_pass(self):
        report = report_for(perfect_sample(8))
        # Every ratio is 1.000 and every zero is a real zero…
        self.assertEqual(report["metrics"]["detection"]["precision"], 1.0)
        self.assertEqual(report["metrics"]["tones"]["macro_f1"], 1.0)
        # ⚠️ …and it still does not pass. This is the vacuous pass the plan
        # forbids: „insufficient support means review-only".
        self.assertFalse(report["gate"]["passed"])
        self.assertTrue(report["review_only"])
        self.assertEqual(report["reason"], "insufficient support")
        self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 8)

    def test_an_uncovered_stratum_blocks_the_gate(self):
        rows = [pair(i, TONES[i % 4], strata=["generic_person"])
                for i in range(240)]
        report = report_for(rows)
        self.assertFalse(report["gate"]["passed"])
        self.assertEqual(
            sorted(report["gate"]["support"]["strata_uncovered"]),
            ["ambiguous_name", "long_article", "official", "quotation"])

    def test_a_tone_below_its_own_floor_blocks_the_gate(self):
        rows = [pair(i, "neutral") for i in range(240)]
        rows += [pair(900 + i, "favorable") for i in range(40)]
        report = report_for(rows)
        self.assertFalse(report["gate"]["passed"])
        self.assertIn("mixed", report["gate"]["support"]["tones_below_floor"])

    def test_one_annotator_alone_is_not_support(self):
        # ⚠️ THE MUTATION THIS CATCHES: computing κ, printing it, and not
        # gating on it. A 200-pair sample labelled start to finish by one
        # person clears every other floor — and is a measurement of one
        # person, which is the argument the module's own docstring makes.
        rows = perfect_sample(200, doubly=0)
        report = report_for(rows)
        self.assertFalse(report["gate"]["passed"])
        self.assertEqual(report["reason"], "insufficient support")
        support = report["gate"]["support"]
        self.assertEqual(support["doubly_annotated_pairs"], 0)
        self.assertFalse(support["agreement_passed"])
        # Two annotators who DISAGREE throughout are not support either.
        contested = perfect_sample(200, doubly=0)
        contested += [dict(r, annotator="ann-2",
                           tone=TONES[(TONES.index(r["tone"]) + 1) % 4])
                      for r in contested[:60]]
        low = report_for(contested)
        self.assertEqual(low["gate"]["support"]["doubly_annotated_pairs"], 60)
        self.assertLess(low["gate"]["support"]["kappa"], 0.60)
        self.assertFalse(low["gate"]["passed"])

    def test_the_gate_is_passable_so_it_is_not_red_by_construction(self):
        report = report_for(perfect_sample(200))
        self.assertTrue(report["gate"]["passed"], report["gate"])
        self.assertEqual(report["status"], "MET")
        self.assertFalse(report["review_only"])
        # ⚠️ Even a MET gate prints what its zeros can support: at n = 200
        # with 0 observed, the true rate could still be ~1.5%.
        bound = report["zero_claims"]["upper_bound_95_at_this_n"]
        self.assertGreater(bound, 0)
        self.assertLess(bound, 0.05)


class TheBlockers(unittest.TestCase):
    def test_one_wrong_canonical_target_fails_an_otherwise_perfect_sample(self):
        rows = perfect_sample(200)
        rows[7]["wrong_canonical_target"] = True
        report = report_for(rows)
        self.assertEqual(report["metrics"]["wrong_canonical_targets"], 1)
        # ⚠️ Naming the WRONG individual is the harm this layer exists to
        # prevent: one instance fails the gate whatever the precision.
        self.assertFalse(report["gate"]["passed"])
        self.assertFalse(
            report["gate"]["checks"]["wrong_canonical_targets"]["passed"])
        self.assertGreaterEqual(
            report["metrics"]["detection"]["precision"], 0.95)

    def test_one_unsupported_evidence_fails_the_gate(self):
        rows = perfect_sample(200)
        rows[3]["evidence_supports"] = False
        report = report_for(rows)
        self.assertEqual(report["metrics"]["unsupported_evidence"], 1)
        self.assertFalse(report["gate"]["passed"])


class TheArithmetic(unittest.TestCase):
    def test_a_pipeline_that_declined_is_scored_wrong_not_dropped(self):
        rows = perfect_sample(200)
        for row in rows[:60]:
            row["pipeline_tone"] = None
        report = report_for(rows)
        self.assertEqual(report["metrics"]["tones"]["declined_by_pipeline"], 60)
        # ⚠️ THE MUTATION THIS CATCHES: dropping the rows the pipeline did
        # not answer. Silence would then be the highest-scoring strategy —
        # macro-F1 1.000 for a model that emits nothing on the hard records.
        # The refusals are still SCORED (n is the full 200) and they cost
        # recall on the class they should have found.
        self.assertLess(report["metrics"]["tones"]["macro_f1"], 1.0)
        self.assertEqual(report["metrics"]["tones"]["n"], 200)
        per_label = report["metrics"]["tones"]["per_label"]
        self.assertLess(per_label["neutral"]["recall"], 1.0)
        # Refuse enough of them and the floor is missed — a gate that
        # dropped the rows would report 1.000 here instead.
        for row in rows[:120]:
            row["pipeline_tone"] = None
        heavier = report_for(rows)
        self.assertFalse(heavier["gate"]["passed"])
        self.assertLess(
            min(v["recall"] for v in
                heavier["metrics"]["tones"]["per_label"].values()), 0.70)

    def test_recall_counts_the_pairs_the_pipeline_missed(self):
        rows = perfect_sample(200)
        for row in rows[:50]:
            row["pipeline_assessed"] = False
        report = report_for(rows)
        det = report["metrics"]["detection"]
        self.assertEqual(det["tp"], 150)
        self.assertEqual(det["fn"], 50)
        self.assertEqual(det["recall"], 0.75)
        self.assertEqual(det["precision"], 1.0)
        # The interval is over ARTICLES, not pairs: pairs inside one article
        # are dependent and a pair-level interval is too narrow.
        boot = det["recall_bootstrap95"]
        self.assertLess(boot["low"], det["recall"])
        self.assertGreater(boot["high"], det["recall"])
        # ⚠️ The interval carries its CONDITIONS: an interval in a committed
        # report has to be reproducible from the report alone.
        self.assertEqual(boot["rounds"], 2000)
        self.assertEqual(boot["seed"], 7)
        self.assertEqual(boot["undefined_rounds"], 0)
        self.assertIsNotNone(det["recall_wilson95"][0])

    def test_stale_and_development_pairs_are_excluded_and_counted(self):
        rows = perfect_sample(10, doubly=0)
        rows[0]["split"] = "development"
        rows[1]["tone"] = "unclear"
        rows[2]["rubric_version"] = "person-treatment-v0"
        rows[3]["tone"] = "totally-made-up"
        report = report_for(rows, rubric_version="person-treatment-v1")
        self.assertEqual(report["excluded"],
                         {"development": 1, "unclear": 1,
                          "stale_rubric": 1, "unknown_label": 1})
        self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 6)

    def test_an_identity_that_moved_invalidates_its_pairs(self):
        rows = perfect_sample(4, doubly=0)
        report = report_for(
            rows, identity_versions={rows[0]["news_person_id"]: "v2"})
        # ⚠️ A correction INVALIDATES a pair; it never transfers a human's
        # label to a judgement made about a different identity.
        self.assertEqual(report["excluded"], {"stale_identity": 1})

    def test_a_second_annotator_is_agreement_not_a_second_pair(self):
        rows = perfect_sample(10, doubly=0)
        twin = dict(rows[0], annotator="ann-2", tone="unfavorable")
        report = report_for(rows + [twin])
        self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 10)
        self.assertEqual(report["inter_annotator"]["n"], 1)
        self.assertEqual(report["inter_annotator"]["observed_agreement"], 0.0)
        # ⚠️ The SAME annotator twice is a duplicate, and it is COUNTED —
        # the dedupe path used to increment nothing.
        again = report_for(rows + [dict(rows[0])])
        self.assertEqual(again["excluded"], {"duplicate_pair": 1})

    def test_distinct_unresolved_people_in_one_article_are_distinct_pairs(self):
        # ⚠️ THE MUTATION THIS CATCHES: a pair key without the SURFACE. For
        # an unresolved mention news_person_id is None, so all three collapse
        # into one — measured at 17 of 250 on the real draw, silently, and
        # the discards were fed to κ as cross-person „agreement".
        rows = [pair(i, "neutral", article_id="a1", surface=name,
                     news_person_id=None)
                for i, name in enumerate(("Едно Лице", "Второ Лице",
                                          "Трето Лице"))]
        report = report_for(rows)
        self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 3)
        self.assertEqual(report["excluded"], {})
        self.assertEqual(report["inter_annotator"]["n"], 0)

    def test_an_unadjudicated_blocker_field_is_excluded_not_read_as_clean(self):
        # ⚠️ THE MUTATION THIS CATCHES: counting `wrong_canonical_target` as
        # „is it True" over rows where nobody answered. Those fields are
        # `null` in the sampler's own output, so this is the LIKELY first
        # annotation, and it reported MET on 200 unexamined blockers.
        for field in ("human_assessable", "evidence_supports",
                      "wrong_canonical_target"):
            rows = [dict(row, **{field: None}) for row in perfect_sample(200)]
            report = report_for(rows)
            self.assertFalse(report["gate"]["passed"], field)
            self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 0)
            self.assertEqual(report["excluded"], {f"unlabelled_{field}": 240})

    def test_an_adjudicating_row_wins_over_either_annotator(self):
        rows = perfect_sample(10, doubly=0)
        first = dict(rows[0])
        rows.append(dict(first, annotator="ann-2", tone="neutral"))
        rows.append(dict(first, annotator="chief", tone="mixed",
                         adjudicated=True))
        baseline = report_for(rows[:10])["metrics"]["tones"]["per_tone_n"]
        report = report_for(rows)
        # ⚠️ THE MUTATION THIS CATCHES: taking whichever row comes FIRST IN
        # FILE ORDER, which makes the documented resolution do nothing. The
        # contested pair was `favorable` to ann-1 and to ann-2 something
        # else; the adjudicator says `mixed`, and that is the one that counts.
        self.assertEqual(report["metrics"]["tones"]["per_tone_n"]["mixed"],
                         baseline.get("mixed", 0) + 1)
        self.assertEqual(report["metrics"]["tones"]["per_tone_n"]["favorable"],
                         baseline["favorable"] - 1)
        self.assertEqual(report["gate"]["support"]["adjudicated_pairs"], 10)

    def test_a_correctly_abstaining_pipeline_is_scored_as_correct(self):
        # ⚠️ THE MUTATION THIS CATCHES: reading `pipeline_tone` alone. The
        # producer is validated never to emit a tone beside a non-assessed
        # status, so a pipeline in PERFECT agreement with the human scored
        # 0.0 recall on `not_assessed` — and per_tone_recall is a min, so a
        # single such label failed the gate however good the pipeline was.
        rows = perfect_sample(200)
        for row in rows:
            if row["tone"] == "mixed":
                row.update(tone="not_assessed", pipeline_tone=None,
                           pipeline_status="not_assessed",
                           human_assessable=False, pipeline_assessed=False)
        report = report_for(rows)
        per_label = report["metrics"]["tones"]["per_label"]
        self.assertEqual(per_label["not_assessed"]["recall"], 1.0)
        self.assertEqual(report["metrics"]["tones"]["declined_by_pipeline"], 0)
        self.assertEqual(report["metrics"]["tones"]["macro_f1"], 1.0)

    def test_insufficient_text_is_not_the_same_answer_as_not_assessed(self):
        rows = perfect_sample(20, doubly=0)
        for row in rows[:4]:
            row.update(tone="not_assessed", pipeline_tone=None,
                       pipeline_status="insufficient_text")
        report = report_for(rows)
        tones_out = report["metrics"]["tones"]
        # ⚠️ Two DIFFERENT pipeline answers. `insufficient_text` is a real
        # answer — so it is NOT a decline — and it is not the same as
        # `not_assessed`, so it does not earn recall on it.
        self.assertEqual(tones_out["declined_by_pipeline"], 0)
        self.assertLess(tones_out["per_label"]["not_assessed"]["recall"], 1.0)

    def test_not_assessed_is_a_real_answer_on_both_sides(self):
        rows = perfect_sample(20, doubly=0)
        for row in rows[:5]:
            row["tone"] = "not_assessed"
            # The producer emits a STATUS, never a tone, beside it.
            row["pipeline_tone"] = None
            row["pipeline_status"] = "not_assessed"
            row["human_assessable"] = False
            row["pipeline_assessed"] = False
        report = report_for(rows)
        self.assertEqual(report["metrics"]["tones"]["n"], 20)
        self.assertIn("not_assessed",
                      report["metrics"]["tones"]["per_tone_n"])
        # It is NOT a missing label: nothing was excluded.
        self.assertEqual(report["excluded"], {})

    def test_prevalence_and_hard_cases_are_reported_apart(self):
        rows = perfect_sample(20, doubly=0)
        for row in rows[:6]:
            row["sample"] = "hard_case"
            row["tone"] = row["pipeline_tone"] = "unfavorable"
        report = report_for(rows)
        # ⚠️ A deliberately balanced hard-case set measures hard cases and
        # says nothing about population prevalence, so the two never pool.
        self.assertEqual(report["prevalence"]["hard_case"]["n"], 6)
        self.assertEqual(report["prevalence"]["natural"]["n"], 14)
        self.assertNotIn("mixed", report["prevalence"]["hard_case"]["tones"])

    def test_resolved_target_coverage_is_reported(self):
        rows = perfect_sample(10, doubly=0)
        for row in rows[:4]:
            row["pipeline_resolved"] = False
        report = report_for(rows)
        self.assertEqual(report["resolved_target_coverage"],
                         {"resolved": 6, "of": 10, "share": 0.6})

    def test_wilson_and_kappa_fail_closed_on_nothing(self):
        self.assertEqual(gate.wilson(0, 0), (None, None))
        self.assertEqual(gate.cohen_kappa([])["kappa"], None)
        empty = gate.bootstrap_ci([], lambda rows: 1.0)
        self.assertIsNone(empty["low"])
        self.assertEqual(empty["why"], "fewer than two articles")

    def test_wilson_matches_a_hand_computed_bound(self):
        # ⚠️ ANCHORS, not a window: a dropped continuity term, a wrong z or a
        # normal-approximation bound all land inside „greater than 0 and less
        # than 0.05", which is what the suite used to assert.
        self.assertEqual(gate.wilson(0, 200), (0.0, 0.0188))
        self.assertEqual(gate.wilson(0, 100), (0.0, 0.037))
        self.assertEqual(gate.wilson(190, 200), (0.9104, 0.9726))

    def test_kappa_matches_hand_computed_values(self):
        # ⚠️ The expected-agreement term could be computed over one
        # annotator's marginals twice, or divided by n instead of n*n, and
        # every previous assertion would still pass.
        self.assertEqual(gate.cohen_kappa(
            [("n", "n"), ("n", "f"), ("f", "n"), ("f", "f")])["kappa"], 0.0)
        self.assertEqual(gate.cohen_kappa(
            [("n", "n"), ("f", "f")])["kappa"], 1.0)
        self.assertEqual(gate.cohen_kappa(
            [("n", "n"), ("n", "n"), ("n", "f"), ("f", "f")])["kappa"], 0.5)


class ThePublishedBaseline(unittest.TestCase):
    def test_the_drift_baseline_reads_the_published_shards(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            (app / "person").mkdir()
            (app / "person" / "np_1.json").write_text(json.dumps(
                {"counts": {"neutral": 3, "unfavorable": 1}}), encoding="utf-8")
            (app / "person" / "np_2.json").write_text(json.dumps(
                {"counts": {"neutral": 1}}), encoding="utf-8")
            adj = app / "adj.json"
            adj.write_text(json.dumps({"version": 1, "pairs": []}),
                           encoding="utf-8")
            report = gate.build_report(adj, app_data=app)
        dist = report["published_distribution"]
        self.assertEqual(dist["assessed"], 5)
        # A change that made the gate easier by relabelling everything
        # neutral has to be visible in this share.
        self.assertEqual(dist["shares"]["neutral"], 0.8)

    def test_it_says_so_when_there_is_nothing_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            adj = Path(tmp) / "adj.json"
            adj.write_text(json.dumps({"version": 1, "pairs": []}),
                           encoding="utf-8")
            report = gate.build_report(adj, app_data=Path(tmp))
        self.assertFalse(report["published_distribution"]["available"])


class TheSampler(unittest.TestCase):
    ARTICLES = [
        {"id": "a1", "url": "https://a.bg/1", "domain": "a.bg",
         "title": "Прокуратурата обвини Калушев", "excerpt": "„Няма нарушение\", заяви Калушев.",
         "content_chars": 9000,
         "analysis": {"news_persons": [
             {"surface": "Ивайло Калушев", "news_person_id": "np_1",
              "identity_version": "v1"},
             {"surface": "Непознат Човек", "basis": "not_in_registry"},
             {"surface": "Георги Калушев", "basis": "ambiguous_registry"}],
             "person_tones": [
                 {"news_person_id": "np_1", "assessment_status": "assessed",
                  "tone": "unfavorable", "subject_role": "primary",
                  "rubric_version": "person-treatment-v1"}]}},
        {"id": "a2", "url": "https://b.bg/2", "domain": "b.bg",
         "title": "Кратко", "excerpt": "", "content_chars": 300,
         "analysis": {"news_persons": [
             {"surface": "Друг Човек", "basis": "not_in_registry"}]}},
    ]

    def rows(self):
        return sampler.candidate_rows(self.ARTICLES,
                                      officials={"ивайло калушев"})

    def test_it_writes_no_labels(self):
        # ⚠️ THE POINT OF THE WHOLE FILE. A sampler that guessed a tone would
        # make the gate a measurement of the pipeline against itself.
        for row in self.rows():
            for field in ("tone", "human_assessable", "subject_role",
                          "evidence_supports", "wrong_canonical_target",
                          "annotator"):
                self.assertIsNone(row[field], field)

    def test_an_unresolved_or_ambiguous_mention_is_still_in_the_frame(self):
        rows = self.rows()
        self.assertEqual(len(rows), 4)
        # ⚠️ THE MUTATION THIS CATCHES: sampling only what the pipeline
        # resolved, which makes RECALL unmeasurable by construction — the
        # missed pairs are exactly what a recall floor is about.
        self.assertEqual(sum(1 for r in rows if not r["pipeline_resolved"]), 3)
        ambiguous = next(r for r in rows if r["surface"] == "Георги Калушев")
        self.assertIn("ambiguous_name", ambiguous["strata"])

    def test_strata_are_assigned_from_the_article_and_the_registry(self):
        rows = {r["surface"]: r for r in self.rows()}
        self.assertIn("official", rows["Ивайло Калушев"]["strata"])
        self.assertIn("long_article", rows["Ивайло Калушев"]["strata"])
        self.assertIn("quotation", rows["Ивайло Калушев"]["strata"])
        self.assertIn("generic_person", rows["Непознат Човек"]["strata"])
        self.assertEqual(rows["Друг Човек"]["strata"], ["generic_person"])

    def test_the_draw_is_seeded_and_round_robins_across_strata(self):
        rows = self.rows()
        first = sampler.draw(rows, target=3, seed=1)
        again = sampler.draw(rows, target=3, seed=1)
        self.assertEqual([r["surface"] for r in first["pairs"]],
                         [r["surface"] for r in again["pairs"]])
        # No stratum is starved by the corpus's own prevalence.
        self.assertGreaterEqual(len(first["strata"]), 2)

    def test_a_shortfall_is_reported_rather_than_padded(self):
        result = sampler.draw(self.rows(), target=200, seed=1)
        self.assertEqual(result["shortfall"]["pairs"],
                         {"wanted": 200, "got": 4})
        self.assertIn("available", result)

    def test_a_stratum_the_corpus_cannot_fill_is_reported_as_zero(self):
        # ⚠️ THE MUTATION THIS CATCHES: omitting the key. A missing stratum
        # reads as „not measured"; a zero reads as „the corpus cannot fill
        # this", which is the finding the gate needs. Measured on the real
        # corpus 2026-09-22: `ambiguous_name` is 0 — the registry holds one
        # active identity and has refused no surface as ambiguous.
        rows = [r for r in self.rows() if "ambiguous_name" not in r["strata"]]
        result = sampler.draw(rows, target=3, seed=1)
        self.assertEqual(result["available"]["ambiguous_name"], 0)
        self.assertEqual(result["strata"]["ambiguous_name"], 0)
        self.assertIn("ambiguous_name", result["shortfall"]["strata_unavailable"])

    def test_it_fails_closed_on_an_empty_corpus(self):
        self.assertEqual(sampler.candidate_rows([], officials=set()), [])
        empty = sampler.draw([], target=10, seed=1)
        self.assertEqual(empty["pairs"], [])
        self.assertEqual(empty["shortfall"]["pairs"], {"wanted": 10, "got": 0})


if __name__ == "__main__":
    unittest.main()
