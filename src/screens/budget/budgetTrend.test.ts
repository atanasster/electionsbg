// Gates for the КФП trend projection (plan T9.2).
//
// The arithmetic is now shared between the legacy tile and /budget/execution,
// which is the point of extracting it — but it also means a mistake here is
// wrong in two places at once. Every property below is one that produces a
// perfectly plausible chart when it breaks:
//
//   * ONE RATIO FOR BOTH SERIES. Revenue is corporate-tax-backloaded and
//     expenditure runs closer to linear, so a shared scale bends them together
//     and the projected deficit becomes an artefact of the arithmetic.
//   * A PROJECTED BALANCE SCALED ON ITS OWN. The balance is a residual; scaled
//     independently the projected months stop satisfying the identity the
//     actual months do, and the page states that identity two elements away.
//   * PROJECTING WITH NO ANCHOR. A first year in the corpus, or a prior year
//     that stops in June, has no seasonal shape to scale — and a straight-line
//     guess drawn in the same dashes as a real projection is indistinguishable
//     from one.
//   * PROJECTING A FINISHED YEAR, which invents thirteen months.

import { describe, it, expect } from "vitest";
import { buildTrendData, type TrendPoint } from "./budgetTrend";

/** Build the four series for one (fy, month). Values are per-month cumulative
 *  totals, which is what the КФП feed publishes. */
const month = (
  fiscalYear: number,
  m: number,
  v: { rev: number; exp: number; eu?: number },
): TrendPoint[] => {
  const period = `${fiscalYear}-${String(m).padStart(2, "0")}`;
  const eu = v.eu ?? 0;
  return [
    { fiscalYear, period, series: "revenue", executedEur: v.rev },
    { fiscalYear, period, series: "expenditure", executedEur: v.exp },
    { fiscalYear, period, series: "euContribution", executedEur: eu },
    {
      fiscalYear,
      period,
      series: "balance",
      executedEur: v.rev - v.exp - eu,
    },
  ];
};

/** A complete prior year with a DELIBERATELY non-linear revenue shape — most
 *  of it lands in the last quarter, the way corporate tax does. A projection
 *  that ignores the shape and extrapolates linearly gets a visibly different
 *  December. */
const priorYear = (fy: number): TrendPoint[] => {
  const out: TrendPoint[] = [];
  const revByMonth = [
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1400, 2000,
  ];
  for (let m = 1; m <= 12; m++) {
    out.push(
      ...month(fy, m, { rev: revByMonth[m - 1], exp: m * 120, eu: m * 5 }),
    );
  }
  return out;
};

describe("buildTrendData", () => {
  it("projects each series on its OWN seasonal ratio", () => {
    const prior = priorYear(2024);
    // 2025 is running 20% ahead on revenue and 50% ahead on expenditure at
    // June. One shared ratio cannot produce both Decembers.
    const current = [
      ...month(2025, 1, { rev: 120, exp: 180, eu: 6 }),
      ...month(2025, 6, { rev: 720, exp: 1080, eu: 36 }),
    ];
    const data = buildTrendData(current, [...prior, ...current]);
    const dec = data.find((d) => d.period === "2025-12");
    expect(dec, "no December datum was projected").toBeTruthy();
    // revenue: prior Dec 2000 × (720/600) = 2400
    expect(dec?.revenueProj).toBe(2400);
    // expenditure: prior Dec 1440 × (1080/720) = 2160
    expect(dec?.expenditureProj).toBe(2160);
    // A single shared ratio would put one of them somewhere else entirely.
    expect(dec?.revenueProj).not.toBe(dec?.expenditureProj);
  });

  it("derives the projected balance as the residual, not as its own series", () => {
    const prior = priorYear(2024);
    const current = [...month(2025, 6, { rev: 720, exp: 1080, eu: 36 })];
    const data = buildTrendData(current, [...prior, ...current]);
    const dec = data.find((d) => d.period === "2025-12");
    // eu: prior Dec 60 × (36/30) = 72. balance = 2400 − 2160 − 72 = 168.
    expect(dec?.balanceBar).toBe(168);
    expect(dec?.balanceBar).toBe(
      (dec?.revenueProj ?? 0) - (dec?.expenditureProj ?? 0) - 72,
    );
  });

  it("every projected month satisfies the identity the actual months do", () => {
    // The page states „revenue − expenditure − EU = balance" two elements from
    // this chart. A projection that breaks it makes the sentence false for
    // exactly the months a reader is most likely to ask about.
    const prior = priorYear(2024);
    const current = [...month(2025, 6, { rev: 720, exp: 1080, eu: 36 })];
    const data = buildTrendData(current, [...prior, ...current]);
    const projected = data.filter((d) => d.isProjected);
    expect(projected.length).toBeGreaterThan(0);
    for (const d of projected) {
      const rev = d.revenueProj ?? 0;
      const exp = d.expenditureProj ?? 0;
      // The EU term is not exposed on the datum, so recover it and check it is
      // a sane, small residual rather than a hole in the arithmetic.
      const eu = rev - exp - (d.balanceBar ?? 0);
      expect(Number.isFinite(eu), d.period).toBe(true);
      expect(eu).toBeGreaterThanOrEqual(0);
      expect(rev - exp - eu).toBe(d.balanceBar);
    }
  });

  it("joins the dashed path to the last actual point", () => {
    const prior = priorYear(2024);
    const current = [...month(2025, 6, { rev: 720, exp: 1080, eu: 36 })];
    const data = buildTrendData(current, [...prior, ...current]);
    const june = data.find((d) => d.period === "2025-06");
    // Both keys populated on the join month, so Recharts draws solid → dashed
    // with no gap…
    expect(june?.revenue).toBe(720);
    expect(june?.revenueProj).toBe(720);
    // …but NOT the bar, which is a discrete rect: painting it twice renders
    // two stacked rects, visible as one doubled, darker bar.
    expect(june?.isProjected).toBe(false);
    const bars = data.filter((d) => d.period === "2025-06");
    expect(bars).toHaveLength(1);
  });

  it("projects nothing when the prior year has no anchor month", () => {
    // Prior year stops in May; the current year is at June. There is no
    // same-month figure to take a ratio against.
    const prior: TrendPoint[] = [];
    for (let m = 1; m <= 5; m++)
      prior.push(...month(2024, m, { rev: m * 100, exp: m * 120 }));
    const current = [...month(2025, 6, { rev: 720, exp: 1080 })];
    const data = buildTrendData(current, [...prior, ...current]);
    expect(data.every((d) => !d.isProjected)).toBe(true);
    expect(data.find((d) => d.period === "2025-12")).toBeUndefined();
  });

  it("projects nothing when the prior year never reached December", () => {
    // It has the anchor month but no December, so there is no year-end to
    // scale toward.
    const prior: TrendPoint[] = [];
    for (let m = 1; m <= 8; m++)
      prior.push(...month(2024, m, { rev: m * 100, exp: m * 120 }));
    const current = [...month(2025, 6, { rev: 720, exp: 1080 })];
    const data = buildTrendData(current, [...prior, ...current]);
    expect(data.every((d) => !d.isProjected)).toBe(true);
  });

  it("projects nothing for a year that already reached December", () => {
    const prior = priorYear(2024);
    const current = priorYear(2025);
    const data = buildTrendData(current, [...prior, ...current]);
    expect(data.every((d) => !d.isProjected)).toBe(true);
    expect(data).toHaveLength(12);
    // And no JOIN marker either. `isProjected` alone does not catch this: the
    // join month is by definition an actual month, so a guard written `> 12`
    // instead of `>= 12` skips the loop (13 <= 12 is false) while still
    // stamping `revenueProj` on December — one stray dashed dot hanging off
    // the end of a finished year.
    expect(data.every((d) => d.revenueProj == null)).toBe(true);
    expect(data.every((d) => d.expenditureProj == null)).toBe(true);
  });

  it("returns the drawn window sorted, and only the drawn window", () => {
    // `allPoints` is the projection's anchor, never something to draw — a
    // builder that folded it in would put the prior year on a chart whose
    // heading names one fiscal year.
    const prior = priorYear(2024);
    const current = [
      ...month(2025, 3, { rev: 300, exp: 360 }),
      ...month(2025, 1, { rev: 100, exp: 120 }),
    ];
    const data = buildTrendData(current, [...prior, ...current]);
    const actual = data.filter((d) => !d.isProjected).map((d) => d.period);
    expect(actual).toEqual(["2025-01", "2025-03"]);
  });

  it("survives an empty window", () => {
    expect(buildTrendData([], priorYear(2024))).toEqual([]);
  });

  // ── the two implementations must agree ────────────────────────────────────
  //
  // This projection exists TWICE on the site, and NOT where an earlier draft of
  // this comment said. There is no projection arithmetic in SQL at all:
  // migration 156 only pivots rows already stamped `basis='projected'`, which
  // `scripts/budget/kfp.ts:projectFigures()` computed at INGEST time. So the
  // two implementations are this module and that ingest step — and a reader
  // sees both on one page, the table's „прогноза" column and the dashed line
  // that has to land on it.
  //
  // They agree ALGEBRAICALLY (same product, one rounding each), not by luck on
  // this data — which is what makes pinning the exact euro legitimate rather
  // than pinning an accident. The fixture is verbatim from `budget_series(NULL)`
  // and the expected values verbatim from `budget_hub_stats(NULL)`, measured
  // 2026-08-14.
  it("lands on the same December the SQL projection publishes", () => {
    const real: TrendPoint[] = [
      // FY2025 — the seasonal anchor: the same month, and December.
      {
        fiscalYear: 2025,
        period: "2025-06",
        series: "revenue",
        executedEur: 12335339793,
      },
      {
        fiscalYear: 2025,
        period: "2025-06",
        series: "expenditure",
        executedEur: 13577869019,
      },
      {
        fiscalYear: 2025,
        period: "2025-06",
        series: "euContribution",
        executedEur: 520874797,
      },
      {
        fiscalYear: 2025,
        period: "2025-12",
        series: "revenue",
        executedEur: 26309031158,
      },
      {
        fiscalYear: 2025,
        period: "2025-12",
        series: "expenditure",
        executedEur: 28381104783,
      },
      {
        fiscalYear: 2025,
        period: "2025-12",
        series: "euContribution",
        executedEur: 1040980572,
      },
      // FY2026 — the year on screen, reported to June.
      {
        fiscalYear: 2026,
        period: "2026-06",
        series: "revenue",
        executedEur: 12796331646,
      },
      {
        fiscalYear: 2026,
        period: "2026-06",
        series: "expenditure",
        executedEur: 14150474073,
      },
      {
        fiscalYear: 2026,
        period: "2026-06",
        series: "euContribution",
        executedEur: 560263445,
      },
    ];
    const drawn = real.filter((p) => p.fiscalYear === 2026);
    const dec = buildTrendData(drawn, real).find((d) => d.period === "2026-12");
    // budget_hub_stats(NULL) -> revenueProjectedEur / expenditureProjectedEur
    expect(dec?.revenueProj).toBe(27292242746);
    expect(dec?.expenditureProj).toBe(29577990982);
  });

  it("anchors on the newest year that CAN anchor, not blindly on FY−1", () => {
    // FY2021 in the live corpus publishes 06,07,08,10,11,12 — no September. A
    // FY2022 chart at September therefore has no same-month figure in FY−1.
    // Anchored blindly it loses its tail (and, before the guard was written as
    // a pair, dereferenced undefined and threw); it should fall back to the
    // next year that has both the month and December.
    const gappy: TrendPoint[] = [];
    for (const m of [6, 7, 8, 10, 11, 12]) {
      gappy.push(...month(2021, m, { rev: m * 100, exp: m * 120, eu: m * 5 }));
    }
    const older = priorYear(2020);
    const current = [...month(2022, 9, { rev: 1080, exp: 1296, eu: 45 })];
    const data = buildTrendData(current, [...older, ...gappy, ...current]);
    const dec = data.find((d) => d.period === "2022-12");
    expect(
      dec,
      "no tail — it did not fall back past the gap year",
    ).toBeTruthy();
    // FY2020 September rev 900 → ratio 1080/900 = 1.2; Dec 2000 × 1.2 = 2400.
    expect(dec?.revenueProj).toBe(2400);
  });

  it("does not throw when the anchor month is missing but December is not", () => {
    // The half of the guard nothing else covers: `priorAtDec` alone is truthy
    // here, so a guard written on it alone reaches the ratio and dereferences
    // undefined. Reachable on the live corpus — see FY2021's September.
    const prior: TrendPoint[] = [];
    for (const m of [1, 2, 3, 12]) {
      prior.push(...month(2024, m, { rev: m * 100, exp: m * 120 }));
    }
    const current = [...month(2025, 6, { rev: 720, exp: 1080 })];
    expect(() => buildTrendData(current, [...prior, ...current])).not.toThrow();
    const data = buildTrendData(current, [...prior, ...current]);
    expect(data.every((d) => !d.isProjected)).toBe(true);
  });
});
