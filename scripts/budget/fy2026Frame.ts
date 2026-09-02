// Build the FY2026 fiscal frame — the mixed-provenance baseline the simulator
// re-bases onto (plan T8).
//
// FY2026 has no single legal frame. The ЗБДОО and ЗБНЗОК were promulgated on
// 28 July 2026; the ЗДБРБ was not, so the state side runs on a bridging law.
// "The 2026 budget" is therefore not one thing, and a baseline that pretends
// otherwise is the failure mode this module exists to prevent. Every line
// carries the KIND of number it is:
//
//   law        ЗБДОО / ЗБНЗОК — exact, promulgated
//   interim    ЗСПИР-2026 + its ЗИД — the legal frame the state side ran on
//   execution  2026 КФП year-to-date, seasonally annualised (this file)
//   carried    2025 or older actuals, grown — see the vintage table
//
// FOUR RULES, all measured rather than assumed:
//
//  1. Annualise each SIDE separately and derive the balance. The balance's own
//     share-by-month is not stable — measured across 2022-2025 it ranges 0.190
//     to 0.539 for May, because it is a small difference of three large numbers
//     and the seasonality does not survive the subtraction. Annualising it
//     directly produces a number with no meaning.
//
//     ⚠️ There are THREE sides, not two. The КФП identity the feed itself
//     publishes is `IV. Бюджетно салдо = I - II - III`, i.e.
//     `balance = revenue - expenditure - euContribution` — the вноска в общия
//     бюджет на ЕС is its own section, NOT part of `expenditure` ("II. Разходи
//     и трансфери"). Measured across the whole feed: the identity holds on all
//     60 periods (2021-07 … 2026-06) with a maximum residual of €1, so it is
//     exact rather than approximate, and `buildFy2026Frame` asserts it against
//     the published `balance` row rather than trusting the section split.
//     Omitting the third side understated the projected 2026 deficit by
//     €1.19bn — a quietly wrong number rather than an error, which is why the
//     identity is asserted rather than left to this comment.
//
//  2. Publish the BAND, not just the point. The share-by-month has a standard
//     deviation of ~1.1-1.6pp, which is ±€0.8-1.7bn on the annualised figure.
//     A simulator whose levers move tens of millions must not present a
//     baseline with a billion-euro band as a hard number.
//
//     That applies MOST to the balance, which is where it is easiest to forget:
//     a difference of three large numbers amplifies each side's spread instead
//     of averaging it away. Measured at 2026-06 the point is −€5.78bn inside a
//     −€8.45bn … −€2.94bn band, and a leave-one-out backtest of this method
//     against the feed's own December actuals misses by up to €3.12bn (2025).
//     So `balanceEur` never ships without `balanceLowEur` / `balanceHighEur`.
//
//  3. There is no 2026 `planned` line in the FEED. Confirmed: every 2026
//     observation has planned: null, where 2025 carries a full plan. Plan-vs-
//     actual must degrade, not blank.
//
//  4. A reference year must be COMPLETE. The КФП feed starts mid-2021 — 2021
//     carries 6 observations per series, not 12 — so its "December" is a
//     half-year total and its share-by-month is not comparable. `monthShares`
//     rejects such a year rather than relying on every caller to know: a
//     partial year is not skipped by the missing-month check, it silently
//     yields a share above 1 and drags the mean.

/** The КФП feed's closed series vocabulary. Typed so a misspelling
 *  (`"eu_contribution"`) fails at compile time rather than at the run-time
 *  missing-observation guard. */
export type KfpSeries =
  | "revenue"
  | "expenditure"
  | "euContribution"
  | "balance"
  | "financing";

/** The three КФП flow sections the frame annualises, in the order of the feed's
 *  own identity `IV. Бюджетно салдо = I - II - III`. This is the ONE definition:
 *  the guard, the frame assembly, the thrown messages and the generator's
 *  summary all read it, so a fourth side cannot be added to the frame and then
 *  missed in a caption. Everything else in the feed is DERIVED from these
 *  (`balance` = I - II - III, `financing` = -balance) and must be recomputed,
 *  never extrapolated. */
export const FRAME_SIDES = [
  "revenue",
  "expenditure",
  "euContribution",
] as const;

export type FrameSide = (typeof FRAME_SIDES)[number];

/** "revenue - expenditure - euContribution", derived from `FRAME_SIDES` so the
 *  prose cannot drift from the arithmetic. */
export const BALANCE_FORMULA = FRAME_SIDES.join(" - ");

export interface KfpObservationLike {
  fiscalYear: number;
  period: string; // "YYYY-MM"
  series: KfpSeries;
  executed?: { amountEur: number } | null;
  planned?: { amountEur: number } | null;
}

export type FrameBasis = "law" | "interim" | "execution" | "carried";

export interface AnnualisedSeries {
  series: string;
  /** Months of the fiscal year observed so far. */
  throughMonth: number;
  ytdEur: number;
  /** Mean share of the full year landed by `throughMonth`, across the
   *  reference years. */
  shareMean: number;
  /** SAMPLE standard deviation (n-1). The population form is also positive and
   *  also plausible, so the tests pin the value, not just its sign. */
  shareStdDev: number;
  /** ytd / shareMean. */
  annualisedEur: number;
  /** Bounds from the min/max historical share — NOT a confidence interval,
   *  just the observed spread. */
  lowEur: number;
  highEur: number;
  /** The years the share was measured over. */
  referenceYears: number[];
}

/** Months a complete fiscal year must carry before its share-by-month can be
 *  used as a seasonal reference. See rule 4. */
const COMPLETE_YEAR_MONTHS = 12;

const monthOf = (period: string): number => Number(period.slice(5, 7));

const pick = (
  obs: KfpObservationLike[],
  year: number,
  series: string,
  month: number,
): number | null => {
  const row = obs.find(
    (o) =>
      o.fiscalYear === year &&
      o.series === series &&
      monthOf(o.period) === month,
  );
  return row?.executed?.amountEur ?? null;
};

/**
 * Share of a full year's execution landed by `month`, per reference year.
 * Returns only years that are COMPLETE (12 monthly observations for the
 * series — rule 4) and whose December is non-zero.
 */
export const monthShares = (
  obs: KfpObservationLike[],
  series: string,
  month: number,
  years: number[],
): { year: number; share: number }[] => {
  const out: { year: number; share: number }[] = [];
  for (const year of years) {
    // A partial year is NOT caught by the missing-month checks below: 2021
    // holds Jun–Dec, so both `at` and `dec` resolve and the "December" it
    // divides by is a half-year total, yielding a share near 1.
    const months = obs.filter(
      (o) => o.fiscalYear === year && o.series === series,
    ).length;
    if (months < COMPLETE_YEAR_MONTHS) continue;
    const at = pick(obs, year, series, month);
    const dec = pick(obs, year, series, 12);
    if (at == null || dec == null || dec === 0) continue;
    out.push({ year, share: at / dec });
  }
  return out;
};

/**
 * Annualise one series' year-to-date execution.
 *
 * `series` is deliberately typed `string` rather than `KfpSeries`: the guard
 * below is an allowlist whose whole job is to reject a series the feed adds
 * later, and a narrower type would make that case unreachable — including from
 * the tests.
 *
 * @throws when the series is not one of `FRAME_SIDES` — see rule 1. A caller
 *   that wants the balance must derive it from the three annualised sides.
 * @throws when the year-to-date observation is missing at `throughMonth`.
 * @throws when fewer than two reference years yield a usable share.
 */
export const annualiseSeries = (
  obs: KfpObservationLike[],
  opts: {
    series: string;
    year: number;
    throughMonth: number;
    referenceYears: number[];
  },
): AnnualisedSeries => {
  // An ALLOWLIST, not a denylist: a denylist fails open, so a derived series
  // the feed adds later (`primaryBalance`, a cash-vs-accrual variant) would be
  // silently annualisable and would reproduce this module's founding defect on
  // a new column.
  if (!(FRAME_SIDES as readonly string[]).includes(opts.series))
    throw new Error(
      `annualiseSeries: "${opts.series}" is not an annualisable КФП section ` +
        `and must not be annualised directly — only ${FRAME_SIDES.join(", ")} ` +
        `are flows. Anything else is derived from them and is a small ` +
        `difference of three large numbers whose seasonality does not survive ` +
        `the subtraction (measured share-by-May ranges 0.190–0.539 across ` +
        `2022–2025). Derive it: balance = ${BALANCE_FORMULA}.`,
    );

  const ytd = pick(obs, opts.year, opts.series, opts.throughMonth);
  if (ytd == null)
    throw new Error(
      `annualiseSeries: no ${opts.series} observation for ${opts.year}-${String(
        opts.throughMonth,
      ).padStart(2, "0")}`,
    );

  const shares = monthShares(
    obs,
    opts.series,
    opts.throughMonth,
    opts.referenceYears,
  );
  if (shares.length < 2)
    throw new Error(
      `annualiseSeries: need at least 2 reference years for ${opts.series} ` +
        `month ${opts.throughMonth}, got ${shares.length}`,
    );

  const values = shares.map((s) => s.share);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  const stdDev = Math.sqrt(variance);

  return {
    series: opts.series,
    throughMonth: opts.throughMonth,
    ytdEur: ytd,
    shareMean: mean,
    shareStdDev: stdDev,
    annualisedEur: ytd / mean,
    // A HIGHER share means the year was further along, so the annualised total
    // is LOWER — the bounds invert relative to the share.
    lowEur: ytd / Math.max(...values),
    highEur: ytd / Math.min(...values),
    referenceYears: shares.map((s) => s.year),
  };
};

export interface Fy2026Frame {
  fiscalYear: number;
  /** The last month EVERY side covers. */
  throughMonth: number;
  revenue: AnnualisedSeries;
  expenditure: AnnualisedSeries;
  /** „III. Вноска в общия бюджет на ЕС" — the third side of the КФП identity,
   *  a section of its own rather than part of `expenditure`. */
  euContribution: AnnualisedSeries;
  /** DERIVED — never annualised. `revenue - expenditure - euContribution`,
   *  the feed's own `IV = I - II - III`. See rule 1. */
  balanceEur: number;
  /** The band the three sides' own observed spreads imply — NOT a confidence
   *  interval, just the corners of the observed shares, the same basis as each
   *  side's low/high. Published because the balance is a difference of large
   *  numbers and AMPLIFIES each side's spread: measured 2026-06 the point is
   *  −€5.78bn inside −€8.45bn … −€2.94bn. Rule 2 applies most here.
   *
   *  The corners cross the sides: the LOW (worst) balance pairs the low revenue
   *  with the HIGH expenditure and the HIGH contribution. */
  balanceLowEur: number;
  balanceHighEur: number;
  /** True when the КФП feed carries a `planned` line for the year. False for
   *  2026 until the ЗДБРБ reaches the feed, which is why plan-vs-actual has to
   *  degrade rather than render an empty comparison. */
  hasPlan: boolean;
}

/**
 * Assemble the FY2026 frame from КФП monthly execution.
 *
 * @param obs - Every КФП observation available; reference-year rows supply the
 *   seasonal share, `opts.year` rows the year-to-date.
 * @param opts.year - The (partial) fiscal year being framed.
 * @param opts.referenceYears - Years the seasonality is measured over.
 *   Incomplete years are rejected by `monthShares` (rule 4), so passing 2021
 *   costs a reference year rather than corrupting the share.
 * @returns The three annualised sides, each with its band, plus the DERIVED
 *   balance and its band — `revenue - expenditure - euContribution`, the feed's
 *   own `IV = I - II - III`.
 * @throws When `opts.year` has no observations at all for one of the sides.
 * @throws When a side is missing at `throughMonth`. Deliberate: a silent zero
 *   on `euContribution` reads as "Bulgaria paid nothing into the EU budget" and
 *   shrinks the deficit by the whole contribution (€1.19bn at 2026-06) — the
 *   defect this side was added to fix.
 * @throws When fewer than two complete reference years yield a usable share:
 *   one year gives a band of zero width, which reads as certainty.
 * @throws When the feed's own published `balance` disagrees with
 *   `I - II - III` by more than €1,000 — the section split has changed.
 */
export const buildFy2026Frame = (
  obs: KfpObservationLike[],
  opts: { year: number; referenceYears: number[] },
): Fy2026Frame => {
  const monthsPerSide = FRAME_SIDES.map((side) =>
    obs
      .filter((o) => o.fiscalYear === opts.year && o.series === side)
      .map((o) => monthOf(o.period)),
  );
  const absent = FRAME_SIDES.filter((_, i) => monthsPerSide[i].length === 0);
  if (absent.length > 0)
    throw new Error(
      `buildFy2026Frame: no ${opts.year} observations for ${absent.join(", ")}`,
    );
  // The last month EVERY side covers. A one-month lag on a single section must
  // narrow the frame, not wedge the generator into never regenerating at all —
  // a generator that cannot run leaves the previous month's artifact served
  // with nobody told, which is loud on stdout and silent on the page.
  const throughMonth = Math.min(...monthsPerSide.map((m) => Math.max(...m)));

  const common = {
    year: opts.year,
    throughMonth,
    referenceYears: opts.referenceYears,
  };
  const revenue = annualiseSeries(obs, { ...common, series: "revenue" });
  const expenditure = annualiseSeries(obs, {
    ...common,
    series: "expenditure",
  });
  const euContribution = annualiseSeries(obs, {
    ...common,
    series: "euContribution",
  });

  // The feed publishes the answer, so check it rather than trusting the section
  // split: `IV = I - II - III` holds to €1 across all 60 periods. This is the
  // gate a synthetic fixture cannot be — it catches the feed re-scoping its
  // sections (euContribution folded into "II. Разходи и трансфери" would make
  // us double-subtract, producing a bigger deficit that is still plausible and
  // still passes every unit test). `!= null` so a feed that stops publishing
  // `balance` degrades rather than wedging.
  const publishedBalance = pick(obs, opts.year, "balance", throughMonth);
  if (publishedBalance != null) {
    const residual =
      revenue.ytdEur -
      expenditure.ytdEur -
      euContribution.ytdEur -
      publishedBalance;
    if (Math.abs(residual) > 1000)
      throw new Error(
        `buildFy2026Frame: КФП identity IV = I - II - III does not hold at ` +
          `${opts.year}-${String(throughMonth).padStart(2, "0")} — residual ` +
          `€${residual.toFixed(0)}. The feed's section split has changed; ` +
          `re-derive which sections the balance subtracts before trusting ` +
          `this frame.`,
      );
  }

  const hasPlan = obs.some(
    (o) => o.fiscalYear === opts.year && o.planned?.amountEur != null,
  );

  return {
    fiscalYear: opts.year,
    throughMonth,
    revenue,
    expenditure,
    euContribution,
    balanceEur:
      revenue.annualisedEur -
      expenditure.annualisedEur -
      euContribution.annualisedEur,
    balanceLowEur:
      revenue.lowEur - expenditure.highEur - euContribution.highEur,
    balanceHighEur:
      revenue.highEur - expenditure.lowEur - euContribution.lowEur,
    hasPlan,
  };
};
