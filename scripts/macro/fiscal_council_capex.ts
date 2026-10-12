// Capital-expenditure execution against plan, 2015–2024 — the Фискален съвет
// analysis „Анализ на публичните инвестиционни разходи в България 2015-2024"
// (published 2026-10-12). Two series, plotted on /indicators/fiscal:
//
//   capexExecStateBudget  — ДБ (state budget) only, executed vs the UPDATED
//                           plan (the year's last ЗДБРБ amendment). Appendix 1.
//   capexExecKfp          — КФП (consolidated programme: municipalities, EU
//                           funds, social funds included), executed vs the
//                           annual plan. Appendix 3.
//
// The appendix tables are images in the PDF, so these figures are transcribed
// by hand. That is why the NOMINAL amounts are stored and the percentage is
// derived from them: `fiscal_council_capex.test.ts` re-derives every percentage
// and both of the report's headline shortfalls (6,383.3 / 15,296 млн. лв.) from
// these rows, so a mistyped digit fails a test instead of shipping a wrong bar.
//
// Two things about the source worth knowing before quoting it:
//
//   - The ДБ table in Appendix 1 starts at 2017. 2015 and 2016 are the sums of
//     the two line items in Appendix 2 (ДМА + основен ремонт, капиталови
//     трансфери); both reproduce the report's own 74.4% / 78.6% and the
//     219.8 / 537 млн. shortfalls its text names.
//   - Appendix 3 prints the SAME executed КФП figure, 3,871.5 млн. лв., for
//     2016 and 2021. Each row is internally consistent (plan − executed =
//     the printed shortfall, and the printed %), and both are plausible against
//     the printed capex/GDP share (4.2% and 2.9%), so it is transcribed as
//     printed — but one of them may be a copy error in the source.
//
// The ДБ series OVERLAPS our own КФП ingest for 2021–2024 and agrees within a
// point (31.4 / 73.5 / 109.6 / 48.9 vs 31.5 / 73.8 / 108.8 / 48.9); the gap is
// the plan basis — the council uses the updated plan, the monthly report's
// „Закон" column. It is kept as a separate, attributed series rather than
// merged into ours for that reason.
//
// Amounts are BGN millions as published (pre-euro years); only the derived
// percentage is served, so no currency conversion is involved.

/** An annual macro.json point — the shape `fetch_eurostat.ts` writes. */
type MacroPoint = { year: number; value: number };

export const FISCAL_COUNCIL_CAPEX_URL =
  "https://www.fiscal-council.bg/bg/publikacii/analiz-na-publichnite-investicionni-razhodi-v-bulgaria-2015-2024";

export type CapexRow = {
  year: number;
  /** млн. лв. — the plan the council measures against. */
  planBgnM: number;
  /** млн. лв. — reported (отчет) capital expenditure. */
  executedBgnM: number;
  /** The percentage the council printed, kept to check the derivation. */
  publishedPct: number;
};

/** ДБ, executed vs the updated plan. 2015–2016 from Appendix 2 (see header). */
export const STATE_BUDGET_CAPEX: CapexRow[] = [
  { year: 2015, planBgnM: 858.6, executedBgnM: 638.8, publishedPct: 74.4 },
  { year: 2016, planBgnM: 2511.9, executedBgnM: 1974.9, publishedPct: 78.6 },
  { year: 2017, planBgnM: 2076.9, executedBgnM: 1686.1, publishedPct: 81.2 },
  { year: 2018, planBgnM: 2243.0, executedBgnM: 2471.8, publishedPct: 110.2 },
  { year: 2019, planBgnM: 4593.2, executedBgnM: 4306.9, publishedPct: 93.8 },
  { year: 2020, planBgnM: 3247.8, executedBgnM: 1988.8, publishedPct: 61.2 },
  { year: 2021, planBgnM: 2444.7, executedBgnM: 769.5, publishedPct: 31.5 },
  { year: 2022, planBgnM: 3144.8, executedBgnM: 2319.5, publishedPct: 73.8 },
  { year: 2023, planBgnM: 3515.6, executedBgnM: 3824.1, publishedPct: 108.8 },
  { year: 2024, planBgnM: 3377.2, executedBgnM: 1649.9, publishedPct: 48.9 },
];

/** КФП, executed vs the annual plan. Appendix 3. */
export const KFP_CAPEX: CapexRow[] = [
  { year: 2015, planBgnM: 6419.8, executedBgnM: 6899.7, publishedPct: 107.5 },
  { year: 2016, planBgnM: 6149.7, executedBgnM: 3871.5, publishedPct: 63.0 },
  { year: 2017, planBgnM: 6244.3, executedBgnM: 3749.7, publishedPct: 60.0 },
  { year: 2018, planBgnM: 6076.0, executedBgnM: 5325.7, publishedPct: 87.7 },
  { year: 2019, planBgnM: 8462.2, executedBgnM: 7561.5, publishedPct: 89.4 },
  { year: 2020, planBgnM: 6979.0, executedBgnM: 5089.4, publishedPct: 72.9 },
  { year: 2021, planBgnM: 6281.0, executedBgnM: 3871.5, publishedPct: 61.6 },
  { year: 2022, planBgnM: 8448.1, executedBgnM: 5706.6, publishedPct: 67.5 },
  { year: 2023, planBgnM: 8211.9, executedBgnM: 9201.3, publishedPct: 112.0 },
  { year: 2024, planBgnM: 10103.3, executedBgnM: 6802.4, publishedPct: 67.3 },
];

export const executionPct = (r: CapexRow): number =>
  Math.round((r.executedBgnM / r.planBgnM) * 1000) / 10;

const toSeries = (rows: CapexRow[]): MacroPoint[] =>
  rows.map((r) => ({ year: r.year, value: executionPct(r) }));

export type FiscalCouncilCapexIndicator = {
  source: "curated";
  key: "capexExecStateBudget" | "capexExecKfp";
  cadence: "annual";
  sourceUrl: string;
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  attributionEn: string;
  attributionBg: string;
  series: MacroPoint[];
};

const ATTRIBUTION_EN =
  "Fiscal Council of Bulgaria — Analysis of public investment expenditure in Bulgaria 2015–2024 (2026), from МФ and Сметна палата execution reports";
const ATTRIBUTION_BG =
  "Фискален съвет — Анализ на публичните инвестиционни разходи в България 2015–2024 (2026), по отчети на МФ и Сметната палата";

/** Both entries, fully built. Shared by `fetch_eurostat.ts` (the durable
 *  writer of macro.json) and `patch_fiscal_council_capex.ts`. */
export const fiscalCouncilCapexIndicators =
  (): FiscalCouncilCapexIndicator[] => [
    {
      source: "curated",
      key: "capexExecStateBudget",
      cadence: "annual",
      sourceUrl: FISCAL_COUNCIL_CAPEX_URL,
      titleEn: "Capital spending executed — state budget",
      titleBg: "Изпълнение на капиталовите разходи — държавен бюджет",
      unitLabelEn: "% of the updated plan (Fiscal Council)",
      unitLabelBg: "% от актуализирания план (Фискален съвет)",
      attributionEn: ATTRIBUTION_EN,
      attributionBg: ATTRIBUTION_BG,
      series: toSeries(STATE_BUDGET_CAPEX),
    },
    {
      source: "curated",
      key: "capexExecKfp",
      cadence: "annual",
      sourceUrl: FISCAL_COUNCIL_CAPEX_URL,
      titleEn: "Capital spending executed — consolidated programme (КФП)",
      titleBg: "Изпълнение на капиталовите разходи — КФП",
      unitLabelEn: "% of the annual plan (Fiscal Council)",
      unitLabelBg: "% от годишния план (Фискален съвет)",
      attributionEn: ATTRIBUTION_EN,
      attributionBg: ATTRIBUTION_BG,
      series: toSeries(KFP_CAPEX),
    },
  ];
