// The selectors, against fixtures AND against the corpus that set the thresholds.
//
// ⚠ THE CENTRAL ASSERTION IS THAT A CUTOFF IS PER-CYCLE. §7's whole finding is that the
// municipality margin distribution moves by an order of magnitude between cycles, so the same
// code on two cycles must yield two cutoffs. A test that fixes one cycle's numbers as expected
// values cannot see a selector that hard-coded 5 pp — it would agree with it on the cycle the
// fixtures came from. So the per-cycle test feeds two REAL distributions and asserts the
// cutoffs differ, and by roughly the measured factor.
//
// ⚠ AND THAT A SIGNAL IS NOT TRUE OF MOST PLACES. The barred sibling — "no single party holds a
// majority", true of 62% of councils — is what `assertNotUbiquitous` exists for, so the gate
// constructs exactly that population and requires a throw.

import { describe, expect, it } from "vitest";
import {
  CATEGORY_ORDER,
  SIGNAL_CATEGORY,
  assertNotUbiquitous,
  selectionCutoff,
  capStandouts,
  dropWithoutEvidence,
  percentile,
  rankStandouts,
  sectionCohortIsLargeEnough,
  selectCloseContests,
  selectFragmentedCouncils,
  selectTurnoutDepartures,
  type CouncilRow,
  type MarginRow,
  type TurnoutRow,
} from "./standouts";
import {
  SECTION_SIGNAL_MIN_SECTIONS,
  STANDOUT_THRESHOLDS,
  TURNOUT_DEPARTURE_EXCLUDED_OBLAST,
  UBIQUITY_CEILING,
  UBIQUITY_MIN_POPULATION,
} from "../../src/data/elections/standoutThresholds";
import {
  MAX_SURFACE_STANDOUTS,
  type ElectionStandout,
  type ElectionStandoutSignal,
} from "../../src/data/elections/surfaceTypes";

const margin = (
  id: string,
  marginPct: number,
  validVotes = 5_000,
): MarginRow => ({
  id,
  level: "municipality",
  marginPct,
  validVotes,
  resultStatus: "final",
  evidenceTo: `/x/${id}`,
});

describe("percentile — the distributional core", () => {
  it("names a real observation, never an interpolated value", () => {
    // ⚠ NEAREST-RANK. An interpolated cutoff is a value no place has, so "the bottom 5%" would
    // select 4.6% or 5.4% of a small population depending on where the fractional rank lands —
    // and at oblast level the population is 28.
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p = percentile(sample, 0.05)!;
    expect(sample).toContain(p);
    expect(p).toBe(1);
    expect(percentile(sample, 0.5)).toBe(5);
    expect(percentile(sample, 0.95)).toBe(10);
  });

  it("selects about the requested share at the lower tail", () => {
    const sample = Array.from({ length: 200 }, (_, i) => i + 1);
    const cutoff = percentile(sample, 0.05)!;
    const selected = sample.filter((v) => v <= cutoff).length;
    expect(selected / sample.length).toBeCloseTo(0.05, 2);
  });

  it("returns null on an empty sample rather than 0", () => {
    // 0 would select every place at a lower tail and none at an upper one.
    expect(percentile([], 0.05)).toBeNull();
  });

  it("refuses a p outside (0,1)", () => {
    expect(() => percentile([1, 2], 0)).toThrow();
    expect(() => percentile([1, 2], 1)).toThrow();
  });

  it("does not mutate its input", () => {
    const sample = [5, 1, 3];
    percentile(sample, 0.5);
    expect(sample).toEqual([5, 1, 3]);
  });

  it("selects the SAME share at both tails", () => {
    // ⚠ THE ASYMMETRY THAT SHIPPED. `percentile(sample, 0.95)` with `>= cutoff` selects
    // `n - ceil(0.95n) + 1`, which is one too many whenever the product is an integer:
    // n=100 → 6 not 5, n=200 → 11 not 10, n=300 → 16 not 15, i.e. 5.33% published as 5%.
    // It agrees at n=289 and n=298 — two of the real populations — so the corpus hides it.
    for (const n of [28, 100, 200, 289, 298, 300]) {
      const sample = Array.from({ length: n }, (_, i) => i + 1);
      const lower = selectionCutoff(sample, {
        percentile: 0.05,
        tail: "lower",
      })!;
      const upper = selectionCutoff(sample, {
        percentile: 0.95,
        tail: "upper",
      })!;
      const lowCount = sample.filter((v) => v <= lower).length;
      const highCount = sample.filter((v) => v >= upper).length;
      expect(highCount, `n=${n}: ${lowCount} low vs ${highCount} high`).toBe(
        lowCount,
      );
      expect(lowCount).toBe(Math.max(1, Math.ceil(0.05 * n)));
    }
  });

  it("always names a real observation at either tail", () => {
    const sample = [3, 1, 4, 1, 5, 9, 2, 6];
    for (const t of ["lower", "upper"] as const) {
      const c = selectionCutoff(sample, {
        percentile: t === "lower" ? 0.05 : 0.95,
        tail: t,
      })!;
      expect(sample).toContain(c);
    }
  });

  it("returns null on an empty sample, at either tail", () => {
    expect(selectionCutoff([], { percentile: 0.05, tail: "lower" })).toBeNull();
    expect(selectionCutoff([], { percentile: 0.95, tail: "upper" })).toBeNull();
  });

  it("refuses a threshold with no tail", () => {
    expect(() => selectionCutoff([1, 2], { percentile: 0.05 })).toThrow();
  });
});

describe("close contest — the cutoff is the CYCLE's, not a constant", () => {
  // The two extremes §7 measured: p5 was 0.47 pp in 2021_07_11 and 4.88 pp in 2026_04_19.
  // Distributions shaped to reproduce that spread.
  const tight = Array.from({ length: 300 }, (_, i) =>
    margin(`t${i}`, 0.2 + i * 0.05),
  );
  const loose = Array.from({ length: 300 }, (_, i) =>
    margin(`l${i}`, 3.0 + i * 0.35),
  );

  it("yields two different cutoffs for two different cycles", () => {
    // ⚠ THE ASSERTION A HARD-CODED 5 pp WOULD FAIL. It would select ~all of `tight` and a
    // handful of `loose`, rather than ~5% of each.
    const a = selectCloseContests(tight, "2021_07_11");
    const b = selectCloseContests(loose, "2026_04_19");
    const cutoffA = a[0].baseline.labelParams.cutoffPp as number;
    const cutoffB = b[0].baseline.labelParams.cutoffPp as number;
    expect(cutoffA).toBeLessThan(cutoffB);
    expect(cutoffB / cutoffA).toBeGreaterThan(3);
  });

  it("selects about 5% of each population, whatever its scale", () => {
    for (const [name, pop] of [
      ["tight", tight],
      ["loose", loose],
    ] as const) {
      const share = selectCloseContests(pop, "C").length / pop.length;
      expect(share, name).toBeGreaterThan(0.03);
      expect(share, name).toBeLessThan(0.09);
    }
  });

  it("takes the LOWEST margins, not the highest", () => {
    // Inverting the tail reports the least close contests as the closest ones.
    const picked = selectCloseContests(tight, "C");
    const worst = Math.max(...picked.map((s) => s.metric));
    const unpickedMin = Math.min(
      ...tight
        .filter((r) => !picked.some((s) => s.scope.id === r.id))
        .map((r) => r.marginPct),
    );
    expect(worst).toBeLessThanOrEqual(unpickedMin);
  });

  it("excludes micro-places from the CUTOFF, not merely from the picks", () => {
    // A cutoff computed including places the signal can never select is a cutoff pulled by them.
    const t = STANDOUT_THRESHOLDS.close_contest;
    const withMicro = [
      ...tight,
      ...Array.from({ length: 60 }, (_, i) =>
        margin(`micro${i}`, 0.01, t.minSample - 1),
      ),
    ];
    const a = selectCloseContests(tight, "C")[0].baseline.labelParams.cutoffPp;
    const b = selectCloseContests(withMicro, "C")[0].baseline.labelParams
      .cutoffPp;
    expect(b).toBe(a);
    expect(
      selectCloseContests(withMicro, "C").some((s) =>
        s.scope.id.startsWith("micro"),
      ),
    ).toBe(false);
  });

  it("names the comparison group and cycle in the baseline (§7)", () => {
    const s = selectCloseContests(tight, "2026_04_19")[0];
    expect(s.baseline.kind).toBe("cycle_percentile");
    expect(s.baseline.labelParams.cycle).toBe("2026_04_19");
    expect(s.baseline.labelParams.level).toBe("municipality");
    expect(s.baseline.labelParams.places).toBe(tight.length);
    expect(s.baseline.labelParams.percentile).toBe(5);
  });

  it("returns nothing for an empty population rather than throwing", () => {
    expect(selectCloseContests([], "C")).toEqual([]);
  });

  it("emits nothing for a place with no evidence route (§5)", () => {
    // ⚠ ENFORCED AT EMIT, not left to a caller. A standout is a claim about a named place; one
    // with nowhere to check it is the shape §7 exists to prevent.
    const pop = tight.map((r, i) => (i === 0 ? { ...r, evidenceTo: "" } : r));
    const picked = selectCloseContests(pop, "C");
    expect(picked.every((s) => s.evidenceTo.length > 0)).toBe(true);
    expect(picked.some((s) => s.scope.id === pop[0].id)).toBe(false);
  });

  it("drops a non-finite metric instead of silently losing places to it", () => {
    // One NaN comparison is false against everything, so it took the selection from 9 places to
    // 5 while leaving the published cutoff unchanged — places quietly missing from a list of
    // places.
    const clean = selectCloseContests(tight, "C").length;
    const withNaN = selectCloseContests(
      [...tight, margin("nan", Number.NaN)],
      "C",
    );
    expect(withNaN.length).toBe(clean);
    expect(withNaN.some((s) => s.scope.id === "nan")).toBe(false);
  });
});

describe("turnout departure — the residual, and abroad", () => {
  const row = (
    id: string,
    deltaPp: number,
    oblast = "PAZ",
    registeredVoters = 10_000,
  ): TurnoutRow => ({
    id,
    level: "municipality",
    oblast,
    deltaPp,
    registeredVoters,
    turnoutBasisUnavailable: false,
    resultStatus: "final",
    evidenceTo: `/x/${id}`,
  });

  const domestic = Array.from({ length: 298 }, (_, i) =>
    row(`d${i}`, 12.05 + (i % 23) - 11),
  );

  it("measures against the NATIONAL change, not the raw one", () => {
    // ⚠ Between 2026 and 2024_10 the national change was 12.05 pp, so an 11 pp local swing was
    // the country moving. A raw-change selector calls it a departure; the residual does not.
    const pop = [...domestic, row("moved-with-country", 11)];
    const picked = selectTurnoutDepartures(pop, 12.05, "C", "P");
    expect(picked.some((s) => s.scope.id === "moved-with-country")).toBe(false);
    // …while a place that moved the other way IS one, at the same absolute change.
    const pop2 = [...domestic, row("against-country", -11)];
    const picked2 = selectTurnoutDepartures(pop2, 12.05, "C", "P");
    expect(picked2.some((s) => s.scope.id === "against-country")).toBe(true);
  });

  it("excludes abroad, which is the whole contaminated tail", () => {
    // The two abroad rows measured 523.4 pp and 149.5 pp against ≤ 22.0 pp for every domestic
    // row: including them does not add two places, it ranks two impossible values above every
    // real finding and drags the cutoff off all of them.
    const withAbroad = [
      ...domestic,
      row("NA", 523.4, TURNOUT_DEPARTURE_EXCLUDED_OBLAST),
      row("EU", 149.5, TURNOUT_DEPARTURE_EXCLUDED_OBLAST),
    ];
    const a = selectTurnoutDepartures(domestic, 12.05, "C", "P");
    const b = selectTurnoutDepartures(withAbroad, 12.05, "C", "P");
    expect(b.some((s) => s.scope.id === "NA" || s.scope.id === "EU")).toBe(
      false,
    );
    expect(b[0].baseline.labelParams.cutoffPp).toBe(
      a[0].baseline.labelParams.cutoffPp,
    );
  });

  it("suppresses a place whose turnout basis is unavailable (§7)", () => {
    const pop = [
      ...domestic,
      { ...row("no-denominator", 90), turnoutBasisUnavailable: true },
    ];
    const picked = selectTurnoutDepartures(pop, 12.05, "C", "P");
    expect(picked.some((s) => s.scope.id === "no-denominator")).toBe(false);
  });

  it("takes the LARGEST residuals — the opposite tail from close contest", () => {
    const picked = selectTurnoutDepartures(domestic, 12.05, "C", "P");
    const smallest = Math.min(...picked.map((s) => s.metric));
    const unpickedMax = Math.max(
      ...domestic
        .filter((r) => !picked.some((s) => s.scope.id === r.id))
        .map((r) => Math.abs(r.deltaPp - 12.05)),
    );
    expect(smallest).toBeGreaterThanOrEqual(unpickedMax);
  });

  it("names both cycles of the comparison", () => {
    const s = selectTurnoutDepartures(
      domestic,
      12.05,
      "2026_04_19",
      "2024_10_27",
    )[0];
    expect(s.baseline.kind).toBe("national_delta");
    expect(s.baseline.labelParams.cycle).toBe("2026_04_19");
    expect(s.baseline.labelParams.comparedWith).toBe("2024_10_27");
    expect(s.baseline.labelParams.nationalDeltaPp).toBe(12.05);
  });

  it("applies the registered-voter floor", () => {
    const t = STANDOUT_THRESHOLDS.turnout_departure;
    const pop = [...domestic, row("tiny", 200, "PAZ", t.minSample - 1)];
    expect(
      selectTurnoutDepartures(pop, 12.05, "C", "P").some(
        (s) => s.scope.id === "tiny",
      ),
    ).toBe(false);
  });
});

describe("fragmented council — and the sibling that is barred", () => {
  const council = (id: string, parties: number, seats = 21): CouncilRow => ({
    id,
    level: "municipality",
    partiesWithSeats: parties,
    seatsTotal: seats,
    resultStatus: "final",
    evidenceTo: `/x/${id}`,
  });

  // The 2023 shape: p50 = 4, p90 = 8, p95 = 9, max = 16 over 289 councils.
  const councils = Array.from({ length: 289 }, (_, i) =>
    council(`c${i}`, i < 260 ? 3 + (i % 5) : 9 + (i % 8)),
  );

  it("fires on roughly the top 5%, matching the measured distribution", () => {
    const picked = selectFragmentedCouncils(councils, "2023_10_29_mi");
    expect(picked.length / councils.length).toBeLessThan(0.15);
    expect(picked.length).toBeGreaterThan(0);
    for (const s of picked)
      expect(s.metric).toBeGreaterThanOrEqual(
        STANDOUT_THRESHOLDS.fragmented_council.minParties,
      );
  });

  it("REFUSES a signal true of most places (§7)", () => {
    // ⚠ THE BARRED SIBLING, CONSTRUCTED. "No single party holds a majority" is true of 179 of
    // 289 councils (62%). It is not a member of the signal union at all — this proves the
    // second line of defence would also stop it.
    expect(() => assertNotUbiquitous("fragmented_council", 179, 289)).toThrow(
      /description, not a finding/,
    );
    // …and a real over-broad population throws through the selector itself.
    const allFragmented = Array.from({ length: 289 }, (_, i) =>
      council(`f${i}`, 12),
    );
    expect(() => selectFragmentedCouncils(allFragmented, "C")).toThrow(
      /fires on 289\/289/,
    );
  });

  it("passes a signal that is genuinely rare", () => {
    // Split control: 32 of 245 (13.1%). The ceiling must not bar it.
    expect(() => assertNotUbiquitous("split_control", 32, 245)).not.toThrow();
  });

  it("does not fire on a population too small for a share to mean anything", () => {
    // ⚠ NEAREST-RANK ALWAYS SELECTS AT LEAST ONE PLACE, so n=1 is 100% and n=2 is 50% — both
    // over the ceiling and neither a finding. Enforcing it there aborts the entire generator
    // because an oblast happens to hold two municipalities.
    expect(() => assertNotUbiquitous("close_contest", 1, 1)).not.toThrow();
    expect(() => assertNotUbiquitous("close_contest", 1, 2)).not.toThrow();
    expect(() =>
      assertNotUbiquitous("close_contest", 1, UBIQUITY_MIN_POPULATION - 1),
    ).not.toThrow();
    // …and the guard is live again the moment the population can answer the question.
    expect(() =>
      assertNotUbiquitous(
        "close_contest",
        UBIQUITY_MIN_POPULATION,
        UBIQUITY_MIN_POPULATION,
      ),
    ).toThrow();
  });

  it("reads its ceiling from the frozen module, not a literal", () => {
    // §7 requires every numeric cutoff to be settled in Phase 0 and reviewable.
    expect(UBIQUITY_CEILING).toBeGreaterThan(0.131); // split control must survive
    expect(UBIQUITY_CEILING).toBeLessThan(0.62); // the council-majority signal must not
  });

  it("is silent on an empty population rather than throwing", () => {
    expect(() => assertNotUbiquitous("close_contest", 0, 0)).not.toThrow();
    expect(selectFragmentedCouncils([], "C")).toEqual([]);
  });
});

describe("the cap and the ordering", () => {
  const s = (
    signal: ElectionStandoutSignal,
    metric: number,
    sampleSize = 100,
    id = `${signal}-${metric}`,
  ): ElectionStandout => ({
    id,
    category: SIGNAL_CATEGORY[signal],
    signal,
    metric,
    unit: "pct_point",
    scope: { level: "municipality", id: "X" },
    baseline: { kind: "cycle_percentile", labelParams: {} },
    sampleSize,
    resultStatus: "final",
    evidenceTo: "/x",
    labelParams: {},
  });

  it("keeps at most three, at most one per category", () => {
    const many = [
      s("close_contest", 0.1),
      s("split_control", 1),
      s("lead_change", 1),
      s("turnout_departure", 20),
      s("fragmented_council", 12),
      s("invalid_ballots", 30),
      s("concentrated_support", 90),
    ];
    const kept = capStandouts(many);
    expect(kept.length).toBeLessThanOrEqual(MAX_SURFACE_STANDOUTS);
    expect(new Set(kept.map((k) => k.category)).size).toBe(kept.length);
  });

  it("dedupes by category BEFORE slicing", () => {
    // A blind `.slice(0, 3)` satisfies the count cap and not the per-category one, so a place
    // with three close contests spends the whole strip on one signal.
    // ⚠ ALL FOUR ARE `outcome` — §7 slot 1. `close_contest` is NOT among them: it is slot 2,
    // "participation/competition — … unusually close contest", which is where §7 puts it.
    const sameCategory = [
      s("lead_change", 1, 100, "a"),
      s("split_control", 1, 100, "b"),
      s("runoff_pending", 1, 100, "c"),
      s("threshold_crossed", 1, 100, "d"),
    ];
    expect(capStandouts(sameCategory)).toHaveLength(1);
  });

  it("ranks a close contest by the SMALLEST margin", () => {
    // Ranking it descending puts the least close contests at the top of the outcome slot.
    const ranked = rankStandouts([
      s("close_contest", 4.8, 100, "wide"),
      s("close_contest", 0.2, 100, "tight"),
    ]);
    expect(ranked[0].id).toBe("tight");
  });

  it("breaks ties deterministically: sample size, then id", () => {
    // Without the last, two identical metrics swap between runs and the byte-identical rebuild
    // gate fails on noise.
    const a = rankStandouts([
      s("turnout_departure", 5, 100, "zzz"),
      s("turnout_departure", 5, 900, "aaa"),
    ]);
    expect(a.map((x) => x.id)).toEqual(["aaa", "zzz"]);
    const b = rankStandouts([
      s("turnout_departure", 5, 100, "zzz"),
      s("turnout_departure", 5, 100, "aaa"),
    ]);
    expect(b.map((x) => x.id)).toEqual(["aaa", "zzz"]);
    // …and it is stable: the same input always gives the same output.
    expect(rankStandouts(b).map((x) => x.id)).toEqual(["aaa", "zzz"]);
  });

  it("does not mutate its input", () => {
    const input = [
      s("close_contest", 4.8, 100, "b"),
      s("lead_change", 1, 100, "a"),
    ];
    const before = input.map((x) => x.id);
    rankStandouts(input);
    capStandouts(input);
    expect(input.map((x) => x.id)).toEqual(before);
  });

  it("puts each signal in §7's own slot, not an intuitive one", () => {
    // ⚠ TRANSCRIBED FROM THE PLAN, so the mapping cannot drift from the document that sets it.
    // §7: "1. outcome/change — winner margin, lead change, threshold/majority, split control,
    // runoff; 2. participation/competition — turnout change …, unusually close contest,
    // unusually fragmented council; 3. review — …".
    expect(SIGNAL_CATEGORY.close_contest).toBe("participation");
    expect(SIGNAL_CATEGORY.turnout_departure).toBe("participation");
    expect(SIGNAL_CATEGORY.fragmented_council).toBe("participation");
    expect(SIGNAL_CATEGORY.lead_change).toBe("outcome");
    expect(SIGNAL_CATEGORY.threshold_crossed).toBe("outcome");
    expect(SIGNAL_CATEGORY.split_control).toBe("outcome");
    expect(SIGNAL_CATEGORY.runoff_pending).toBe("outcome");
    expect(SIGNAL_CATEGORY.concentrated_support).toBe("review");
    expect(SIGNAL_CATEGORY.invalid_ballots).toBe("review");
    expect(SIGNAL_CATEGORY.additional_voters).toBe("review");
  });

  it("renders the categories in §7's slot order", () => {
    expect([...CATEGORY_ORDER]).toEqual(["outcome", "participation", "review"]);
    const ranked = rankStandouts([
      s("invalid_ballots", 30, 100, "rev"),
      s("close_contest", 0.2, 100, "part"),
      s("split_control", 1, 100, "out"),
    ]);
    expect(ranked.map((x) => x.id)).toEqual(["out", "part", "rev"]);
  });

  it("orders identically whatever order the candidates arrive in", () => {
    // ⚠ THE NON-TRANSITIVITY TEST. The first comparator sorted ascending only when BOTH signals
    // were "more notable when smaller", which makes close(1) < close(5) < turnout(3) < close(1)
    // — a strict cycle, so `sort` returned a different winner depending on input order and a
    // DIFFERENT municipality's standout got published per run.
    const set = [
      s("close_contest", 1, 100, "close-tight"),
      s("close_contest", 5, 100, "close-wide"),
      s("turnout_departure", 3, 100, "turnout"),
    ];
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const results = perms.map((p) =>
      capStandouts(p.map((i) => set[i]))
        .map((x) => x.id)
        .join(","),
    );
    expect(
      new Set(results).size,
      `orders differ: ${[...new Set(results)]}`,
    ).toBe(1);
  });

  it("assigns every signal a category, exhaustively", () => {
    // The cap is meaningless if a signal has no category. Exhaustiveness is a compile-time
    // property of the `satisfies`; this asserts the categories are the three §7 names.
    const cats = new Set(Object.values(SIGNAL_CATEGORY));
    expect([...cats].sort()).toEqual(["outcome", "participation", "review"]);
  });
});

describe("the suppression rules", () => {
  it("drops a standout with no evidence destination (§5, §7)", () => {
    const base: ElectionStandout = {
      id: "x",
      category: "outcome",
      signal: "close_contest",
      metric: 1,
      unit: "pct_point",
      scope: { level: "municipality", id: "X" },
      baseline: { kind: "cycle_percentile", labelParams: {} },
      sampleSize: 100,
      resultStatus: "final",
      evidenceTo: "/x",
      labelParams: {},
    };
    expect(dropWithoutEvidence([base])).toHaveLength(1);
    expect(dropWithoutEvidence([{ ...base, evidenceTo: "" }])).toHaveLength(0);
  });

  it("floors a section-derived signal at five sections (§7)", () => {
    expect(sectionCohortIsLargeEnough(SECTION_SIGNAL_MIN_SECTIONS)).toBe(true);
    expect(sectionCohortIsLargeEnough(SECTION_SIGNAL_MIN_SECTIONS - 1)).toBe(
      false,
    );
  });

  it("emits no prose — only codes and params", () => {
    // §7: the words a reader sees come from i18n. A generator emitting a sentence bakes one
    // language into a file both languages read.
    const picked = selectCloseContests(
      Array.from({ length: 100 }, (_, i) => margin(`m${i}`, i * 0.1 + 0.1)),
      "C",
    );
    for (const s of picked) {
      const blob = JSON.stringify(s);
      // Cyrillic anywhere in a standout means generated prose.
      expect(blob, `${s.id} carries prose`).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it("names no signal that asserts a cause (§7)", () => {
    // "stands out", "differs from", "flagged for review" — never "fraud" or "manipulation".
    for (const signal of Object.keys(SIGNAL_CATEGORY))
      expect(signal).not.toMatch(/fraud|manipul|rigged|stolen|cheat/i);
  });
});
