// Parses Article 53 of the State Budget Law — the per-municipality table that
// allocates the state's annual transfer envelope to each of the ~265 общини.
//
// The article structures the data as:
//   1. A lead paragraph naming five named transfer-type totals (the budget
//      envelope) embedded in prose, in thousands of leva.
//   2. A 7-column table grouped by oblast header rows. Each municipality row
//      carries the municipality name + the breakdown across:
//        col 2: Основни бюджетни взаимоотношения           — total (= 3+4+5+6)
//        col 3: Обща субсидия за делегираните от държавата дейности
//        col 4: обща изравнителна субсидия
//        col 5: за зимно поддържане и снегопочистване на общински пътища
//        col 6: Целева субсидия за капиталови разходи
//        col 7: Трансфери за други целеви разходи за местни дейности
//
// Oblast headers are detected by their styling (single non-empty cell, all
// other cells empty) AND their text starting with "ОБЛАСТ ". Sofia city
// ("СТОЛИЧНА ОБЩИНА") appears as a regular data row between the Smolyan and
// Sofia-region headers — handled by the municipality_lookup helper.
//
// Amounts in the source are хил. лв. (thousands of leva); we convert to Money
// the same way law_html.ts does — multiply by 1000 and translate to EUR via
// the locked currency peg.

import { load } from "cheerio";
import { toEur } from "../../src/lib/currency";
import type { Money } from "./types";
import {
  oblastHeaderToCode,
  resolveMunicipality,
  type MunicipalityRecord,
} from "./lib/municipality_lookup";

export type TransferType =
  | "delegated"
  | "equalization"
  | "winter"
  | "capital"
  | "otherTargeted";

export interface MunicipalTransferTypeTotals {
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface ParsedMunicipalRow {
  ekatte: string;
  obshtinaCode: string;
  oblastCode: string;
  nuts3: string;
  nameBg: string;
  nameEn: string;
  total: Money | null;
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface ParsedMunicipalTransfers {
  fiscalYear: number;
  // Top-level transfer-type totals from the lead paragraph. The fifth field
  // (otherTargeted) is declared in a separate sub-paragraph but belongs to the
  // same envelope semantically.
  totals: MunicipalTransferTypeTotals;
  // Whole-country grand-total computed by summing column 2 ("Основни …") plus
  // column 7 ("Други целеви") across every municipality row. Reconciled
  // against `sumOfTotals(totals)` by the caller as a parser-correctness canary.
  rowSum: {
    total: Money;
    delegated: Money;
    equalization: Money;
    winter: Money;
    capital: Money;
    otherTargeted: Money;
  };
  municipalities: ParsedMunicipalRow[];
  // Names that appeared in the table but couldn't be matched to a known
  // municipality. Empty when everything resolved; populated when the source
  // introduces a new spelling that the lookup map doesn't cover.
  unresolvedNames: string[];
}

// Parse a Bulgarian number with space/NBSP thousands separators and a comma
// decimal point. Returns null for blank or non-numeric input.
const parseBulgarianAmount = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const makeMoney = (thousandsBgn: number | null): Money | null => {
  if (thousandsBgn === null) return null;
  const amount = Math.round(thousandsBgn * 1000);
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const cellText = (s: string | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

// Pull the lead-paragraph totals out of Article 53's introductory prose. The
// law writes the named amounts inline; we match by named phrase rather than
// positional order so the order can drift across years.
const parseLeadParagraph = (
  paragraphText: string,
): {
  delegated: number | null;
  equalization: number | null;
  winter: number | null;
  capital: number | null;
} => {
  const text = paragraphText.replace(/\u00A0/g, " ");
  const extractAfter = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    return parseBulgarianAmount(m[1]);
  };
  return {
    delegated: extractAfter(
      /делегираните от държавата дейности\s+([\d\s,]+?)\s*хил\.\s*лв/i,
    ),
    equalization: extractAfter(
      /обща изравнителна субсидия\s+([\d\s,]+?)\s*хил\.\s*лв/i,
    ),
    winter: extractAfter(
      /зимно поддържане и снегопочистване(?: на общински пътища)?\s+([\d\s,]+?)\s*хил\.\s*лв/i,
    ),
    capital: extractAfter(
      /целева субсидия за капиталови разходи\s+([\d\s,]+?)\s*хил\.\s*лв/i,
    ),
  };
};

const parseOtherTargetedTotal = (paragraphText: string): number | null => {
  const text = paragraphText.replace(/\u00A0/g, " ");
  const m = text.match(
    /трансфери за други целеви разходи за местни дейности\s+([\d\s,]+?)\s*хил\.\s*лв/i,
  );
  return m ? parseBulgarianAmount(m[1]) : null;
};

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

// Wording drift across years:
//   2025/2024/2023: "размерите на бюджетните взаимоотношения" (definite)
//   2022:           "размерите на основните бюджетни взаимоотношения"
// Plus optional whitespace tolerance for nested span boundaries.
const ANCHOR_RE =
  /размерите на (?:основните\s+бюджетни|бюджетните)\s+взаимоотношения\s+между централния бюджет и бюджетите на общините/i;

// Walk the DOM depth-first to find the per-municipality transfer table.
// Anchor on the canonical phrase rather than a fixed article number — the
// article number drifts (Чл. 53 in 2024/2025, Чл. 51 in 2022/2023, etc.) but
// the phrase is stable. The first <table> after the anchor is the per-
// municipality allocation table; downstream tables are detail annexes which
// we currently skip.
const walkAnchorTable = (
  root: DomNode,
): {
  leadText: string;
  table: DomNode | null;
} => {
  let leadText = "";
  let table: DomNode | null = null;
  let pastMarker = false;
  let leadCharsRemaining = 4000; // ~4 KB of prose collected after the marker
  const visit = (node: DomNode): void => {
    if (table) return;
    if (node.type === "text" && node.data) {
      const text = node.data.replace(/\u00A0/g, " ");
      if (!pastMarker) {
        if (ANCHOR_RE.test(text)) {
          pastMarker = true;
          // Capture the anchor text itself so the lead-paragraph parser sees
          // the named amounts that appear in the same sentence.
          leadText += text;
          leadCharsRemaining -= text.length;
        }
      } else if (leadCharsRemaining > 0) {
        leadText += text;
        leadCharsRemaining -= text.length;
      }
    }
    if (node.type === "tag" && node.name === "table" && pastMarker) {
      table = node;
      return;
    }
    for (const child of node.children ?? []) {
      if (table) return;
      visit(child);
    }
  };
  visit(root);
  return { leadText, table };
};

const tableRows = (
  tableNode: DomNode,
  $: ReturnType<typeof load>,
): string[][] => {
  const rows: string[][] = [];
  $(tableNode as never)
    .find("tr")
    .each((_, tr) => {
      const cells = $(tr)
        .find("td,th")
        .map((__, td) => cellText($(td).text()))
        .get();
      if (cells.length > 0) rows.push(cells);
    });
  return rows;
};

// Detect oblast header rows: a row whose first cell starts with "ОБЛАСТ " and
// whose other cells are blank. Sofia ("СТОЛИЧНА ОБЩИНА") carries amount
// values in cells[1..6] so it isn't flagged here — it's parsed as a regular
// municipality row.
const isOblastHeaderRow = (cells: string[]): boolean => {
  if (cells.length === 0) return false;
  const first = (cells[0] ?? "").trim().toUpperCase();
  if (!first.startsWith("ОБЛАСТ ")) return false;
  for (let i = 1; i < cells.length; i++) {
    if ((cells[i] ?? "").trim() !== "") return false;
  }
  return true;
};

const isGrandTotalRow = (cells: string[]): boolean => {
  const first = (cells[0] ?? "").trim().toUpperCase();
  return first === "ВСИЧКО" || first === "ВСИЧКО:" || first === "ОБЩО";
};

const isHeaderOrEmptyRow = (cells: string[]): boolean => {
  if (cells.every((c) => c.trim() === "")) return true;
  // Column-number indicator row ("1", "2(3+4+5+6)", "3", …) precedes the data.
  const first = (cells[0] ?? "").trim();
  if (/^\d+(\(\d+(\+\d+)*\))?$/.test(first)) return true;
  return false;
};

const parseMunicipalityRow = (
  cells: string[],
): {
  total: number | null;
  delegated: number | null;
  equalization: number | null;
  winter: number | null;
  capital: number | null;
  otherTargeted: number | null;
} => ({
  total: parseBulgarianAmount(cells[1]),
  delegated: parseBulgarianAmount(cells[2]),
  equalization: parseBulgarianAmount(cells[3]),
  winter: parseBulgarianAmount(cells[4]),
  capital: parseBulgarianAmount(cells[5]),
  otherTargeted: parseBulgarianAmount(cells[6]),
});

const sumMoney = (values: Array<Money | null>): Money => {
  let amount = 0;
  for (const v of values) if (v) amount += v.amount;
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

export const parseMunicipalTransfers = (
  html: string,
  fiscalYear: number,
): ParsedMunicipalTransfers => {
  const $ = load(html);
  const root = $.root()[0] as unknown as DomNode;
  const { leadText, table } = walkAnchorTable(root);

  if (!table) {
    throw new Error(
      `Municipal-transfers (${fiscalYear}): no <table> found after the ` +
        `"размерите на бюджетните взаимоотношения" anchor phrase — the law ` +
        `structure likely changed.`,
    );
  }

  const leadAmounts = parseLeadParagraph(leadText);
  const otherTargeted = parseOtherTargetedTotal(leadText);

  const rows = tableRows(table, $);
  const municipalities: ParsedMunicipalRow[] = [];
  const unresolvedNames: string[] = [];
  let runningOblast: string | null = null;

  for (const cells of rows) {
    if (isHeaderOrEmptyRow(cells)) continue;
    if (isGrandTotalRow(cells)) continue;
    if (isOblastHeaderRow(cells)) {
      runningOblast = oblastHeaderToCode(cells[0]);
      continue;
    }
    const name = cellText(cells[0]);
    if (!name) continue;
    const amounts = parseMunicipalityRow(cells);
    // Header-rowspan rows leak through as data rows when cheerio walks <tr>
    // sequentially — they have a label in cells[0] but no numbers. Filter
    // these so the unresolved-names list stays clean.
    const anyAmount =
      amounts.total !== null ||
      amounts.delegated !== null ||
      amounts.equalization !== null ||
      amounts.winter !== null ||
      amounts.capital !== null ||
      amounts.otherTargeted !== null;
    if (!anyAmount) continue;
    const muni: MunicipalityRecord | null = resolveMunicipality(
      name,
      runningOblast,
    );
    if (!muni) {
      unresolvedNames.push(name);
      continue;
    }
    municipalities.push({
      ekatte: muni.ekatte,
      obshtinaCode: muni.obshtinaCode,
      oblastCode: muni.oblastCode,
      nuts3: muni.nuts3,
      nameBg: muni.nameBg,
      nameEn: muni.nameEn,
      total: makeMoney(amounts.total),
      delegated: makeMoney(amounts.delegated),
      equalization: makeMoney(amounts.equalization),
      winter: makeMoney(amounts.winter),
      capital: makeMoney(amounts.capital),
      otherTargeted: makeMoney(amounts.otherTargeted),
    });
  }

  if (municipalities.length === 0) {
    throw new Error(
      `Municipal-transfers (${fiscalYear}): parsed 0 municipality rows from ` +
        `the table — the column layout likely changed.`,
    );
  }

  return {
    fiscalYear,
    totals: {
      delegated: makeMoney(leadAmounts.delegated),
      equalization: makeMoney(leadAmounts.equalization),
      winter: makeMoney(leadAmounts.winter),
      capital: makeMoney(leadAmounts.capital),
      otherTargeted: makeMoney(otherTargeted),
    },
    rowSum: {
      total: sumMoney(municipalities.map((m) => m.total)),
      delegated: sumMoney(municipalities.map((m) => m.delegated)),
      equalization: sumMoney(municipalities.map((m) => m.equalization)),
      winter: sumMoney(municipalities.map((m) => m.winter)),
      capital: sumMoney(municipalities.map((m) => m.capital)),
      otherTargeted: sumMoney(municipalities.map((m) => m.otherTargeted)),
    },
    municipalities,
    unresolvedNames,
  };
};

// ---------------------------------------------------------------------------
// Artifact shapes — what gets written to data/budget/municipal_transfers/.
// ---------------------------------------------------------------------------

export interface MunicipalTransfersTotalsFile {
  fiscalYear: number;
  asOf: string; // ISO date — the DV promulgation date of the budget law
  source: { documentId: string; url: string };
  totals: MunicipalTransferTypeTotals;
  rowSum: {
    total: Money;
    delegated: Money;
    equalization: Money;
    winter: Money;
    capital: Money;
    otherTargeted: Money;
  };
  reconciliationDeltasEur: Partial<Record<TransferType, number>>;
}

export interface MunicipalTransfersByMunicipalityFile {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  municipalities: ParsedMunicipalRow[];
}

export interface MunicipalTransfersOblastRow {
  oblastCode: string;
  oblastNameBg: string;
  oblastNameEn: string;
  municipalityCount: number;
  total: Money;
  delegated: Money;
  equalization: Money;
  winter: Money;
  capital: Money;
  otherTargeted: Money;
}

export interface MunicipalTransfersByOblastFile {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  oblasts: MunicipalTransfersOblastRow[];
}

export interface MunicipalTransfersIndexFile {
  generatedAt: string;
  years: Array<{
    fiscalYear: number;
    municipalityCount: number;
    grandTotalEur: number;
  }>;
}

// Per-oblast shard — sliced by oblast (28 small files) instead of by fiscal
// year (one big file × N years). Each shard carries the full multi-year
// history for the ~12-22 municipalities in that oblast, so per-region and
// per-municipality pages can fetch ONE small file instead of every year's
// whole-corpus per-municipality file. Size: ~5-15 KB per oblast.
export interface MunicipalTransfersOblastShardMuniYear {
  ekatte: string;
  obshtinaCode: string;
  nameBg: string;
  nameEn: string;
  total: Money | null;
  delegated: Money | null;
  equalization: Money | null;
  winter: Money | null;
  capital: Money | null;
  otherTargeted: Money | null;
}

export interface MunicipalTransfersOblastShardYear {
  fiscalYear: number;
  asOf: string;
  source: { documentId: string; url: string };
  oblastTotals: {
    total: Money;
    delegated: Money;
    equalization: Money;
    winter: Money;
    capital: Money;
    otherTargeted: Money;
  };
  municipalities: MunicipalTransfersOblastShardMuniYear[];
}

export interface MunicipalTransfersOblastShard {
  oblastCode: string;
  oblastNameBg: string;
  oblastNameEn: string;
  years: MunicipalTransfersOblastShardYear[];
}

const OBLAST_NAMES: Record<string, { bg: string; en: string }> = {
  BLG: { bg: "Благоевград", en: "Blagoevgrad" },
  BGS: { bg: "Бургас", en: "Burgas" },
  VAR: { bg: "Варна", en: "Varna" },
  VTR: { bg: "Велико Търново", en: "Veliko Tarnovo" },
  VID: { bg: "Видин", en: "Vidin" },
  VRC: { bg: "Враца", en: "Vratsa" },
  GAB: { bg: "Габрово", en: "Gabrovo" },
  DOB: { bg: "Добрич", en: "Dobrich" },
  KRZ: { bg: "Кърджали", en: "Kardzhali" },
  KNL: { bg: "Кюстендил", en: "Kyustendil" },
  LOV: { bg: "Ловеч", en: "Lovech" },
  MON: { bg: "Монтана", en: "Montana" },
  PAZ: { bg: "Пазарджик", en: "Pazardzhik" },
  PER: { bg: "Перник", en: "Pernik" },
  PVN: { bg: "Плевен", en: "Pleven" },
  PDV: { bg: "Пловдив", en: "Plovdiv" },
  RAZ: { bg: "Разград", en: "Razgrad" },
  RSE: { bg: "Русе", en: "Ruse" },
  SLS: { bg: "Силистра", en: "Silistra" },
  SLV: { bg: "Сливен", en: "Sliven" },
  SML: { bg: "Смолян", en: "Smolyan" },
  SFO: { bg: "Софийска", en: "Sofia (region)" },
  SOF: { bg: "София-град", en: "Sofia (capital)" },
  SZR: { bg: "Стара Загора", en: "Stara Zagora" },
  TGV: { bg: "Търговище", en: "Targovishte" },
  HKV: { bg: "Хасково", en: "Haskovo" },
  SHU: { bg: "Шумен", en: "Shumen" },
  JAM: { bg: "Ямбол", en: "Yambol" },
};

const emptyMoney = (): Money => ({ amount: 0, currency: "BGN", amountEur: 0 });

const addMoney = (a: Money, b: Money | null): Money => {
  if (!b) return a;
  return {
    amount: a.amount + b.amount,
    currency: "BGN",
    amountEur: a.amountEur + b.amountEur,
  };
};

export const buildTotalsFile = (
  parsed: ParsedMunicipalTransfers,
  asOf: string,
  source: { documentId: string; url: string },
): MunicipalTransfersTotalsFile => {
  const deltas: Partial<Record<TransferType, number>> = {};
  for (const k of [
    "delegated",
    "equalization",
    "winter",
    "capital",
    "otherTargeted",
  ] as const) {
    const lead = parsed.totals[k]?.amountEur ?? null;
    const sum = parsed.rowSum[k]?.amountEur ?? 0;
    if (lead === null) continue;
    const diff = sum - lead;
    if (Math.abs(diff) > 0) deltas[k] = diff;
  }
  return {
    fiscalYear: parsed.fiscalYear,
    asOf,
    source,
    totals: parsed.totals,
    rowSum: parsed.rowSum,
    reconciliationDeltasEur: deltas,
  };
};

export const buildByMunicipalityFile = (
  parsed: ParsedMunicipalTransfers,
  asOf: string,
  source: { documentId: string; url: string },
): MunicipalTransfersByMunicipalityFile => ({
  fiscalYear: parsed.fiscalYear,
  asOf,
  source,
  municipalities: parsed.municipalities,
});

export const buildByOblastFile = (
  parsed: ParsedMunicipalTransfers,
  asOf: string,
  source: { documentId: string; url: string },
): MunicipalTransfersByOblastFile => {
  const byOblast = new Map<string, MunicipalTransfersOblastRow>();
  const ensure = (code: string): MunicipalTransfersOblastRow => {
    let row = byOblast.get(code);
    if (!row) {
      const names = OBLAST_NAMES[code] ?? { bg: code, en: code };
      row = {
        oblastCode: code,
        oblastNameBg: names.bg,
        oblastNameEn: names.en,
        municipalityCount: 0,
        total: emptyMoney(),
        delegated: emptyMoney(),
        equalization: emptyMoney(),
        winter: emptyMoney(),
        capital: emptyMoney(),
        otherTargeted: emptyMoney(),
      };
      byOblast.set(code, row);
    }
    return row;
  };
  for (const m of parsed.municipalities) {
    const row = ensure(m.oblastCode);
    row.municipalityCount += 1;
    row.total = addMoney(row.total, m.total);
    row.delegated = addMoney(row.delegated, m.delegated);
    row.equalization = addMoney(row.equalization, m.equalization);
    row.winter = addMoney(row.winter, m.winter);
    row.capital = addMoney(row.capital, m.capital);
    row.otherTargeted = addMoney(row.otherTargeted, m.otherTargeted);
  }
  return {
    fiscalYear: parsed.fiscalYear,
    asOf,
    source,
    oblasts: [...byOblast.values()].sort((a, b) =>
      a.oblastCode.localeCompare(b.oblastCode),
    ),
  };
};

// Build per-oblast shards from a multi-year parse. Each shard is a single
// small file (~5-15 KB) with the full multi-year history for the ~12-22
// municipalities in that oblast — the unit per-region and per-municipality
// pages fetch. The fiscal-year-keyed `parsedByYear` map is what the ingest
// already accumulates while parsing the law-HTML per year.
export const buildOblastShards = (
  parsedByYear: Map<number, ParsedMunicipalTransfers>,
  asOfByYear: Map<number, string>,
  sourceByYear: Map<number, { documentId: string; url: string }>,
): MunicipalTransfersOblastShard[] => {
  // Collect oblast codes seen across all years (any year that contains a
  // municipality in that oblast). Each oblast gets a shard.
  const oblastCodes = new Set<string>();
  for (const parsed of parsedByYear.values()) {
    for (const m of parsed.municipalities) oblastCodes.add(m.oblastCode);
  }

  const out: MunicipalTransfersOblastShard[] = [];
  for (const code of oblastCodes) {
    const names = OBLAST_NAMES[code] ?? { bg: code, en: code };
    const years: MunicipalTransfersOblastShardYear[] = [];
    const sortedYears = [...parsedByYear.keys()].sort((a, b) => a - b);
    for (const year of sortedYears) {
      const parsed = parsedByYear.get(year)!;
      const munis = parsed.municipalities.filter((m) => m.oblastCode === code);
      if (munis.length === 0) continue;
      // Per-year rollup for this oblast.
      const totals = {
        total: emptyMoney(),
        delegated: emptyMoney(),
        equalization: emptyMoney(),
        winter: emptyMoney(),
        capital: emptyMoney(),
        otherTargeted: emptyMoney(),
      };
      for (const m of munis) {
        totals.total = addMoney(totals.total, m.total);
        totals.delegated = addMoney(totals.delegated, m.delegated);
        totals.equalization = addMoney(totals.equalization, m.equalization);
        totals.winter = addMoney(totals.winter, m.winter);
        totals.capital = addMoney(totals.capital, m.capital);
        totals.otherTargeted = addMoney(totals.otherTargeted, m.otherTargeted);
      }
      years.push({
        fiscalYear: year,
        asOf: asOfByYear.get(year) ?? `${year}-01-01`,
        source: sourceByYear.get(year) ?? {
          documentId: `law-${year}`,
          url: "",
        },
        oblastTotals: totals,
        municipalities: munis
          .map((m) => ({
            ekatte: m.ekatte,
            obshtinaCode: m.obshtinaCode,
            nameBg: m.nameBg,
            nameEn: m.nameEn,
            total: m.total,
            delegated: m.delegated,
            equalization: m.equalization,
            winter: m.winter,
            capital: m.capital,
            otherTargeted: m.otherTargeted,
          }))
          .sort(
            (a, b) => (b.total?.amountEur ?? 0) - (a.total?.amountEur ?? 0),
          ),
      });
    }
    out.push({
      oblastCode: code,
      oblastNameBg: names.bg,
      oblastNameEn: names.en,
      years,
    });
  }
  return out.sort((a, b) => a.oblastCode.localeCompare(b.oblastCode));
};
