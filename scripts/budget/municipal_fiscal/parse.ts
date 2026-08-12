// Parser for МФ's „Финансови показатели за общините" workbook (ЗПФ чл. 130г
// ал. 2), sheet „показатели".
//
// Layout, verified against the 2025 releases (see the README in
// data/_cache/minfin_municipal_fiscal/):
//
//   row 1  indicator title, on the first column of each group (sometimes on all
//          three — do not rely on it being merged)
//   row 2  period label per column, e.g. "2024 Q3"
//   row 3+ one row per община; col A = МФ/ЕБК code, col B = name
//
//   cols 3–62   20 indicator groups × 3 columns, one per period, in the
//               workbook's own prev / final / current order
//   cols 63–65  collection rates — SINGLE columns, all on the year-end period
//
// **Periods come from row 2, never from the filename.** The filename encodes the
// same three quarters (T7.1 of the plan) but the naming rule is derived from two
// samples and is not guaranteed to hold for older releases, so it is a
// cross-check at most.
//
// **The published ratios are FRACTIONS** (0.01355 = 1.355%) and their denominator
// SWITCHES by quarter: планирани разходи in Q1–Q3, отчетени разходи (arrears) or
// средногодишни разходи за 4 г. (obligations, commitments) at Q4. Only the Q4
// column is the actual чл. 130а criterion, so the three columns of one ratio
// group are not a time series. `ratioBasis` records which.

import { BGN_PER_EUR } from "../../../src/lib/currency";
import { buildCrosswalk, loadMunicipalities, type MuniRef } from "./codes";
import type {
  CollectionRates,
  Money,
  MunicipalFiscalPeriod,
  MunicipalFiscalQuarter,
  ParsedWorkbook,
  RatioBases,
  Rms436Indicators,
} from "./types";

/** 1-based first column of each 3-wide group, in workbook order. */
const GROUP = {
  revenueShare: 3,
  localCoverage: 6,
  balanceShare: 9,
  debtToOwnRevenue: 12,
  debtPerCapita: 15,
  arrearsToOwnRevenue: 18,
  populationPerEmployee: 21,
  wageShare: 24,
  capitalShare: 27,
  revenue: 30,
  expenditure: 33,
  budgetBalance: 36,
  cashOnHand: 39,
  debtStock: 42,
  arrears: 45,
  expenseObligations: 48,
  commitments: 51,
  arrearsRatio: 54,
  obligationsRatio: 57,
  commitmentsRatio: 60,
} as const;

/** Single-column fields, all on the year-end period. */
const COLLECTION_COL = { dni: 63, dprs: 64, avg: 65 } as const;

const HEADER_ROWS_POKAZATELI = 2;
/** The recovery sheet carries two extra marker rows above the same header. */
const HEADER_ROWS_RECOVERY = 4;

const PERIOD_RE = /^(20\d{2})\s*Q([1-4])$/;

export const parsePeriodLabel = (
  raw: unknown,
): MunicipalFiscalPeriod | null => {
  const label = String(raw ?? "").trim();
  const m = PERIOD_RE.exec(label);
  if (!m) return null;
  return {
    fiscalYear: Number(m[1]),
    quarter: Number(m[2]) as 1 | 2 | 3 | 4,
    label,
  };
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Anything non-scalar (`[]` coerces to "") must not become 0. The whitespace
  // strip has to run BEFORE the emptiness check, or " " falls through to
  // Number("") === 0 — a fabricated zero in a field where zero is a legally
  // meaningful чл. 130а value.
  if (typeof v !== "string") return null;
  const stripped = v.replace(/\s/g, "");
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
};

/** Published fractions → percent. */
const pct = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : n * 100;
};

const money = (v: unknown, currency: "BGN" | "EUR"): Money | null => {
  const n = num(v);
  if (n == null) return null;
  return {
    amount: n,
    currency,
    amountEur: currency === "EUR" ? n : n / BGN_PER_EUR,
  };
};

/** BGN through 2025, EUR from 2026 — the workbook states this explicitly. */
export const currencyForYear = (fiscalYear: number): "BGN" | "EUR" =>
  fiscalYear >= 2026 ? "EUR" : "BGN";

/** Which denominator the source used, PER RATIO. At Q4 the three do not share
 *  one: arrears divides by ACTUAL expenditure (чл. 130а т. 4) while obligations
 *  and commitments divide by the 4-year average (т. 2 / т. 3) — the workbook
 *  says so in its own column titles, and it is measurable: for all 121 Q4 rows
 *  with non-zero arrears the implied denominator equals `expenditure` and
 *  matches the derived 4-year average in none of them. A single scalar here
 *  sends a consumer re-deriving levels to the wrong denominator silently. */
export const ratioBasisFor = (quarter: 1 | 2 | 3 | 4): RatioBases =>
  quarter === 4
    ? { arrears: "actual", obligations: "avg4y", commitments: "avg4y" }
    : { arrears: "planned", obligations: "planned", commitments: "planned" };

const UNIT_RE = /\(\s*в\s*(лв\.?|лева|евро|eur)\s*\)/iu;

/** The unit МФ declares in the row-1 group title. One label governs that group's
 *  three period columns, so the unit is a property of the GROUP, not of the
 *  period — which is why `currencyForYear` can only ever be a fallback. */
export const currencyFromTitle = (title: unknown): "BGN" | "EUR" | null => {
  const m = UNIT_RE.exec(String(title ?? ""));
  if (!m) return null;
  return /евро|eur/i.test(m[1]) ? "EUR" : "BGN";
};

/** Read row 2 and return the distinct periods in column order. Every 3-wide
 *  group repeats the same sequence, so the first group defines it. */
export const readPeriods = (
  headerRow: readonly unknown[],
): MunicipalFiscalPeriod[] => {
  const out: MunicipalFiscalPeriod[] = [];
  for (let c = GROUP.revenueShare; c < GROUP.revenueShare + 3; c++) {
    const p = parsePeriodLabel(headerRow[c - 1]);
    if (p) out.push(p);
  }
  return out;
};

export interface ParseOptions {
  sourceFile: string;
  /** Injected for testing; defaults to the committed crosswalk. */
  crosswalk?: Map<number, string>;
  municipalities?: MuniRef[];
  /** МФ codes in формално финансово оздравяване, from the sibling sheet. */
  inRecovery?: ReadonlySet<number>;
}

/** Extract the МФ codes on the „общини фин. оздр." sheet — the official чл. 130д
 *  recovery list. Never derived from the criteria; see types.ts. */
export const parseRecoverySheet = (rows: readonly unknown[][]): Set<number> => {
  const out = new Set<number>();
  for (const r of rows.slice(HEADER_ROWS_RECOVERY)) {
    const mf = num(r?.[0]);
    if (mf != null) out.add(mf);
  }
  return out;
};

const indicatorsAt = (r: readonly unknown[], i: number): Rms436Indicators => ({
  revenueSharePct: pct(r[GROUP.revenueShare - 1 + i]),
  localCoveragePct: pct(r[GROUP.localCoverage - 1 + i]),
  balanceSharePct: pct(r[GROUP.balanceShare - 1 + i]),
  debtToOwnRevenuePct: pct(r[GROUP.debtToOwnRevenue - 1 + i]),
  debtPerCapita: num(r[GROUP.debtPerCapita - 1 + i]),
  arrearsToOwnRevenuePct: pct(r[GROUP.arrearsToOwnRevenue - 1 + i]),
  populationPerEmployee: num(r[GROUP.populationPerEmployee - 1 + i]),
  wageSharePct: pct(r[GROUP.wageShare - 1 + i]),
  capitalSharePct: pct(r[GROUP.capitalShare - 1 + i]),
});

/** Средногодишни разходи за 4 г. — the чл. 130а т. 2/т. 3 denominator, which the
 *  workbook does not publish. Recovered from the commitments pair, falling back
 *  to the obligations pair; null when neither can supply it. Year-end only,
 *  because only there does the ratio use that denominator. */
export const deriveAvg4y = (
  row: Pick<
    MunicipalFiscalQuarter,
    "commitments" | "expenseObligations" | "ratios" | "quarter"
  >,
): number | null => {
  if (row.quarter !== 4) return null;
  const pairs: [Money | null, number | null][] = [
    [row.commitments, row.ratios.commitmentsPct],
    [row.expenseObligations, row.ratios.obligationsPct],
  ];
  for (const [m, p] of pairs) {
    // The money leg needs its own guard: a zero commitments cell would return 0
    // AND suppress the valid obligations fallback, and a negative one would
    // return a negative denominator.
    if (m && m.amountEur > 0 && p != null && p > 0)
      return (m.amountEur / p) * 100;
  }
  return null;
};

export const parsePokazateli = (
  rows: readonly unknown[][],
  opts: ParseOptions,
): ParsedWorkbook => {
  const warnings: string[] = [];
  const header = rows[HEADER_ROWS_POKAZATELI - 1] ?? [];
  const periods = readPeriods(header);
  if (periods.length !== 3) {
    throw new Error(
      `municipal_fiscal: expected 3 period columns in header row ${HEADER_ROWS_POKAZATELI}, got ${periods.length}` +
        ` (${periods.map((p) => p.label).join(", ") || "none parsed"})`,
    );
  }

  // Group 1 defines the period sequence; every other group must repeat it. The
  // evidence is already in the header row being read, and an unchecked
  // extrapolation here is exactly the off-by-one that attributes one quarter's
  // money to another — the defect class this module exists to prevent.
  for (const [name, first] of Object.entries(GROUP)) {
    for (let i = 0; i < 3; i++) {
      const got = parsePeriodLabel(header[first - 1 + i]);
      if (got?.label !== periods[i].label) {
        throw new Error(
          `municipal_fiscal: group „${name}" column ${first + i} is ` +
            `„${got?.label ?? String(header[first - 1 + i] ?? "")}", expected „${periods[i].label}" — ` +
            "the workbook's column layout has changed; re-read the column map before trusting any figure",
        );
      }
    }
  }

  // The unit is declared per money GROUP in row 1. Prefer what the source says;
  // fall back to the year rule only when a release omits the label, and warn on
  // disagreement rather than silently preferring the inference — at the euro
  // changeover a wrong guess understates two thirds of a file by ~49%.
  const titleRow = rows[0] ?? [];
  const MONEY_GROUPS = [
    GROUP.revenue,
    GROUP.expenditure,
    GROUP.budgetBalance,
    GROUP.cashOnHand,
    GROUP.debtStock,
    GROUP.arrears,
    GROUP.expenseObligations,
    GROUP.commitments,
  ];
  const declared = [
    ...new Set(
      MONEY_GROUPS.map((c) => currencyFromTitle(titleRow[c - 1])).filter(
        (u): u is "BGN" | "EUR" => u != null,
      ),
    ),
  ];
  if (declared.length > 1) {
    throw new Error(
      `municipal_fiscal: money groups declare conflicting units (${declared.join(", ")})`,
    );
  }
  const declaredUnit = declared[0] ?? null;

  const crosswalk =
    opts.crosswalk ??
    buildCrosswalk(opts.municipalities ?? loadMunicipalities());
  const inRecovery = opts.inRecovery ?? new Set<number>();

  // The collection columns are single, on the workbook's year-end period. Which
  // of the three that is comes from the data, not from an assumption about
  // ordering — a release whose middle column is not Q4 would otherwise attach
  // the rates to the wrong quarter.
  const collectionPeriodIdx = periods.findIndex((p) => p.quarter === 4);

  if (declaredUnit) {
    const clash = periods.filter(
      (p) => currencyForYear(p.fiscalYear) !== declaredUnit,
    );
    if (clash.length > 0) {
      warnings.push(
        `workbook declares ${declaredUnit} but the year rule expects ` +
          `${clash.map((p) => `${p.label}=${currencyForYear(p.fiscalYear)}`).join(", ")}` +
          ` — using the DECLARED unit; check the release around the euro changeover`,
      );
    }
  } else {
    warnings.push(
      "no unit declared in row 1 of any money group — falling back to the year rule (лв. through 2025, евро from 2026)",
    );
  }

  const out: MunicipalFiscalQuarter[] = [];
  const mfCodes: number[] = [];

  for (const r of rows.slice(HEADER_ROWS_POKAZATELI)) {
    const mf = num(r?.[0]);
    if (mf == null) continue;
    mfCodes.push(mf);
    const nameBg = String(r[1] ?? "").trim();
    const obshtina = crosswalk.get(mf);
    if (!obshtina) {
      warnings.push(`unresolved МФ code ${mf} „${nameBg}" — row skipped`);
      continue;
    }

    periods.forEach((period, i) => {
      const inferred = currencyForYear(period.fiscalYear);
      const currency = declaredUnit ?? inferred;
      const m = (col: number) => money(r[col - 1 + i], currency);
      const ratios = {
        arrearsPct: pct(r[GROUP.arrearsRatio - 1 + i]),
        obligationsPct: pct(r[GROUP.obligationsRatio - 1 + i]),
        commitmentsPct: pct(r[GROUP.commitmentsRatio - 1 + i]),
      };
      const collection: CollectionRates | null =
        i === collectionPeriodIdx
          ? {
              dniPct: pct(r[COLLECTION_COL.dni - 1]),
              dprsPct: pct(r[COLLECTION_COL.dprs - 1]),
              avgPct: pct(r[COLLECTION_COL.avg - 1]),
            }
          : null;

      const base = {
        mfCode: mf,
        obshtina,
        nameBg,
        fiscalYear: period.fiscalYear,
        quarter: period.quarter,
        commitments: m(GROUP.commitments),
        expenseObligations: m(GROUP.expenseObligations),
        arrears: m(GROUP.arrears),
        revenue: m(GROUP.revenue),
        expenditure: m(GROUP.expenditure),
        budgetBalance: m(GROUP.budgetBalance),
        cashOnHand: m(GROUP.cashOnHand),
        debtStock: m(GROUP.debtStock),
        ratios,
        ratioBasis: ratioBasisFor(period.quarter),
        indicators: indicatorsAt(r, i),
        collection,
        inRecoveryProcedure: inRecovery.has(mf),
        sourceFile: opts.sourceFile,
      };
      out.push({ ...base, expenditureAvg4yEur: deriveAvg4y(base) });
    });
  }

  return { periods, rows: out, mfCodes, warnings };
};
