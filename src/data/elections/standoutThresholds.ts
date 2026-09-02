// The standout thresholds, frozen (docs/plans/elections-hub-implementation-v1.md §7).
//
// ⚠ THE PUBLISHED METHODOLOGY IS `docs/methodology/election-surfaces.md` §5, AND IT IS THE
// GATE. Every value here is transcribed from it, never re-derived, and every threshold carries
// §7's four fields — value, basis, minimum sample, and what it excludes — because a bare number
// is not reviewable. A change to either side requires a change to the other IN THE SAME COMMIT;
// `standoutThresholds.test.ts` fails when they drift.
//
// This module is shared rather than living in the generator, for two reasons: the source panel
// renders these values to the reader (a reader cannot judge "stands out" without them), and
// `scripts/elections/standouts.ts` selects with them. One definition, two consumers.
//
// ⚠⚠ TWO OF THE FOUR ARE NOT NUMBERS, AND THAT IS THE FINDING RATHER THAN A HEDGE.
// Measured 2026-09-02: the municipality margin distribution moves by an ORDER OF MAGNITUDE
// between cycles (5th percentile 0.47 pp in 2021_07_11, 4.88 pp in 2026_04_19), so a fixed
// 5 pp selects 5.3% of municipalities in one cycle and 24.3% in another. One word would mean
// two different things depending on the year. Both of those thresholds are therefore
// percentiles OF THE CYCLE BEING BUILT, and a selector that hard-codes a pp value has
// reintroduced the defect this shape exists to prevent.
//
// ⚠ KEYED BY SIGNAL, not by loose constants. `ElectionStandoutSignal`'s own header promises
// "a new signal cannot appear without copy and a threshold (§7)" — this is the threshold half,
// and it is only enforceable if every member of the union is accounted for. A signal with no
// numeric cutoff goes in `SIGNALS_WITHOUT_OWN_THRESHOLD` WITH ITS REASON, so the gate can prove
// the union is covered rather than trusting a naming convention.

import type {
  ElectionBaselineKind,
  ElectionStandoutSignal,
} from "./surfaceTypes";

/** The basis label keys, written out — never built (§5.2). `Record<Union, …>` so a missing
 *  member is a compile error and `electionCopyCoverage.test.ts` can enumerate them: these four
 *  are in none of the unions that gate schedules, so without an export here they would be
 *  invisible to it and render as their own raw identifiers at a 200. */
export const BASIS_LABEL_KEYS = {
  cycle_percentile: "election_basis_cycle_percentile",
  national_delta: "election_basis_national_delta",
  council_distribution: "election_basis_council_distribution",
  section_cohort: "election_basis_section_cohort",
} as const satisfies Record<ElectionBaselineKind, string>;

export type ThresholdBasisKey = (typeof BASIS_LABEL_KEYS)[ElectionBaselineKind];

/** Every i18n key this module can name, for `electionCopyCoverage.test.ts`. */
export const thresholdCopyKeys = (): string[] =>
  Object.values(BASIS_LABEL_KEYS);

/** Which tail of the distribution a percentile selects. Explicit because the two differ and
 *  the direction is otherwise implied only by the number: `close_contest` takes the LOWEST
 *  margins (bottom 5%) and `turnout_departure` the LARGEST residuals (top 5%, i.e. p95). A
 *  selector that reads one as the other inverts the finding — it would report the places
 *  whose turnout moved LEAST as departures. */
export type ThresholdTail = "lower" | "upper";

export type StandoutThreshold = {
  /** The cutoff, as a fraction in (0,1) for a percentile rule or a count for a fixed one. */
  percentile?: number;
  tail?: ThresholdTail;
  /** A fixed count, where the rule is not distributional. */
  minParties?: number;
  /** §7's "minimum sample": below this the signal is suppressed rather than emitted at low
   *  confidence. The unit differs per signal and is named in `sampleUnit`. */
  minSample: number;
  sampleUnit: "valid_votes" | "registered_voters" | "seats" | "sections";
  basis: ElectionBaselineKind;
  /** §7's "basis" field — the measurement that justified this value, rendered by the source
   *  panel. Prose lives in i18n; this is the evidence. */
  measured: string;
  /** §7's "what it excludes" — the cases this value deliberately drops, so a later widening is
   *  a decision and not a bug fix. */
  excludes: string;
};

export const STANDOUT_THRESHOLDS = {
  close_contest: {
    percentile: 0.05,
    tail: "lower",
    minSample: 200,
    sampleUnit: "valid_votes",
    basis: "cycle_percentile",
    measured:
      "per-cycle p5 over eight cycles: 0.47 · 0.66 · 0.66 · 0.95 · 1.02 · 1.12 · 2.50 · 4.88 pp",
    excludes:
      "it always selects ~5%, so it can never report that nothing was close this cycle",
  },
  turnout_departure: {
    percentile: 0.95,
    tail: "upper",
    minSample: 500,
    sampleUnit: "registered_voters",
    basis: "national_delta",
    measured:
      "residual p95 over four consecutive pairs: 4.89 → 12.81 pp; national Δ 2026↔2024_10 was 12.05 pp",
    excludes:
      "abroad entirely, and any cycle where the whole country moved together",
  },
  fragmented_council: {
    minParties: 9,
    minSample: 5,
    sampleUnit: "seats",
    basis: "council_distribution",
    measured: "289 councils, 2023: p50 = 4 parties, p90 = 8, p95 = 9, max = 16",
    excludes: "councils whose fragmentation is ordinary for the cycle",
  },
} as const satisfies Partial<Record<ElectionStandoutSignal, StandoutThreshold>>;

/** ⚠ EVERY OTHER MEMBER OF THE UNION, WITH ITS REASON. The gate asserts this set plus
 *  `STANDOUT_THRESHOLDS` covers `ElectionStandoutSignal` exactly, so an eleventh signal cannot
 *  ship without someone deciding which bucket it belongs in. */
export const SIGNALS_WITHOUT_OWN_THRESHOLD = {
  lead_change: "categorical — a change of winner needs no cutoff",
  threshold_crossed: "categorical — the statutory 4% line is the cutoff",
  split_control:
    "categorical — mayor's party ≠ council lead. Kept because it is rare: 32 of the 245 municipalities whose mayor carries a canonical party id (13.1%). Counting every elected mayor instead gives 58 of 289 (20.1%); the first is the honest denominator for a claim about PARTY control. Unlike the majority signal barred below",
  runoff_pending:
    "categorical — a scheduled second round is a fact, not a metric",
  concentrated_support: "inherited from the producer (§5.5)",
  invalid_ballots: "inherited from the producer (§5.5)",
  additional_voters: "inherited from the producer (§5.5)",
} as const satisfies Partial<Record<ElectionStandoutSignal, string>>;

/** ⚠ THE SHARE ABOVE WHICH A SIGNAL STOPS BEING A FINDING. Frozen here rather than living as a
 *  literal in the selector, because §7 requires every numeric cutoff to be settled in Phase 0
 *  and reviewable — and this one decides whether a signal may be published at all.
 *
 *  1/3 brackets the two measured cases with room on both sides: split control fires on 13.1%
 *  of municipalities and is KEPT; "no single party holds a majority" fires on 62% of councils
 *  and is BARRED. Anything between 33% and 62% is a judgement nobody has had to make yet.
 *
 *  ⚠ IT IS UNDEFINED ON A TINY POPULATION, hence the floor below. A nearest-rank percentile
 *  always selects at least one place, so at n = 1 the share is 100% and at n = 2 it is 50% —
 *  both above the ceiling, both meaningless. Enforcing it there would abort the generator on a
 *  data property (an oblast with two municipalities) rather than on a defect. */
export const UBIQUITY_CEILING = 1 / 3;

/** Below this many places, "what share of places does this fire on" is not a question the
 *  corpus can answer. 20 is under the smallest real population the selectors run over — 28
 *  oblasts — so no genuine level is exempted by it. */
export const UBIQUITY_MIN_POPULATION = 20;

/** A place needs this many polling sections before "this section differs from the rest" has a
 *  "rest" to compare against. Not keyed by signal because it is a FLOOR on any section-derived
 *  signal rather than a signal of its own. */
export const SECTION_SIGNAL_MIN_SECTIONS = 5;

export const SECTION_SIGNAL_BASIS: ElectionBaselineKind = "section_cohort";

export const SECTION_SIGNAL_MEASURED =
  "315 of 353 places (89.2%) clear it, carrying 99.5% of all sections";

/** ⚠ ABROAD IS EXCLUDED FROM THE TURNOUT COMPARISON, and that is §2 decision 10 applied rather
 *  than a new rule — abroad has no valid registered-voter denominator. It is ALSO the entire
 *  contaminated tail: the two abroad rows are 523.4 pp and 149.5 pp, while all 298 domestic
 *  rows are ≤ 22.0 pp. A selector that forgets this does not merely include a place it should
 *  not; it ranks two impossible values above every real finding. */
export const TURNOUT_DEPARTURE_EXCLUDED_OBLAST = "32";

/** ⚠ THE SIBLING SIGNAL THAT IS BARRED, named so it cannot be added back by someone who has
 *  not read the measurement. "No single party holds a majority" describes 179 of 289 councils
 *  (62%) — the ABSENCE of a majority is the ordinary case, and a signal firing on most places
 *  is a description, not a finding.
 *
 *  ⚠ THIS CONSTANT IS NOT ENFORCEMENT. That the signal is never EMITTED is `standouts.ts`'s
 *  gate in Phase 1; this only makes the bar impossible to miss when reading the module — which
 *  is why it is deliberately absent from `ElectionStandoutSignal` as well. */
export const COUNCIL_MAJORITY_IS_NOT_A_SIGNAL = true;

// ─── review signals — inherited, never chosen ───────────────────────────────────────────

/** ⚠ THE VALUES ARE NOT DECLARED HERE, ON PURPOSE. `concentratedPct`, `invalidBallotsPct`,
 *  `additionalVotersPct` and `additionalVotersMinActual` already exist and are already
 *  published in each cycle's own artifact; Benford's `minVotes1BL`/`minVotes2BL` live in
 *  `scripts/reports/benford.ts` and are written to its own report.
 *
 *  The generator READS them from the producer at generation time. A copy here would be a second
 *  definition of a flag the reports already publish, and the two would drift silently since
 *  nothing compares a constant against a JSON file nobody re-reads.
 *
 *  ⚠ TWO PRODUCERS, NOT ONE. A generator following only the first would find four of the five
 *  inherited thresholds — Benford's pair is written to `reports/`, not to `dashboard/`. */
export const REVIEW_THRESHOLD_SOURCES = {
  settlements: "data/<cycle>/dashboard/suspicious_settlements.json#thresholds",
  benford: "data/<cycle>/reports/benford.json#thresholds",
} as const;

export const REVIEW_THRESHOLDS_ARE_READ_FROM_THE_PRODUCER = true;
