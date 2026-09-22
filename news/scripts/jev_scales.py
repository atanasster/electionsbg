#!/usr/bin/env python3
"""The sentiment SCALE contract — what a Jev `score` answer means, as numbers.

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` §3. This module is pure: no
network, no store, no article. It turns one Jev answer into the five fields the
rest of the pipeline stores, and it is the ONE place the arithmetic lives.

⚠️⚠️ THE MEASUREMENT IS `value`, NOT `level`. A `score` answer carries an
ordinal placement AND a probability for every level. Reading only the placement
throws away the half that makes the number continuous: an article answered
`{-2: .05, -1: .30, 0: .50, +1: .15, +2: 0}` is at **−0.25**, not "neutral", and
a chart plotted from `level` alone is a step function that sits on zero.
(The arithmetic is pinned in `test_value_is_continuous_where_the_level_is_not`,
so the number has one home rather than three.)

⚠️ `confidence` IS NOT INDEPENDENT INFORMATION. Measured on all five non-`noul`
answers in the captured contract probe (`news/data/_perf/jev/20260920T024115Z/`),
the reported `confidence` equals `max(probabilities)` EXACTLY. So it is the modal
probability, the distribution strictly dominates it, and — the part that matters
for any consumer — **a confident answer is not a strong one**: confidence 0.98 on
"neutral" is a confident zero. Both values are stored (`confidence_reported`,
`confidence_derived`) precisely so the plan's §2.4 claim can be re-checked over
the whole corpus instead of over five samples; `confidence_agrees` is that check
per answer.

⚠️ NOTHING HERE DEFAULTS. A missing or malformed distribution raises
`JevScaleError`; it never becomes a neutral at 0.75. That is Refusal 6 of the
plan, and it is written against a real shipped example — the prior-art app
(§2.2) fabricates a distribution from the weights `[.4, .3, .15, .1, .05]` when
Jev returns fewer than two probabilities, and defaults a missing answer to
`score 2.0, confidence 0.75` through the same field shape a real answer uses.
This project publishes about named parties and named people; a number nobody
measured, wearing the shape of one that was, is the one output that must be
impossible rather than merely discouraged.
"""
from __future__ import annotations

import math

SCALE_CONTRACT_VERSION = 1

# `jev_client.LIMITS["score_levels"]`, restated here rather than imported so
# this module stays free of the network client; `test_jev_scales` asserts the
# two agree, the way `analyze_articles.DEFAULT_MAX_BODY_CHARS` mirrors
# `build_prompts.MAX_BODY_CHARS`.
MAX_SCORE_LEVELS = 24

# How close to a bucket edge counts as ON it. Absolute, and applied to BOTH
# sides — see `bucket_index`.
EDGE_TOLERANCE = 1e-9

# ⚠️ THE BUCKET BOUNDARIES ARE ON THE NORMALIZED VALUE, and that is what makes a
# 5-anchor and a 9-anchor run comparable. `value` lives on ±(n-1)/2, so a raw
# cut at ±0.5 / ±1.5 means different things on the two scales — and Phase 0 of
# the plan scores BOTH over the same articles and compares them. Normalizing to
# [-1, 1] first, then cutting at ±0.25 / ±0.75, reproduces the plan's §3.6 raw
# boundaries exactly on the 5-anchor scale (0.25×2 = 0.5, 0.75×2 = 1.5) and
# keeps them meaning the same thing on any other anchor count.
#
# ⚠️ A TYPESCRIPT TWIN AND A SHARED VECTOR FIXTURE ARE OWED — plan §3.6. The
# pattern it cites (`shlyoRules.ts` → `141_shlyo_query_fold.sql`) GENERATES one
# side from the other and gates the pair with a test; hand-copying these four
# numbers into `labels.ts` is how the bar and the number stop agreeing.
BUCKET_EDGES = (-0.75, -0.25, 0.25, 0.75)

# Provisional. ⚠️ NOT FITTED YET — the plan (§3.5) fits it in Phase 0 against the
# 19 existing `mixed` and 1,766 `neutral` records and reports the ROC. Quoting
# this number as "the threshold" before that run is quoting a guess.
BOTH_DIRECTIONS_TAU_PROVISIONAL = 0.20

# A distribution may miss 1.0 by rounding, so it is renormalized; anything
# outside the band is not rounding and is refused rather than rescaled into
# looking healthy.
#
# ⚠️ THE BAND SCALES WITH THE LEVEL COUNT and a flat number gets this wrong on
# the arm Phase 0 will actually run. The observed probabilities are reported to
# two decimals, so the worst case is 0.005 per level: 0.025 at 5 anchors,
# **0.045 at 9** and 0.12 at the API's maximum of 24. A flat 0.05 therefore sits
# 0.005 from refusing a legitimately rounded 9-anchor answer. The 2-dp fact is
# stated HERE and nowhere else — it was restated in three places and three forms.
PROB_ROUNDING_PER_LEVEL = 0.005
PROB_SUM_FLOOR = 0.05
PROB_SUM_HEADROOM = 1.1

# ⚠️ ON THE NORMALIZED VALUE, for exactly the reason BUCKET_EDGES is. A raw
# cut at |value| >= 1 is ±0.50 of the range on 5 anchors and ±0.25 on 9, so the
# same relative answer is two-directional on one scale and not on the other —
# and Phase 0 scores both over the same articles and fits τ against the result.
# 0.25 is the first bucket edge, so "both directions" means mass in a
# non-neutral BUCKET on each side, which is what a reader sees.
BOTH_DIRECTIONS_TAIL = 0.25


def prob_sum_tolerance(scale) -> float:
    """How far from 1.0 a distribution may land and still be rounding."""
    return max(PROB_SUM_FLOOR,
               PROB_ROUNDING_PER_LEVEL * len(scale) * PROB_SUM_HEADROOM)


class JevScaleError(ValueError):
    """A score answer that cannot be read. Never returned as a value."""


class Scale:
    """One ordinal question: its anchors, and the signed value of each level.

    `labels` are the vocabulary the rest of the site already speaks (the
    `LEANING_ORDER` / `RUSSIA_ORDER` / `TONE_META` keys in `labels.ts`).
    `anchors` are the Bulgarian rubric sentences sent to Jev as `criteria` —
    they ARE the question, which is why they live beside the labels rather
    than in the prompt builder.

    `renderable` says whether `labels` is a vocabulary the CLIENT can draw.
    ⚠️ It is a real property, not a proxy: `bucket_label`'s guard used to test
    the label COUNT, which any 5-entry scale passes — including one whose
    labels appear in no `.ts` file. A count is not a vocabulary.
    """

    __slots__ = ("id", "labels", "anchors", "renderable")

    def __init__(self, id: str, labels, anchors, *, renderable: bool = True):
        # A bare string is a sequence of characters, so `Scale("x", "ab", "AB")`
        # would otherwise build a two-level scale whose rubric is "A" and "B".
        if isinstance(labels, str) or isinstance(anchors, str):
            raise JevScaleError(f"{id}: labels/anchors must be sequences, not a string")
        labels, anchors = tuple(labels), tuple(anchors)
        if len(labels) != len(anchors):
            raise JevScaleError(f"{id}: {len(labels)} labels against {len(anchors)} anchors")
        if len(labels) < 2:
            raise JevScaleError(f"{id}: a scale needs at least two levels")
        if len(set(labels)) != len(labels):
            # Two identical labels make `bucket_label` ambiguous.
            raise JevScaleError(f"{id}: duplicate label")
        if len(labels) > MAX_SCORE_LEVELS:
            # Fail before the call is paid for — `jev_client._score_criteria`
            # refuses it too, but only once the payload is being built.
            raise JevScaleError(
                f"{id}: {len(labels)} levels exceeds the API's {MAX_SCORE_LEVELS}")
        if any(not isinstance(a, str) or not a.strip() for a in anchors):
            raise JevScaleError(f"{id}: every anchor needs rubric text")
        self.id = id
        self.labels = labels
        self.anchors = anchors
        self.renderable = bool(renderable)

    def __len__(self) -> int:
        return len(self.labels)

    @property
    def values(self) -> tuple:
        """Signed value per level, centred on zero: 5 anchors -> (-2,-1,0,1,2).

        An EVEN anchor count has no centre level and yields half-integers
        (4 -> -1.5,-0.5,0.5,1.5). That is deliberate rather than an oversight:
        the stored number is an expectation, so it does not need a level to
        land on.
        """
        half = (len(self.labels) - 1) / 2
        return tuple(i - half for i in range(len(self.labels)))

    @property
    def extent(self) -> float:
        """The largest absolute level value — the normalizer for `bucket`.

        Always >= 0.5: `__init__` requires at least two levels.
        """
        return (len(self.labels) - 1) / 2

    def label_at(self, index: int) -> str:
        return self.labels[index]


def normalize(value: float, scale: Scale) -> float:
    """`value` mapped onto [-1, 1], so two anchor counts can be compared."""
    return value / scale.extent


def bucket_index(value: float, scale: Scale) -> int:
    """Which of the five display buckets a value falls in.

    ⚠️ THE FLOAT TOLERANCE MUST BE TWO-SIDED. Applying it to the positive
    edges only makes `bucket_index(-v)` stop mirroring `bucket_index(v)` a few
    ULPs from an edge — and that is reachable from an ordinary two-decimal
    answer, not a theoretical nicety: `{1: .20, 2: .10, 3: .70}` has value
    0.49999999999999994, so it lands in *favorable* while its exact mirror
    lands in *neutral*. Two opposite articles, non-opposite labels.
    """
    n = normalize(value, scale)
    idx = 0
    for edge in BUCKET_EDGES:
        if math.isclose(n, edge, rel_tol=0.0, abs_tol=EDGE_TOLERANCE):
            # The plan closes each interval on its OUTER side: -0.25 belongs
            # to the unfavourable bucket, +0.25 to the favourable one.
            if edge > 0:
                idx += 1
            break
        if n > edge:
            idx += 1
        else:
            break
    return idx


def bucket_label(value: float, scale: Scale) -> str:
    """The display bucket, named in the vocabulary the client can draw.

    ⚠️ Refuses a scale the client cannot render, because returning its own
    3rd-of-9 anchor would put a label on the page that no vocabulary contains.
    A 9-anchor run (Phase 0's comparison arm) is bucketed through the display
    scale it is being compared against, via `bucket_index`.
    """
    if not scale.renderable:
        raise JevScaleError(
            f"{scale.id}: not a display scale — bucket through the display "
            f"scale with bucket_index() instead")
    if len(scale) != len(BUCKET_EDGES) + 1:
        raise JevScaleError(
            f"{scale.id}: bucket_label needs a {len(BUCKET_EDGES) + 1}-label scale, "
            f"got {len(scale)}")
    return scale.label_at(bucket_index(value, scale))


def read_probabilities(raw, scale: Scale) -> tuple:
    """`({level index -> p}, raw_max)` — checked, renormalized, and the raw max.

    Jev keys the map by level index AS A STRING (`{"0": 0, "1": 0.01, ...}`);
    a caller that indexes it with an int silently finds nothing, so the
    conversion happens once, here.

    ⚠️ THE RAW MAXIMUM IS RETURNED ALONGSIDE, and it is not redundant. Plan
    §2.4's claim — that Jev's reported `confidence` equals the largest
    probability — is about the values AS SENT. Renormalization moves the
    maximum whenever two-decimal rounding misses 1.0, so checking the reported
    confidence against the *stored* max manufactures a disagreement on most
    rounded answers, and §2.4 pre-commits to reading a disagreement as "itself
    the finding".
    """
    if not isinstance(raw, dict) or not raw:
        raise JevScaleError(f"{scale.id}: no probability distribution")
    out: dict = {}
    for key, prob in raw.items():
        # `int(True)` is 1 and `int(2.9)` truncates to 2, either of which
        # silently lands on a level nobody named.
        if isinstance(key, bool) or not isinstance(key, (str, int)):
            raise JevScaleError(f"{scale.id}: level key {key!r} is not an index")
        try:
            index = int(str(key).strip())
        except ValueError:
            raise JevScaleError(f"{scale.id}: level key {key!r} is not an index")
        if not 0 <= index < len(scale):
            raise JevScaleError(f"{scale.id}: level {index} outside 0..{len(scale) - 1}")
        if index in out:
            raise JevScaleError(f"{scale.id}: level {index} appears twice")
        # bool is an int in Python and would pass an isinstance check.
        if isinstance(prob, bool) or not isinstance(prob, (int, float)):
            raise JevScaleError(f"{scale.id}: level {index} probability is not a number")
        if not math.isfinite(prob) or prob < 0:
            raise JevScaleError(f"{scale.id}: level {index} probability {prob!r}")
        out[index] = float(prob)
    total = sum(out.values())
    if not math.isfinite(total) or total <= 0:
        raise JevScaleError(f"{scale.id}: probabilities sum to {total!r}")
    tolerance = prob_sum_tolerance(scale)
    if abs(total - 1.0) > tolerance:
        raise JevScaleError(
            f"{scale.id}: probabilities sum to {total:.4f}, outside 1±{tolerance:.4f}")
    return {index: prob / total for index, prob in out.items()}, max(out.values())


def decode_score(answer, scale: Scale, *,
                 tau: float = BOTH_DIRECTIONS_TAU_PROVISIONAL,
                 axes_version=None) -> dict:
    """One Jev `score` answer -> the fields the pipeline stores.

    Raises `JevScaleError` on anything it cannot read. It never substitutes a
    default — see the module header.

    `axes_version` is passed IN rather than imported: `jev_axes` imports this
    module, so reading it here would be a cycle. It identifies the rubric the
    answer was scored against, which `contract_version` (the arithmetic) does
    not — and `jev_axes` is by design the file that gets revised.
    """
    if not isinstance(answer, dict):
        raise JevScaleError(f"{scale.id}: answer is not an object")
    if answer.get("type") != "score":
        raise JevScaleError(f"{scale.id}: answer type {answer.get('type')!r}, not 'score'")
    probabilities, raw_max = read_probabilities(answer.get("probabilities"), scale)
    values = scale.values
    value = sum(prob * values[index] for index, prob in probabilities.items())
    variance = sum(prob * (values[index] - value) ** 2 for index, prob in probabilities.items())
    derived = max(probabilities.values())

    # ⚠️ Stored RAW and deliberately NOT clamped, unlike `jev_client._clamped`
    # which reads the same field. This one's job is to let the corpus re-check
    # §2.4, and clamping would turn a contract break into a plausible 1.0. A
    # value outside [0, 1] is recorded, and `confidence_agrees` is False for it.
    reported = answer.get("confidence")
    if isinstance(reported, bool) or not isinstance(reported, (int, float)):
        reported = None
    elif not math.isfinite(reported):
        reported = None

    # ⚠️ `level` is stored RAW and is never rounded into an index here. Whether
    # Jev's `score` is an integer or a fraction is an OPEN question (plan §2.3:
    # the prior-art app's code is written as if it is fractional, our own probe
    # returned an integer, and the expected value of that probe's distribution
    # was 2.99 — so the two are indistinguishable in that one sample). Phase 0
    # settles it by reading this field; coercing it now would erase the evidence.
    level = answer.get("score")
    if isinstance(level, bool) or not isinstance(level, (int, float)) or not math.isfinite(level):
        raise JevScaleError(f"{scale.id}: score {level!r} is not a number")
    # Not rounded — but it must lie ON the scale. This is the one field a
    # consumer is likely to index with, and every other field is bounded.
    if not -0.5 <= level <= len(scale) - 0.5:
        raise JevScaleError(f"{scale.id}: score {level!r} outside 0..{len(scale) - 1}")

    legend = answer.get("legend")
    return {
        "scale": scale.id,
        "levels": len(scale),
        "level": level,
        "probabilities": {str(i): probabilities.get(i, 0.0) for i in range(len(scale))},
        "value": value,
        "normalized": normalize(value, scale),
        "spread": math.sqrt(variance),
        "confidence_reported": reported,
        "confidence_derived": derived,
        # §2.4 is a claim about the RAW probabilities as sent, so it is checked
        # against `raw_max` — see `read_probabilities`.
        "confidence_agrees": (reported is not None
                              and math.isclose(reported, raw_max, abs_tol=0.005)),
        "both_directions": both_directions(probabilities, scale, tau=tau),
        "both_directions_tau": tau,
        "both_directions_tail": BOTH_DIRECTIONS_TAIL,
        "anchors": list(scale.anchors),
        "legend": legend if isinstance(legend, dict) else None,
        "legend_matches_anchors": legend_matches(legend, scale),
        "axes_version": axes_version,
        "contract_version": SCALE_CONTRACT_VERSION,
    }


def legend_matches(legend, scale: Scale):
    """Did Jev echo the rubric we sent? `None` when it echoed none.

    ⚠️ NOT A REFUSAL. The endpoint may normalize whitespace, and a mismatch is
    not necessarily a wrong answer — but an answer scored against a DIFFERENT
    question is otherwise shape-identical to one scored against ours, so it has
    to be visible somewhere. Recorded, never acted on here.
    """
    if not isinstance(legend, dict) or not legend:
        return None
    echoed = tuple(legend.get(str(i)) for i in range(len(scale)))
    if all(e is None for e in echoed):
        return None
    return tuple(" ".join(str(e).split()) if e is not None else None for e in echoed) == \
        tuple(" ".join(a.split()) for a in scale.anchors)


def both_directions(probabilities: dict, scale: Scale, *,
                    tau: float = BOTH_DIRECTIONS_TAU_PROVISIONAL) -> bool:
    """Is there real mass on BOTH sides of neutral? — the derived `mixed`.

    ⚠️ This is what replaces a stored `mixed` label, and the distinction it
    buys is the point: "the model was torn" (mass on both tails, `value` ~ 0)
    and "the article is even-handed" (mass piled on neutral, `value` ~ 0) are
    the same word today and different distributions here. `spread` alone cannot
    separate them from a single wide-but-one-sided answer, which is why this
    tests the two tails rather than the variance.

    A tail is mass at or beyond `BOTH_DIRECTIONS_TAIL` of the range on each
    side — the NORMALIZED cut, so a 5-anchor and a 9-anchor answer of the same
    shape get the same verdict.
    """
    if not 0 < tau <= 1:
        raise JevScaleError(f"tau {tau!r} outside (0, 1]")
    values = scale.values
    if any(isinstance(i, bool) or not isinstance(i, int) or not 0 <= i < len(values)
           for i in probabilities):
        # A negative index would silently wrap and count the MOST favourable
        # level as the right tail, returning a confident True.
        raise JevScaleError(f"{scale.id}: level index outside 0..{len(values) - 1}")
    extent = scale.extent
    left = sum(p for i, p in probabilities.items()
               if values[i] / extent <= -BOTH_DIRECTIONS_TAIL)
    right = sum(p for i, p in probabilities.items()
                if values[i] / extent >= BOTH_DIRECTIONS_TAIL)
    return left >= tau and right >= tau


def read_noul(answer) -> float:
    """A `noul` answer's probability, in [0, 1].

    ⚠️ `noul` carries NO `confidence` and NO `probabilities` — its value IS its
    probability. `jev_client.confidence_of` already encodes the matching trap
    (a confident "no" at 0.01 is near-certain, not unreliable); here the raw
    probability is what an applicability gate wants, so it is returned as-is.
    """
    if not isinstance(answer, dict):
        raise JevScaleError("noul: answer is not an object")
    if answer.get("type") != "noul":
        raise JevScaleError(f"noul: answer type {answer.get('type')!r}")
    value = answer.get("noul")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise JevScaleError(f"noul: value {value!r} is not a number")
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise JevScaleError(f"noul: value {value!r} outside [0, 1]")
    return float(value)
