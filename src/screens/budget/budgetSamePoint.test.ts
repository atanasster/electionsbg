// Gates for the same-point cross-year comparison (plan T9.3).
//
// This panel exists to stop ONE misreading, and every property below is a way
// of reintroducing it: КФП figures are cumulative year-to-date, so a June
// figure set beside previous DECEMBERS shows a collapse in every single year.
// If the anchor slips, the panel becomes the error it was built to prevent —
// and it looks entirely normal while doing so.
//
// The other three:
//
//   * A MEDIAN THAT INCLUDES THE CURRENT YEAR. It is then compared against a
//     set containing itself, which drags the median toward it and understates
//     every deviation — most at exactly the moment a year is most unusual.
//   * COMPARING SIGNED VALUES ON THE BALANCE. Every year in this corpus runs a
//     deficit, so `(current − median) / |median|` on a deficit that grew from
//     −€0.5bn to −€1.9bn gives −257% — „257% smaller" about a deficit that
//     nearly quadrupled. Both sides go through `Math.abs` instead, which gives
//     +257%: what the pre-migration tile prints today, on the same corpus,
//     while both pages are live.
//   * A „% OF PLAN" ON A YEAR WITH NO PLAN. FY2026 runs on an interim law and
//     has `plannedEur` NULL on every series; a 0 there renders as ∞% or 0%.

import { describe, it, expect } from "vitest";
import { buildSamePoint, type SamePointInput } from "./budgetSamePoint";

const row = (
  fiscalYear: number,
  m: number,
  series: string,
  executedEur: number | null,
  plannedEur: number | null = null,
): SamePointInput => ({
  fiscalYear,
  period: `${fiscalYear}-${String(m).padStart(2, "0")}`,
  series,
  executedEur,
  plannedEur,
});

/** Every month of a year for one series, cumulative. */
const year = (
  fy: number,
  series: string,
  perMonth: number,
  months = 12,
  plan: number | null = null,
): SamePointInput[] =>
  Array.from({ length: months }, (_, i) =>
    row(fy, i + 1, series, perMonth * (i + 1), plan),
  );

describe("buildSamePoint", () => {
  it("cuts every year at the CURRENT year's latest month", () => {
    // 2022-2024 complete, 2025 reported to June. Anchoring anywhere else — a
    // year's own December, or the corpus maximum — is the cumulative-series
    // error this panel exists to prevent.
    const points = [
      ...year(2023, "revenue", 100),
      ...year(2024, "revenue", 200),
      ...year(2025, "revenue", 300, 6),
    ];
    const sp = buildSamePoint(points, ["revenue"]);
    expect(sp?.month).toBe(6);
    expect(sp?.currentFiscalYear).toBe(2025);
    const rows = sp?.series[0].rows ?? [];
    // June values, not Decembers: 600 / 1200 / 1800 — never 1200 / 2400 / 1800.
    expect(rows.map((r) => r.value)).toEqual([600, 1200, 1800]);
  });

  it("excludes the current year from its own median", () => {
    // Priors at June: 600 and 1200 → median 900. The current year is 1800.
    // Included, the median would be 1200 and the delta +50% instead of +100%.
    const points = [
      ...year(2023, "revenue", 100),
      ...year(2024, "revenue", 200),
      ...year(2025, "revenue", 300, 6),
    ];
    const s = buildSamePoint(points, ["revenue"])?.series[0];
    expect(s?.priorMedian).toBe(900);
    expect(s?.deltaPct).toBeCloseTo(100, 5);
  });

  it("reports a widening deficit as a POSITIVE deviation", () => {
    // Priors −600 and −600 at June → median −600. Current −1200: the deficit
    // DOUBLED, so the verdict must be +100%. Comparing signed values gives
    // −100%, which reads as „half as much" — and that is what the live corpus
    // turns into −257% vs the legacy tile's +257% on the same numbers.
    const points = [
      ...year(2023, "balance", -100),
      ...year(2024, "balance", -100),
      ...year(2025, "balance", -200, 6),
    ];
    const s = buildSamePoint(points, ["balance"])?.series[0];
    expect(s?.priorMedian).toBe(-600);
    expect(s?.deltaPct).toBeCloseTo(100, 5);
    expect(s?.deltaPct).toBeGreaterThan(0);
    expect(s?.signMismatch).toBe(false);
  });

  it("withholds the verdict when the current year flips sign", () => {
    // A SURPLUS year against deficit years. The magnitudes are comparable and
    // the comparison is still nonsense: „the deficit grew 40%" about a year
    // that ran no deficit. The pre-migration tile skipped it silently; this
    // publishes the reason so it does not read as missing data.
    const points = [
      ...year(2023, "balance", -100),
      ...year(2024, "balance", -100),
      ...year(2025, "balance", 200, 6),
    ];
    const s = buildSamePoint(points, ["balance"])?.series[0];
    expect(s?.signMismatch).toBe(true);
    expect(s?.deltaPct).toBeNull();
  });

  it("matches the pre-migration tile on the live corpus", () => {
    // Verbatim June figures from `budget_series(NULL)`, 2026-08-14. The legacy
    // BudgetSamePointTile is still mounted on /budget/deep-dive and on a
    // governance card, so the two are on screen at the same time and a reader
    // moving between them must not get two different verdicts.
    const june = (fy: number, series: string, v: number) =>
      row(fy, 6, series, v);
    const points = [
      june(2021, "revenue", 7409000000),
      june(2022, "revenue", 8450000000),
      june(2023, "revenue", 9380000000),
      june(2024, "revenue", 10420000000),
      june(2025, "revenue", 12340000000),
      june(2026, "revenue", 12796331646),
      june(2021, "balance", -536000000),
      june(2022, "balance", -181000000),
      june(2023, "balance", -438000000),
      june(2024, "balance", -1230000000),
      june(2025, "balance", -1763404023),
      june(2026, "balance", -1914405872),
    ];
    const sp = buildSamePoint(points, ["revenue", "balance"]);
    const rev = sp?.series.find((s) => s.series === "revenue");
    const bal = sp?.series.find((s) => s.series === "balance");
    // The pre-migration screenshot: „Приходи +36% … Бюджетен дефицит +257%".
    expect(Math.round(rev?.deltaPct ?? 0)).toBe(36);
    expect(Math.round(bal?.deltaPct ?? 0)).toBe(257);
  });

  it("carries the full-year plan onto every row that has one", () => {
    const points = [
      ...year(2023, "revenue", 100, 12, 1500),
      ...year(2024, "revenue", 200, 12, 3000),
      // FY2025 runs on an interim law: no plan on any month.
      ...year(2025, "revenue", 300, 6, null),
    ];
    const rows = buildSamePoint(points, ["revenue"])?.series[0].rows ?? [];
    expect(rows.map((r) => r.plan)).toEqual([1500, 3000, null]);
  });

  it("renders nothing once the current year is complete", () => {
    // At December every year is cut at its own year-end, which is the annual
    // series the page already shows above.
    const points = [
      ...year(2023, "revenue", 100),
      ...year(2024, "revenue", 200),
    ];
    expect(buildSamePoint(points, ["revenue"])).toBeNull();
  });

  it("renders nothing with only one year to compare", () => {
    expect(
      buildSamePoint(year(2025, "revenue", 300, 6), ["revenue"]),
    ).toBeNull();
  });

  it("withholds the median with fewer than two priors", () => {
    // One prior year is not a norm; calling it one invites a verdict the data
    // cannot support.
    const points = [
      ...year(2024, "revenue", 200),
      ...year(2025, "revenue", 300, 6),
    ];
    const s = buildSamePoint(points, ["revenue"])?.series[0];
    expect(s?.rows).toHaveLength(2);
    expect(s?.priorMedian).toBeNull();
    expect(s?.deltaPct).toBeNull();
  });

  it("shows a year that never reported the anchor month as absent, not zero", () => {
    // FY2021 in the live corpus has no September. A row of 0 there reads as
    // „the state collected nothing", and it would drag the median down too.
    const points = [
      ...year(2023, "revenue", 100),
      ...year(2024, "revenue", 200),
      // 2022 reported only January and February.
      ...year(2022, "revenue", 50, 2),
      ...year(2025, "revenue", 300, 6),
    ];
    const s = buildSamePoint(points, ["revenue"])?.series[0];
    const y2022 = s?.rows.find((r) => r.fiscalYear === 2022);
    expect(y2022?.value).toBeNull();
    // …and it is not in the median either: priors are 600 and 1200 → 900.
    expect(s?.priorMedian).toBe(900);
  });

  it("keeps the panels in the order the caller asked for", () => {
    const points = [
      ...year(2023, "revenue", 100),
      ...year(2023, "expenditure", 120),
      ...year(2024, "revenue", 200),
      ...year(2024, "expenditure", 240),
      ...year(2025, "revenue", 300, 6),
      ...year(2025, "expenditure", 360, 6),
    ];
    // „revenue" before „expenditure" is NOT alphabetical, so a builder that
    // sorted the panels would fail here. Asked the other way round it could
    // not.
    const sp = buildSamePoint(points, ["revenue", "expenditure"]);
    expect(sp?.series.map((s) => s.series)).toEqual(["revenue", "expenditure"]);
  });

  it("survives an empty corpus", () => {
    expect(buildSamePoint([], ["revenue"])).toBeNull();
  });

  it("withholds the verdict when the prior median is zero", () => {
    // The CURRENT year must be zero too, or the sign guard fires first and
    // this passes for the wrong reason — `Math.sign(100) !== Math.sign(0)`.
    // With both at zero the division is 0/0 = NaN, which renders as „NaN%".
    const points = [
      ...year(2023, "euContribution", 0),
      ...year(2024, "euContribution", 0),
      ...year(2025, "euContribution", 0, 6),
    ];
    const s = buildSamePoint(points, ["euContribution"])?.series[0];
    expect(s?.priorMedian).toBe(0);
    expect(s?.signMismatch).toBe(false);
    expect(s?.deltaPct).toBeNull();
  });

  it("treats a missing plannedEur field as no plan, not as zero", () => {
    // The route omits the key entirely on some rows rather than sending null.
    const points: SamePointInput[] = [
      {
        fiscalYear: 2024,
        period: "2024-06",
        series: "revenue",
        executedEur: 100,
      },
      {
        fiscalYear: 2024,
        period: "2024-12",
        series: "revenue",
        executedEur: 200,
      },
      {
        fiscalYear: 2025,
        period: "2025-06",
        series: "revenue",
        executedEur: 150,
      },
    ];
    const rows = buildSamePoint(points, ["revenue"])?.series[0].rows ?? [];
    expect(rows.every((r) => r.plan === null)).toBe(true);
  });
});
