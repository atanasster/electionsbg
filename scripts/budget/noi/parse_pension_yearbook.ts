// Parses Table 6.3 ("Разход по видове пенсии за периода YYYY-YYYY г.") from
// the annual NOI pension yearbook PDF (Yearbook_Pensions_YYYY.pdf on
// nssi.bg). Yields the within-pension breakdown that the basic B1 files
// don't carry — old-age vs. disability vs. survivors vs. social pensions —
// across the 4 NOI pension funds.
//
// Table layout (verified against 2024 PDF):
//   Page ~154 (look for header "Разход по видове пенсии за периода")
//   Columns: label | 2020 | 2021 | 2022 | 2023 | 2024  (5-year window)
//   Each year value sits at a fixed x; the label runs left-of x≈220.
//   Rows: Roman-section fund subtotals (I, II, III, IV) + numbered children.
//
// Categorization: we collapse the ~25 line items into 4 user-facing buckets
// the drilldown surfaces — old-age, disability, social/non-contributory,
// other (supplementary, transfers, war-related). Mapping is by row label
// pattern, not row index, so the parser survives minor reordering.

import { createRequire } from "module";
import { toEur } from "../../../src/lib/currency";
import type { Money } from "../types";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist") as PdfjsLib;

interface PdfjsLib {
  getDocument: (opts: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    verbosity?: number;
  }) => { promise: Promise<PdfDocument> };
}
interface PdfTextItem {
  str: string;
  transform: number[];
}
interface PdfPage {
  getTextContent: () => Promise<{
    items: Array<PdfTextItem | { type: string }>;
  }>;
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

export type PensionCategory =
  | "old_age"
  | "disability"
  | "social"
  | "occupational"
  | "other";

export interface ParsedPensionYearbookRow {
  // The raw row label as printed ("2. Пенсии за осигурителен стаж и възраст",
  // "I. Фонд "Пенсии" /вкл.А /", etc.).
  label: string;
  // The mapped user-facing category. null for fund subtotal rows (I, II, III,
  // IV) and the grand-total row — those are aggregations, not leaves.
  category: PensionCategory | null;
  // Whether this row is a fund subtotal — used by the artifact builder to
  // recover fund-level totals without double-counting children.
  isSubtotal: boolean;
  // Single-year amount (the latest year column in the source) in BGN whole-
  // leva units (the yearbook prints amounts in leva, not thousands).
  amountBgn: number;
}

export interface ParsedPensionYearbook {
  fiscalYear: number;
  // The year the parser ATTRIBUTED these figures to — = the last (latest)
  // column on the PDF's 5-year strip, which is the year the yearbook is
  // titled for.
  yearColumnUsed: number;
  rows: ParsedPensionYearbookRow[];
  // The Roman-section subtotals — fund-level rollup that confirms parser
  // correctness against the artifact's own pensionsBgn from the B1 path.
  fundSubtotals: {
    fund1Pensions: number | null; // I. Фонд "Пенсии"
    fund2Article69: number | null; // II. Фонд "Пенсии за лицата по чл. 69"
    fund3NonContrib: number | null; // III. Фонд "Пенсии, несвързани..."
    fund4Occupational: number | null; // IV. Фонд "Трудова злополука..."
    grandTotal: number | null;
  };
}

// User-facing category mapping. Patterns are tested in order; first match
// wins. Roman-section fund subtotals + the grand total are categorised as
// null so they're excluded from the per-category sum.
const categorize = (label: string): PensionCategory | null => {
  const trimmed = label.trim();
  // Fund subtotals — skip from category aggregation.
  if (/^I\./i.test(trimmed) || /^II\./i.test(trimmed)) return null;
  if (/^III\./i.test(trimmed) || /^IV\./i.test(trimmed)) return null;
  if (/^А\.\s/i.test(trimmed) || /^Б\.\s/i.test(trimmed)) return null; // А./Б. = sub-fund partitions within Фонд IV
  if (/^Разход за пенсии - общо/i.test(trimmed)) return null;
  if (/^Трансфери за прехвърля/i.test(trimmed)) return null;
  if (/^\/вкл\./i.test(trimmed)) return null; // continuation of subtotal label
  if (/^Вид на пенсиите/i.test(trimmed)) return null; // header row
  if (/^Еднократна допълнителна сума/i.test(trimmed)) return "other"; // A.
  if (/^Добавки/i.test(trimmed) || /^Добавка/i.test(trimmed)) return "other";

  // Categorize the actual leaf rows. Order matters: "трудова злополука"
  // (occupational injury) must match BEFORE the generic "инвалидност"
  // (disability) pattern, otherwise §IV row children get bucketed as
  // disability and the occupational bucket stays €0. Same for "социални
  // пенсии" before generic "пенсии за осигурителен стаж".
  if (/(социални пенсии|социалн.+пенси)/i.test(trimmed)) return "social";
  if (
    /(старост|поборнически|народн|особени заслуги|персоналн|по чл\. 9|по чл\. 4|война|войните|с отделен указ|с указ|гражданска)/i.test(
      trimmed,
    )
  )
    return "social";
  if (/трудова злополука|проф(\.|есионална)\s*болест/i.test(trimmed))
    return "occupational";
  if (/инвалидност/i.test(trimmed)) return "disability";
  if (
    /(пенсии за осигурителен стаж|пенсии за осиг\. стаж|стаж и възраст|занаятчии|търговци)/i.test(
      trimmed,
    )
  )
    return "old_age";
  // Supplementary, transfers, additions — bucket as "other".
  return "other";
};

const fundFor = (
  label: string,
): keyof ParsedPensionYearbook["fundSubtotals"] | null => {
  const t = label.trim();
  if (/^I\.\s*Фонд/i.test(t)) return "fund1Pensions";
  if (/^II\.\s*Фонд/i.test(t)) return "fund2Article69";
  if (/^III\.\s*Фонд/i.test(t)) return "fund3NonContrib";
  if (/^IV\.\s*Фонд/i.test(t)) return "fund4Occupational";
  if (/^Разход за пенсии - общо/i.test(t)) return "grandTotal";
  return null;
};

interface PositionedItem {
  x: number;
  y: number;
  str: string;
}

const collectPageItems = async (page: PdfPage): Promise<PositionedItem[]> => {
  const content = await page.getTextContent();
  const items: PositionedItem[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    if (!it.str.trim()) continue;
    items.push({ x: it.transform[4], y: it.transform[5], str: it.str });
  }
  return items;
};

const findTablePage = async (
  doc: PdfDocument,
): Promise<{ pageNum: number; items: PositionedItem[] } | null> => {
  // The yearbook's TOC sits on early pages and may also contain
  // "Разход по видове пенсии" — pick the page where that header appears AND
  // it has the Roman-section row labels (a real table page, not a TOC).
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = await collectPageItems(page);
    const text = items.map((i) => i.str).join("");
    if (!text.includes("Разход по видове пенсии за периода")) continue;
    if (!/I\.\s*Фонд\s*"?Пенсии/i.test(text)) continue;
    return { pageNum: p, items };
  }
  return null;
};

const parseBgnNumber = (raw: string): number | null => {
  // "15 477 419 110" → 15477419110. Space-separated thousands; the source
  // never uses fractional leva for these amounts.
  const cleaned = raw.replace(/\s+/g, "").replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// The label column ends at x ≈ 220 on the 2024 PDF (a 2-column subtotal row
// like "I. Фонд "Пенсии"" extends to x≈210 with no values right of it; the
// subtotal values appear on the SAME y but at the year-column x positions).
// We treat any item with x < LABEL_MAX_X as belonging to the label.
const LABEL_MAX_X = 240;
// The 5 year columns sit roughly at these x mid-points (2024 PDF). We snap
// each value item to the closest column.
const YEAR_COLUMN_XS = [285, 340, 395, 450, 505];

const groupRows = (items: PositionedItem[]): Map<number, PositionedItem[]> => {
  const rows = new Map<number, PositionedItem[]>();
  for (const it of items) {
    const y = Math.round(it.y * 2) / 2;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push(it);
  }
  return rows;
};

export const parsePensionYearbook = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedPensionYearbook> => {
  const doc = await pdfjs.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const tablePage = await findTablePage(doc);
  if (!tablePage) {
    throw new Error(
      `Pension yearbook (${fiscalYear}): could not find Table 6.3 — searched all ${doc.numPages} pages.`,
    );
  }

  const rowsByY = groupRows(tablePage.items);
  // Sort rows top → bottom (descending y).
  const sortedYs = [...rowsByY.keys()].sort((a, b) => b - a);

  const out: ParsedPensionYearbookRow[] = [];
  const subtotals: ParsedPensionYearbook["fundSubtotals"] = {
    fund1Pensions: null,
    fund2Article69: null,
    fund3NonContrib: null,
    fund4Occupational: null,
    grandTotal: null,
  };
  // Fund subtotal labels sometimes wrap to a second physical row (label on
  // line N, values on line N+1). Carry the label forward when we see a row
  // that's only a label with no values.
  let carriedLabel: string | null = null;

  for (const y of sortedYs) {
    const row = rowsByY.get(y)!.sort((a, b) => a.x - b.x);
    const labelParts: string[] = [];
    const yearVals: (number | null)[] = [null, null, null, null, null];
    for (const it of row) {
      if (it.x < LABEL_MAX_X) {
        const t = it.str.trim();
        if (t) labelParts.push(t);
      } else {
        // Snap to closest year column.
        let bestIdx = 0;
        let bestDist = Math.abs(it.x - YEAR_COLUMN_XS[0]);
        for (let i = 1; i < YEAR_COLUMN_XS.length; i++) {
          const d = Math.abs(it.x - YEAR_COLUMN_XS[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        const n = parseBgnNumber(it.str);
        if (n !== null) yearVals[bestIdx] = n;
      }
    }
    const label = labelParts.join(" ").replace(/\s+/g, " ").trim();
    const latestVal = yearVals[YEAR_COLUMN_XS.length - 1];
    const hasNumbers = yearVals.some((v) => v !== null);

    // Headers / blank rows.
    if (!label && !hasNumbers) continue;
    // Pure-label row (subtotal continuation) — carry forward.
    if (label && !hasNumbers) {
      carriedLabel = carriedLabel ? `${carriedLabel} ${label}` : label;
      continue;
    }
    // Pure-value row — values belong to the carried label.
    const effectiveLabel = label || carriedLabel || "";
    carriedLabel = null;
    if (!effectiveLabel) continue;

    const fund = fundFor(effectiveLabel);
    if (fund && latestVal !== null) subtotals[fund] = latestVal;

    out.push({
      label: effectiveLabel,
      category: categorize(effectiveLabel),
      isSubtotal: fund !== null,
      amountBgn: latestVal ?? 0,
    });
  }

  return {
    fiscalYear,
    yearColumnUsed: fiscalYear,
    rows: out,
    fundSubtotals: subtotals,
  };
};

// ---------------------------------------------------------------------------
// Artifact contribution — per-category Money rollup that the NOI funds.json
// embeds for the latest fiscal year so the social-funds drilldown can render
// a depth-3 pension-type breakdown.
// ---------------------------------------------------------------------------

export interface PensionTypeBreakdown {
  oldAge: Money;
  disability: Money;
  social: Money;
  occupational: Money;
  other: Money;
  // Sum of the above — should match the parsed grand-total within rounding.
  total: Money;
}

const moneyFromBgn = (bgn: number): Money => {
  const eur = toEur(bgn, "BGN");
  return {
    amount: bgn,
    currency: "BGN",
    amountEur: eur == null ? bgn : Math.round(eur),
  };
};

export const aggregatePensionTypes = (
  parsed: ParsedPensionYearbook,
): PensionTypeBreakdown => {
  const sums: Record<PensionCategory, number> = {
    old_age: 0,
    disability: 0,
    social: 0,
    occupational: 0,
    other: 0,
  };
  for (const row of parsed.rows) {
    if (row.isSubtotal) continue;
    if (!row.category) continue;
    sums[row.category] += row.amountBgn;
  }
  const totalBgn =
    sums.old_age +
    sums.disability +
    sums.social +
    sums.occupational +
    sums.other;
  return {
    oldAge: moneyFromBgn(sums.old_age),
    disability: moneyFromBgn(sums.disability),
    social: moneyFromBgn(sums.social),
    occupational: moneyFromBgn(sums.occupational),
    other: moneyFromBgn(sums.other),
    total: moneyFromBgn(totalBgn),
  };
};
