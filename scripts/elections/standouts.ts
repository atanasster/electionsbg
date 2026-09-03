// Which places "stand out", and why (§7).
//
// Pure selectors: every function here takes a POPULATION and returns picks. No file reads, no
// dates, no randomness — so the same corpus always yields the same standouts, which is what
// makes §9's byte-identical rebuild gate possible.
//
// ⚠ TWO OF THE FOUR THRESHOLDS ARE PERCENTILES OF THE CYCLE BEING BUILT, NOT NUMBERS. The
// municipality margin distribution moves by an order of magnitude between cycles — p5 is 0.47 pp
// in 2021_07_11 and 4.88 pp in 2026_04_19 — so a fixed 5 pp selects 5.3% of municipalities in one
// cycle and 24.3% in another, and the word "close" would mean two different things depending on
// the year. Every cutoff here is therefore DERIVED from the population passed in, and a selector
// that hard-codes a pp value has reintroduced the defect the shape exists to prevent.
//
// ⚠ A SIGNAL TRUE OF MOST PLACES IS A DESCRIPTION, NOT A FINDING. "No single party holds a
// majority" describes 179 of 289 councils (62%) and is barred outright — it is not even a member
// of `ElectionStandoutSignal`. Split control survives the same test at 13.1% and stays. The
// share-of-population check is enforced here, in `assertNotUbiquitous`, rather than left to a
// reviewer's memory.
//
// ⚠ NEUTRAL LANGUAGE IS A DATA RULE, NOT A COPY RULE. These functions emit signal CODES and
// label params; the words a reader sees come from i18n. Nothing here may emit prose, and no
// signal name may assert a cause — "stands out", "differs from", "flagged for review", never
// "fraud" or "manipulation" (§7).

import {
  SECTION_SIGNAL_MIN_SECTIONS,
  STANDOUT_THRESHOLDS,
  TURNOUT_DEPARTURE_EXCLUDED_OBLAST,
  UBIQUITY_CEILING,
  UBIQUITY_MIN_POPULATION,
  type StandoutThreshold,
} from "../../src/data/elections/standoutThresholds";
import {
  MAX_SURFACE_STANDOUTS,
  type ElectionPlaceLevel,
  type ElectionResultStatus,
  type ElectionStandout,
  type ElectionStandoutCategory,
  type ElectionStandoutSignal,
} from "../../src/data/elections/surfaceTypes";

/** Which category each signal occupies. §7 caps at ONE PER CATEGORY, so this mapping is what
 *  makes the cap meaningful — and it is exhaustive, so a new signal cannot be selected without
 *  someone deciding whether it competes with the margin or with the review flags. */
export const SIGNAL_CATEGORY = {
  // ⚠ TRANSCRIBED FROM §7's SLOT LIST, not grouped by intuition. §7 slot 1 is
  // "outcome/change — winner margin, lead change, threshold/majority, split control, runoff";
  // slot 2 is "participation/competition — turnout change …, unusually CLOSE CONTEST, unusually
  // fragmented council". So `close_contest` is slot 2: it is the COMPETITIVENESS comparison,
  // not the winner's margin as a fact. It sat in `outcome` until 2026-09-03 and the difference
  // is not cosmetic — the cap keeps one per category, so the mapping decides which findings can
  // co-appear, and a mis-slotted close contest silently displaced split control.
  close_contest: "participation",
  lead_change: "outcome",
  threshold_crossed: "outcome",
  split_control: "outcome",
  runoff_pending: "outcome",
  turnout_departure: "participation",
  fragmented_council: "participation",
  concentrated_support: "review",
  invalid_ballots: "review",
  additional_voters: "review",
} as const satisfies Record<ElectionStandoutSignal, ElectionStandoutCategory>;

// ─── the distributional core ────────────────────────────────────────────────────────────────

/** The value at fraction `p` of a sorted ascending sample, by nearest-rank.
 *
 *  ⚠ NEAREST-RANK, NOT INTERPOLATION, and the choice is not cosmetic. An interpolated cutoff is
 *  a value no place actually has, so "the bottom 5%" can select 4.6% or 5.4% of a small
 *  population depending on where the fractional rank lands — and at oblast level the population
 *  is 28. Nearest-rank always names a real observation, which is also what lets the gate assert
 *  "the selected share is ~5%" rather than "roughly 5%".
 *
 *  Returns `null` for an empty sample: a cutoff over nothing is not 0, and 0 would select every
 *  place at a lower tail and none at an upper one. */
export const percentile = (
  sample: readonly number[],
  p: number,
): number | null => {
  if (sample.length === 0) return null;
  if (!(p > 0 && p < 1)) throw new Error(`percentile p out of range: ${p}`);
  const sorted = [...sample].sort((a, b) => a - b);
  // Rank in 1..n, so p=0.05 over 100 values is the 5th — the boundary of the bottom 5%.
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
};

/** The cutoff that makes an INCLUSIVE tail comparison select the intended share.
 *
 *  ⚠ THE TWO TAILS ARE NOT THE SAME RANK, and using `percentile(sample, 0.95)` with `>= cutoff`
 *  gets the upper one wrong whenever `share x n` is an integer: it selects `n - ceil(0.95n) + 1`,
 *  which is ONE TOO MANY. Measured — n=100: 5 vs 6; n=200: 10 vs 11; n=300: **15 vs 16**, i.e.
 *  5.33% published as 5%. It hides at n=289 and n=298, which are two of the real populations,
 *  so the corpus would not have shown it.
 *
 *  Both tails are therefore computed from the SHARE TO SELECT, and the boundary is a real
 *  observation in both directions. `share` is derived from the threshold: a `lower` rule's
 *  percentile IS the share, an `upper` rule's is its complement. */
export const selectionCutoff = (
  sample: readonly number[],
  threshold: Pick<StandoutThreshold, "percentile" | "tail">,
): number | null => {
  const { percentile: p, tail } = threshold;
  if (p === undefined || tail === undefined)
    throw new Error("selectionCutoff needs a percentile and a tail");
  if (sample.length === 0) return null;
  const share = tail === "upper" ? 1 - p : p;
  if (!(share > 0 && share < 1))
    throw new Error(`selection share out of range: ${share}`);
  const sorted = [...sample].sort((a, b) => a - b);
  const n = sorted.length;
  // ⚠ AN EPSILON, AND IT IS NOT DEFENSIVE PADDING. An upper rule's share is `1 - 0.95`, which in
  // binary floating point is 0.050000000000000044 — so a bare `ceil(share * 100)` is SIX, and
  // the upper tail silently selects one place more than the lower one at every n where the
  // product should have been exact. Measured before the fix: n=100 → 5 low against 6 high.
  const take = Math.max(1, Math.ceil(share * n - 1e-9));
  return tail === "lower" ? sorted[take - 1] : sorted[n - take];
};

/** ⚠ THE GUARD THAT KEEPS A SIGNAL A FINDING. §7: "never emit a signal that is true of most
 *  places". Applied to the SELECTION, not to the threshold, because a percentile cutoff is
 *  ~5% by construction while a categorical signal is whatever the corpus makes it — and the
 *  council-majority signal (62%) is exactly how a categorical one goes wrong.
 *
 *  Throws rather than filtering. A selector that quietly dropped an over-broad signal would
 *  publish nothing and look like a corpus with no findings. */
export const assertNotUbiquitous = (
  signal: ElectionStandoutSignal,
  selected: number,
  population: number,
  ceiling = UBIQUITY_CEILING,
): void => {
  // ⚠ UNDEFINED ON A TINY POPULATION. Nearest-rank always selects at least one place, so n = 1
  // is 100% and n = 2 is 50% — both over the ceiling, neither a finding about the corpus.
  // Enforcing it there aborts the whole generator because an oblast has two municipalities.
  if (population < UBIQUITY_MIN_POPULATION) return;
  const share = selected / population;
  if (share > ceiling)
    throw new Error(
      `standout "${signal}" fires on ${selected}/${population} places ` +
        `(${(share * 100).toFixed(1)}%), above the ${(ceiling * 100).toFixed(0)}% ceiling — ` +
        `a signal true of most places is a description, not a finding (§7)`,
    );
};

// ─── the populations a selector reasons over ────────────────────────────────────────────────

export type MarginRow = {
  id: string;
  level: ElectionPlaceLevel;
  /** Winner-to-runner-up margin, in percentage points of valid votes. */
  marginPct: number;
  validVotes: number;
  resultStatus: ElectionResultStatus;
  evidenceTo: string;
};

export type TurnoutRow = {
  id: string;
  level: ElectionPlaceLevel;
  /** The oblast this place sits in — abroad (32) is excluded outright. */
  oblast: string;
  /** This place's turnout change, in pp, over the same cycle pair as `nationalDeltaPp`. */
  deltaPp: number;
  registeredVoters: number;
  turnoutBasisUnavailable: boolean;
  resultStatus: ElectionResultStatus;
  evidenceTo: string;
};

export type CouncilRow = {
  id: string;
  level: ElectionPlaceLevel;
  partiesWithSeats: number;
  seatsTotal: number;
  resultStatus: ElectionResultStatus;
  evidenceTo: string;
};

/** §7: "suppress a review signal if the evidence leaf is absent for that cycle/scope", and §5's
 *  "do not emit a standout when its denominator, baseline, or evidence destination is missing".
 *
 *  ⚠ APPLIED TO EVERY SIGNAL, NOT ONLY REVIEW ONES. An outcome standout with no evidence route
 *  is a claim about a named place with nowhere to check it, which is the shape §7 exists to
 *  prevent — the review flags are simply where it was noticed first. */
export const hasEvidence = (s: ElectionStandout): boolean =>
  typeof s.evidenceTo === "string" && s.evidenceTo.length > 0;

export const dropWithoutEvidence = (
  candidates: readonly ElectionStandout[],
): ElectionStandout[] => candidates.filter(hasEvidence);

// ─── the selectors ──────────────────────────────────────────────────────────────────────────

const standout = (
  args: Omit<ElectionStandout, "category">,
): ElectionStandout => ({
  ...args,
  category: SIGNAL_CATEGORY[args.signal],
});

/** Places whose winner-to-runner-up margin is in the bottom 5% OF THIS CYCLE'S distribution at
 *  this level (§7.1). The cutoff is derived from `population`, so the same code on two cycles
 *  yields two cutoffs — which is the whole point. */
export const selectCloseContests = (
  population: readonly MarginRow[],
  cycle: string,
): ElectionStandout[] => {
  const t = STANDOUT_THRESHOLDS.close_contest;
  // ⚠ THE SAMPLE FLOOR APPLIES TO THE DISTRIBUTION TOO, not only to the picks. A cutoff computed
  // including micro-stations is a cutoff pulled by places the signal will never select.
  // ⚠ A NON-FINITE METRIC IS DROPPED AT THE GATE, not carried into the sort. One NaN margin
  // silently changed the SELECTION (comparisons against NaN are all false) while leaving the
  // published cutoff unchanged — a place quietly missing from a list that names places.
  const eligible = population.filter(
    (r) => Number.isFinite(r.marginPct) && r.validVotes >= t.minSample,
  );
  const cutoff = selectionCutoff(
    eligible.map((r) => r.marginPct),
    t,
  );
  if (cutoff === null) return [];
  // ⚠ THE POPULATION CAN BE THE WRONG ONE, and a percentile cannot tell you so. It selects its
  // share by construction, so a cutoff above the recorded basis means these places are not the
  // distribution the threshold was calibrated on — not that this cycle was unusually close.
  // Refusing is the honest answer; publishing names a decisively-won place as a close contest.
  if (t.maxCutoff !== undefined && cutoff > t.maxCutoff) return [];
  const picked = eligible.filter((r) => r.marginPct <= cutoff);
  assertNotUbiquitous("close_contest", picked.length, eligible.length);
  return dropWithoutEvidence(
    picked.map((r) =>
      standout({
        id: `${cycle}:${r.level}:${r.id}:close_contest`,
        signal: "close_contest",
        metric: r.marginPct,
        unit: "pct_point",
        scope: { level: r.level, id: r.id },
        baseline: {
          kind: t.basis,
          // §7: "include the actual comparison group and cycle in the baseline".
          labelParams: {
            cycle,
            level: r.level,
            percentile: t.percentile * 100,
            cutoffPp: Number(cutoff.toFixed(2)),
            places: eligible.length,
          },
        },
        sampleSize: r.validVotes,
        resultStatus: r.resultStatus,
        evidenceTo: r.evidenceTo,
        labelParams: { marginPp: Number(r.marginPct.toFixed(2)) },
      }),
    ),
  );
};

/** Places whose turnout moved unlike the country's, measured as the place's Δ minus the NATIONAL
 *  Δ over the same cycle pair.
 *
 *  ⚠ THE RESIDUAL, NEVER THE RAW CHANGE. Between 2026 and 2024_10 the national turnout change was
 *  12.05 pp, so an 11 pp local swing was the country moving, not the place.
 *
 *  ⚠ ABROAD IS EXCLUDED, and it is not a rounding decision: the two abroad rows are 523.4 pp and
 *  149.5 pp against ≤ 22.0 pp for all 298 domestic rows, so including them does not merely add
 *  two places — it ranks two impossible values above every real finding, and the percentile
 *  cutoff computed with them in is pulled off every genuine one. */
export const selectTurnoutDepartures = (
  population: readonly TurnoutRow[],
  nationalDeltaPp: number,
  cycle: string,
  comparedWith: string,
): ElectionStandout[] => {
  const t = STANDOUT_THRESHOLDS.turnout_departure;
  const eligible = population.filter(
    (r) =>
      r.oblast !== TURNOUT_DEPARTURE_EXCLUDED_OBLAST &&
      Number.isFinite(r.deltaPp) &&
      Number.isFinite(nationalDeltaPp) &&
      // §7: "suppress turnout comparison when turnoutBasis is unavailable".
      !r.turnoutBasisUnavailable &&
      r.registeredVoters >= t.minSample,
  );
  const residual = (r: TurnoutRow) => Math.abs(r.deltaPp - nationalDeltaPp);
  const cutoff = selectionCutoff(eligible.map(residual), t);
  if (cutoff === null) return [];
  const picked = eligible.filter((r) => residual(r) >= cutoff);
  assertNotUbiquitous("turnout_departure", picked.length, eligible.length);
  return dropWithoutEvidence(
    picked.map((r) =>
      standout({
        id: `${cycle}:${r.level}:${r.id}:turnout_departure`,
        signal: "turnout_departure",
        metric: Number(residual(r).toFixed(2)),
        unit: "pct_point",
        scope: { level: r.level, id: r.id },
        baseline: {
          kind: t.basis,
          labelParams: {
            cycle,
            comparedWith,
            nationalDeltaPp: Number(nationalDeltaPp.toFixed(2)),
            percentile: t.percentile * 100,
            cutoffPp: Number(cutoff.toFixed(2)),
            places: eligible.length,
          },
        },
        sampleSize: r.registeredVoters,
        resultStatus: r.resultStatus,
        evidenceTo: r.evidenceTo,
        labelParams: {
          placeDeltaPp: Number(r.deltaPp.toFixed(2)),
          residualPp: Number(residual(r).toFixed(2)),
        },
      }),
    ),
  );
};

/** Councils with at least 9 parties holding seats — the top ~5% of the 2023 distribution
 *  (p50 = 4, p90 = 8, p95 = 9, max = 16).
 *
 *  ⚠ ITS OBVIOUS SIBLING IS BARRED. "No single party holds a majority" is true of 179 of 289
 *  councils (62%) and is not a member of `ElectionStandoutSignal` at all. This selector must
 *  never grow a majority arm; `assertNotUbiquitous` would catch it, but the union is the
 *  first line of defence. */
export const selectFragmentedCouncils = (
  population: readonly CouncilRow[],
  cycle: string,
): ElectionStandout[] => {
  const t = STANDOUT_THRESHOLDS.fragmented_council;
  const eligible = population.filter((r) => r.seatsTotal >= t.minSample);
  const picked = eligible.filter((r) => r.partiesWithSeats >= t.minParties!);
  assertNotUbiquitous("fragmented_council", picked.length, eligible.length);
  return dropWithoutEvidence(
    picked.map((r) =>
      standout({
        id: `${cycle}:${r.level}:${r.id}:fragmented_council`,
        signal: "fragmented_council",
        metric: r.partiesWithSeats,
        unit: "count",
        scope: { level: r.level, id: r.id },
        baseline: {
          kind: t.basis,
          labelParams: {
            cycle,
            minParties: t.minParties,
            councils: eligible.length,
          },
        },
        sampleSize: r.seatsTotal,
        resultStatus: r.resultStatus,
        evidenceTo: r.evidenceTo,
        labelParams: { parties: r.partiesWithSeats },
      }),
    ),
  );
};

// ─── the cap (§7 / §2 decision 11) ──────────────────────────────────────────────────────────

/** §7's own slot order: "1. outcome/change … 2. participation/competition … 3. review". The
 *  cap keeps one per category, so this is the order the three slots are rendered in. */
export const CATEGORY_ORDER: readonly ElectionStandoutCategory[] = [
  "outcome",
  "participation",
  "review",
];

/** ⚠ NOTABILITY IS COMPARED ONLY WITHIN A CATEGORY, NEVER ACROSS ONE.
 *
 *  The first cut compared every candidate by raw `metric`, sorting ascending only when BOTH
 *  signals were "more notable when smaller". That relation is NOT TRANSITIVE — close(1) beats
 *  close(5), close(5) beats turnout(3) by magnitude, and turnout(3) beats close(1) — a strict
 *  cycle, so `Array.prototype.sort` returns a different order depending on the input's order.
 *  Executed over all six permutations of one three-candidate set it kept {A,C} or {B,C}
 *  accordingly: a DIFFERENT municipality's standout published per run, which is exactly what
 *  the id tie-break two lines below exists to prevent.
 *
 *  It was also meaningless on its face: the metrics are in different units — pp of winner
 *  margin against pp of turnout residual against a count of parties — so a `split_control` flag
 *  carrying the metric `1` outranked a 0.2 pp razor-thin race.
 *
 *  Comparing within a category removes both problems, and costs nothing: there are exactly
 *  three categories and the cap is three, so cross-category ranking never decided which
 *  category got a slot — only, wrongly, which member won one. */
const MORE_NOTABLE_WHEN_SMALLER: ReadonlySet<ElectionStandoutSignal> = new Set([
  "close_contest",
]);

/** ⚠ §7's OWN ORDER WITHIN EACH SLOT, and it settles a comparison that has no other answer.
 *  Three signals share `participation`, and only one slot is kept — so the cap always has to
 *  choose between a turnout residual in pp, a margin in pp and a party COUNT. Falling through to
 *  `sampleSize` compared 26,416 votes against 51 seats, which is not a comparison; §7's slot
 *  list gives the priority explicitly: "participation/competition — turnout change …, unusually
 *  close contest, unusually fragmented council". */
const SIGNAL_PRIORITY: readonly ElectionStandoutSignal[] = [
  // slot 1 — outcome/change
  "lead_change",
  "threshold_crossed",
  "split_control",
  "runoff_pending",
  // slot 2 — participation/competition
  "turnout_departure",
  "close_contest",
  "fragmented_council",
  // slot 3 — review
  "concentrated_support",
  "invalid_ballots",
  "additional_voters",
];

const byNotability = (a: ElectionStandout, b: ElectionStandout): number => {
  // Different signals are never ranked by magnitude — their units differ.
  if (a.signal !== b.signal)
    return (
      SIGNAL_PRIORITY.indexOf(a.signal) - SIGNAL_PRIORITY.indexOf(b.signal)
    );
  if (a.metric !== b.metric)
    return MORE_NOTABLE_WHEN_SMALLER.has(a.signal)
      ? a.metric - b.metric
      : b.metric - a.metric;
  if (a.sampleSize !== b.sampleSize) return b.sampleSize - a.sampleSize;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** Candidates in render order: §7's category order, each category's members most notable first.
 *  Deterministic end to end — metric, then sample size, then the stable place id, so two places
 *  with identical metrics cannot swap between runs and fail the byte-identical rebuild gate. */
export const rankStandouts = (
  candidates: readonly ElectionStandout[],
): ElectionStandout[] =>
  CATEGORY_ORDER.flatMap((category) =>
    candidates.filter((c) => c.category === category).sort(byNotability),
  );

/** At most three, at most one per category (§7). The dedupe runs BEFORE the slice — a blind
 *  `.slice(0, 3)` satisfies the count cap and not the per-category one, so a place with three
 *  close contests would spend the whole strip on one signal.
 *
 *  ⚠ EVIDENCE IS DROPPED FIRST, and the order is load-bearing. Capping before dropping spends a
 *  slot on a candidate that is then removed, so the strip renders fewer standouts than the
 *  corpus supports — measured, cap-then-drop yielded 0 where drop-then-cap yields 1. */
export const capStandouts = (
  candidates: readonly ElectionStandout[],
): ElectionStandout[] => {
  const seen = new Set<ElectionStandoutCategory>();
  const kept: ElectionStandout[] = [];
  for (const s of rankStandouts(dropWithoutEvidence(candidates))) {
    if (seen.has(s.category)) continue;
    seen.add(s.category);
    kept.push(s);
    if (kept.length === MAX_SURFACE_STANDOUTS) break;
  }
  return kept;
};

/** §7: "a section-derived signal needs ≥ 5 sections at the place" — a floor on ANY
 *  section-derived signal rather than one signal's own threshold. Below it, "this section
 *  differs from the rest" compares against fewer than four others. */
export const sectionCohortIsLargeEnough = (sectionsAtPlace: number): boolean =>
  sectionsAtPlace >= SECTION_SIGNAL_MIN_SECTIONS;
