// The FY2026 frame's three rules, driven against synthetic observations so the
// cases are the ones the real feed does NOT have.
//
// The rules exist because each has a failure mode that produces a
// plausible-looking number rather than an error:
//   1. annualising the balance yields a figure with no meaning (its
//      share-by-month ranges 0.190–0.539 across 2022–2025);
//   2. a point estimate with a ±€1bn band, presented bare, reads as precision;
//   3. FY2026 has no `planned` line at all, so plan-vs-actual must degrade
//      rather than render an empty comparison.
import { describe, expect, it } from "vitest";
import {
  annualiseSeries,
  buildFy2026Frame,
  monthShares,
  type KfpObservationLike,
} from "./fy2026Frame";

/** Build monthly observations where year Y's month M is `M * step`. */
const obsFor = (
  years: number[],
  series: string[],
  step: (year: number, s: string) => number,
): KfpObservationLike[] => {
  const out: KfpObservationLike[] = [];
  for (const year of years)
    for (const s of series)
      for (let m = 1; m <= 12; m++)
        out.push({
          fiscalYear: year,
          period: `${year}-${String(m).padStart(2, "0")}`,
          series: s,
          executed: { amountEur: m * step(year, s) },
        });
  return out;
};

/** Perfectly linear years: month M is always M/12 of the year. */
const LINEAR = obsFor(
  [2022, 2023, 2024, 2025],
  ["revenue", "expenditure"],
  () => 100,
);

describe("rule 1 — the balance is derived, never annualised", () => {
  it("refuses to annualise the balance", () => {
    expect(() =>
      annualiseSeries(LINEAR, {
        series: "balance",
        year: 2026,
        throughMonth: 5,
        referenceYears: [2022, 2023],
      }),
    ).toThrow(/must not be annualised directly/);
  });

  it("refuses financing too — same shape, same problem", () => {
    expect(() =>
      annualiseSeries(LINEAR, {
        series: "financing",
        year: 2026,
        throughMonth: 5,
        referenceYears: [2022, 2023],
      }),
    ).toThrow(/must not be annualised directly/);
  });

  it("derives the balance from the two annualised sides", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 5),
      ...obsFor([2026], ["expenditure"], () => 130).slice(0, 5),
    ];
    const frame = buildFy2026Frame(obs, {
      year: 2026,
      referenceYears: [2022, 2023, 2024, 2025],
    });
    expect(frame.balanceEur).toBeCloseTo(
      frame.revenue.annualisedEur - frame.expenditure.annualisedEur,
      6,
    );
    // Linear years ⇒ share-by-May is exactly 5/12, so the annualised total is
    // the full-year figure.
    expect(frame.revenue.annualisedEur).toBeCloseTo(12 * 100, 6);
    expect(frame.expenditure.annualisedEur).toBeCloseTo(12 * 130, 6);
  });
});

describe("rule 2 — the band is published, not just the point", () => {
  it("reports the share's mean, spread and the resulting bounds", () => {
    // Deliberately uneven years so the shares differ.
    const obs: KfpObservationLike[] = [];
    const shapes: Record<number, number[]> = {
      2022: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
      2023: [5, 15, 25, 40, 60, 70, 80, 90, 100, 110, 115, 120],
    };
    for (const [y, months] of Object.entries(shapes))
      months.forEach((v, i) =>
        obs.push({
          fiscalYear: Number(y),
          period: `${y}-${String(i + 1).padStart(2, "0")}`,
          series: "revenue",
          executed: { amountEur: v },
        }),
      );
    obs.push({
      fiscalYear: 2026,
      period: "2026-05",
      series: "revenue",
      executed: { amountEur: 55 },
    });

    const a = annualiseSeries(obs, {
      series: "revenue",
      year: 2026,
      throughMonth: 5,
      referenceYears: [2022, 2023],
    });
    // 2022: 50/120 = 0.4167; 2023: 60/120 = 0.5
    expect(a.shareMean).toBeCloseTo((50 / 120 + 60 / 120) / 2, 6);
    expect(a.shareStdDev).toBeGreaterThan(0);
    expect(a.referenceYears).toEqual([2022, 2023]);
    // A HIGHER share ⇒ the year is further along ⇒ a LOWER annual total. The
    // bounds must invert relative to the share, which is easy to get backwards.
    expect(a.lowEur).toBeCloseTo(55 / 0.5, 6);
    expect(a.highEur).toBeCloseTo(55 / (50 / 120), 6);
    expect(a.lowEur).toBeLessThan(a.annualisedEur);
    expect(a.highEur).toBeGreaterThan(a.annualisedEur);
  });

  it("refuses to annualise off a single reference year", () => {
    // One year gives a point with no spread — a band of zero width would read
    // as certainty rather than as an unmeasured quantity. The fixture needs a
    // 2026 observation, or the missing-YTD guard fires first and this asserts
    // the wrong thing.
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 5),
    ];
    expect(() =>
      annualiseSeries(obs, {
        series: "revenue",
        year: 2026,
        throughMonth: 5,
        referenceYears: [2022],
      }),
    ).toThrow(/at least 2 reference years/);
  });

  it("reports a missing year-to-date observation distinctly", () => {
    expect(() =>
      annualiseSeries(LINEAR, {
        series: "revenue",
        year: 2026,
        throughMonth: 5,
        referenceYears: [2022, 2023],
      }),
    ).toThrow(/no revenue observation for 2026-05/);
  });
});

describe("rule 3 — FY2026 has no plan line", () => {
  it("reports hasPlan false when no observation carries one", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 5),
      ...obsFor([2026], ["expenditure"], () => 100).slice(0, 5),
    ];
    expect(
      buildFy2026Frame(obs, { year: 2026, referenceYears: [2022, 2023] })
        .hasPlan,
    ).toBe(false);
  });

  it("reports hasPlan true once the ЗДБРБ lands and the feed carries one", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 5),
      ...obsFor([2026], ["expenditure"], () => 100).slice(0, 5),
    ];
    obs.push({
      fiscalYear: 2026,
      period: "2026-05",
      series: "revenue",
      executed: { amountEur: 500 },
      planned: { amountEur: 1200 },
    });
    expect(
      buildFy2026Frame(obs, { year: 2026, referenceYears: [2022, 2023] })
        .hasPlan,
    ).toBe(true);
  });
});

describe("monthShares", () => {
  it("skips a reference year missing either endpoint", () => {
    const obs: KfpObservationLike[] = [
      {
        fiscalYear: 2022,
        period: "2022-05",
        series: "revenue",
        executed: { amountEur: 50 },
      },
      // no December for 2022 ⇒ unusable
      {
        fiscalYear: 2023,
        period: "2023-05",
        series: "revenue",
        executed: { amountEur: 50 },
      },
      {
        fiscalYear: 2023,
        period: "2023-12",
        series: "revenue",
        executed: { amountEur: 100 },
      },
    ];
    expect(monthShares(obs, "revenue", 5, [2022, 2023])).toEqual([
      { year: 2023, share: 0.5 },
    ]);
  });

  it("skips a year whose December is zero rather than dividing by it", () => {
    const obs: KfpObservationLike[] = [
      {
        fiscalYear: 2022,
        period: "2022-05",
        series: "revenue",
        executed: { amountEur: 50 },
      },
      {
        fiscalYear: 2022,
        period: "2022-12",
        series: "revenue",
        executed: { amountEur: 0 },
      },
    ];
    expect(monthShares(obs, "revenue", 5, [2022])).toEqual([]);
  });
});

describe("frame assembly", () => {
  it("uses the latest observed month, not a hard-coded one", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 7),
      ...obsFor([2026], ["expenditure"], () => 100).slice(0, 7),
    ];
    expect(
      buildFy2026Frame(obs, { year: 2026, referenceYears: [2022, 2023] })
        .throughMonth,
    ).toBe(7);
  });

  it("throws when the year has no observations at all", () => {
    expect(() =>
      buildFy2026Frame(LINEAR, { year: 2027, referenceYears: [2022, 2023] }),
    ).toThrow(/no 2027 revenue observations/);
  });
});
