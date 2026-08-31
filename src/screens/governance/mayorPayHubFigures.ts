// The /governance/mayor-pay head's KPI band, as a pure function over the ranking rows.
//
// Out of the component for the reason `budgetHubFigures.ts`, `fundsHubFigures.ts`,
// `consumptionHubFigures.ts`, `subsidiesHubFigures.ts`, `declarationsHubFigures.ts`,
// `cultureHubFigures.ts`, `sectorsHubFigures.ts` and `indicatorsHubFigures.ts` are: a band
// built inline is unreachable from `hubHead.gates.test.ts`, whose band/tile clause compares
// band values against tile metrics as rendered strings.
//
// ⚠️ AND FOR A SECOND REASON THIS ONE LEARNED THE HARD WAY. `COUNTED_WAITS` in
// `scripts/prerender/ogAndSitemapCoverage.test.ts` pins how many `data-kpi-cell`s this
// card's Playwright capture must wait for, and its own rule is that the number is DERIVED
// from the band wherever the band is a declared array — `analysis-hub` and `reports-hub`
// read `ANALYSIS_BAND.length` / `REPORTS_BAND.length`, while the two payload-shaped bands
// are literals because they have no array to read. This band was a four-element array
// literal inside the screen, i.e. exactly the case the rule points at, and the gate held a
// hand-copied `4` anyway.
//
// That copy fails in the ugly direction: drop to three cells and the gate stays GREEN (its
// assertion is `hops >= cells - 1`), while the capture SELECTOR still demands four siblings
// and never resolves — so `captureOne` throws, the runner keeps the PREVIOUS card, and the
// only signal is a line of stderr. Exporting the builder makes `MAYOR_PAY_BAND_CELLS` the
// one place that number lives.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ FOUR FIGURES ON THREE DIFFERENT BASES, AND NONE OF THEM IS A SALARY.
//
// The corpus is the declared annual income from EMPLOYMENT (`доход от трудово
// възнаграждение`) on each mayor's own filing — not a household income, not a pay scale,
// and not a figure anybody publishes as a salary. So every cell here carries what it is of:
// coverage is „общини с налична стойност" out of all municipalities, the year cell says how
// many of them filed for it, and BOTH medians say they are taken over each mayor's LATEST
// filing, which means the rows behind them can span different years.
//
// The per-1000-residents median is the one most easily misread, and its basis says so in
// words: dividing one person's declared income by the population of the place they govern
// is CONTEXT — it puts Челопеч's 1,456 residents beside Sofia's — and never a judgement
// about whether the income is high.
//
// ⚠️⚠️ CELLS 1 AND 2 COUNT DIFFERENT SETS AND MUST NOT SHARE A SENTENCE SHAPE. Cell 1 is
// „has a resolved labour-income row" over every municipality; cell 2 is „filed for the
// dominant year". Today both are 249 of 259 — a coincidence, since `mayor_pay_ranking()`
// takes each mayor's LATEST filing whatever its year, so a mayor who filed for a NEWER year
// is in cell 1 and not in cell 2. Rendered as two „N от M"s ~200px apart they read as one
// restated fact, which is the defect `8d378e10b0` already shipped once („the coverage line
// claimed 249 filings for a year 2 mayors have filed"). So cell 2's basis names its YEAR
// cohort and carries no denominator — there is deliberately no `total` in that call, and the
// gate below feeds the two cells distinguishable numbers so a re-conflation fails.
//
// The same rule retired the head's `kpiNote`'s first sentence: it restated cell 1 in cell
// 1's own words, a third print of one figure. What is left there is the only thing the band
// cannot say — that the rows can span years.
// ═══════════════════════════════════════════════════════════════════════════════════════

import type { HubKpi } from "@/ux/infographic/HubHead";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The most-filed fiscal year in the corpus, with how many municipalities filed for it.
 *  Ties broken by the LATER year, so a corpus half-way through a filing season names the
 *  season it is entering rather than the one it is leaving. */
export interface DominantYear {
  fiscalYear: number;
  count: number;
}

/** How many cells this band renders when it renders at all.
 *
 *  ⚠️ READ BY THE OG CAPTURE GATE — see this file's header. It is a constant rather than
 *  `mayorPayHubKpis(...).length` because the gate needs it without constructing a band, and
 *  `mayorPayHubKpis` is gated below so the two cannot disagree. */
export const MAYOR_PAY_BAND_CELLS = 4;

/** The head's four figures.
 *
 *  ⚠️ ALL-OR-NOTHING, unlike every sibling band, and that is a property of the SOURCE rather
 *  than a shortcut. The other hubs withhold a cell whose basis has no publishable value; here
 *  all four are derived from one corpus — the count, its dominant year and two medians over
 *  it — so either the corpus loaded or it did not. An empty band is „no data yet"; there is
 *  no state in which three of these four are knowable.
 *
 *  ⚠️ A NULL MEDIAN RENDERS „—", NOT ZERO, and the distinction matters more here than usual:
 *  „€0 медианен доход" would be a claim about what mayors are paid. */
export const mayorPayHubKpis = (
  /** Every municipality in the ranking, whether or not it carries an income figure. */
  totalRows: number,
  /** Those with a resolved declared income — the numerator of the coverage cell. */
  withIncomeRows: number,
  dominantYear: DominantYear | null,
  medianIncome: number | null,
  medianPerThousand: number | null,
  t: T,
  /** Formats a euro figure, or „—" for null. The screen's own formatter, passed in rather
   *  than imported, so the band cannot format money differently from the table below it. */
  eur: (value: number | null) => string,
): HubKpi[] =>
  totalRows === 0
    ? []
    : [
        {
          value: `${withIncomeRows}/${totalRows}`,
          label: t("mp_kpi_coverage"),
          basis: t("mp_kpi_coverage_detail"),
        },
        {
          value: dominantYear ? String(dominantYear.fiscalYear) : "—",
          label: t("mp_kpi_dominant_year"),
          basis: t("mp_kpi_dominant_year_detail", {
            count: dominantYear?.count ?? 0,
            year: dominantYear?.fiscalYear ?? 0,
          }),
        },
        {
          value: eur(medianIncome),
          label: t("mp_kpi_median_income"),
          basis: t("mp_kpi_median_income_detail"),
        },
        {
          value: eur(medianPerThousand),
          label: t("mp_kpi_median_per_thousand"),
          basis: t("mp_kpi_median_per_thousand_detail"),
        },
      ];
