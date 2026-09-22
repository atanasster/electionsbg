#!/usr/bin/env python3
"""The scale contract: what a Jev `score` answer means as numbers.

No network. The reference answer is the REAL one captured in the contract
probe (`news/data/_perf/jev/20260920T024115Z/contract.json`), read from disk
rather than retyped, so the decoder is tested against a shape the endpoint
actually sent.

⚠️ SEVERAL TESTS HERE EXIST TO KILL A SPECIFIC MUTANT, not to describe the
happy path. An earlier cut of this suite passed all 31 of its own assertions
while six deliberate mutations were applied to the module, five of which
survived: the variance centred on zero instead of on `value`, `normalized`
computed with the wrong divisor, `normalized` deleted outright, the
`both_directions` tail moved by a level, the two MIDDLE `LEANING` labels
swapped, and the 9-anchor rubric fully reversed. Each of those now has a test
named for it.
"""
import json
import math
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import jev_axes as ax  # noqa: E402
import jev_client as jc  # noqa: E402
import jev_scales as js  # noqa: E402

PROBE = ROOT / "news/data/_perf/jev/20260920T024115Z/contract.json"
MAX_ANCHOR = jc.LIMITS["option_chars"]
MAX_INSTRUCTIONS = jc.LIMITS["instructions_chars"]
FIVE = ax.SUBJECT_TONE
NINE = ax.SUBJECT_TONE_9

STORED_FIELDS = {
    "scale", "levels", "level", "probabilities", "value", "normalized",
    "spread", "confidence_reported", "confidence_derived", "confidence_agrees",
    "both_directions", "both_directions_tau", "both_directions_tail",
    "anchors", "legend", "legend_matches_anchors", "axes_version",
    "contract_version",
}


def score(probs, level=0, confidence=None, legend=None):
    answer = {"type": "score", "score": level,
              "probabilities": {str(k): v for k, v in probs.items()}}
    if confidence is not None:
        answer["confidence"] = confidence
    if legend is not None:
        answer["legend"] = legend
    return answer


def probe_answer():
    """The real captured `score` answer, or None when the probe is absent."""
    if not PROBE.exists():
        return None
    doc = json.loads(PROBE.read_text(encoding="utf-8"))
    return ((doc.get("score") or {}).get("response") or {}).get("body", {}) \
        .get("answers", {}).get("q_score")


class ScaleShape(unittest.TestCase):
    def test_values_are_centred_on_zero(self):
        self.assertEqual(FIVE.values, (-2.0, -1.0, 0.0, 1.0, 2.0))
        self.assertEqual(NINE.values, (-4.0, -3.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0, 4.0))

    def test_an_even_scale_has_no_centre_level(self):
        even = js.Scale("even", ("a", "b", "c", "d"), ("A", "B", "C", "D"))
        self.assertEqual(even.values, (-1.5, -0.5, 0.5, 1.5))
        self.assertEqual(even.extent, 1.5)

    def test_a_scale_refuses_an_empty_or_mismatched_anchor(self):
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", ("a", "b"), ("A", "   "))
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", ("a", "b", "c"), ("A", "B"))
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", ("a",), ("A",))

    def test_a_bare_string_is_not_a_sequence_of_labels(self):
        # `Scale("x", "ab", "AB")` would otherwise build a per-character scale
        # whose entire rubric is "A" and "B".
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", "ab", ("A", "B"))
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", ("a", "b"), "AB")

    def test_duplicate_labels_are_refused(self):
        # Two identical labels make `bucket_label` ambiguous.
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", ("a", "a"), ("A", "B"))

    def test_a_scale_longer_than_the_api_allows_is_refused_at_construction(self):
        n = js.MAX_SCORE_LEVELS + 1
        with self.assertRaises(js.JevScaleError):
            js.Scale("x", tuple(f"l{i}" for i in range(n)), tuple("A" for _ in range(n)))

    def test_the_level_cap_matches_the_client(self):
        # Restated rather than imported so this module stays off the network
        # client; the two must not drift.
        self.assertEqual(js.MAX_SCORE_LEVELS, jc.LIMITS["score_levels"])

    def test_every_shipped_axis_has_rubric_text_inside_the_payload_budget(self):
        for scale in (ax.LEANING, ax.RUSSIA_STANCE, FIVE, NINE):
            self.assertEqual(len(scale.labels), len(scale.anchors), scale.id)
            for anchor in scale.anchors:
                self.assertTrue(anchor.strip(), scale.id)
                self.assertLessEqual(len(anchor), MAX_ANCHOR, scale.id)

    def test_every_instruction_fits_the_payload_budget(self):
        found = 0
        for name, text in vars(ax).items():
            if name.endswith("_INSTRUCTIONS"):
                found += 1
                self.assertTrue(text.strip(), name)
                self.assertLessEqual(len(text), MAX_INSTRUCTIONS, name)
        self.assertGreaterEqual(found, 5)

    def test_the_axes_keep_the_sites_own_label_order_in_full(self):
        # ⚠️ NOT just the ends. Swapping the two MIDDLE `LEANING` labels
        # survived the previous suite, and it inverts the sign of every
        # merely-leaning article against the 8,925-record corpus Phase 0
        # measures agreement against.
        self.assertEqual(ax.LEANING.labels, (
            "strong_progressive", "progressive", "neutral",
            "conservative", "strong_conservative"))
        self.assertEqual(ax.RUSSIA_STANCE.labels, (
            "strong_pro_russia", "pro_russia", "neutral",
            "anti_russia", "strong_anti_russia"))
        self.assertEqual(FIVE.labels, (
            "strongly_unfavorable", "unfavorable", "neutral",
            "favorable", "strongly_favorable"))

    def test_the_rubric_runs_IN_THE_SAME_DIRECTION_as_the_labels(self):
        # ⚠️ THE CENTRE ANCHOR CANNOT CATCH A REVERSAL of an ODD-length rubric:
        # reversing nine sentences leaves the fifth exactly where it was. So
        # the ends are asserted too — fully reversing NINE (which silently
        # inverts Phase 0's whole 5-vs-9 arm) survived a centre-only check.
        for scale, first, last in (
                (ax.LEANING, "прогресивна", "консервативна"),
                (ax.RUSSIA_STANCE, "руската гледна точка", "критична към Русия"),
                (FIVE, "враждебна", "подчертано благоприятна"),
                (NINE, "напада субекта", "застъпва каузата")):
            self.assertIn(first, scale.anchors[0], f"{scale.id}: first anchor")
            self.assertIn(last, scale.anchors[-1], f"{scale.id}: last anchor")
            self.assertNotIn(last, scale.anchors[0], f"{scale.id}: rubric reversed?")
            self.assertNotIn(first, scale.anchors[-1], f"{scale.id}: rubric reversed?")

    def test_the_centre_anchor_is_the_no_position_sentence(self):
        # ⚠️ A REVERSED RUBRIC IS INVISIBLE to a length/non-empty check and
        # inverts the whole axis — fully reversing NINE's nine sentences
        # survived the previous suite. The centre is where a reversal is
        # cheapest to catch without reading Bulgarian.
        for scale, needle in ((ax.LEANING, "не заема страна"),
                              (ax.RUSSIA_STANCE, "не заема страна"),
                              (FIVE, "без благоприятна или неблагоприятна"),
                              (NINE, "без оценъчна рамка")):
            self.assertIn(needle, scale.anchors[len(scale) // 2], scale.id)

    def test_anchor_variants_are_keyed_by_their_own_level_count(self):
        for n, scale in ax.ANCHOR_VARIANTS.items():
            self.assertEqual(len(scale), n, scale.id)

    def test_every_display_label_exists_in_the_typescript_vocabulary(self):
        # ⚠️ THE CHECK A LABEL COUNT CANNOT MAKE. `SUBJECT_TONE` once emitted
        # `strongly_favorable` / `strongly_unfavorable`, which appeared in no
        # `.ts` file at all — so `toneMeta()` returned undefined and the chip
        # rendered blank, while `bucket_label`'s 5-label guard passed happily.
        ts = (ROOT / "newsapp/app/labels.ts").read_text(encoding="utf-8")
        for scale in ax.DISPLAY_SCALES:
            self.assertTrue(scale.renderable, scale.id)
            for label in scale.labels:
                self.assertIn(f"{label}:", ts,
                              f"{scale.id}: '{label}' is in no labels.ts vocabulary")

    def test_the_comparison_arm_is_not_marked_renderable(self):
        self.assertFalse(NINE.renderable)
        self.assertNotIn(NINE, ax.DISPLAY_SCALES)


class Buckets(unittest.TestCase):
    def test_bucket_is_symmetric_under_negation_including_near_an_edge(self):
        # ⚠️ THE NEIGHBOURHOOD IS THE POINT. A sweep of exact hundredths hits
        # every edge dead-on and never enters the tolerance band, so it passed
        # while `bucket_index(v) + bucket_index(-v)` was 5 instead of 4 a few
        # ULPs away.
        last = len(js.BUCKET_EDGES)
        probes = [h / 100 for h in range(-250, 251)]
        for edge in js.BUCKET_EDGES:
            for eps in (0.0, 1e-16, 1e-13, 1e-12, 1e-10, 1e-8):
                probes += [(edge + eps) * FIVE.extent, (edge - eps) * FIVE.extent]
        for value in probes:
            self.assertEqual(js.bucket_index(value, FIVE),
                             last - js.bucket_index(-value, FIVE),
                             f"asymmetric at {value!r}")

    def test_a_mirrored_pair_of_ordinary_answers_gets_mirrored_buckets(self):
        # The live reproduction: value 0.49999999999999994 vs its exact
        # negation. One published as favorable, its opposite as neutral.
        up = js.decode_score(score({1: 0.20, 2: 0.10, 3: 0.70}), FIVE)
        down = js.decode_score(score({3: 0.20, 2: 0.10, 1: 0.70}), FIVE)
        self.assertAlmostEqual(up["value"], -down["value"], places=15)
        self.assertEqual(js.bucket_index(up["value"], FIVE),
                         4 - js.bucket_index(down["value"], FIVE))

    def test_the_plans_raw_boundaries_on_the_five_anchor_scale(self):
        cases = [(-2.0, 0), (-1.6, 0), (-1.5, 0), (-1.4, 1), (-0.5, 1),
                 (-0.49, 2), (0.0, 2), (0.49, 2), (0.5, 3), (1.4, 3),
                 (1.5, 4), (2.0, 4)]
        for value, expected in cases:
            self.assertEqual(js.bucket_index(value, FIVE), expected, value)

    def test_a_nine_anchor_value_buckets_the_same_as_its_five_anchor_twin(self):
        for fraction in (-1.0, -0.8, -0.3, 0.0, 0.3, 0.8, 1.0):
            self.assertEqual(js.bucket_index(fraction * FIVE.extent, FIVE),
                             js.bucket_index(fraction * NINE.extent, NINE),
                             fraction)

    def test_bucket_label_refuses_a_scale_the_client_cannot_draw(self):
        self.assertEqual(js.bucket_label(-2.0, FIVE), "strongly_unfavorable")
        self.assertEqual(js.bucket_label(0.0, FIVE), "neutral")
        self.assertEqual(js.bucket_label(2.0, FIVE), "strongly_favorable")
        with self.assertRaises(js.JevScaleError):
            js.bucket_label(0.0, NINE)

    def test_bucket_label_refuses_a_renderable_scale_of_the_wrong_length(self):
        three = js.Scale("three", ("a", "b", "c"), ("A", "B", "C"))
        with self.assertRaises(js.JevScaleError):
            js.bucket_label(0.0, three)


class Decoding(unittest.TestCase):
    def test_the_real_captured_answer_decodes_to_its_expected_value(self):
        raw = probe_answer()
        if raw is None:
            self.skipTest(f"captured probe absent: {PROBE}")
        # The probe's own rubric, so the legend echo matches.
        scale = js.Scale("probe", tuple("abcde"),
                         tuple(raw["legend"][str(i)] for i in range(5)))
        out = js.decode_score(raw, scale)
        # 0.01(-1) + 0.98(+1) + 0.01(+2) = 0.99 on a centred 5-scale, i.e.
        # 2.99 on the probe's own 0..4 indexing against a reported score of 3 —
        # the coincidence that leaves plan §2.3 undecidable from one sample.
        self.assertAlmostEqual(out["value"], 0.99, places=6)
        self.assertEqual(out["level"], 3)
        self.assertAlmostEqual(out["confidence_derived"], 0.98)
        self.assertTrue(out["confidence_agrees"])
        self.assertTrue(out["legend_matches_anchors"])

    def test_the_captured_answer_still_has_confidence_equal_to_max_probability(self):
        # Plan §2.4, re-checked against the file rather than a retyped copy.
        raw = probe_answer()
        if raw is None:
            self.skipTest(f"captured probe absent: {PROBE}")
        self.assertAlmostEqual(raw["confidence"],
                               max(raw["probabilities"].values()), places=6)

    def test_the_decoded_answer_carries_every_stored_field(self):
        # A missing key is a KeyError in the Phase-1 store; deleting
        # `normalized` outright survived the previous suite.
        out = js.decode_score(score({2: 1.0}, level=2, confidence=1.0), FIVE)
        self.assertEqual(set(out), STORED_FIELDS)

    def test_normalized_is_the_value_over_the_extent(self):
        out = js.decode_score(score({0: 0.5, 2: 0.5}), FIVE)  # value -1.0
        self.assertAlmostEqual(out["value"], -1.0, places=9)
        self.assertAlmostEqual(out["normalized"], -0.5, places=9)  # not -1/5
        nine = js.decode_score(score({0: 1.0}), NINE)  # value -4.0
        self.assertAlmostEqual(nine["normalized"], -1.0, places=9)

    def test_value_is_continuous_where_the_level_is_not(self):
        # The module header's worked example. Its arithmetic lives here.
        out = js.decode_score(
            score({0: 0.05, 1: 0.30, 2: 0.50, 3: 0.15, 4: 0.0}, level=2), FIVE)
        self.assertAlmostEqual(out["value"], -0.25, places=6)
        self.assertEqual(out["level"], 2)

    def test_spread_is_the_sd_about_the_value_not_about_zero(self):
        # ⚠️ Centring the variance on 0 survived the previous suite: its one
        # asymmetric case asserted only `spread > 0.5`, which the mutant's
        # 1.4142 also satisfies.
        out = js.decode_score(score({0: 0.4, 1: 0.4, 2: 0.2}), FIVE)
        self.assertAlmostEqual(out["value"], -1.2, places=9)
        self.assertAlmostEqual(out["spread"], math.sqrt(0.56), places=9)

    def test_spread_separates_a_hedge_from_a_confident_neutral(self):
        confident = js.decode_score(score({2: 1.0}), FIVE)
        torn = js.decode_score(score({0: 0.5, 4: 0.5}), FIVE)
        self.assertAlmostEqual(confident["value"], 0.0)
        self.assertAlmostEqual(torn["value"], 0.0)
        self.assertAlmostEqual(confident["spread"], 0.0)
        self.assertAlmostEqual(torn["spread"], 2.0)

    def test_confidence_agreement_is_checked_against_the_raw_maximum(self):
        # ⚠️ §2.4 is a claim about the probabilities AS SENT. Checking the
        # renormalized max manufactured a disagreement on most rounded
        # answers — and §2.4 pre-commits to reading one as "itself the
        # finding", so Phase 0 would have recorded a defect that is ours.
        out = js.decode_score(score({1: 0.03, 3: 0.95}, confidence=0.95), FIVE)
        self.assertTrue(out["confidence_agrees"])
        self.assertAlmostEqual(out["confidence_derived"], 0.95 / 0.98, places=9)
        self.assertEqual(out["confidence_reported"], 0.95)

    def test_a_real_disagreement_is_still_reported(self):
        out = js.decode_score(score({0: 0.1, 2: 0.9}, confidence=0.4), FIVE)
        self.assertAlmostEqual(out["confidence_derived"], 0.9)
        self.assertEqual(out["confidence_reported"], 0.4)
        self.assertFalse(out["confidence_agrees"])

    def test_a_missing_confidence_is_none_not_a_default(self):
        out = js.decode_score(score({2: 1.0}), FIVE)
        self.assertIsNone(out["confidence_reported"])
        self.assertFalse(out["confidence_agrees"])

    def test_an_out_of_range_confidence_is_stored_raw_not_clamped(self):
        # Deliberately unlike `jev_client._clamped`: this field exists so the
        # corpus can re-check §2.4, and clamping would turn a contract break
        # into a plausible 1.0.
        out = js.decode_score(score({2: 1.0}, confidence=7.0), FIVE)
        self.assertEqual(out["confidence_reported"], 7.0)
        self.assertFalse(out["confidence_agrees"])

    def test_probabilities_are_renormalized_when_rounding_misses_one(self):
        out = js.decode_score(score({1: 0.33, 2: 0.33, 3: 0.33}), FIVE)
        self.assertAlmostEqual(sum(out["probabilities"].values()), 1.0, places=9)
        self.assertAlmostEqual(out["value"], 0.0, places=9)

    def test_every_level_is_present_in_the_stored_distribution(self):
        out = js.decode_score(score({2: 1.0}), FIVE)
        self.assertEqual(sorted(out["probabilities"]), ["0", "1", "2", "3", "4"])
        self.assertEqual(out["probabilities"]["0"], 0.0)

    def test_the_rubric_travels_with_the_answer(self):
        # An answer scored against a DIFFERENT question is otherwise
        # shape-identical to one scored against ours.
        out = js.decode_score(score({2: 1.0}), FIVE, axes_version=ax.AXES_VERSION)
        self.assertEqual(out["anchors"], list(FIVE.anchors))
        self.assertEqual(out["axes_version"], ax.AXES_VERSION)
        self.assertEqual(out["contract_version"], js.SCALE_CONTRACT_VERSION)

    def test_a_legend_echo_is_compared_and_a_mismatch_recorded_not_raised(self):
        matching = {str(i): a for i, a in enumerate(FIVE.anchors)}
        self.assertTrue(js.decode_score(
            score({2: 1.0}, legend=matching), FIVE)["legend_matches_anchors"])
        other = {str(i): f"друг въпрос {i}" for i in range(5)}
        out = js.decode_score(score({2: 1.0}, legend=other), FIVE)
        self.assertFalse(out["legend_matches_anchors"])
        self.assertEqual(out["legend"], other)

    def test_no_legend_is_unknown_rather_than_a_mismatch(self):
        self.assertIsNone(js.decode_score(score({2: 1.0}), FIVE)["legend_matches_anchors"])

    def test_an_even_anchor_scale_decodes_end_to_end(self):
        four = js.Scale("four", ("a", "b", "c", "d"), ("A", "B", "C", "D"))
        out = js.decode_score(score({0: 0.5, 3: 0.5}, level=1), four)
        self.assertAlmostEqual(out["value"], 0.0, places=9)
        self.assertAlmostEqual(out["spread"], 1.5, places=9)
        self.assertAlmostEqual(out["normalized"], 0.0, places=9)


class Refusals(unittest.TestCase):
    """Nothing defaults. Plan Refusal 6 — written against a shipped example
    that fabricates a distribution and defaults a missing answer to a
    confident neutral through the same field shape a real answer uses."""

    def test_no_distribution_is_refused_not_defaulted(self):
        for raw in ({}, None, [], "0.98"):
            with self.assertRaises(js.JevScaleError):
                js.decode_score({"type": "score", "score": 2, "probabilities": raw}, FIVE)

    def test_a_missing_score_is_refused(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score({"type": "score", "probabilities": {"2": 1.0}}, FIVE)

    def test_a_score_outside_the_scale_is_refused_without_being_rounded(self):
        # Range-checking does not prejudge §2.3: a fractional level passes.
        self.assertAlmostEqual(
            js.decode_score(score({2: 1.0}, level=2.99), FIVE)["level"], 2.99)
        for level in (9, -1, 5.0):
            with self.assertRaises(js.JevScaleError):
                js.decode_score(score({2: 1.0}, level=level), FIVE)

    def test_the_wrong_answer_type_is_refused(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score({"type": "choice", "choice": "x",
                             "probabilities": {"2": 1.0}, "score": 2}, FIVE)

    def test_a_probability_key_outside_the_scale_is_refused(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({7: 1.0}), FIVE)

    def test_a_duplicate_probability_key_is_refused(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score({"type": "score", "score": 2,
                             "probabilities": {"2": 0.5, " 2 ": 0.5}}, FIVE)

    def test_a_distribution_far_from_one_is_refused_not_rescaled(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({2: 0.5}), FIVE)
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({1: 1.0, 2: 1.0}), FIVE)

    def test_the_sum_tolerance_scales_with_the_level_count(self):
        # ⚠️ A FLAT 0.05 sits 0.005 from refusing a legitimately rounded
        # 9-anchor answer — and 9 anchors is the arm Phase 0 actually runs.
        # The floor covers 5 and 9; what a flat number cannot cover is the
        # API's maximum, where ordinary rounding alone can miss 1.0 by 0.12.
        widest = js.Scale("widest",
                          tuple(f"l{i}" for i in range(js.MAX_SCORE_LEVELS)),
                          tuple("A" for _ in range(js.MAX_SCORE_LEVELS)))
        self.assertGreater(js.prob_sum_tolerance(widest), js.prob_sum_tolerance(FIVE))
        for scale in (FIVE, NINE, widest):
            self.assertGreaterEqual(js.prob_sum_tolerance(scale),
                                    js.PROB_ROUNDING_PER_LEVEL * len(scale), scale.id)
        # 9 levels each rounded down by 0.005 → sums to 0.955, still rounding.
        nine_rounded = {i: 0.955 / 9 for i in range(9)}
        js.decode_score(score(nine_rounded), NINE)

    def test_booleans_and_nonfinite_numbers_are_not_probabilities(self):
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({2: True}), FIVE)
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({2: float("nan")}), FIVE)
        with self.assertRaises(js.JevScaleError):
            js.decode_score(score({2: -0.5, 1: 1.5}), FIVE)

    def test_a_nonnumeric_or_truncating_level_key_is_refused(self):
        for key in ("neutral", 2.9, None, True):
            with self.assertRaises(js.JevScaleError):
                js.decode_score({"type": "score", "score": 2,
                                 "probabilities": {key: 1.0}}, FIVE)


class BothDirections(unittest.TestCase):
    def test_it_separates_torn_from_even_handed(self):
        torn, _ = js.read_probabilities({"0": 0.5, "4": 0.5}, FIVE)
        even, _ = js.read_probabilities({"2": 1.0}, FIVE)
        self.assertTrue(js.both_directions(torn, FIVE))
        self.assertFalse(js.both_directions(even, FIVE))

    def test_one_full_level_off_centre_counts_as_a_tail(self):
        # ⚠️ The rule the comment justifies — not only the extremes. Moving
        # the cut out by a level survived the previous suite, which never
        # exercised levels at ±1 at all.
        inner, _ = js.read_probabilities({"1": 0.5, "3": 0.5}, FIVE)
        self.assertTrue(js.both_directions(inner, FIVE))
        # ⚠️ The 5-anchor case alone cannot pin the tail: its level ±1 sits at
        # 0.5 of the range, so a tail of 0.25 and one of 0.5 both admit it.
        # On 9 anchors level ±1 is 0.25 of the range, which separates them —
        # and moving the tail out survived without this.
        nine_inner, _ = js.read_probabilities({"3": 0.5, "5": 0.5}, NINE)
        self.assertTrue(js.both_directions(nine_inner, NINE))
        self.assertEqual(js.BOTH_DIRECTIONS_TAIL, abs(js.BUCKET_EDGES[1]),
                         "the tail is the first bucket edge: mass in a "
                         "non-neutral BUCKET on each side")

    def test_both_directions_agrees_across_anchor_counts(self):
        # ⚠️ The invariant BUCKET_EDGES is normalized for. A raw cut at
        # |value| >= 1 is half the range on 5 anchors and a quarter on 9, so
        # the same relative answer answered differently on each — corrupting
        # both Phase 0's 5-vs-9 arm and the τ fit.
        # Only fractions that land ON a level of BOTH scales can be compared:
        # 0.25 of the range is level 3/5 on 9 anchors and falls BETWEEN levels
        # on 5, so a mismatch there would be the test's arithmetic, not the
        # rule's. 0.5 and 1.0 are levels on both.
        for fraction in (0.5, 1.0):
            five_off = round(fraction * FIVE.extent)
            nine_off = round(fraction * NINE.extent)
            five = {2 - five_off: 0.5, 2 + five_off: 0.5}
            nine = {4 - nine_off: 0.5, 4 + nine_off: 0.5}
            self.assertEqual(js.both_directions(five, FIVE),
                             js.both_directions(nine, NINE), fraction)
            self.assertTrue(js.both_directions(five, FIVE), fraction)

    def test_a_one_sided_spread_is_not_both_directions(self):
        one_sided, _ = js.read_probabilities({"0": 0.4, "1": 0.4, "2": 0.2}, FIVE)
        self.assertGreater(
            js.decode_score(score({0: 0.4, 1: 0.4, 2: 0.2}), FIVE)["spread"], 0.5)
        self.assertFalse(js.both_directions(one_sided, FIVE))

    def test_the_centre_level_counts_to_neither_side(self):
        centred, _ = js.read_probabilities({"2": 1.0}, FIVE)
        self.assertFalse(js.both_directions(centred, FIVE, tau=0.001))

    def test_a_bad_level_index_raises_rather_than_wrapping(self):
        # A negative index would silently count the MOST favourable level as
        # the right tail and return a confident True.
        with self.assertRaises(js.JevScaleError):
            js.both_directions({7: 1.0}, FIVE)
        with self.assertRaises(js.JevScaleError):
            js.both_directions({-1: 0.5, 0: 0.5}, FIVE)
        with self.assertRaises(js.JevScaleError):
            js.both_directions({True: 0.5, 0: 0.5}, FIVE)

    def test_tau_outside_the_unit_interval_is_refused(self):
        probs, _ = js.read_probabilities({"0": 0.5, "4": 0.5}, FIVE)
        for tau in (0, -0.1, 1.5):
            with self.assertRaises(js.JevScaleError):
                js.both_directions(probs, FIVE, tau=tau)

    def test_the_threshold_and_the_tail_are_both_recorded(self):
        # Neither is fitted yet (plan §3.5 fits τ in Phase 0), so a consumer
        # must be able to see which pair produced the flag — and a τ fitted
        # against one tail must never be read against another.
        out = js.decode_score(score({0: 0.5, 4: 0.5}), FIVE, tau=0.3)
        self.assertEqual(out["both_directions_tau"], 0.3)
        self.assertEqual(out["both_directions_tail"], js.BOTH_DIRECTIONS_TAIL)
        self.assertTrue(out["both_directions"])


class Noul(unittest.TestCase):
    def test_a_noul_value_is_its_probability(self):
        self.assertAlmostEqual(js.read_noul({"type": "noul", "noul": 0.99}), 0.99)
        self.assertAlmostEqual(js.read_noul({"type": "noul", "noul": 0.01}), 0.01)

    def test_the_boundary_values_are_accepted(self):
        self.assertEqual(js.read_noul({"type": "noul", "noul": 0.0}), 0.0)
        self.assertEqual(js.read_noul({"type": "noul", "noul": 1}), 1.0)

    def test_a_score_shaped_answer_is_not_readable_as_noul(self):
        with self.assertRaises(js.JevScaleError):
            js.read_noul({"type": "score", "score": 1})
        with self.assertRaises(js.JevScaleError):
            js.read_noul(None)

    def test_out_of_range_and_nonnumeric_are_refused(self):
        for value in (1.5, -0.1, None, True, "0.5", float("inf"), float("nan")):
            with self.assertRaises(js.JevScaleError):
                js.read_noul({"type": "noul", "noul": value})


if __name__ == "__main__":
    unittest.main()
