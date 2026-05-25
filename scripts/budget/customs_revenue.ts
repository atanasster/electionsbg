// Customs Agency revenue-breakdown parser. Itemises the consolidated-budget
// excise wedge (~3.8B EUR) into product groups + sub-products, plus the import-
// VAT total and the customs-duties total — the three streams the agency
// administers and reports on annually.
//
// Source: Агенция "Митници" — "Митническа хроника" annual report PDF
// (customs.bg). The report is a narrative magazine, NOT a structured table, but
// every figure we want appears in a strict editorial template that has been
// stable across years: "Касовите приходи от акциз за <group> през <year> г. са
// в размер на <X> млн. лева". We extract via regex over column-aware text.
//
// The PDF lays out two columns per page; pdf2array interleaves cells from the
// two columns which mangles the narrative. We use pdfjs-dist directly with
// item positions: split items into left/right columns at pageWidth/2, sort
// each column top-to-bottom, and concatenate.

import { createRequire } from "module";
import { toEur } from "../../src/lib/currency";

const require = createRequire(import.meta.url);

interface PdfTextItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] — e,f are X,Y of text origin
  width: number;
}
interface PdfPage {
  getTextContent: () => Promise<{
    items: Array<PdfTextItem | { type: string }>;
  }>;
  getViewport: (opts: { scale: number }) => { width: number };
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
interface PdfjsLib {
  getDocument: (opts: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<PdfDocument>;
  };
}

const pdfjs = require("pdfjs-dist") as PdfjsLib;

// Older Митническа хроника issues (2022-2024) carry a structured "Таблица 1"
// on the chapter intro page: 4–5 rows × 4 numeric columns. The rows are
// labelled in the leftmost column (ОБЩО, Акциз, ДДС при внос, Мита, Глоби)
// and the numeric cells lay out as
//   [Изпълнение T-1] [Годишен план T] [Изпълнение T] [% на плана].
// We scan every page; when we find ≥3 row labels in roughly the same X column,
// we treat the items at the same Y as table rows and pull cell 2 (the current
// year's actual). The 2025 issue dropped this table — caller falls back to
// narrative regex when this extractor returns no rows.
interface TableExtraction {
  total: number | null;
  excise: number | null;
  importVat: number | null;
  customs: number | null;
  fines: number | null;
  plannedTotal: number | null;
  plannedExcise: number | null;
  plannedImportVat: number | null;
  plannedCustoms: number | null;
}

// Row labels — both 2023 ("Акциз") and 2024 ("Акцизи") spellings; same for
// "Глоби" (2024) vs "Глоби, санкции" (2023).
const ROW_LABELS: Array<{ key: keyof TableExtraction; re: RegExp }> = [
  { key: "total", re: /^\s*ОБЩО:?\s*$/i },
  { key: "excise", re: /^\s*Акциз[иеa]?\s*$/i },
  { key: "importVat", re: /^\s*ДДС\s+при\s+внос\s*$/i },
  { key: "customs", re: /^\s*Мита\s*$/i },
  // Wrapped row label in 2023 ("Глоби, санкции, лихви и\nдруги приходи");
  // bare "Глоби, санкции" in 2024 — no $-anchor here.
  { key: "fines", re: /^\s*Глоби(?:,?\s*санкции)?/i },
];

const findTableRows = async (
  page: PdfPage,
): Promise<TableExtraction | null> => {
  const tc = await page.getTextContent();
  const items: PdfTextItem[] = (
    tc.items as Array<{ str?: string; transform?: number[] }>
  ).filter(
    (i): i is PdfTextItem =>
      typeof (i as PdfTextItem).str === "string" &&
      Array.isArray((i as PdfTextItem).transform),
  );

  // Locate label rows.
  type LabelHit = {
    key: keyof TableExtraction;
    y: number;
    x: number;
  };
  const hits: LabelHit[] = [];
  for (const it of items) {
    for (const { key, re } of ROW_LABELS) {
      if (re.test(it.str)) {
        hits.push({ key, y: it.transform[5], x: it.transform[4] });
        break;
      }
    }
  }
  // The table labels share an X-anchor (the leftmost column). Stray label
  // mentions elsewhere on the page (chart captions, body-text references)
  // would inflate the X-span; instead, find the densest X-cluster (±10 px)
  // and discard hits outside it. Then check we still have ≥3 of the four
  // main keys.
  const tableHits = (() => {
    let best: typeof hits = [];
    for (const candidate of hits) {
      const cluster = hits.filter((h) => Math.abs(h.x - candidate.x) <= 10);
      if (cluster.length > best.length) best = cluster;
    }
    return best;
  })();
  const mainKeys: Array<keyof TableExtraction> = [
    "total",
    "excise",
    "importVat",
    "customs",
  ];
  const haveKeys = new Set(tableHits.map((h) => h.key));
  const haveMains = mainKeys.filter((k) => haveKeys.has(k)).length;
  if (haveMains < 3) return null;

  // For each label, gather numeric cells at the same Y (±3 px) sorted by X.
  // Numeric cells are tokens that match a Bulgarian decimal: "5 706.9",
  // "13 397.7", "103.5", "10.0". Stray tokens that don't parse are skipped.
  const NUM_RE = /^-?\d[\d  ]*(?:[.,]\d+)?$/;
  const out: TableExtraction = {
    total: null,
    excise: null,
    importVat: null,
    customs: null,
    fines: null,
    plannedTotal: null,
    plannedExcise: null,
    plannedImportVat: null,
    plannedCustoms: null,
  };
  for (const hit of tableHits) {
    // ±8 px tolerance — covers wrapped labels like "Глоби, санкции\nи други
    // приходи" in 2024 where the value row sits between the two label lines.
    // The next-row label is always ≥15 px away so this can't cross-contaminate.
    const rowItems = items
      .filter(
        (it) =>
          Math.abs(it.transform[5] - hit.y) <= 8 &&
          it.transform[4] > hit.x + 30 &&
          NUM_RE.test(it.str.trim()),
      )
      .sort((a, b) => a.transform[4] - b.transform[4]);
    if (rowItems.length < 3) continue;
    const planned = parseMillions(rowItems[1].str);
    const executed = parseMillions(rowItems[2].str);
    out[hit.key] = executed;
    if (hit.key === "total") out.plannedTotal = planned;
    if (hit.key === "excise") out.plannedExcise = planned;
    if (hit.key === "importVat") out.plannedImportVat = planned;
    if (hit.key === "customs") out.plannedCustoms = planned;
  }
  // Need to actually have populated at least 3 of the four mains to count as
  // a successful table parse — guards against pages that match the heuristic
  // but have malformed numeric cells.
  const mainCount = [out.total, out.excise, out.importVat, out.customs].filter(
    (v) => v != null,
  ).length;
  return mainCount >= 3 ? out : null;
};

const findTable1 = async (
  doc: PdfDocument,
): Promise<TableExtraction | null> => {
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const result = await findTableRows(page);
    if (result) return result;
  }
  return null;
};

// Per-page column detection. 2025-era reports are single-page layouts
// (pageWidth ~609, 2 text columns); 2023-era reports are double-page spreads
// (pageWidth ~1218, 4 text columns) — both must work without a hard-coded
// midpoint. Cluster item start-X positions; treat the recurring positions
// (≥10 items align there) as column anchors, and assign every item to the
// nearest one ≤ its X.
const detectColumnAnchors = (items: PdfTextItem[]): number[] => {
  const buckets = new Map<number, number>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const xBucket = Math.round(it.transform[4] / 5) * 5;
    buckets.set(xBucket, (buckets.get(xBucket) ?? 0) + 1);
  }
  // Threshold of 5 items: low enough that a short column (e.g. the last page
  // of a chapter that fills only half its column) still qualifies, high
  // enough to reject single stray text fragments.
  const candidates = [...buckets.entries()]
    .filter(([, count]) => count >= 5)
    .map(([x]) => x)
    .sort((a, b) => a - b);
  // Merge anchors closer than 30 px (same column with sub-pixel jitter or a
  // one-off bullet indent that doesn't deserve its own column).
  const merged: number[] = [];
  for (const a of candidates) {
    if (merged.length === 0 || a - merged[merged.length - 1] > 30) {
      merged.push(a);
    }
  }
  return merged;
};

// Column-aware text extraction. Returns one flat string per document; columns
// are joined in reading order (left-to-right across all detected anchors,
// page-by-page). Within a column, sort by Y descending (PDF Y grows upward)
// then by X ascending for ties. Caller passes an already-opened PdfDocument
// so pdfjs's structured-clone buffer transfer only runs once per parse.
const extractTextFromDoc = async (doc: PdfDocument): Promise<string> => {
  const segments: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: PdfTextItem[] = tc.items.filter(
      (i): i is PdfTextItem => typeof (i as PdfTextItem).str === "string",
    );
    const anchors = detectColumnAnchors(items);
    // Fall back to a single column on sparse pages (titles, image-only).
    const colCount = anchors.length || 1;
    const cols: PdfTextItem[][] = Array.from({ length: colCount }, () => []);
    for (const it of items) {
      if (anchors.length === 0) {
        cols[0].push(it);
        continue;
      }
      let idx = 0;
      for (let i = 0; i < anchors.length; i++) {
        if (it.transform[4] >= anchors[i] - 5) idx = i;
      }
      cols[idx].push(it);
    }
    const sortCol = (col: PdfTextItem[]) =>
      col.sort((a, b) => {
        const dy = b.transform[5] - a.transform[5];
        if (Math.abs(dy) > 2) return dy;
        return a.transform[4] - b.transform[4];
      });
    const joinCol = (col: PdfTextItem[]): string =>
      col
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    for (const col of cols) {
      sortCol(col);
      segments.push(joinCol(col));
    }
  }
  return segments.join("\n\n");
};

// Parse "2 821.1" / "2,821.1" / "7 423.7" / "2 018" / "(- 41.3)" into a Number
// of millions in the native currency (BGN before 2026, EUR thereafter).
// Returns null when the cell contains anything outside this shape.
const parseMillions = (raw: string): number | null => {
  if (raw == null) return null;
  // Normalise NBSP/thin-space and Bulgarian/Western decimal separators.
  let cleaned = raw
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  // Handle "(- 41.3)" / "- 41.3" — kept negative, signals a net-of-refunds
  // value the source publishes.
  let sign = 1;
  if (/^\(?-/.test(cleaned)) {
    sign = -1;
    cleaned = cleaned.replace(/^\(?-/, "").replace(/\)$/, "");
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return sign * n;
};

interface RevenueLine {
  id: string;
  labelBg: string;
  labelEn: string;
  millionsNative: number | null;
  pattern: RegExp;
}

// Editorial template that has been stable in the report for years.
// `\\d{4}` is templated with the actual fiscal year at parse time so a 2024
// report's "през 2024 г." doesn't accidentally pick up references to 2023
// inside the same paragraph.
const PATTERNS = (year: number): RevenueLine[] => {
  const Y = String(year);
  // Bulgarian PDF text often inserts a soft-hyphen on line wraps (e.g.
  // "тю- тюневи"); accept zero or more `-\s` interleaves between any two
  // word characters in the keyphrase by using \S*[-\s] gaps.
  // `M` is the shared trailing fragment: amount + unit. Some lines use
  // "е <amount>" instead of "са в размер на" — variants enumerated per line.
  const AMT = `(\\d[\\d  ]*(?:[.,]\\d+)?)`;
  const MLN = `\\s*млн\\.?\\s*лева`;
  return [
    {
      id: "total_collected",
      labelBg: "Общи постъпления (акцизи, ДДС при внос, мита, глоби)",
      labelEn: "Total collections (excise, import VAT, customs, fines)",
      millionsNative: null,
      pattern: new RegExp(
        `касовите постъпления от акцизи,?\\s*ДДС при внос,? мита и глоби,?\\s*събрани от Аген-?\\s*ция\\s*„?Митници[”""]?\\s*са\\s+в\\s+размер\\s+на\\s+${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_total",
      labelBg: "Акциз",
      labelEn: "Excise duties",
      millionsNative: null,
      pattern: new RegExp(
        `През ${Y}\\s+г\\.\\s+касовите постъпления от акциз са\\s+в размер на ${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_fuels",
      labelBg: "Акциз — Горива",
      labelEn: "Excise — Fuels",
      millionsNative: null,
      pattern: new RegExp(
        `Касовите приходи от акциз за горива през ${Y}\\s*г\\.\\s+са в размер на ${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_diesel",
      labelBg: "Акциз — Газьол (дизел)",
      labelEn: "Excise — Diesel",
      millionsNative: null,
      // "Сумата на акциза за газьол, ефективно постъпила в държавния бюджет
      //  през 2025 г. (касово изпълнение) е 2 018 млн. лева"
      pattern: new RegExp(
        `Сумата на акциза за газьол,?\\s+ефективно\\s+постъпила\\s+в\\s+държавния\\s+бюджет\\s+през ${Y}\\s+г\\.\\s+\\(касово изпълнение\\)\\s+е\\s+${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_petrol",
      labelBg: "Акциз — Бензин",
      labelEn: "Excise — Petrol",
      millionsNative: null,
      pattern: new RegExp(
        `Ефективно постъпилата сума от ак-?\\s*циз за бензин през ${Y}\\s+г\\.\\s+е в размер на ${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_lpg",
      labelBg: "Акциз — Втечнен нефтен газ (ВНГ)",
      labelEn: "Excise — LPG",
      millionsNative: null,
      // "Приходите от акциз за втечнен нефтен газ заемат N% ...
      //  Касовите постъпления от акциз са в размер на 128.5 млн. лева"
      pattern: new RegExp(
        `Приходите от акциз за втечнен нефтен газ.{0,200}?Касовите постъпления от акциз\\s+са в размер на ${AMT}${MLN}`,
        "is",
      ),
    },
    {
      id: "excise_natural_gas",
      labelBg: "Акциз — Природен газ",
      labelEn: "Excise — Natural gas",
      millionsNative: null,
      pattern: new RegExp(
        `Нетните приходи от акциз за природен газ\\s+през ${Y}\\s+г\\.\\s+са в размер на ${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_kerosene_net",
      labelBg: "Акциз — Керосин (нетен)",
      labelEn: "Excise — Kerosene (net)",
      millionsNative: null,
      pattern: new RegExp(
        `Нетната сума на акциза за керосин\\s+през ${Y}\\s+г\\.\\s+е ${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_tobacco",
      labelBg: "Акциз — Тютюн и тютюневи изделия",
      labelEn: "Excise — Tobacco",
      millionsNative: null,
      // "Касовите приходи от акциз за тютюн и тю- тюневи изделия през 2025 г.
      //  са в размер на 4 210.3 млн. лева" — the year token wraps line, and
      //  the amount itself wraps (4 \n 210.3) in the PDF.
      pattern: new RegExp(
        `Касовите приходи от акциз за тютюн и тю-?\\s*тюневи изделия през ${Y}\\s+г\\.\\s+са\\s+в\\s+размер\\s+на\\s+${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "excise_alcohol",
      labelBg: "Акциз — Алкохол, алкохолни напитки и бира",
      labelEn: "Excise — Alcohol & beer",
      millionsNative: null,
      pattern: new RegExp(
        `Нетните приходи от акциз за алкохол,?\\s*ал-?\\s*кохолни напитки и бира през ${Y}\\s+г\\.\\s+възлизат\\s+на\\s+${AMT}${MLN}`,
        "i",
      ),
    },
    {
      id: "import_vat_total",
      labelBg: "ДДС при внос",
      labelEn: "Import VAT",
      millionsNative: null,
      // Long sentence with several wrapped commas; .{0,400}? to bridge the
      // boilerplate between "Постъпленията от ДДС при внос..." and the amount.
      pattern: new RegExp(
        `Постъпленията от ДДС при внос на стоки\\s+през ${Y}\\s+г\\..{0,400}?са в размер на ${AMT}${MLN}`,
        "is",
      ),
    },
    {
      id: "customs_duties_total",
      labelBg: "Мита при внос",
      labelEn: "Customs duties",
      millionsNative: null,
      pattern: new RegExp(
        `През ${Y}\\s+г\\.\\s+приходите от мита при внос на стоки\\s+от трети страни\\s+са в размер на ${AMT}${MLN}`,
        "i",
      ),
    },
  ];
};

// Country-of-origin split for customs duties. The report's "ПРИХОДИ ОТ МИТА"
// chapter enumerates the top-5 countries of origin. Across editions the
// templates drift; we match four shapes:
//   2025-style paren:    "произход <Country> (X млн. лева, Y% относителен ..."
//   2023-style paren:    "внесени от <Country> (X млн. лева приходи, Y% ...)" — extra "приходи"
//   2023-style dash:     "произход <Country> – X млн. лева, Y% дял"
//   leading-country:     "стоки от <Country>. Декларираната сума [за <year> г.] е X млн. лева, което представлява Y%"
// All four reuse the same capture groups (1=name, 2=amount, 3=share %).
// Note: no /i flag here. Country names need case sensitivity ([А-Я][а-я]+
// would otherwise match "от Русия" because case-insensitive makes the two
// character classes equivalent).
const COUNTRY_PAREN_RE =
  /(?:произход|внесени\s+от|внос\s+от)\s+([А-Я][а-я]+(?:\s+(?:република|[а-я]+))?|[А-Я]{2,4})\s*\(\s*(\d[\d  ]*(?:[.,]\d+)?)\s*млн\.?\s*лева(?:\s+приходи)?\s*,\s*(\d[\d  ]*(?:[.,]\d+)?)\s*%/g;
// Enumerated form: "..., <Country> (X млн. лева, Y%), <Country> (..., и <Country> (...)".
// Country tokens are conservative: leading cap + lowercase tail, OR all-caps
// abbreviation (САЩ, ОАЕ). The leading verb is optional — the parenthetical
// itself is uncommon enough that within the chapter slice it's reliable.
const COUNTRY_CHAIN_RE =
  /(?:,|и)\s+([А-Я][а-я]+(?:\s+[а-я]+)?|[А-Я]{2,4})\s*\(\s*(\d[\d  ]*(?:[.,]\d+)?)\s*млн\.?\s*лева(?:\s+приходи)?\s*,\s*(\d[\d  ]*(?:[.,]\d+)?)\s*%/g;
const COUNTRY_DASH_RE =
  /(?:произход|внесени\s+от)\s+([А-Я][а-я]+(?:\s+[а-я]+)?)\s*[–—-]\s+(\d[\d  ]*(?:[.,]\d+)?)\s*млн\.?\s*лева,\s*(\d[\d  ]*(?:[.,]\d+)?)\s*%/g;
const COUNTRY_LEAD_RE =
  /(?:приходи(?:те)?\s+от\s+мита\s+при\s+внос\s+на\s+стоки\s+от|стоки\s+от)\s+([А-Я][а-я]+(?:\s+[а-я]+)?)\.?\s+Декларираната\s+сума(?:\s+за\s+\d{4}\s+г\.)?\s+е\s+(\d[\d  ]*(?:[.,]\d+)?)\s*млн\.?\s*лева,\s*което\s+представлява\s+(\d[\d  ]*(?:[.,]\d+)?)\s*%/i;

const extractCustomsByCountry = (
  text: string,
): { name: string; millionsNative: number; share: number }[] => {
  // Bound to the customs-duties chapter — anchored on a body-unique sentence
  // that only appears in the chapter introduction. Using the heading
  // "ПРИХОДИ ОТ МИТА" would also catch the table-of-contents entry, which is
  // followed by import-VAT text and not country mentions.
  const start = text.indexOf("приходите от мита при внос на стоки");
  const end = text.indexOf("АДМИНИСТРАТИВНИ НАРУШЕНИЯ");
  const raw = start >= 0 && end > start ? text.slice(start, end) : text;
  // Strip "Ин- дия" style line-wrap hyphens within a Cyrillic word so country
  // names (and the trailing parenthetical) match cleanly.
  const slice = raw.replace(/(\p{L})-\s+(\p{Ll})/gu, "$1$2");

  const out: { name: string; millionsNative: number; share: number }[] = [];
  const seen = new Set<string>();
  const push = (name: string, amt: number | null, share: number | null) => {
    if (amt == null || share == null) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, millionsNative: amt, share });
  };

  const lead = slice.match(COUNTRY_LEAD_RE);
  if (lead) {
    push(lead[1].trim(), parseMillions(lead[2]), parseMillions(lead[3]));
  }
  for (const re of [COUNTRY_PAREN_RE, COUNTRY_DASH_RE, COUNTRY_CHAIN_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) != null) {
      push(m[1].trim(), parseMillions(m[2]), parseMillions(m[3]));
    }
  }
  // Sort by share desc to give the UI the natural top-N order.
  out.sort((a, b) => b.share - a.share);
  return out;
};

// Convert a millions-native figure to the canonical pair { amount, amountEur }
// in whole native units (lev for BGN, cent for EUR).
const toMoney = (
  millions: number | null,
  currency: "BGN" | "EUR",
): { amount: number; currency: "BGN" | "EUR"; amountEur: number } | null => {
  if (millions == null) return null;
  const amount = Math.round(millions * 1_000_000);
  const eur = toEur(amount, currency);
  return {
    amount,
    currency,
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

export interface CustomsRevenueLine {
  id: string;
  labelBg: string;
  labelEn: string;
  amount: number | null;
  amountEur: number | null;
  parent: string | null;
  share?: number | null; // share of the parent (excise total etc.), 0–1
}

export interface CustomsRevenueByCountry {
  name: string;
  amount: number;
  amountEur: number;
  sharePct: number; // 0–100 (as the source reports it)
}

export interface CustomsRevenueFile {
  generatedAt: string;
  country: "BG";
  fiscalYear: number;
  asOf: string; // YYYY-12-31
  currency: "BGN" | "EUR";
  source: {
    publisher: string;
    document: string;
    url: string;
  };
  lines: CustomsRevenueLine[];
  customsByCountry: CustomsRevenueByCountry[];
}

// PARENT_OF declares the hierarchy used by the UI: excise_* roll up to
// excise_total; the four mid-level groups (fuels, tobacco, alcohol) split
// excise_total; the five fuel sub-products split excise_fuels; etc.
const PARENT_OF: Record<string, string | null> = {
  total_collected: null,
  excise_total: "total_collected",
  excise_fuels: "excise_total",
  excise_tobacco: "excise_total",
  excise_alcohol: "excise_total",
  excise_diesel: "excise_fuels",
  excise_petrol: "excise_fuels",
  excise_lpg: "excise_fuels",
  excise_natural_gas: "excise_fuels",
  excise_kerosene_net: "excise_fuels",
  import_vat_total: "total_collected",
  customs_duties_total: "total_collected",
};

// Map a table-extraction key to the parser's line id.
const TABLE_KEY_TO_LINE_ID: Record<
  Exclude<keyof TableExtraction, `planned${string}`>,
  string
> = {
  total: "total_collected",
  excise: "excise_total",
  importVat: "import_vat_total",
  customs: "customs_duties_total",
  fines: "fines_total",
};

export const parseCustomsHronikaPdf = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
  source: { url: string },
): Promise<CustomsRevenueFile> => {
  // BG adopted EUR on 2026-01-01; reports for FY 2026+ are in EUR.
  const currency: "BGN" | "EUR" = fiscalYear >= 2026 ? "EUR" : "BGN";

  // pdfjs's getDocument transfers the input buffer; opening the same doc twice
  // raises DataCloneError. Open once, hand the same PdfDocument to both
  // passes.
  const doc = await pdfjs.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
  }).promise;

  // First pass: try the Таблица 1 extractor. Older reports (2022-2024) carry
  // it and it's far more robust than narrative regex — gives total + four
  // main lines + the plan figures for each.
  const tableExtraction = await findTable1(doc);

  const text = await extractTextFromDoc(doc);
  const patterns = PATTERNS(fiscalYear);
  const lines: CustomsRevenueLine[] = [];

  for (const pat of patterns) {
    const m = text.match(pat.pattern);
    const millions = m ? parseMillions(m[1]) : null;
    const money = toMoney(millions, currency);
    lines.push({
      id: pat.id,
      labelBg: pat.labelBg,
      labelEn: pat.labelEn,
      amount: money?.amount ?? null,
      amountEur: money?.amountEur ?? null,
      parent: PARENT_OF[pat.id] ?? null,
    });
  }

  // Layer Table 1 over narrative. Narrative tends to use rounded figures
  // ("6 148.0 млн. лева"); Table 1 uses the same rounding, so values match
  // when both are available. When narrative didn't match, the table fills in.
  if (tableExtraction) {
    for (const [tableKey, lineId] of Object.entries(
      TABLE_KEY_TO_LINE_ID,
    ) as Array<[keyof TableExtraction, string]>) {
      const millions = tableExtraction[tableKey];
      if (millions == null) continue;
      const money = toMoney(millions, currency);
      if (!money) continue;
      const existing = lines.find((l) => l.id === lineId);
      if (existing) {
        if (existing.amount == null) {
          existing.amount = money.amount;
          existing.amountEur = money.amountEur;
        }
      } else {
        // "fines_total" isn't in the narrative-pattern list — add it from
        // the table so it shows up in the breakdown.
        lines.push({
          id: lineId,
          labelBg: "Глоби, санкции, лихви и други приходи",
          labelEn: "Fines, penalties, interest and other revenue",
          amount: money.amount,
          amountEur: money.amountEur,
          parent: "total_collected",
        });
      }
    }
  }

  // Compute share-of-parent for every child that has a value AND a parent
  // whose total is known. Decimal 0–1 — UI multiplies by 100 for display.
  for (const line of lines) {
    if (line.parent == null || line.amount == null) continue;
    const parentLine = lines.find((l) => l.id === line.parent);
    if (!parentLine || parentLine.amount == null || parentLine.amount === 0) {
      continue;
    }
    line.share = line.amount / parentLine.amount;
  }

  const customsByCountry: CustomsRevenueByCountry[] = extractCustomsByCountry(
    text,
  ).map((c) => {
    const money = toMoney(c.millionsNative, currency)!;
    return {
      name: c.name,
      amount: money.amount,
      amountEur: money.amountEur,
      sharePct: c.share,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    country: "BG",
    fiscalYear,
    asOf: `${fiscalYear}-12-31`,
    currency,
    source: {
      publisher: 'Агенция "Митници"',
      document: `Митническа хроника — Българските митници през ${fiscalYear} г.`,
      url: source.url,
    },
    lines,
    customsByCountry,
  };
};

// Hand-curated catalogue of report URLs. The customs.bg site serves them off a
// WebSphere portal with opaque UUIDs, so resolving the URL programmatically is
// noisy. New years get added here once the report is published (typically
// March of year T+1).
//
// 2025-format reports use single-page PDFs (pageWidth ~609, 2 text columns).
// 2023-format reports are double-page spreads (pageWidth ~1218, 4 columns).
// The column auto-detector in extractText() handles both layouts.
export const MITNICHESKA_HRONIKA_REPORTS: Record<number, string> = {
  2025: "https://customs.bg/wps/wcm/connect/customs.bg28892/2beb244f-3618-4fe8-b3dc-7b46bdc288d8/Mitnicheska_hronika-02-03-04-2025_sait.pdf?MOD=AJPERES",
  2024: "https://customs.bg/wps/wcm/connect/customs.bg28892/3568e94e-a883-4ab5-a455-9c080ae6ac9d/Mitnicheska_hronika-03-04-2024_small.pdf?MOD=AJPERES",
  2023: "https://customs.bg/wps/wcm/connect/customs.bg28892/890abab9-b78d-4910-9e9a-fc168306e1e9/Mitnicheska_hronika2023.pdf?MOD=AJPERES",
  2022: "https://customs.bg/wps/wcm/connect/customs.bg28892/72b30309-cf05-4880-9cf2-34f3ef38f0e7/MH_04-2022+-FINAL.pdf?MOD=AJPERES",
};
