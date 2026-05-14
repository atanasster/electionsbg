// КФП parser — turns the data.egov.bg "state budget execution by major budget
// indicators" resources into the KfpObservation time series + the latest
// detailed snapshot.
//
// Each egov resource is a 2D array. Row 0 is a header:
//   ["", "Закон 2025 г. ДБ (млн.лв)", "Изпълнение 31.12.2025 (млн.лв.)", "%"]
// The 2026 (post-euro-changeover) resources drop the "%" column and leave the
// "Закон" column empty; their amounts are in millions of EUR rather than BGN.
//
// Data rows are [label, law, execution, pct?]. The five Roman-numeral rows
// (I … V) are the section totals; every other row is a line within the most
// recent section. Amounts are in MILLIONS of the native currency.

import { toEur } from "../../src/lib/currency";
import type { EgovResource } from "./fetch_sources";
import type {
  FiscalYearSeriesFigures,
  FiscalYearSummary,
  KfpFile,
  KfpObservation,
  KfpSeries,
  KfpSnapshot,
  KfpSnapshotLine,
  KfpSnapshotSection,
  Money,
  FactKind,
} from "./types";

const KFP_DOCUMENT_ID = "kfp-egov";

// Section code → (series, kind, English label).
const SECTIONS: Record<
  string,
  { series: KfpSeries; kind: FactKind; labelEn: string }
> = {
  I: {
    series: "revenue",
    kind: "revenue",
    labelEn: "Revenue, grants and donations",
  },
  II: {
    series: "expenditure",
    kind: "expenditure",
    labelEn: "Expenditure and transfers",
  },
  III: {
    series: "euContribution",
    kind: "expenditure",
    labelEn: "Contribution to the EU budget",
  },
  IV: {
    series: "balance",
    kind: "balance",
    labelEn: "Budget balance (deficit / surplus)",
  },
  V: { series: "financing", kind: "financing", labelEn: "Financing" },
};

// English labels for the common line items. Anything unmapped falls back to
// the Bulgarian label on the frontend — Phase 2's economic crosswalk will give
// these proper structure.
const LINE_LABELS_EN: Record<string, string> = {
  "Данъчни приходи": "Tax revenue",
  "Корпоративен данък": "Corporate income tax",
  "Данъци в/у доходите на физически лица": "Personal income tax",
  "Данък върху добавената стойност": "Value added tax",
  Акцизи: "Excise duties",
  "Мита и митнически такси": "Customs duties",
  "Други данъци": "Other taxes",
  "Неданъчни приходи": "Non-tax revenue",
  "Приходи от такси": "Fees",
  "Глоби, санкции и наказателни лихви": "Fines and penalties",
  Помощи: "Grants",
  Разходи: "Expenditure",
  Персонал: "Personnel",
  Издръжка: "Operations and maintenance",
  "Лихви - общо": "Interest — total",
  "Социални разходи, стипендии": "Social spending and scholarships",
  Субсидии: "Subsidies",
  "Капиталови разходи": "Capital expenditure",
  "Трансфери (нето)": "Transfers (net)",
  Общини: "Municipalities",
  "Социалноосигурителни фондове": "Social security funds",
  "Външно финансиране  (нето)": "External financing (net)",
  "Вътрешно финансиране  (нето)": "Domestic financing (net)",
};

const SECTION_RE = /^(I{1,3}|IV|V)\.\s+/;

// "31.12.2025" anywhere in the execution-column header.
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

interface ParsedHeader {
  asOf: string; // YYYY-MM-DD
  period: string; // YYYY-MM
  fiscalYear: number;
  currency: "BGN" | "EUR";
  lawCol: number;
  execCol: number;
}

const parseHeader = (header: string[], uuid: string): ParsedHeader => {
  const lawCol = header.findIndex((h) => /Закон/i.test(h ?? ""));
  const execCol = header.findIndex((h) => /Изпълнение/i.test(h ?? ""));
  if (execCol < 0) {
    throw new Error(
      `egov resource ${uuid}: no "Изпълнение" column in header ${JSON.stringify(header)}`,
    );
  }
  const dateMatch = (header[execCol] ?? "").match(DATE_RE);
  if (!dateMatch) {
    throw new Error(
      `egov resource ${uuid}: could not parse execution date from "${header[execCol]}"`,
    );
  }
  const [, dd, mm, yyyy] = dateMatch;
  const headerText = header.join(" ").toLowerCase();
  const currency: "BGN" | "EUR" = headerText.includes("евро") ? "EUR" : "BGN";
  return {
    asOf: `${yyyy}-${mm}-${dd}`,
    period: `${yyyy}-${mm}`,
    fiscalYear: parseInt(yyyy, 10),
    currency,
    lawCol: lawCol >= 0 ? lawCol : 1,
    execCol,
  };
};

// Source cell → Money. Cells are millions of the native currency, with float
// noise ("55168.38089999999"); round to whole native units to kill the noise
// and keep the canary deterministic. Empty cell → null.
const cellToMoney = (
  cell: string | undefined,
  currency: "BGN" | "EUR",
): Money | null => {
  if (cell == null || String(cell).trim() === "") return null;
  const millions = Number(String(cell).replace(/\s/g, ""));
  if (!Number.isFinite(millions)) return null;
  const amount = Math.round(millions * 1_000_000);
  const eur = toEur(amount, currency);
  return {
    amount,
    currency,
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

interface ParsedResource {
  header: ParsedHeader;
  uuid: string;
  sections: KfpSnapshotSection[];
}

// Parse one egov resource into its five sections (each with its line items).
export const parseEgovResource = (
  rows: EgovResource,
  uuid: string,
): ParsedResource => {
  if (rows.length < 2) {
    throw new Error(`egov resource ${uuid}: fewer than 2 rows`);
  }
  const header = parseHeader(rows[0], uuid);
  const sections: KfpSnapshotSection[] = [];
  let current: KfpSnapshotSection | null = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const label = (row?.[0] ?? "").trim();
    if (!label) continue;
    const planned = cellToMoney(row[header.lawCol], header.currency);
    const executed = cellToMoney(row[header.execCol], header.currency);
    const sectionMatch = label.match(SECTION_RE);
    if (sectionMatch) {
      const code = sectionMatch[1];
      const meta = SECTIONS[code];
      if (!meta) continue;
      current = {
        code,
        series: meta.series,
        kind: meta.kind,
        labelBg: label,
        labelEn: meta.labelEn,
        planned,
        executed,
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) continue; // pre-section rows (shouldn't happen) — skip
    const line: KfpSnapshotLine = {
      labelBg: label,
      labelEn: LINE_LABELS_EN[label] ?? "",
      planned,
      executed,
    };
    current.lines.push(line);
  }

  const seen = new Set(sections.map((s) => s.code));
  for (const code of ["I", "II", "III", "IV", "V"]) {
    if (!seen.has(code)) {
      throw new Error(
        `egov resource ${uuid}: missing section ${code} — upstream table structure changed`,
      );
    }
  }
  return { header, uuid, sections };
};

const snapshotFromParsed = (p: ParsedResource): KfpSnapshot => ({
  period: p.header.period,
  fiscalYear: p.header.fiscalYear,
  asOf: p.header.asOf,
  currency: p.header.currency,
  constituentBudget: "state",
  sections: p.sections,
});

const observationsFromParsed = (p: ParsedResource): KfpObservation[] => {
  const out: KfpObservation[] = [];
  for (const section of p.sections) {
    if (section.executed == null && section.planned == null) continue;
    out.push({
      period: p.header.period,
      cadence: "monthly",
      fiscalYear: p.header.fiscalYear,
      asOf: p.header.asOf,
      series: section.series,
      constituentBudget: "state",
      executed:
        section.executed ??
        ({ amount: 0, currency: p.header.currency, amountEur: 0 } as Money),
      planned: section.planned,
      sourceRef: {
        documentId: KFP_DOCUMENT_ID,
        sheet: p.uuid,
        rowLabel: section.labelBg,
      },
    });
  }
  return out;
};

// Month number from a "YYYY-MM" period.
const monthOf = (period: string): number => parseInt(period.slice(5, 7), 10);

// Group parsed resources by fiscal year, each list sorted by period ascending.
const groupByFiscalYear = (
  parsed: ParsedResource[],
): Map<number, ParsedResource[]> => {
  const byFy = new Map<number, ParsedResource[]>();
  for (const p of parsed) {
    const arr = byFy.get(p.header.fiscalYear) ?? [];
    arr.push(p);
    byFy.set(p.header.fiscalYear, arr);
  }
  for (const arr of byFy.values()) {
    arr.sort((a, b) => a.header.period.localeCompare(b.header.period));
  }
  return byFy;
};

// One detailed snapshot per fiscal year — the latest month of each.
const buildSnapshots = (parsed: ParsedResource[]): KfpSnapshot[] => {
  const byFy = groupByFiscalYear(parsed);
  return [...byFy.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, arr]) => snapshotFromParsed(arr[arr.length - 1]));
};

// Pull the planned or executed Money for each of the five series off one
// parsed resource.
const seriesFigures = (
  p: ParsedResource,
  pick: "planned" | "executed",
): FiscalYearSeriesFigures => {
  const get = (series: KfpSeries): Money | null =>
    p.sections.find((s) => s.series === series)?.[pick] ?? null;
  return {
    revenue: get("revenue"),
    expenditure: get("expenditure"),
    euContribution: get("euContribution"),
    balance: get("balance"),
    financing: get("financing"),
  };
};

const mkMoney = (eur: number, currency: "BGN" | "EUR"): Money => ({
  amountEur: Math.round(eur),
  amount: Math.round(eur),
  currency,
});

// Seasonal full-year projection for an incomplete fiscal year. Revenue,
// expenditure and the EU contribution are each scaled by the prior complete
// year's cumulative share at the same calendar month; the balance and
// financing are then derived (balance = revenue − expenditure − euC,
// financing = −balance) rather than share-projected, since a share on a
// near-zero quantity is unstable. Returns null for a series that cannot be
// projected.
const projectFigures = (
  actual: FiscalYearSeriesFigures,
  priorAtMonth: FiscalYearSeriesFigures,
  priorAtDec: FiscalYearSeriesFigures,
  currency: "BGN" | "EUR",
): FiscalYearSeriesFigures => {
  const projectSeries = (s: KfpSeries): Money | null => {
    const a = actual[s];
    const pm = priorAtMonth[s];
    const pd = priorAtDec[s];
    if (!a || !pm || !pd || pd.amountEur === 0) return null;
    const share = pm.amountEur / pd.amountEur;
    if (share === 0) return null;
    return mkMoney(a.amountEur / share, currency);
  };
  const revenue = projectSeries("revenue");
  const expenditure = projectSeries("expenditure");
  const euContribution = projectSeries("euContribution");
  const balance =
    revenue && expenditure && euContribution
      ? mkMoney(
          revenue.amountEur - expenditure.amountEur - euContribution.amountEur,
          currency,
        )
      : null;
  const financing = balance ? mkMoney(-balance.amountEur, currency) : null;
  return { revenue, expenditure, euContribution, balance, financing };
};

// Per-fiscal-year roll-up: full-year figures (December cumulative for a
// complete year), the budget-law plan, and a seasonal projection for the
// current incomplete year.
export const buildFiscalYearSummaries = (
  parsed: ParsedResource[],
): FiscalYearSummary[] => {
  const byFy = groupByFiscalYear(parsed);
  const fiscalYears = [...byFy.keys()].sort((a, b) => a - b);
  const summaries: FiscalYearSummary[] = [];

  for (const fy of fiscalYears) {
    const arr = byFy.get(fy)!;
    const last = arr[arr.length - 1];
    const complete = arr.some((p) => monthOf(p.header.period) === 12);
    const actual = seriesFigures(last, "executed");
    const plannedRaw = seriesFigures(last, "planned");
    const planned = Object.values(plannedRaw).some((m) => m != null)
      ? plannedRaw
      : null;

    let projected: FiscalYearSeriesFigures | null = null;
    let projectionBasis: number | null = null;
    if (!complete) {
      const month = monthOf(last.header.period);
      // Most recent prior complete fiscal year that also has a cumulative
      // snapshot at the same calendar month — the seasonal anchor.
      for (const candFy of fiscalYears.filter((f) => f < fy).reverse()) {
        const cand = byFy.get(candFy)!;
        const candComplete = cand.some((p) => monthOf(p.header.period) === 12);
        if (!candComplete) continue;
        const atMonth = cand.find((p) => monthOf(p.header.period) === month);
        const atDec = cand.find((p) => monthOf(p.header.period) === 12);
        if (!atMonth || !atDec) continue;
        projected = projectFigures(
          actual,
          seriesFigures(atMonth, "executed"),
          seriesFigures(atDec, "executed"),
          last.header.currency,
        );
        projectionBasis = candFy;
        break;
      }
    }

    summaries.push({
      fiscalYear: fy,
      complete,
      monthsAvailable: arr.length,
      firstPeriod: arr[0].header.period,
      lastPeriod: last.header.period,
      asOf: last.header.asOf,
      currency: last.header.currency,
      planned,
      actual,
      projected,
      projectionBasis,
    });
  }
  return summaries;
};

// Build the committed kfp.json from every parsed egov resource.
export const buildKfpFile = (
  parsed: ParsedResource[],
  sources: Record<string, string>,
): KfpFile => {
  const observations: KfpObservation[] = [];
  for (const p of parsed) observations.push(...observationsFromParsed(p));
  observations.sort((a, b) =>
    a.period === b.period
      ? a.series.localeCompare(b.series)
      : a.period.localeCompare(b.period),
  );
  const snapshots = buildSnapshots(parsed);
  const latest = [...parsed].sort((a, b) =>
    a.header.asOf.localeCompare(b.header.asOf),
  )[parsed.length - 1];
  return {
    generatedAt: new Date().toISOString(),
    country: "BG",
    constituentBudget: "state",
    sources,
    observations,
    snapshots,
    latestSnapshot: latest ? snapshotFromParsed(latest) : null,
  };
};

export { KFP_DOCUMENT_ID };
export type { ParsedResource };
