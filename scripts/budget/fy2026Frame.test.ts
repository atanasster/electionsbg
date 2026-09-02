// The FY2026 frame's four rules, driven against synthetic observations so the
// cases are the ones the real feed does NOT have. The corpus-backed half — the
// КФП identity against the live feed — is `fy2026Frame.data.test.ts`.
//
// The rules exist because each has a failure mode that produces a
// plausible-looking number rather than an error:
//   1. annualising the balance yields a figure with no meaning (its
//      share-by-month ranges 0.190–0.539 across 2022–2025) — and deriving it
//      from only TWO of the three sides yields a plausible number that is
//      quietly €1.19bn too small (the вноска в общия бюджет на ЕС is its own
//      КФП section, not part of "II. Разходи и трансфери");
//   2. a point estimate with a ±€1bn band, presented bare, reads as precision —
//      most of all for the balance, which amplifies each side's spread;
//   3. the plan has two sources — the feed's „Закон" column and the ЗДБРБ
//      itself, which for 2026 was promulgated 31.07.2026, after the feed we
//      hold was ingested. They are not interchangeable (the feed carries the
//      уточнен план), and with neither the comparison must degrade to null
//      rather than compare against zero;
//   4. an INCOMPLETE reference year (2021 starts mid-year) has a "December"
//      that is a half-year total, so its share is near 1 and drags the mean —
//      and nothing about a missing month catches it.
import { describe, expect, it } from "vitest";
import {
  annualiseSeries,
  buildFy2026Frame,
  monthShares,
  type KfpObservationLike,
  type KfpSeries,
} from "./fy2026Frame";

/** Build monthly observations where year Y's month M is `M * step`. */
const obsFor = (
  years: number[],
  series: KfpSeries[],
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
  ["revenue", "expenditure", "euContribution"],
  () => 100,
);

const REF = [2022, 2023, 2024, 2025];

/** The 2026 partial year the frame is built from: `months` of each side, with
 *  a per-side monthly step. Every helper below goes through this so a new side
 *  cannot be added to the frame and forgotten in a fixture. */
const partial2026 = (
  steps: { revenue: number; expenditure: number; euContribution: number },
  months = 5,
): KfpObservationLike[] =>
  (
    ["revenue", "expenditure", "euContribution"] as const
  ).flatMap<KfpObservationLike>((s) =>
    obsFor([2026], [s], () => steps[s]).slice(0, months),
  );

/** The standard 2026 fixture: revenue 100/mo, expenditure 130/mo, EU 7/mo. */
const STANDARD = () => [
  ...LINEAR,
  ...partial2026({ revenue: 100, expenditure: 130, euContribution: 7 }),
];

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

  // The guard is an ALLOWLIST, so a series the feed adds later fails CLOSED.
  // A denylist naming only balance/financing would silently annualise this.
  it("refuses an unknown series rather than annualising it", () => {
    expect(() =>
      annualiseSeries(LINEAR, {
        series: "primaryBalance",
        year: 2026,
        throughMonth: 5,
        referenceYears: [2022, 2023],
      }),
    ).toThrow(/not an annualisable КФП section/);
  });

  it("derives the balance from the three annualised sides", () => {
    const frame = buildFy2026Frame(STANDARD(), {
      year: 2026,
      referenceYears: REF,
    });
    expect(frame.balanceEur).toBeCloseTo(
      frame.revenue.annualisedEur -
        frame.expenditure.annualisedEur -
        frame.euContribution.annualisedEur,
      6,
    );
    // Linear years ⇒ share-by-May is exactly 5/12, so the annualised total is
    // the full-year figure.
    expect(frame.revenue.annualisedEur).toBeCloseTo(12 * 100, 6);
    expect(frame.expenditure.annualisedEur).toBeCloseTo(12 * 130, 6);
    expect(frame.euContribution.annualisedEur).toBeCloseTo(12 * 7, 6);
  });

  // The mutation check for the €1.19bn defect: `revenue - expenditure` alone
  // is a perfectly plausible balance, so an assertion that only restates the
  // implementation would pass on the broken form too. This pins the SIGN and
  // SIZE of the difference between the two-side and three-side derivations.
  it("is strictly more negative than the two-side derivation", () => {
    const frame = buildFy2026Frame(STANDARD(), {
      year: 2026,
      referenceYears: REF,
    });
    const twoSide =
      frame.revenue.annualisedEur - frame.expenditure.annualisedEur;
    expect(frame.balanceEur).toBeLessThan(twoSide);
    expect(twoSide - frame.balanceEur).toBeCloseTo(12 * 7, 6);
  });

  // A zero would read as "Bulgaria paid nothing into the EU budget" and shrink
  // the deficit by the whole contribution — the failure has to be loud.
  it("refuses to build a frame when the EU contribution is missing", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 5),
      ...obsFor([2026], ["expenditure"], () => 130).slice(0, 5),
    ];
    expect(() =>
      buildFy2026Frame(obs, { year: 2026, referenceYears: REF }),
    ).toThrow(/no 2026 observations for euContribution/);
  });

  describe("the identity gate against the feed's own balance row", () => {
    /** 5 months at 100 / 130 / 7 ⇒ YTD 500 − 650 − 35 = −185. */
    const withBalance = (published: number): KfpObservationLike[] => [
      ...STANDARD(),
      {
        fiscalYear: 2026,
        period: "2026-05",
        series: "balance",
        executed: { amountEur: published },
      },
    ];

    it("passes when the published balance reconciles", () => {
      expect(() =>
        buildFy2026Frame(withBalance(-185), {
          year: 2026,
          referenceYears: REF,
        }),
      ).not.toThrow();
    });

    it("throws when the feed's section split has moved", () => {
      // A re-scoping — the contribution folded into "II. Разходи и трансфери" —
      // would move the published balance by the contribution. These synthetic
      // figures are in the hundreds, so the shift is exaggerated past the
      // €1,000 absolute tolerance; on the real feed the residue is €1 and the
      // real shift is €560m. Plausible either way, and invisible to every
      // other test in this file.
      expect(() =>
        buildFy2026Frame(withBalance(-150000), {
          year: 2026,
          referenceYears: REF,
        }),
      ).toThrow(/identity IV = I - II - III does not hold/);
    });

    it("degrades rather than wedging when the feed stops publishing it", () => {
      expect(() =>
        buildFy2026Frame(STANDARD(), { year: 2026, referenceYears: REF }),
      ).not.toThrow();
    });
  });
});

describe("rule 2 — the band is published, not just the point", () => {
  // Deliberately uneven years so the shares differ. 2022: 50/120 = 0.4167;
  // 2023: 60/120 = 0.5. Both complete (12 months), per rule 4.
  const unevenRevenue = (): KfpObservationLike[] => {
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
    return obs;
  };

  it("reports the share's mean, spread and the resulting bounds", () => {
    const a = annualiseSeries(unevenRevenue(), {
      series: "revenue",
      year: 2026,
      throughMonth: 5,
      referenceYears: [2022, 2023],
    });
    expect(a.shareMean).toBeCloseTo((50 / 120 + 60 / 120) / 2, 6);
    expect(a.referenceYears).toEqual([2022, 2023]);
    // A HIGHER share ⇒ the year is further along ⇒ a LOWER annual total. The
    // bounds must invert relative to the share, which is easy to get backwards.
    expect(a.lowEur).toBeCloseTo(55 / 0.5, 6);
    expect(a.highEur).toBeCloseTo(55 / (50 / 120), 6);
    expect(a.lowEur).toBeLessThan(a.annualisedEur);
    expect(a.highEur).toBeGreaterThan(a.annualisedEur);
  });

  // Pins the SAMPLE denominator (n-1). The population form (n) is also
  // positive and also plausible, so `> 0` is satisfied by both — this is the
  // assertion that discriminates, and the module header quotes the value
  // ("~1.1-1.6pp") as evidence, so it is a figure a reader can see.
  it("uses the sample standard deviation, not the population one", () => {
    const a = annualiseSeries(unevenRevenue(), {
      series: "revenue",
      year: 2026,
      throughMonth: 5,
      referenceYears: [2022, 2023],
    });
    const shares = [50 / 120, 60 / 120];
    const mean = (shares[0] + shares[1]) / 2;
    const sample = Math.sqrt(
      shares.reduce((acc, s) => acc + (s - mean) ** 2, 0) / (shares.length - 1),
    );
    expect(a.shareStdDev).toBeGreaterThan(0);
    expect(a.shareStdDev).toBeCloseTo(sample, 12);
    // n vs n-1 over two samples differ by exactly √2.
    expect(a.shareStdDev).not.toBeCloseTo(sample / Math.SQRT2, 12);
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

  // The balance amplifies each side's spread instead of averaging it away, so
  // it is the figure Rule 2 exists for most — and its corners CROSS the sides,
  // which is the same inversion the per-side bounds get wrong.
  it("brackets the derived balance by the worst and best corners", () => {
    // Uneven expenditure so the sides have real spread; LINEAR alone gives a
    // zero-width band and the bracketing would be vacuous.
    const obs: KfpObservationLike[] = [
      ...obsFor([2022, 2023], ["revenue", "euContribution"], () => 100),
      ...[2022, 2023].flatMap((y) =>
        (y === 2022
          ? [5, 15, 25, 40, 60, 70, 80, 90, 100, 110, 115, 120]
          : [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
        ).map((v, i) => ({
          fiscalYear: y,
          period: `${y}-${String(i + 1).padStart(2, "0")}`,
          series: "expenditure" as const,
          executed: { amountEur: v },
        })),
      ),
      ...partial2026({ revenue: 100, expenditure: 130, euContribution: 7 }),
    ];
    const frame = buildFy2026Frame(obs, {
      year: 2026,
      referenceYears: [2022, 2023],
    });
    expect(frame.expenditure.lowEur).toBeLessThan(frame.expenditure.highEur);
    expect(frame.balanceLowEur).toBeLessThan(frame.balanceEur);
    expect(frame.balanceHighEur).toBeGreaterThan(frame.balanceEur);
    // The LOW balance takes the low revenue against the HIGH spending sides —
    // the corner, not the same-named bound on each side.
    expect(frame.balanceLowEur).toBeCloseTo(
      frame.revenue.lowEur -
        frame.expenditure.highEur -
        frame.euContribution.highEur,
      6,
    );
    expect(frame.balanceHighEur).toBeCloseTo(
      frame.revenue.highEur -
        frame.expenditure.lowEur -
        frame.euContribution.lowEur,
      6,
    );
  });
});

describe("rule 3 — the plan has two sources and they are not interchangeable", () => {
  /** A plan line on every side, stamped onto the observations that ALREADY
   *  exist rather than appended as duplicates — `pick`/`pickPlanned` both use
   *  the first match, so a duplicate row makes the assertion depend on array
   *  order instead of on the rule under test. */
  const withFeedPlan = (plans: {
    revenue: number;
    expenditure: number;
    euContribution: number;
  }): KfpObservationLike[] =>
    STANDARD().map((o) =>
      o.fiscalYear === 2026 && o.period === "2026-05" && o.series in plans
        ? {
            ...o,
            planned: {
              amountEur: plans[o.series as keyof typeof plans],
            },
          }
        : o,
    );

  const LAW_PLAN = {
    fiscalYear: 2026,
    source: "law" as const,
    revenueEur: 2400,
    expenditureEur: 3120,
    euContributionEur: 168,
    balanceEur: -888,
    note: "ЗДБРБ-2026, ДВ бр. 69 от 31.07.2026",
  };

  it("reports hasPlan false when neither source supplies one", () => {
    const frame = buildFy2026Frame(STANDARD(), {
      year: 2026,
      referenceYears: REF,
    });
    expect(frame.hasPlan).toBe(false);
    // null, not an empty comparison — a plan of zero would render as total
    // over-execution against a real year-to-date figure.
    expect(frame.plan).toBeNull();
  });

  it("falls back to the promulgated ЗДБРБ when the feed carries none", () => {
    const frame = buildFy2026Frame(STANDARD(), {
      year: 2026,
      referenceYears: REF,
      lawPlan: LAW_PLAN,
    });
    expect(frame.hasPlan).toBe(true);
    expect(frame.plan!.source).toBe("law");
    expect(frame.plan!.note).toContain("ДВ бр. 69");
    // 5 months at 100/mo against a 2400 plan.
    expect(frame.plan!.revenue.ytdEur).toBe(500);
    expect(frame.plan!.revenue.pct).toBeCloseTo(500 / 2400, 12);
  });

  // The feed's column is the УТОЧНЕН план — it moves with an in-year
  // актуализация while the parsed law is the original — so it must win. On the
  // real corpus the two differ by €0.7-1.0bn on revenue in 2021 and 2022.
  it("prefers the feed's own „Закон\" column over the law", () => {
    const frame = buildFy2026Frame(
      withFeedPlan({ revenue: 1200, expenditure: 1500, euContribution: 90 }),
      { year: 2026, referenceYears: REF, lawPlan: LAW_PLAN },
    );
    expect(frame.plan!.source).toBe("feed");
    expect(frame.plan!.revenue.plannedEur).toBe(1200);
    expect(frame.plan!.revenue.plannedEur).not.toBe(LAW_PLAN.revenueEur);
  });

  // A plan missing one side is a hole that reads as a real figure, so it is
  // treated as absent and the law fallback takes over.
  it("ignores a partial feed plan rather than comparing against a hole", () => {
    const obs = STANDARD().map((o) =>
      o.fiscalYear === 2026 && o.period === "2026-05" && o.series === "revenue"
        ? { ...o, planned: { amountEur: 1200 } }
        : o,
    );
    const frame = buildFy2026Frame(obs, {
      year: 2026,
      referenceYears: REF,
      lawPlan: LAW_PLAN,
    });
    expect(frame.plan!.source).toBe("law");
  });

  // ⚠️ The dangerous pre-law shape. In every bridging-law month the real corpus
  // holds, the „Закон" column is a byte-identical copy of the executed YTD, so
  // taking it as an annual plan yields exactly 100% on every side — plausible,
  // cited, and false. The all-zero guard catches the OTHER pre-law shape.
  it("rejects a feed plan that mirrors the executed year-to-date", () => {
    // STANDARD()'s month-5 execution is 500 / 650 / 35.
    const frame = buildFy2026Frame(
      withFeedPlan({ revenue: 500, expenditure: 650, euContribution: 35 }),
      { year: 2026, referenceYears: REF, lawPlan: LAW_PLAN },
    );
    expect(frame.plan!.source).toBe("law");
    expect(frame.plan!.revenue.pct).not.toBeCloseTo(1, 6);
  });

  it("rejects an all-zero feed plan", () => {
    const frame = buildFy2026Frame(
      withFeedPlan({ revenue: 0, expenditure: 0, euContribution: 0 }),
      { year: 2026, referenceYears: REF, lawPlan: LAW_PLAN },
    );
    expect(frame.plan!.source).toBe("law");
  });

  // The wider net: before December an annual plan cannot sit below the
  // year-to-date on every side at once. That is the wrong denominator, not an
  // overrun — and it catches a future variant that mirrors an ALMOST-equal
  // figure rather than an exactly equal one.
  it("rejects a feed plan that is below the year-to-date on every side", () => {
    const frame = buildFy2026Frame(
      withFeedPlan({ revenue: 499, expenditure: 649, euContribution: 34 }),
      { year: 2026, referenceYears: REF, lawPlan: LAW_PLAN },
    );
    expect(frame.plan!.source).toBe("law");
  });

  // A plan from another year reconciles perfectly and cites the wrong ДВ issue,
  // so nothing in the payload could contradict it.
  it("refuses a law plan minted for a different fiscal year", () => {
    expect(() =>
      buildFy2026Frame(STANDARD(), {
        year: 2026,
        referenceYears: REF,
        lawPlan: { ...LAW_PLAN, fiscalYear: 2025 },
      }),
    ).toThrow(/lawPlan is for 2025 but the frame is 2026/);
  });

  // `pickPlanned` reads the plan as it stood AT throughMonth. A column filled
  // only in a later month is not yet knowable at this reporting date.
  it("ignores a plan row from a month after throughMonth", () => {
    const obs = [
      ...LINEAR,
      ...partial2026({ revenue: 100, expenditure: 130, euContribution: 7 }, 7),
    ].map((o) =>
      o.fiscalYear === 2026 && o.period === "2026-07"
        ? { ...o, planned: { amountEur: 9_000 } }
        : o,
    );
    // Truncate the frame to month 6 by dropping month 7 from ONE side.
    const truncated = obs.filter(
      (o) =>
        !(
          o.fiscalYear === 2026 &&
          o.period === "2026-07" &&
          o.series === "euContribution"
        ),
    );
    const frame = buildFy2026Frame(truncated, {
      year: 2026,
      referenceYears: REF,
      lawPlan: LAW_PLAN,
    });
    expect(frame.throughMonth).toBe(6);
    expect(frame.plan!.source).toBe("law");
  });

  // The reference years DO carry full plans in the real feed, so dropping the
  // fiscalYear predicate would flip hasPlan to true for 2026 and the UI would
  // render a comparison against a plan that does not exist. Both cases above
  // use fixtures where no year has a plan, so neither can see it.
  it("ignores a plan line belonging to a different fiscal year", () => {
    const obs = STANDARD();
    obs.push({
      fiscalYear: 2025,
      period: "2025-12",
      series: "revenue",
      executed: { amountEur: 1200 },
      planned: { amountEur: 1300 },
    });
    expect(
      buildFy2026Frame(obs, { year: 2026, referenceYears: REF }).hasPlan,
    ).toBe(false);
  });
});

describe("rule 4 — a reference year must be complete", () => {
  it("skips a reference year missing either endpoint", () => {
    // 2022 is COMPLETE (12 rows) but its December carries no executed figure,
    // so this isolates the endpoint rule from the completeness rule below.
    const obs: KfpObservationLike[] = [
      ...obsFor([2022], ["revenue"], () => 100).map((o) =>
        o.period === "2022-12" ? { ...o, executed: null } : o,
      ),
      ...obsFor([2023], ["revenue"], () => 100),
    ];
    const shares = monthShares(obs, "revenue", 5, [2022, 2023]);
    expect(shares).toHaveLength(1);
    expect(shares[0].year).toBe(2023);
    expect(shares[0].share).toBeCloseTo(5 / 12, 12);
  });

  it("skips a year whose December is zero rather than dividing by it", () => {
    const obs = obsFor([2022], ["revenue"], () => 100).map((o) =>
      o.period === "2022-12" ? { ...o, executed: { amountEur: 0 } } : o,
    );
    expect(monthShares(obs, "revenue", 5, [2022])).toEqual([]);
  });

  // The 2021 case: the feed starts mid-year, so both endpoints resolve and the
  // "December" divided by is a half-year total. Nothing about a missing month
  // catches this — the share just comes out near 1 and drags the mean down,
  // inflating every annualised total.
  it("skips a year that started mid-feed, even though both endpoints exist", () => {
    const partial = obsFor([2021], ["revenue"], () => 100).filter(
      (o) => Number(o.period.slice(5, 7)) >= 6,
    );
    expect(partial).toHaveLength(7);
    expect(monthShares(partial, "revenue", 7, [2021])).toEqual([]);
  });
});

describe("frame assembly", () => {
  it("uses the latest observed month, not a hard-coded one", () => {
    const obs = [
      ...LINEAR,
      ...partial2026({ revenue: 100, expenditure: 100, euContribution: 7 }, 7),
    ];
    expect(
      buildFy2026Frame(obs, { year: 2026, referenceYears: [2022, 2023] })
        .throughMonth,
    ).toBe(7);
  });

  // A one-month lag on one section must NARROW the frame, not wedge the
  // generator — a generator that cannot run leaves the previous month's
  // artifact served with nobody told.
  it("narrows to the last month every side covers", () => {
    const obs = [
      ...LINEAR,
      ...obsFor([2026], ["revenue"], () => 100).slice(0, 7),
      ...obsFor([2026], ["expenditure"], () => 130).slice(0, 7),
      ...obsFor([2026], ["euContribution"], () => 7).slice(0, 6),
    ];
    const frame = buildFy2026Frame(obs, {
      year: 2026,
      referenceYears: [2022, 2023],
    });
    expect(frame.throughMonth).toBe(6);
    expect(frame.revenue.throughMonth).toBe(6);
    expect(frame.euContribution.ytdEur).toBe(6 * 7);
  });

  it("throws when the year has no observations at all", () => {
    expect(() =>
      buildFy2026Frame(LINEAR, { year: 2027, referenceYears: [2022, 2023] }),
    ).toThrow(/no 2027 observations for revenue, expenditure, euContribution/);
  });
});
