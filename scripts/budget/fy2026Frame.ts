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
// THREE RULES, all measured rather than assumed:
//
//  1. Annualise revenue and expenditure SEPARATELY and derive the balance.
//     The balance's own share-by-month is not stable — measured across
//     2022-2025 it ranges 0.190 to 0.539 for May, because it is a small
//     difference of two large numbers and the seasonality does not survive the
//     subtraction. Annualising it directly produces a number with no meaning.
//
//  2. Publish the BAND, not just the point. The share-by-month has a standard
//     deviation of ~1.1-1.6pp, which is ±€0.8-1.7bn on the annualised figure.
//     A simulator whose levers move tens of millions must not present a
//     baseline with a billion-euro band as a hard number.
//
//  3. There is no 2026 `planned` line and will not be one until the ЗДБРБ.
//     Confirmed against the feed: every 2026 observation has planned: null,
//     where 2025 carries a full plan. Plan-vs-actual must degrade, not blank.

export interface KfpObservationLike {
  fiscalYear: number;
  period: string; // "YYYY-MM"
  series: string;
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
 * Returns only years where both the month and December are present and
 * December is non-zero.
 */
export const monthShares = (
  obs: KfpObservationLike[],
  series: string,
  month: number,
  years: number[],
): { year: number; share: number }[] => {
  const out: { year: number; share: number }[] = [];
  for (const year of years) {
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
 * @throws when the series is `balance` — see rule 1. A caller that wants the
 *   balance must derive it from the two annualised sides.
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
  if (opts.series === "balance" || opts.series === "financing")
    throw new Error(
      `annualiseSeries: "${opts.series}" must not be annualised directly — it ` +
        `is a difference of two large numbers and its seasonality does not ` +
        `survive the subtraction (measured share-by-May ranges 0.190–0.539 ` +
        `across 2022–2025). Annualise revenue and expenditure and subtract.`,
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
  /** The last month of 2026 with an observation. */
  throughMonth: number;
  revenue: AnnualisedSeries;
  expenditure: AnnualisedSeries;
  /** DERIVED — never annualised. See rule 1. */
  balanceEur: number;
  /** True when the КФП feed carries a `planned` line for the year. False for
   *  2026 until the ЗДБРБ is promulgated, which is why plan-vs-actual has to
   *  degrade rather than render an empty comparison. */
  hasPlan: boolean;
}

/** Assemble the frame. `referenceYears` are the complete years the seasonality
 *  is measured over. */
export const buildFy2026Frame = (
  obs: KfpObservationLike[],
  opts: { year: number; referenceYears: number[] },
): Fy2026Frame => {
  const months = obs
    .filter((o) => o.fiscalYear === opts.year && o.series === "revenue")
    .map((o) => monthOf(o.period));
  if (months.length === 0)
    throw new Error(`buildFy2026Frame: no ${opts.year} revenue observations`);
  const throughMonth = Math.max(...months);

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

  const hasPlan = obs.some(
    (o) => o.fiscalYear === opts.year && o.planned?.amountEur != null,
  );

  return {
    fiscalYear: opts.year,
    throughMonth,
    revenue,
    expenditure,
    balanceEur: revenue.annualisedEur - expenditure.annualisedEur,
    hasPlan,
  };
};
