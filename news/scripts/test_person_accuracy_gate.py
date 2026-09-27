#!/usr/bin/env python3
"""The person-sentiment gate (news-person-sentiment-v1 §8) and its sampler.

⚠️ THE FIXTURES HERE ARE TEST INPUTS, NOT ADJUDICATIONS. None is written to
`news/evals/person_adjudications.json`, which stays empty until a human
labels pairs; the first test asserts exactly that.
"""
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import person_accuracy_gate as gate  # noqa: E402
import sample_person_pairs as sampler  # noqa: E402


def row(i, level=2, model=None, **over):
    """A test pair the human scored `level`; the pipeline scored `model`
    (defaults to agreeing)."""
    scored = level if model is None else model
    out = {"pair_id": f"p{i}", "split": "test", "stratum": "model_scored",
           "article_url": f"https://x.bg/{i}", "surface": "Иван Петров",
           "identity": {"kind": "person", "id": "mp-1"},
           "identity_version": "v1", "rubric_version": "r1",
           "role": "primary", "level": level,
           "pipeline_bucket_index": scored,
           "pipeline_value": scored - 2 if isinstance(scored, int) else None,
           "wrong_person": False, "declined": False, "annotator": "a"}
    out.update(over)
    return out


def balanced(n_per_group=70, **over):
    rows, i = [], 0
    for level in (0, 1, 2, 3, 4):
        count = n_per_group if level == 2 else n_per_group // 2
        for _ in range(count):
            rows.append(row(i, level, **over))
            i += 1
    return rows


def sealed(rows):
    """Seal every row as the workspace's finalize does — unless a test set
    its own seal."""
    return [r if "seal" in r else {**r, "seal": gate.seal_of(r)} for r in rows]


def report(rows, **kw):
    rows = sealed(rows)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "adj.json"
        path.write_text(json.dumps({"version": 2, "pairs": rows}), encoding="utf-8")
        return gate.build_report(path, app_data=Path(tmp), **kw)


def second_reader(rows, n=40, disagree=0):
    # Spread across the groups: κ over one category is undefined.
    extra = []
    step = max(1, len(rows) // n)
    for k, r in enumerate(rows[::step][:n]):
        level = r["level"]
        if k < disagree:
            level = 4 if level < 2 else 0
        extra.append({**r, "annotator": "b", "level": level})
    return rows + extra


class TheRealFileIsEmpty(unittest.TestCase):
    def test_the_committed_file_holds_no_pairs_and_the_gate_says_so(self):
        doc = json.loads(gate.ADJUDICATIONS.read_text(encoding="utf-8"))
        self.assertEqual(doc["pairs"], [])
        out = gate.build_report(gate.ADJUDICATIONS, app_data=Path("/nonexistent"))
        self.assertTrue(out["status"].startswith("UNMET"))
        self.assertFalse(out["gate"]["passed"])

    def test_a_zero_over_an_empty_sample_is_not_a_pass(self):
        out = report([])
        self.assertFalse(out["gate"]["checks"]["wrong_person"]["passed"])
        self.assertIsNone(out["zero_claims"]["upper_bound_95_at_this_n"])


class Support(unittest.TestCase):
    def test_a_perfect_large_sample_with_agreement_passes(self):
        out = report(second_reader(balanced()))
        self.assertTrue(out["gate"]["passed"], out["gate"])
        self.assertEqual(out["status"], "MET")

    def test_without_a_second_reader_it_is_met_except_agreement(self):
        out = report(balanced())
        self.assertFalse(out["gate"]["passed"])
        self.assertTrue(out["gate"]["passed_without_agreement"])
        self.assertEqual(out["status"], "MET EXCEPT AGREEMENT")

    def test_a_tiny_flawless_sample_is_unmet(self):
        out = report(second_reader(balanced(6), n=6))
        self.assertEqual(out["status"], "UNMET")
        self.assertFalse(out["gate"]["support"]["passed_without_agreement"])

    def test_a_thin_group_blocks_the_gate(self):
        rows = [r for r in balanced(120) if r["level"] < 4]
        rows = [r for r in rows if r["level"] != 3][:] + \
            [row(9000 + k, 3) for k in range(10)]
        out = report(second_reader(rows))
        self.assertIn("favorable", out["gate"]["support"]["groups_below_floor"])
        self.assertFalse(out["gate"]["passed"])

    def test_disagreeing_readers_fail_the_agreement_arm(self):
        out = report(second_reader(balanced(), disagree=25))
        self.assertFalse(out["gate"]["support"]["agreement_passed"])
        self.assertTrue(out["gate"]["passed_without_agreement"])


class Tone(unittest.TestCase):
    def test_off_by_one_counts_near_not_exact(self):
        rows = [row(i, 2, model=3) for i in range(10)]
        t = report(rows)["tones"]
        self.assertEqual(t["exact_bucket"], 0.0)
        self.assertEqual(t["off_by_one_or_better"], 1.0)
        self.assertEqual(t["sign_flips"], 0)

    def test_a_sign_flip_is_counted_and_bounded(self):
        rows = [row(i, 0, model=4) for i in range(3)] + [row(10 + i, 2) for i in range(97)]
        t = report(rows)["tones"]
        self.assertEqual(t["sign_flips"], 3)
        self.assertGreater(t["sign_flip_upper95"], 0.02)

    def test_neutral_against_a_side_is_not_a_flip(self):
        t = report([row(0, 2, model=0), row(1, 4, model=2)])["tones"]
        self.assertEqual(t["sign_flips"], 0)

    def test_a_pipeline_that_did_not_score_is_wrong_not_dropped(self):
        rows = [row(i, 1, model=None, pipeline_bucket_index=None) for i in range(4)] + \
            [row(10 + i, 1) for i in range(4)]
        t = report(rows)["tones"]
        self.assertEqual(t["n"], 8)
        self.assertEqual(t["declined_by_pipeline"], 4)
        self.assertEqual(t["exact_bucket"], 0.5)

    def test_non_substantive_rows_carry_no_tone(self):
        t = report([row(0, None, role="incidental")])["tones"]
        self.assertEqual(t["n"], 0)


class Blockers(unittest.TestCase):
    def test_one_wrong_person_fails_an_otherwise_passing_sample(self):
        rows = second_reader(balanced())
        rows.append(row(99999, 2, wrong_person=True, role="not_substantive",
                        stratum="model_incidental"))
        out = report(rows)
        self.assertEqual(out["wrong_person"], 1)
        self.assertFalse(out["gate"]["passed"])

    def test_a_wrong_person_the_sampler_supplied_is_not_the_pipelines(self):
        out = report([row(0, 2, wrong_person=True, stratum="text_only")])
        self.assertEqual(out["wrong_person"], 0)


class Exclusions(unittest.TestCase):
    def test_stale_development_declined_and_unfinished_are_counted(self):
        rows = [row(0, rubric_version="old"), row(1, split="development"),
                row(2, declined=True), row(3, None), row(4, role="bogus"),
                row(5, identity_version="v0"), row(6)]
        out = report(rows, rubric="r1", versions={"mp-1": "v1"})
        self.assertEqual(out["excluded"], {
            "stale_rubric": 1, "development": 1, "unclear": 1,
            "unlabelled_tone": 1, "malformed": 1, "stale_identity": 1})
        self.assertEqual(out["tones"]["n"], 1)

    def test_a_declined_answer_from_the_workspace_is_unclear_not_malformed(self):
        import review_persons_queues as rq  # noqa: PLC0415
        answer = rq.annotation_answer(role=None, level=None,
                                      wrong_person=False, declined=True)
        rows = rq.adjudication_rows({"pairs": [row(0)]}, {"p0": answer},
                                    annotator="a", rubric_version="r1",
                                    finalized_at="t", revealed=set())
        self.assertEqual(report(rows)["excluded"], {"unclear": 1})

    def test_a_retired_identity_is_excluded_not_scored(self):
        out = report([row(0), row(1, identity={"kind": "person", "id": "gone"})],
                     versions={"mp-1": "v1"})
        self.assertEqual(out["excluded"], {"retired_identity": 1})

    def test_a_registry_vintage_bump_leaves_other_people_current(self):
        ident = {"kind": "person", "id": "np_0000abcd"}
        rows = [row(0, identity=ident, identity_version="2026-09-20.1:aaa"),
                row(1, identity=ident, identity_version="2026-09-20.1:old")]
        out = report(rows, versions={"np_0000abcd": "2026-09-27.1:aaa"})
        self.assertEqual(out["excluded"], {"stale_identity": 1})
        self.assertEqual(out["tones"]["n"], 1)

    def test_one_annotator_twice_is_a_duplicate(self):
        out = report([row(0), row(0)])
        self.assertEqual(out["excluded"].get("duplicate_pair"), 1)

    def test_an_adjudicating_row_wins(self):
        rows = [row(0, 0), {**row(0, 0), "annotator": "b", "level": 4},
                {**row(0, 4), "annotator": "c", "adjudicated": True}]
        t = report(rows)["tones"]
        self.assertEqual(t["n"], 1)
        self.assertEqual(t["per_group"], {"favorable": 1})


class Seal(unittest.TestCase):
    def test_an_unsealed_or_edited_row_is_not_scored(self):
        good = sealed([row(0, 1)])[0]
        edited = {**sealed([row(1, 1)])[0], "pipeline_bucket_index": 1,
                  "level": 4}
        out = report([good, edited, {**row(2), "seal": None}])
        self.assertEqual(out["excluded"], {"unsealed": 2})
        self.assertEqual(out["tones"]["n"], 1)

    def test_seal_new_seals_only_rows_without_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "adj.json"
            edited = {**sealed([row(1)])[0], "level": 4}
            path.write_text(json.dumps({"pairs": [row(0, adjudicated=True),
                                                  edited, row(2)]}),
                            encoding="utf-8")
            # Only the adjudicating row: row 2 is an annotator's row with no
            # seal — an edit — and stays unsealed.
            self.assertEqual(gate.seal_new(path), 1)
            pairs = json.loads(path.read_text(encoding="utf-8"))["pairs"]
            self.assertEqual(pairs[0]["seal"], gate.seal_of(pairs[0]))
            self.assertNotEqual(pairs[1]["seal"], gate.seal_of(pairs[1]))
            self.assertNotIn("seal", pairs[2])


class ToneIsModelScoredOnly(unittest.TestCase):
    def test_detection_strata_never_enter_the_tone_metrics(self):
        rows = [row(0, 2), row(1, 0, stratum="model_incidental",
                               pipeline_bucket_index=None),
                row(2, 4, stratum="text_only", pipeline_bucket_index=None)]
        t = report(rows)["tones"]
        self.assertEqual((t["n"], t["exact_bucket"]), (1, 1.0))


class Detection(unittest.TestCase):
    def test_hidden_subjects_are_recall_misses(self):
        rows = [row(0), row(1, stratum="model_incidental"),
                row(2, None, role="incidental", stratum="text_only"),
                row(3, None, role="not_substantive")]
        d = report(rows)["detection"]
        self.assertEqual((d["tp"], d["fp"], d["fn"]), (1, 1, 1))


class Arithmetic(unittest.TestCase):
    def test_wilson_matches_a_hand_computed_bound(self):
        self.assertEqual(gate.wilson(0, 200)[1], 0.0188)
        self.assertEqual(gate.wilson(0, 0), (None, None))

    def test_kappa(self):
        self.assertEqual(gate.cohen_kappa([])["kappa"], None)
        self.assertEqual(gate.cohen_kappa([("a", "a"), ("b", "b")])["kappa"], 1.0)
        k = gate.cohen_kappa([("a", "a"), ("a", "b"), ("b", "a"), ("b", "b")])
        self.assertEqual(k["kappa"], 0.0)


class Sampler(unittest.TestCase):
    def pool(self):
        def r(stratum, i, group=None, domain="a.bg"):
            return {"stratum": stratum, "model_group": group, "domain": domain,
                    "article_url": f"https://{domain}/{stratum}/{i}",
                    "surface": "Иван Петров", "identity": {"id": f"p{i}"}}
        groups = ["unfavorable"] * 20 + ["neutral"] * 300 + ["favorable"] * 70
        return {
            "model_scored": [r("model_scored", i, g, f"d{i % 4}.bg")
                             for i, g in enumerate(groups)],
            "model_incidental": [r("model_incidental", i) for i in range(60)],
            "unscored_subject": [r("unscored_subject", i) for i in range(5)],
            "text_only": [],
        }

    def test_the_draw_is_seeded(self):
        a, b = sampler.draw(self.pool(), 7), sampler.draw(self.pool(), 7)
        self.assertEqual([p["pair_id"] for p in a["pairs"]],
                         [p["pair_id"] for p in b["pairs"]])

    def test_thin_groups_are_taken_whole_and_neutral_fills_the_rest(self):
        s = sampler.draw(self.pool(), 7)
        scored = [p for p in s["pairs"] if p["stratum"] == "model_scored"]
        by = {g: sum(1 for p in scored if p["model_group"] == g)
              for g in ("unfavorable", "neutral", "favorable")}
        self.assertEqual(by, {"unfavorable": 20, "favorable": 65, "neutral": 65})

    def test_a_shortfall_is_left_short_not_padded(self):
        s = sampler.draw(self.pool(), 7)
        counts = {k: sum(1 for p in s["pairs"] if p["stratum"] == k)
                  for k in sampler.TARGETS}
        self.assertEqual(counts["unscored_subject"], 5)
        self.assertEqual(counts["text_only"], 0)
        self.assertEqual(counts["model_incidental"], 40)

    def test_the_second_reader_subset_is_a_subset(self):
        s = sampler.draw(self.pool(), 7)
        ids = {p["pair_id"] for p in s["pairs"]}
        self.assertEqual(len(s["second_reader"]), sampler.SECOND_READER)
        self.assertTrue(set(s["second_reader"]) <= ids)

    def test_spread_round_robins_outlets(self):
        rows = [{"domain": "a"} for _ in range(10)] + [{"domain": "b"}] * 2
        got = sampler.spread(rows, 4, random.Random(1))
        self.assertEqual(sorted(r["domain"] for r in got), ["a", "a", "b", "b"])

    def test_a_longer_name_is_not_the_name(self):
        self.assertFalse(sampler.named_in("Иван Петров", "срещу Иван Петрова"))
        self.assertTrue(sampler.named_in("Иван Петров", "„Иван Петров“ каза"))

    def test_the_drawn_file_is_not_ordered_by_stratum(self):
        order = [p["stratum"] for p in sampler.draw(self.pool(), 7)["pairs"]]
        self.assertNotEqual(order, sorted(order, key=list(sampler.TARGETS).index))

    def test_spread_alternates_identity_basis(self):
        rows = ([{"domain": "a", "identity_basis": "exact"}] * 6
                + [{"domain": "a", "identity_basis": "context"}] * 2)
        got = sampler.spread(rows, 4, random.Random(1))
        self.assertEqual(sum(r["identity_basis"] == "context" for r in got), 2)

    def test_group_of(self):
        self.assertEqual([sampler.group_of(i) for i in (0, 1, 2, 3, 4, None)],
                         ["unfavorable", "unfavorable", "neutral", "favorable",
                          "favorable", None])


if __name__ == "__main__":
    unittest.main()
