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
import { sentenceCaseLabel } from "../lib/normalize_name";
import type { EgovResource } from "./fetch_sources";
import type {
  ConstituentBudget,
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
// the Bulgarian label on the frontend.
const LINE_LABELS_EN: Record<string, string> = {
  "Данъчни приходи": "Tax revenue",
  "Корпоративен данък": "Corporate income tax",
  "Данъци в/у доходите на физически лица": "Personal income tax",
  "Данъци върху  дивидентите, ликвидац. дялове и доходите на местни и чужд. юрид. лица":
    "Taxes on dividends, liquidation shares and income of resident and foreign legal entities",
  "Данък върху добавената стойност": "Value added tax",
  Акцизи: "Excise duties",
  "Данък върху застрахователните премии": "Insurance premium tax",
  "Мита и митнически такси": "Customs duties",
  "Други данъци": "Other taxes",
  "Неданъчни приходи": "Non-tax revenue",
  "Приходи от такси": "Fees",
  "Приходи и доходи  от собственост": "Property income",
  "Приходи и доходи от собственост": "Property income",
  "Превишение на приходите над разходите на БНБ":
    "Surplus of BNB revenue over expenditure",
  "Глоби, санкции и наказателни лихви": "Fines and penalties",
  "Други неданъчни приходи": "Other non-tax revenue",
  Помощи: "Grants",
  Разходи: "Expenditure",
  Персонал: "Personnel",
  Издръжка: "Operations and maintenance",
  "Лихви - общо": "Interest — total",
  "Лихви по външни заеми": "Interest on external debt",
  "Лихви по вътрешни заеми": "Interest on domestic debt",
  "Лихви по вътрешни заеми и др. лихви": "Interest on domestic debt and other",
  "Социални разходи, стипендии": "Social spending and scholarships",
  Субсидии: "Subsidies",
  "Субсидии за нефинансови предприятия":
    "Subsidies to non-financial enterprises",
  "Предоставени текущи и капиталови трансфери за чужбина":
    "Current and capital transfers provided abroad",
  "Капиталови разходи": "Capital expenditure",
  "Придобиване на дълготрайни активи и основен ремонт":
    "Acquisition of fixed assets and major repairs",
  "Капиталови трансфери": "Capital transfers",
  "Прираст на държавния резерв": "Increase in state reserves",
  "Прираст на държавния резерв - нето": "Increase in state reserves (net)",
  "Резерв за непредвидени и/или неотложни разходи:":
    "Reserve for unforeseen and/or urgent expenditure",
  "Трансфери (нето)": "Transfers (net)",
  "Предоставени трансфери": "Provided transfers",
  "Получени трансфери": "Received transfers",
  "Текущи трансфери, обезщетения и помощи за домакинствата":
    "Current transfers, indemnities and household benefits",
  "Текущи и капиталови трансфери, предоставени в страната":
    "Current and capital transfers within the country",
  Общини: "Municipalities",
  "Социалноосигурителни фондове": "Social security funds",
  "ДВУ, БАН, ССА, БНТ, БНР и БТА":
    "State universities, BAS, SSA, BNT, BNR and BTA",
  "Бюджети по чл.13 (4) от ЗПФ - нето":
    "Art. 13(4) Public Finance Act budgets (net)",
  "Други трансфери - нето": "Other transfers (net)",
  "Държавни висши училища и БАН": "State universities and BAS",
  "Други бюджетни организации": "Other budget organisations",
  "Сметка за средствата от ЕС": "EU funds account",
  "Резерв за непредвидени и неотложни разходи":
    "Reserve for unforeseen and urgent expenditure",
  "Външно финансиране  (нето)": "External financing (net)",
  "Получени дългосрочни заеми от чужбина":
    "Long-term loans received from abroad",
  "Погашения по дългосрочни заеми от чужбина":
    "Repayments on long-term loans from abroad",
  "Вътрешно финансиране  (нето)": "Domestic financing (net)",
  "Заеми от банки и други лица в страната":
    "Loans from domestic banks and other parties",
  "Депозити и средства по сметки – нето": "Deposits and account balances (net)",
  "Покупко-продажба на държавни ценни книжа":
    "Sale and purchase of government securities",
  Приватизация: "Privatisation",
  "Други операции по финансирането": "Other financing operations",
};

// Hierarchy reconstruction. The КФП source table is a single label column with
// no indentation or code signal — a 2-3 level tree flattened by row order.
// "Tax revenue" (24.6B) is followed by 8 rows that sum exactly to it; those
// are its children. Same for "Non-tax revenue", "Expenditure", "Transfers
// (net)", and a 3rd level under "Interest — total" / "Capital expenditure".
//
// Algorithm: walk lines once with a stack of open subtotals. For each row,
// look ahead and accumulate following rows; if a prefix of the lookahead sums
// (within tolerance) to this row's value, mark it a subtotal and recurse into
// the prefix. Otherwise it's a leaf at the current depth. `pick` selects the
// signal — `executed` for in-progress years, `planned` for plan-only years.
//
// Plan figures sum EXACTLY; executed figures have small source-publication
// noise (a few tens of thousands of native units on a 30B subtotal). 100K is
// loose enough to accept that, tight enough to reject coincidental sums (the
// closest false positive in the data is ~33M off).
const SUM_TOLERANCE_ABS = 100_000;

type SignalPick = "executed" | "planned";
const MAX_DEPTH = 2;

// Pick ONE signal per section before reconstructing — mixing planned and
// executed values in the same accumulation would never sum back to the parent
// when the source publishes one but not the other for some rows.
const sectionSignal = (section: KfpSnapshotSection): SignalPick =>
  section.executed != null ? "executed" : "planned";

const lineValue = (line: KfpSnapshotLine, pick: SignalPick): number | null => {
  const m = pick === "executed" ? line.executed : line.planned;
  return m ? m.amount : null;
};

const sumWithin = (a: number, b: number): boolean =>
  Math.abs(a - b) <= SUM_TOLERANCE_ABS;

interface HierarchyAnnotation {
  depth: number;
  isSubtotal: boolean;
  groupLabelBg: string | null;
  groupLabelEn: string | null;
}

// Find a prefix of lines[start..end) that consumed at the given depth (with
// nested subtotals eating their children) sums to `target`. Best-fit, not
// first-fit: walks the whole lookahead and picks the position with the
// smallest absolute residual within tolerance. This lets the algorithm prefer
// "include the small ± row" over "stop early at a near-match" when both are
// within noise tolerance — important for the FY2026-style cases where the
// natural prefix-sum is off by only 15K but the row-just-after closes the
// gap exactly.
//
// Also handles signed-net subtotals (the "Transfers (net)" pattern in section
// II, where Net = Предоставени − Получени): if no natural prefix matches but
// flipping the sign of a single consumed child would, accept the match and
// extend through the end of the walked range.
const findMatchEnd = (
  lines: KfpSnapshotLine[],
  start: number,
  end: number,
  target: number,
  depth: number,
  pick: SignalPick,
): number => {
  let i = start;
  let acc = 0;
  const consumedValues: number[] = [];
  let bestPos = -1;
  let bestResidual = Infinity;
  while (i < end) {
    const head = lines[i];
    const headValue = lineValue(head, pick);
    if (headValue == null || headValue === 0) {
      i++;
    } else {
      let advanced = i + 1;
      if (depth < MAX_DEPTH) {
        const nested = findMatchEnd(
          lines,
          i + 1,
          end,
          headValue,
          depth + 1,
          pick,
        );
        if (nested > i + 1) advanced = nested;
      }
      acc += headValue;
      consumedValues.push(headValue);
      i = advanced;
    }
    const residual = Math.abs(acc - target);
    if (residual <= SUM_TOLERANCE_ABS && residual < bestResidual) {
      bestResidual = residual;
      bestPos = i;
    }
  }
  if (bestPos !== -1) return bestPos;
  if (depth === 1) {
    const overshoot = acc - target;
    if (Math.abs(overshoot) >= SUM_TOLERANCE_ABS) {
      const half = overshoot / 2;
      for (const v of consumedValues) {
        if (sumWithin(v, half)) return i;
      }
    }
  }
  return -1;
};

// Walk lines[start..end) at `depth`, marking each row as leaf or subtotal and
// recursing into the children of every detected subtotal.
const annotateRange = (
  lines: KfpSnapshotLine[],
  annotations: HierarchyAnnotation[],
  start: number,
  end: number,
  depth: number,
  groupBg: string | null,
  groupEn: string | null,
  pick: SignalPick,
): void => {
  let i = start;
  while (i < end) {
    const head = lines[i];
    const headValue = lineValue(head, pick);
    annotations[i] = {
      depth,
      isSubtotal: false,
      groupLabelBg: depth === 0 ? null : groupBg,
      groupLabelEn: depth === 0 ? null : groupEn,
    };
    let consumed = 1;
    if (
      headValue != null &&
      headValue !== 0 &&
      depth < MAX_DEPTH &&
      i + 1 < end
    ) {
      const matchEnd = findMatchEnd(
        lines,
        i + 1,
        end,
        headValue,
        depth + 1,
        pick,
      );
      if (matchEnd > i + 1) {
        annotations[i].isSubtotal = true;
        const childGroupBg = depth === 0 ? head.labelBg : groupBg;
        const childGroupEn = depth === 0 ? head.labelEn || null : groupEn;
        annotateRange(
          lines,
          annotations,
          i + 1,
          matchEnd,
          depth + 1,
          childGroupBg,
          childGroupEn,
          pick,
        );
        consumed = matchEnd - i;
      }
    }
    i += consumed;
  }
};

const reconstructHierarchy = (section: KfpSnapshotSection): void => {
  const n = section.lines.length;
  if (n === 0) return;
  const annotations: HierarchyAnnotation[] = new Array(n);
  const pick = sectionSignal(section);
  annotateRange(section.lines, annotations, 0, n, 0, null, null, pick);
  for (let i = 0; i < n; i++) {
    const a = annotations[i];
    if (a) {
      section.lines[i] = { ...section.lines[i], ...a };
    } else {
      section.lines[i] = {
        ...section.lines[i],
        depth: 0,
        isSubtotal: false,
        groupLabelBg: null,
        groupLabelEn: null,
      };
    }
  }
};

const SECTION_RE = /^(I{1,3}|IV|V)\.\s+/;

// "31.12.2025" anywhere in the execution-column header.
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

export class UnparseableHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableHeaderError";
  }
}

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
  // Some legacy resources (e.g. one of the 2021 batch) carry just "Изпълнение"
  // with no date in the header — they're orphan duplicates of properly-dated
  // ones. Signal with a sentinel so the caller can skip them without aborting
  // the whole ingest; the date is the only field we cannot infer.
  const dateMatch = (header[execCol] ?? "").match(DATE_RE);
  if (!dateMatch) {
    throw new UnparseableHeaderError(
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
        // КФП source rows arrive as "I. ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ" — keep
        // the Roman / Arabic section marker, sentence-case the body so the
        // /budget header doesn't read like the all-caps source feed.
        labelBg: sentenceCaseLabel(label),
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
      depth: 0,
      isSubtotal: false,
      groupLabelBg: null,
      groupLabelEn: null,
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
  for (const section of sections) reconstructHierarchy(section);
  return { header, uuid, sections };
};

const snapshotFromParsed = (
  p: ParsedResource,
  constituent: ConstituentBudget,
): KfpSnapshot => ({
  period: p.header.period,
  fiscalYear: p.header.fiscalYear,
  asOf: p.header.asOf,
  currency: p.header.currency,
  constituentBudget: constituent,
  sections: p.sections,
});

const observationsFromParsed = (
  p: ParsedResource,
  constituent: ConstituentBudget,
): KfpObservation[] => {
  const out: KfpObservation[] = [];
  for (const section of p.sections) {
    if (section.executed == null && section.planned == null) continue;
    out.push({
      period: p.header.period,
      cadence: "monthly",
      fiscalYear: p.header.fiscalYear,
      asOf: p.header.asOf,
      series: section.series,
      constituentBudget: constituent,
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
const buildSnapshots = (
  parsed: ParsedResource[],
  constituent: ConstituentBudget,
): KfpSnapshot[] => {
  const byFy = groupByFiscalYear(parsed);
  return [...byFy.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, arr]) => snapshotFromParsed(arr[arr.length - 1], constituent));
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
// current incomplete year. `gdpByYear` is an optional lookup the caller
// builds from data/macro.json — populates `gdpEur` on each summary so the
// /budget SPA doesn't have to fetch macro.json just to compute % of GDP.
export const buildFiscalYearSummaries = (
  parsed: ParsedResource[],
  gdpByYear?: Map<number, number>,
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
      gdpEur: gdpByYear?.get(fy) ?? null,
    });
  }
  return summaries;
};

// Read `data/macro.json`'s nominalGdp series (Eurostat nama_10_gdp, current
// prices, MEUR) and build a {fiscalYear → gdpEur} lookup spanning the given
// fiscal years. Eurostat publishes year Y by mid-Y+1, so the in-progress
// fiscal year is projected forward up to 2 years using the geometric mean
// of the last 3 YoY growth rates. Returns an empty map when macro.json is
// missing — callers fall back to `gdpEur: null` per summary.
export const buildGdpByYear = (
  fiscalYears: number[],
  macro: { series?: { nominalGdp?: { year: number; value: number }[] } },
): Map<number, number> => {
  const out = new Map<number, number>();
  const raw = macro?.series?.nominalGdp;
  if (!raw || raw.length === 0) return out;
  const sorted = [...raw].sort((a, b) => a.year - b.year);
  const window = sorted.slice(-4);
  const yoy: number[] = [];
  for (let i = 1; i < window.length; i++) {
    if (window[i - 1].value > 0) {
      yoy.push(window[i].value / window[i - 1].value);
    }
  }
  const geoMean =
    yoy.length > 0
      ? Math.pow(
          yoy.reduce((a, b) => a * b, 1),
          1 / yoy.length,
        )
      : null;
  const last = sorted[sorted.length - 1];
  for (const fy of fiscalYears) {
    const exact = sorted.find((p) => p.year === fy);
    if (exact) {
      out.set(fy, Math.round(exact.value * 1_000_000));
      continue;
    }
    if (geoMean != null && fy > last.year) {
      const steps = fy - last.year;
      if (steps <= 2) {
        out.set(
          fy,
          Math.round(last.value * Math.pow(geoMean, steps) * 1_000_000),
        );
      }
    }
  }
  return out;
};

// Build the committed kfp.json from every parsed egov resource.
export const buildKfpFile = (
  parsed: ParsedResource[],
  sources: Record<string, string>,
  // Which budget scope these resources describe. Defaults to the state budget
  // (the data.egov.bg 79ce7de2 dataset). Pass "consolidated" when ingesting the
  // КФП consolidated dataset so downstream readers (the deficit baseline) can
  // pick the consolidated scope. See docs/budget_consolidated_kfp.md.
  constituent: ConstituentBudget = "state",
): KfpFile => {
  const observations: KfpObservation[] = [];
  for (const p of parsed)
    observations.push(...observationsFromParsed(p, constituent));
  observations.sort((a, b) =>
    a.period === b.period
      ? a.series.localeCompare(b.series)
      : a.period.localeCompare(b.period),
  );
  return {
    generatedAt: new Date().toISOString(),
    country: "BG",
    constituentBudget: constituent,
    sources,
    observations,
    snapshots: buildSnapshots(parsed, constituent),
  };
};

export { KFP_DOCUMENT_ID };
export type { ParsedResource };
