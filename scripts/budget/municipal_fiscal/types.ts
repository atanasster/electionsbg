// Shared types for the per-município financial-indicators pillar (ЗПФ чл. 130г
// ал. 2 — „Финансови показатели за общините").
//
// Three nested liability stocks, and keeping them apart is the whole point of
// this module. From outermost to innermost:
//
//   commitments        поети ангажименти за разходи — CONTRACTED and unperformed
//                      at period end, due for execution in whole or in part in
//                      following budget years (МФ's wording, data.europa.eu
//                      dataset 4229). Source: end balance of сметка 9200.
//   expenseObligations задължения за разходи — INVOICED, not yet past term.
//                      Раздел 4 СБО, excluding personnel, pensions, debt
//                      interest, taxes and public receivables. Computed by МФ.
//   arrears            просрочени задължения — OVERDUE. Задбалансови сметки
//                      9921–9929, SELF-REPORTED by the município. Not audited,
//                      and one of the six чл. 130а criteria (three or more must
//                      be met before a município is „в финансови затруднения") —
//                      so the party a finding falls on is the one that files it.
//
// Any label that says „задължения" without saying WHICH re-creates the exact
// confusion this pillar exists to end.

export interface Money {
  /** Native amount as published: BGN through 2025, EUR from 2026. */
  amount: number;
  currency: "BGN" | "EUR";
  /** Always EUR, so a series spanning the changeover is comparable. The
   *  currency-board rate is locked, so this is exact, not an approximation. */
  amountEur: number;
}

/** Which denominator the SOURCE used for a published ratio. The workbook
 *  switches this by quarter — планирани разходи in Q1–Q3, отчетени (arrears) or
 *  средногодишни-4г (obligations, commitments) at Q4 — so the three columns of
 *  one ratio group are NOT a time series, and only the Q4 column is the actual
 *  чл. 130а criterion. Stored so a consumer cannot chart across the break. */
export type RatioBasis = "planned" | "actual" | "avg4y";

/** The basis is PER RATIO, not per row: at year-end arrears divide by actual
 *  expenditure while obligations and commitments divide by the 4-year average.
 *  A single scalar collapses that distinction and sends a consumer re-deriving
 *  levels to the wrong denominator. */
export interface RatioBases {
  arrears: RatioBasis;
  obligations: RatioBasis;
  commitments: RatioBasis;
}

/** The eight РМС 436/2017 financial-sustainability indicators (workbook cols
 *  3–29). Percentages are stored as PERCENT (the workbook holds fractions);
 *  the two level indicators keep their published units. */
export interface Rms436Indicators {
  /** 1. Дял на приходите от общите постъпления (%). */
  revenueSharePct: number | null;
  /** 2. Покритие на разходите за местни дейности с приходи (%). */
  localCoveragePct: number | null;
  /** 3. Бюджетно салдо спрямо общите постъпления (%). */
  balanceSharePct: number | null;
  /** 4.1 Размер на ДЪЛГА (the stock) as % of own revenue + equalizing subsidy.
   *  NOTE this is not чл. 130а ал. 1 т. 1, which is about debt SERVICE
   *  (плащания) rather than the stock. Different question, similar name. */
  debtToOwnRevenuePct: number | null;
  /** 4.2 Размер на дълга на човек от населението (лв./човек, НСИ population). */
  debtPerCapita: number | null;
  /** 5. Просрочени задължения as % of own revenue + equalizing subsidy —
   *  a DIFFERENT ratio from `ratios.arrearsPct`, whose denominator is
   *  expenditure. Same stock, two denominators; do not substitute one. */
  arrearsToOwnRevenuePct: number | null;
  /** 6. Население на един общински служител (бр.). */
  populationPerEmployee: number | null;
  /** 7. Дял на разходите за заплати и осигуровки в общите разходи (%). */
  wageSharePct: number | null;
  /** 8. Дял на капиталовите разходи в общите разходи (%). */
  capitalSharePct: number | null;
}

/** Local-tax collection, published for the year-end quarter only. */
export interface CollectionRates {
  /** Събираемост на данък върху недвижимите имоти (%). */
  dniPct: number | null;
  /** Събираемост на данък върху превозните средства (%). */
  dprsPct: number | null;
  /** Осреднена събираемост на двата данъка (%) — the чл. 130а ал. 1 т. 6 value,
   *  compared against the national mean for that year. */
  avgPct: number | null;
}

export interface MunicipalFiscalQuarter {
  /** МФ/ЕБК code as published (col A) — the SOURCE key, kept for provenance. */
  mfCode: number;
  /** Resolved canonical obshtina code; `SOF00` for Sofia (synthetic). */
  obshtina: string;
  /** Col B, as published — pins the spelling the crosswalk resolved. */
  nameBg: string;
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;

  // --- the three stocks -------------------------------------------------
  commitments: Money | null;
  expenseObligations: Money | null;
  arrears: Money | null;

  // --- the fiscal position, all published as LEVELS ---------------------
  /** Приходи по чл. 45 ал. 1 т. 1 ЗПФ (без §46, §47, §48). */
  revenue: Money | null;
  /** Разходи по чл. 45 ал. 1 т. 2 ЗПФ (без §19). Also the denominator the
   *  source uses for the Q4 arrears ratio — verified exact across the corpus. */
  expenditure: Money | null;
  budgetBalance: Money | null;
  /** Налични средства (вкл. преводи в процес на сетълмент) — the município's
   *  own cash position. Comparable in spirit to the national фискален резерв,
   *  but not defined against it: different scope, different statutory basis. */
  cashOnHand: Money | null;
  debtStock: Money | null;

  // --- published ratios, as PERCENT ------------------------------------
  ratios: {
    /** Просрочени задължения ÷ разходи. Q4 basis = `actual`. */
    arrearsPct: number | null;
    /** Задължения за разходи ÷ разходи. Q4 basis = `avg4y` (чл. 130а т. 2). */
    obligationsPct: number | null;
    /** Поети ангажименти ÷ разходи. Q4 basis = `avg4y` (чл. 130а т. 3). */
    commitmentsPct: number | null;
  };
  ratioBasis: RatioBases;

  /** Средногодишни отчетени разходи за последните 4 години — NOT published as a
   *  column. Recovered as `commitments ÷ commitmentsPct` on year-end rows,
   *  which is the чл. 130а т. 2/т. 3 denominator. Null off Q4 and whenever
   *  either input is missing; never guessed. */
  expenditureAvg4yEur: number | null;

  indicators: Rms436Indicators;
  /** Present only on the quarter the workbook publishes it (the year-end one). */
  collection: CollectionRates | null;

  /** From the SEPARATE „общини фин. оздр." sheet — an administratively recorded
   *  state, NEVER derived from the criteria. Meeting ≥3 чл. 130а criteria
   *  OBLIGES a município to open a чл. 130д procedure; being IN one persists
   *  across years, can begin the year after, and can continue after the criteria
   *  stop being met. Conflating them mislabels municipalities in both
   *  directions on a page that names them. */
  inRecoveryProcedure: boolean;

  sourceFile: string;
}

export interface MunicipalFiscalPeriod {
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;
  /** As published in the workbook's header row, e.g. "2024 Q4". */
  label: string;
}

export interface ParsedWorkbook {
  periods: MunicipalFiscalPeriod[];
  rows: MunicipalFiscalQuarter[];
  /** МФ codes seen in the workbook, for `diffRoster`. */
  mfCodes: number[];
  /** Non-fatal problems worth reporting: unresolved codes, out-of-range values. */
  warnings: string[];
}
