// The ЗДБРБ → КФП plan mapping against the REAL corpus.
//
// The mapping's one non-obvious step is that the feed's `expenditure` is the
// law's II + III (the feed's section is „II. Разходи И ТРАНСФЕРИ"). A wrong
// split there misses by the whole transfer envelope — €16.9bn in 2026 — and
// would still produce a plausible-looking plan. The corpus settles it: for the
// years where the feed publishes its OWN „Закон" column, the law-derived plan
// must equal it to the euro.
//
// Needs no database: both `data/budget/kfp.json` and
// `data/budget/derived/law_framework.json` are committed.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { kfpPlanFromLaw, type LawFrameworkYearLike } from "./lawPlan";
import type { KfpObservationLike } from "./fy2026Frame";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const FRAMEWORK: Record<string, LawFrameworkYearLike> = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "data/budget/derived/law_framework.json"),
    "utf8",
  ),
);

const OBSERVATIONS: KfpObservationLike[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/budget/kfp.json"), "utf8"),
).observations;

/** The feed's own „Закон" figure for a year and series, as it stood at the
 *  year's LAST reported month.
 *
 *  ⚠️ Not the first — the column moves within a year. Measured here: 2025's
 *  earliest planned expenditure is 0 (the ЗДБРБ-2025 had not passed) against
 *  €30.82bn at year end, and 2021/2022 restate it mid-year on актуализация. */
const feedPlanned = (year: number, series: string): number | null =>
  OBSERVATIONS.filter(
    (o) =>
      o.fiscalYear === year &&
      o.series === series &&
      o.planned?.amountEur != null,
  )
    .sort((a, b) => a.period.localeCompare(b.period))
    .at(-1)?.planned?.amountEur ?? null;

/** Years where the law framework AND the feed both carry a plan, so the two
 *  can be compared at all. */
const comparableYears = Object.keys(FRAMEWORK)
  .map(Number)
  .filter((y) => feedPlanned(y, "revenue") != null)
  .sort((a, b) => a - b);

// 2021 and 2022 each had an in-year актуализация, so the feed carries the
// УТОЧНЕН план while the parsed HTML is the law as first promulgated. They are
// excluded from the equality gate and asserted to DIFFER below, so the gate
// cannot quietly go vacuous by excluding everything.
const AMENDED_YEARS = [2021, 2022];

describe("the law-derived plan against the feed's own „Закон\" column", () => {
  it("has years to compare at all", () => {
    expect(comparableYears.length).toBeGreaterThanOrEqual(3);
  });

  it("matches the feed to the euro in every unamended year", () => {
    const checked: number[] = [];
    for (const year of comparableYears) {
      if (AMENDED_YEARS.includes(year)) continue;
      const plan = kfpPlanFromLaw(FRAMEWORK[String(year)], "test")!;
      checked.push(year);
      expect(plan.revenueEur, `${year} revenue`).toBe(
        feedPlanned(year, "revenue"),
      );
      expect(plan.expenditureEur, `${year} expenditure (law II + III)`).toBe(
        feedPlanned(year, "expenditure"),
      );
      expect(plan.euContributionEur, `${year} euContribution`).toBe(
        feedPlanned(year, "euContribution"),
      );
      // €1, not exact: the pre-2026 law tables are in лева and both sides
      // convert at the locked 1.95583, so the balance — a difference of three
      // converted figures — carries a cent-level residue. Measured: 2023 is
      // €1 off, 2024 and 2025 are exact. Same residue the КФП identity gate
      // allows in `fy2026Frame.data.test.ts`.
      expect(
        Math.abs(plan.balanceEur - feedPlanned(year, "balance")!),
        `${year} balance`,
      ).toBeLessThanOrEqual(1);
    }
    // Non-vacuity: 2023, 2024 and 2025 all reconcile today.
    expect(checked.length).toBeGreaterThanOrEqual(3);
  });

  // The mutation check for the II+III step. If `kfpPlanFromLaw` ever stopped
  // adding the transfers, the assertion above would fail — but so would a
  // reader who assumed II alone were close enough. This pins how far off it is.
  it("misses by the whole transfer envelope when III is dropped", () => {
    const year = comparableYears
      .filter((y) => !AMENDED_YEARS.includes(y))
      .at(-1)!;
    const fw = FRAMEWORK[String(year)];
    const withoutTransfers = fw.expenditure.amount.amountEur;
    const feed = feedPlanned(year, "expenditure")!;
    expect(feed - withoutTransfers).toBe(fw.transfers.amount.amountEur);
    expect(feed - withoutTransfers).toBeGreaterThan(1e10);
  });

  // Keeps the exclusion above honest: if an актуализация year ever started
  // matching, the exclusion is stale and should be removed rather than kept
  // as dead config.
  it("still disagrees in the years that had an in-year актуализация", () => {
    for (const year of AMENDED_YEARS) {
      if (!comparableYears.includes(year)) continue;
      const plan = kfpPlanFromLaw(FRAMEWORK[String(year)], "test")!;
      expect(plan.revenueEur, `${year} revenue`).not.toBe(
        feedPlanned(year, "revenue"),
      );
    }
  });
});

describe("ЗДБРБ-2026", () => {
  const plan = kfpPlanFromLaw(FRAMEWORK["2026"], "test");

  it("is present in the committed framework", () => {
    // The law was promulgated 31.07.2026 (ДВ бр. 69). A checkout whose budget
    // ingest predates that has no 2026 entry, and the frame degrades — but the
    // committed artifact does carry it, so this is a real assertion here.
    expect(plan).not.toBeNull();
  });

  // The literal from чл. 1 ал. 3: „V. БЮДЖЕТНО САЛДО (І-ІІ-ІІІ-IV)
  // -7 319 804,0" thousand euro. The balance is DERIVED (the parser does not
  // read ал. 3), so this is the check that the derivation reproduces the law's
  // own published figure rather than merely being self-consistent.
  it("derives the deficit чл. 1 ал. 3 states, to the euro", () => {
    expect(plan!.balanceEur).toBe(-7_319_804_000);
  });

  it("carries the four чл. 1 quantities", () => {
    expect(plan!.revenueEur).toBe(28_460_847_100);
    expect(plan!.expenditureEur).toBe(17_600_574_100 + 16_897_918_800);
    expect(plan!.euContributionEur).toBe(1_282_158_200);
  });

  // The whole reason the law path exists: the feed we hold was ingested before
  // the ЗДБРБ was promulgated, so it carries no plan for 2026. If this ever
  // fails, the feed has caught up and `feedPlan` will start winning on its own
  // — nothing to fix, but the fallback stops being the live path.
  it("is the only plan source for 2026 — the feed carries none", () => {
    for (const series of ["revenue", "expenditure", "euContribution"])
      expect(feedPlanned(2026, series), series).toBeNull();
  });
});
