// Parses an NOI B1 (monthly per-fund execution) XLS file from
// nssi.bg/wp-content/uploads/B1_{YYYY}_{MM}_{FUND}.xls into a typed snapshot.
//
// Fund codes (EBK):
//   5500 — ДОО (Държавно обществено осигуряване) — the main social-security
//          fund (€12.6B in 2024). 88% of its expenditure flows through §4100
//          "Пенсии" + §4200 "Текущи трансфери, обезщетения и помощи" — the
//          pensions + short-term benefits envelope that drives the Sankey
//          drilldown.
//   5591 — Учителски пенсионен фонд — teacher pension top-up (€52M).
//   5592 — Фонд "Гарантирани вземания на работниците и служителите" —
//          bankruptcy receivables fund (€1M).
//
// The XLS is a legacy BIFF8 document (CP1251); we use the project's `xlsx`
// dependency (already in package.json). The "OTCHET-agregirani pokazateli"
// sheet has clean labelled rows (Roman section + numbered sub-row) — the
// other sheets (OTCHET, Cash-Flow-DATA) carry the same data at finer or
// coarser grain and aren't needed for the fund-level rollup.
//
// Amounts in the source are in LEVA (BGN), not thousands of leva like the
// budget-law tables — multiply by 1 (no scaling) when constructing Money.

import fs from "fs";
import * as xlsx from "xlsx";
import { toEur } from "../../../src/lib/currency";
import type { Money } from "../types";

export type NoiFundCode = "5500" | "5591" | "5592";

export const FUND_LABELS: Record<
  NoiFundCode,
  { bg: string; en: string; shortBg: string; shortEn: string }
> = {
  "5500": {
    bg: "Държавно обществено осигуряване",
    en: "State Social Security",
    shortBg: "ДОО",
    shortEn: "DOO",
  },
  "5591": {
    bg: "Учителски пенсионен фонд",
    en: "Teachers' Pension Fund",
    shortBg: "УчПФ",
    shortEn: "TPF",
  },
  "5592": {
    bg: 'Фонд „Гарантирани вземания на работниците и служителите"',
    en: "Guaranteed Workers' Receivables Fund",
    shortBg: "ГВРС",
    shortEn: "GWRF",
  },
};

export interface NoiExpenseLine {
  // Stable id for the line — matches the named buckets the Sankey drilldown
  // surfaces. "pensions" + "short_term_benefits" are the two big policy
  // categories; the rest are operational.
  id:
    | "personnel"
    | "operations"
    | "interest"
    | "social_pensions"
    | "social_other"
    | "social_total"
    | "subsidies"
    | "capital_assets"
    | "capital_transfers"
    | "abroad"
    | "reserve";
  labelBg: string;
  labelEn: string;
  planned: Money | null;
  executed: Money | null;
}

export interface NoiFundSnapshot {
  fundCode: NoiFundCode;
  fundLabelBg: string;
  fundLabelEn: string;
  fiscalYear: number;
  // ISO date of the snapshot's cut-off (e.g. "2024-12-31" for a year-end
  // full-year file). Extracted from cells [1][11] and [2][17].
  asOf: string;
  // Top-level revenue + expenditure + balance, mirroring the law/КФП shape.
  revenue: Money | null;
  expenditure: Money | null;
  balance: Money | null;
  expenseLines: NoiExpenseLine[];
  // Pension-specific sub-detail extracted from the OTCHET sheet (when
  // present): the breakdown of §4100 "Пенсии" vs §4200 "Текущи трансфери,
  // обезщетения и помощи". Only meaningful for fund 5500.
  pensionsBgn: number | null;
  shortTermBenefitsBgn: number | null;
}

// Money from leva (whole lev units), not from thousands of leva.
const moneyFromLeva = (leva: unknown): Money | null => {
  if (typeof leva !== "number" || !Number.isFinite(leva)) return null;
  const amount = Math.round(leva);
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const cellText = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

// Match an OTCHET-agregirani row's leading numbered label (e.g. "1.", "2.1",
// "II.") against the canonical category map. Returns the line id or null.
//
// The structure has been stable across years 2018-2025 — we anchor on the
// human-readable label rather than the row index in case rows are inserted.
const matchExpenseLine = (
  name: string,
): { id: NoiExpenseLine["id"]; labelEn: string } | null => {
  // Order matters: "Социални разходи, стипендии" must match before any
  // sub-pattern. Section headers (II. РАЗХОДИ) and sub-categories (1.1, 1.2)
  // are filtered out. JavaScript's `\b` doesn't anchor on Cyrillic letters,
  // so we rely on the numbered-prefix anchor (`^N.`) for word separation.
  if (/^1\.\s*Персонал/i.test(name))
    return { id: "personnel", labelEn: "Personnel" };
  if (/^2\.\s*Издръжка/i.test(name))
    return { id: "operations", labelEn: "Operations" };
  if (/^3\.\s*Лихви/i.test(name))
    return { id: "interest", labelEn: "Interest" };
  if (/^4\.\s*Социални/i.test(name))
    return {
      id: "social_total",
      labelEn: "Social expenditure (pensions + benefits)",
    };
  if (/^5\.?\s*Субсидии/i.test(name))
    return { id: "subsidies", labelEn: "Subsidies" };
  if (/^6\.\s*Придобиване на/i.test(name))
    return { id: "capital_assets", labelEn: "Capital assets" };
  if (/^7\.\s*Капиталови трансфери/i.test(name))
    return { id: "capital_transfers", labelEn: "Capital transfers" };
  if (/^8\.\s*Предоставени.+трансфери за чужбина/i.test(name))
    return { id: "abroad", labelEn: "Transfers abroad" };
  if (/^10\.\s*Резерв/i.test(name))
    return { id: "reserve", labelEn: "Reserve for unforeseen" };
  return null;
};

// "30.12.2024" / Date / number → ISO yyyy-mm-dd. NOI sometimes writes the
// cut-off as an Excel serial number (45657 = 31 Dec 2024); handle both.
const excelDateToIso = (raw: unknown): string | null => {
  if (typeof raw === "string") {
    const m = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    if (m) {
      const [, d, mo, y] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return null;
  }
  if (typeof raw === "number") {
    // Excel epoch starts 1899-12-30 (accounting for the 1900-02-29 bug).
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
};

// Extract the §4100 / §4200 expenditure sub-detail from the OTCHET sheet —
// fund 5500 only. Paragraph codes 4100 and 4200 are reused across the
// revenue + expenditure sides of the sheet (revenue 4100 = "Приходи от
// концесии", expenditure 4100 = "Пенсии"), so we anchor on the label in
// col 2 instead of just the numeric code.
const parsePensionDetail = (
  rows: unknown[][],
): { pensions: number | null; shortTermBenefits: number | null } => {
  let pensions: number | null = null;
  let shortTermBenefits: number | null = null;
  for (const r of rows) {
    if (!r) continue;
    const param = r[1];
    const label = typeof r[2] === "string" ? r[2] : "";
    const total = r[5];
    if (typeof param !== "number" || typeof total !== "number") continue;
    if (param === 4100 && /^Пенсии/i.test(label) && pensions === null) {
      pensions = total;
    }
    if (
      param === 4200 &&
      /^Текущи трансфери/i.test(label) &&
      shortTermBenefits === null
    ) {
      shortTermBenefits = total;
    }
    if (pensions !== null && shortTermBenefits !== null) break;
  }
  return { pensions, shortTermBenefits };
};

export interface ParseB1Input {
  bytes: Buffer | Uint8Array;
  fundCode: NoiFundCode;
  fiscalYear: number;
}

export const parseB1Xls = (input: ParseB1Input): NoiFundSnapshot => {
  const wb = xlsx.read(input.bytes, { codepage: 1251, type: "buffer" });
  const sheetName = "OTCHET-agregirani pokazateli";
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `NOI B1 (${input.fundCode}/${input.fiscalYear}): sheet "${sheetName}" not found`,
    );
  }
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  // Header cells we care about:
  //   rows[1][11] → asOf as Excel serial number (date)
  //   rows[1][5]  → fund code (string "5500")
  // We accept either source. The fund label comes from the static map.
  const labels = FUND_LABELS[input.fundCode];
  const asOf =
    excelDateToIso(rows[1]?.[11]) ??
    excelDateToIso(rows[2]?.[17]) ??
    `${input.fiscalYear}-12-31`;

  // The OTCHET-agregirani sheet anchors on labelled rows. Walk all rows,
  // accept the ones whose label matches our canonical expense-line map.
  const expenseLines: NoiExpenseLine[] = [];
  let revenue: Money | null = null;
  let expenditure: Money | null = null;
  let balance: Money | null = null;

  for (const r of rows) {
    if (!r) continue;
    const name = cellText(r[1]);
    const plannedRaw = r[4];
    const executedRaw = r[5];
    if (!name) continue;

    // Section headlines.
    if (/^I\.\s*ПРИХОДИ/i.test(name)) {
      revenue = moneyFromLeva(executedRaw) ?? revenue;
      continue;
    }
    if (/^II\.\s*РАЗХОДИ/i.test(name)) {
      expenditure = moneyFromLeva(executedRaw) ?? expenditure;
      continue;
    }
    if (/^V\.\s*Дефицит/i.test(name)) {
      balance = moneyFromLeva(executedRaw) ?? balance;
      continue;
    }

    const matched = matchExpenseLine(name);
    if (!matched) continue;
    expenseLines.push({
      id: matched.id,
      labelBg: name,
      labelEn: matched.labelEn,
      planned: moneyFromLeva(plannedRaw),
      executed: moneyFromLeva(executedRaw),
    });
  }

  // Pull §4100 (Pensions) and §4200 (Short-term benefits) out of the OTCHET
  // sheet for fund 5500. Other funds carry these with zero values.
  const otchet = wb.Sheets["OTCHET"];
  const otchetRows = otchet
    ? (xlsx.utils.sheet_to_json(otchet, {
        header: 1,
        defval: "",
      }) as unknown[][])
    : [];
  const pensionDetail = parsePensionDetail(otchetRows);

  return {
    fundCode: input.fundCode,
    fundLabelBg: labels.bg,
    fundLabelEn: labels.en,
    fiscalYear: input.fiscalYear,
    asOf,
    revenue,
    expenditure,
    balance,
    expenseLines,
    pensionsBgn: pensionDetail.pensions,
    shortTermBenefitsBgn: pensionDetail.shortTermBenefits,
  };
};

// Convenience: parse from a local file path.
export const parseB1XlsFile = (
  filePath: string,
  fundCode: NoiFundCode,
  fiscalYear: number,
): NoiFundSnapshot => {
  const bytes = fs.readFileSync(filePath);
  return parseB1Xls({ bytes, fundCode, fiscalYear });
};

// ---------------------------------------------------------------------------
// Artifact — what gets written to data/budget/noi/.
// ---------------------------------------------------------------------------

export interface NoiFundsFile {
  generatedAt: string;
  source: {
    publisher: string;
    urlTemplate: string;
    description: string;
  };
  years: Array<{
    fiscalYear: number;
    asOf: string;
    // Whole-NOI rollup across the three funds — the headline figure the
    // drilldown shows. Sums {revenue,expenditure,balance} across all funds
    // for which a B1 file was ingested in this year.
    totals: {
      revenue: import("../types").Money;
      expenditure: import("../types").Money;
      balance: import("../types").Money;
      pensions: import("../types").Money;
      shortTermBenefits: import("../types").Money;
    };
    funds: NoiFundSnapshot[];
  }>;
}

// Sum an array of Money values, anchored to BGN. Drops nulls.
const sumMoney = (
  values: Array<import("../types").Money | null>,
): import("../types").Money => {
  let amount = 0;
  for (const v of values) if (v) amount += v.amount;
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const moneyFromBgn = (bgn: number | null): import("../types").Money => {
  if (bgn === null) return { amount: 0, currency: "BGN", amountEur: 0 };
  const eur = toEur(bgn, "BGN");
  return {
    amount: bgn,
    currency: "BGN",
    amountEur: eur == null ? bgn : Math.round(eur),
  };
};

export const buildNoiFundsFile = (
  snapshotsByYear: Map<number, NoiFundSnapshot[]>,
): NoiFundsFile => {
  const years: NoiFundsFile["years"] = [];
  for (const [year, funds] of [...snapshotsByYear.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const pensions = sumMoney(funds.map((f) => moneyFromBgn(f.pensionsBgn)));
    const shortTermBenefits = sumMoney(
      funds.map((f) => moneyFromBgn(f.shortTermBenefitsBgn)),
    );
    years.push({
      fiscalYear: year,
      asOf: funds[0]?.asOf ?? `${year}-12-31`,
      totals: {
        revenue: sumMoney(funds.map((f) => f.revenue)),
        expenditure: sumMoney(funds.map((f) => f.expenditure)),
        balance: sumMoney(funds.map((f) => f.balance)),
        pensions,
        shortTermBenefits,
      },
      funds: funds.sort(
        (a, b) =>
          (b.expenditure?.amountEur ?? 0) - (a.expenditure?.amountEur ?? 0),
      ),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национален осигурителен институт (NOI)",
      urlTemplate:
        "https://www.nssi.bg/wp-content/uploads/B1_{YYYY}_{MM}_{FUND}.xls",
      description:
        "Monthly per-fund cash-execution report (B1). Fund codes: 5500 ДОО, 5591 УчПФ, 5592 ГВРС.",
    },
    years,
  };
};
