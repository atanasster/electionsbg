// Parses Article 53 of the State Budget Law — the per-municipality table that
// allocates the state's annual transfer envelope to each of the ~265 общини.
//
// The article structures the data as:
//   1. A lead paragraph naming five named transfer-type totals (the budget
//      envelope) embedded in prose, in thousands — leva through FY2025, euro
//      from FY2026 (see the denomination note below).
//   2. A 7-column table grouped by oblast header rows. Each municipality row
//      carries the municipality name + the breakdown across:
//        col 2: Основни бюджетни взаимоотношения        — `basic` (= 3+4+5+6)
//        col 3: Обща субсидия за делегираните от държавата дейности
//        col 4: обща изравнителна субсидия
//        col 5: за зимно поддържане и снегопочистване на общински пътища
//        col 6: Целева субсидия за капиталови разходи
//        col 7: Трансфери за други целеви разходи за местни дейности
//
// `total` is the ENVELOPE — col 2 + col 7, i.e. all five transfer types.
// Column 2 alone is `basic`; it is NOT the municipality's total, because
// column 7 is declared in its own sub-paragraph and sits OUTSIDE column 2.
// Every consumer divides the five categories by `total`, so the two must span
// the same set — when `total` was column 2 alone the five shares summed to
// 100.3-108.6% on 1,056 municipality-years.
//
// Oblast headers are detected by their styling (single non-empty cell, all
// other cells empty) AND their text starting with "ОБЛАСТ ". Sofia city
// ("СТОЛИЧНА ОБЩИНА") appears as a regular data row between the Smolyan and
// Sofia-region headers — handled by the municipality_lookup helper.
//
// Amounts in the source are in THOUSANDS, and which currency depends on the
// year: laws through FY2025 are хил. лв., and from the FY2026 law (promulgated
// after Bulgaria adopted the euro on 2026-01-01) the very same tables are
// хил. евро. Article 53 carries no unit of its own — it inherits the document's
// denomination — so we detect it exactly the way law_html.ts does, off the
// "(хил. лв.)" / "(хил. евро)" markers, and build Money the same way: multiply
// by 1000, and translate to EUR via the locked peg only when the source is
// leva. Getting this wrong is silent and halves every figure in the year.

import { load } from "cheerio";
import { toEur } from "../../src/lib/currency";
import { detectLawCurrency } from "./law_html";
import type { Money } from "./types";
import {
  oblastHeaderToCode,
  resolveMunicipality,
  type MunicipalityRecord,
} from "./lib/municipality_lookup";

// Raised when the article IS present and we parsed it wrong — a misaligned
// column, an unmatched lead paragraph, a missing unit marker, an envelope that
// disagrees with the prose. Distinct from an ordinary Error, which here means
// "this law carries no Article 53 table at all" (older layouts) and is a
// legitimate skip.
//
// The distinction is load-bearing, not decorative. ingest.ts wraps the parse in
// a try/catch written for the absent case, so without a type to re-throw, every
// integrity check in this file is inert in the only pipeline that runs it: the
// year is dropped from index.json and the oblast shards, its stale per-year
// artifacts stay on disk, and the ingest exits green. That is strictly worse
// than the corruption the checks exist to catch.
export class MunicipalTransfersIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MunicipalTransfersIntegrityError";
  }
}

// The five transfer types Article 53 declares. `otherTargeted` (column 7) is
// named in its own sub-paragraph and sits OUTSIDE column 2, but it is part of
// the same envelope — the four subsidies alone are not the total.
export const TRANSFER_TYPES = [
  "delegated",
  "equalization",
  "winter",
  "capital",
  "otherTargeted",
] as const;

export type TransferType = (typeof TRANSFER_TYPES)[number];

// Every money cell a municipality row can carry: column 2 plus the five types.
const AMOUNT_FIELDS = ["basic", ...TRANSFER_TYPES] as const;

// Slack on the envelope canary, in EUR. Both sides convert from leva, the lead
// paragraph in five roundings and the row sum in one, so a few euro of drift is
// arithmetic; anything larger is a structural disagreement.
const ENVELOPE_TOLERANCE_EUR = 10;

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
  // The WHOLE Article 53 envelope for this municipality: column 2 + column 7,
  // i.e. all five transfer types. NOT column 2 alone — see `basic`.
  total: Money | null;
  // Column 2 alone, "Основни бюджетни взаимоотношения". The law declares it as
  // 3+4+5+6, so it is the four named subsidies WITHOUT the separately-declared
  // "други целеви" (column 7). Kept because it is a real legal quantity and
  // because the declared identity is checked on every row.
  basic: Money | null;
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
  // Whole-country sums over the municipality rows. `total` is column 2 plus
  // column 7 — the same five-category envelope the lead paragraph declares —
  // and buildTotalsFile reconciles it against the sum of `totals` as a
  // parser-correctness canary. `basic` is column 2 alone and is not reconciled
  // against anything national; the per-row 2(3+4+5+6) check covers it.
  rowSum: {
    total: Money;
    basic: Money;
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

// Add two raw cell values, in thousands. Null means the law printed no cell —
// several municipalities legitimately have none for a given transfer type — so
// it contributes nothing, but two nulls stay null rather than becoming a zero
// the source never stated.
const addThousands = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

// Slack on the "2(3+4+5+6)" identity, counted in the source's own last-place
// units (it prints one decimal, so 1 = 0,1 хил.). Comparing scaled integers
// rather than the raw floats matters: 800,1 + 100 + 30 + 70 lands on
// 1000.1000000000000227, so a plain `> 0.1` check on the difference turns a
// legitimate rounding into a hard failure.
//
// Four independently-rounded components against a fifth rounded value can
// legitimately drift 0,25 хил. = 2.5 units. Every law 2018-2026 in fact prints
// column 2 as the sum of the ROUNDED parts (0 of 2,385 rows drift at all), so
// this is headroom for a drafting-style change rather than for observed noise.
// A column SHIFT is off by orders of magnitude more, so the headroom costs no
// detection power.
const COLUMN_SUM_TOLERANCE_UNITS = 3;

// The document's own denomination — see detectLawCurrency in law_html.ts.
type LawCurrency = "BGN" | "EUR";

const makeMoney = (
  thousands: number | null,
  currency: LawCurrency,
): Money | null => {
  if (thousands === null) return null;
  const amount = Math.round(thousands * 1000);
  if (currency === "EUR") return { amount, currency, amountEur: amount };
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const cellText = (s: string | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

// The unit suffix each inline amount is written with — "хил. лв." through
// FY2025, "хил. евро" from FY2026. Matching either keeps one regex per named
// phrase; the amount's actual denomination comes from detectLawCurrency, not
// from which branch matched here.
const UNIT_RE = String.raw`\s*хил\.\s*(?:лв|евро)`;

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
      new RegExp(
        `делегираните от държавата дейности\\s+([\\d\\s,]+?)${UNIT_RE}`,
        "i",
      ),
    ),
    equalization: extractAfter(
      new RegExp(`обща изравнителна субсидия\\s+([\\d\\s,]+?)${UNIT_RE}`, "i"),
    ),
    winter: extractAfter(
      new RegExp(
        `зимно поддържане и снегопочистване(?: на общински пътища)?\\s+([\\d\\s,]+?)${UNIT_RE}`,
        "i",
      ),
    ),
    capital: extractAfter(
      new RegExp(
        `целева субсидия за капиталови разходи\\s+([\\d\\s,]+?)${UNIT_RE}`,
        "i",
      ),
    ),
  };
};

const parseOtherTargetedTotal = (paragraphText: string): number | null => {
  const text = paragraphText.replace(/\u00A0/g, " ");
  const m = text.match(
    new RegExp(
      `трансфери за други целеви разходи за местни дейности\\s+([\\d\\s,]+?)${UNIT_RE}`,
      "i",
    ),
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

// Column 2 as the table prints it. The envelope (`total`) adds column 7 to
// this; see addThousands at the call site.
const parseMunicipalityRow = (
  cells: string[],
): {
  basic: number | null;
  delegated: number | null;
  equalization: number | null;
  winter: number | null;
  capital: number | null;
  otherTargeted: number | null;
} => ({
  basic: parseBulgarianAmount(cells[1]),
  delegated: parseBulgarianAmount(cells[2]),
  equalization: parseBulgarianAmount(cells[3]),
  winter: parseBulgarianAmount(cells[4]),
  capital: parseBulgarianAmount(cells[5]),
  otherTargeted: parseBulgarianAmount(cells[6]),
});

const sumMoney = (
  values: Array<Money | null>,
  currency: LawCurrency,
): Money => {
  let amount = 0;
  for (const v of values) if (v) amount += v.amount;
  if (currency === "EUR") return { amount, currency, amountEur: amount };
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
  const { currency, leva, euro } = detectLawCurrency(html);
  // An unmarked document would silently default to BGN and halve every figure
  // in a euro-denominated law, so require the marker rather than assume.
  if (leva === 0 && euro === 0) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${fiscalYear}): no "(хил. лв.)" / "(хил. евро)" ` +
        `unit marker found — cannot determine the law's denomination.`,
    );
  }
  const { leadText, table } = walkAnchorTable(root);

  // The ONE genuinely-absent case, and so the one throw that stays an ordinary
  // Error: no anchor phrase means this law carries no Article 53 table, which
  // ingest.ts is entitled to skip. Every other failure below is an integrity
  // error, because reaching them means the table IS here.
  if (!table) {
    throw new Error(
      `Municipal-transfers (${fiscalYear}): no <table> found after the ` +
        `"размерите на бюджетните взаимоотношения" anchor phrase — the law ` +
        `structure likely changed.`,
    );
  }

  const leadAmounts = parseLeadParagraph(leadText);
  const otherTargeted = parseOtherTargetedTotal(leadText);

  // The four core lead-paragraph totals are declared in every law 2018→. Their
  // only consumer is the reconciliation canary in buildTotalsFile, which skips
  // whichever field is null — so a lead paragraph that stops matching produces
  // no deltas and reads as a clean parse. That is how the FY2026 unit change
  // shipped a silently halved year: the table parsed, the prose did not, and
  // nothing anywhere was red. Fail here instead. (otherTargeted is NOT in the
  // list — it is genuinely absent from the 2018–2022 laws.)
  const missingLead = (
    ["delegated", "equalization", "winter", "capital"] as const
  ).filter((k) => leadAmounts[k] === null);
  if (missingLead.length > 0) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${fiscalYear}): lead paragraph yielded no total ` +
        `for ${missingLead.join(", ")} — the wording or the unit suffix ` +
        `("хил. лв." / "хил. евро") likely changed.`,
    );
  }

  const rows = tableRows(table, $);
  const municipalities: ParsedMunicipalRow[] = [];
  const unresolvedNames: string[] = [];
  const columnSumMismatches: string[] = [];
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
    // Keyed off the amount fields explicitly rather than Object.values, so that
    // adding a non-amount field to parseMunicipalityRow's return can never
    // silently make a label count as "this row carries numbers".
    const anyAmount = AMOUNT_FIELDS.some((k) => amounts[k] !== null);
    if (!anyAmount) continue;
    const muni: MunicipalityRecord | null = resolveMunicipality(
      name,
      runningOblast,
    );
    if (!muni) {
      unresolvedNames.push(name);
      continue;
    }
    // The table's own header declares column 2 as "2(3+4+5+6)", so the identity
    // is a free per-row integrity check on the column alignment — and it holds
    // for every one of the 2,385 municipality-years currently parsed. It is
    // worth asserting because the realistic corruption is a SHIFT, not a wrong
    // number: several municipalities legitimately leave a cell blank (Банско
    // has no equalization subsidy, Несебър and Поморие no winter line), and a
    // blank that stops being rendered as an empty <td> slides every later
    // column one to the left. That produces entirely plausible figures.
    const declaredParts =
      (amounts.delegated ?? 0) +
      (amounts.equalization ?? 0) +
      (amounts.winter ?? 0) +
      (amounts.capital ?? 0);
    if (
      amounts.basic !== null &&
      Math.abs(Math.round((amounts.basic - declaredParts) * 10)) >
        COLUMN_SUM_TOLERANCE_UNITS
    ) {
      // Name alone is not unique — Бяла exists in both RSE and VAR — so the
      // oblast has to be here for the operator to find the row. toFixed(1)
      // matches the source's own precision and keeps float noise
      // (1000.1000000000000227) out of the message.
      columnSumMismatches.push(
        `${name} (${muni.oblastCode}): column 2 = ${amounts.basic.toFixed(1)} ` +
          `but 3+4+5+6 = ${declaredParts.toFixed(1)}`,
      );
    }
    municipalities.push({
      ekatte: muni.ekatte,
      obshtinaCode: muni.obshtinaCode,
      oblastCode: muni.oblastCode,
      nuts3: muni.nuts3,
      nameBg: muni.nameBg,
      nameEn: muni.nameEn,
      // The envelope — column 2 plus the separately-declared column 7. Every
      // consumer presents this as the municipality's total transfers and
      // divides the five category amounts by it, so it must span all five.
      total: makeMoney(
        addThousands(amounts.basic, amounts.otherTargeted),
        currency,
      ),
      basic: makeMoney(amounts.basic, currency),
      delegated: makeMoney(amounts.delegated, currency),
      equalization: makeMoney(amounts.equalization, currency),
      winter: makeMoney(amounts.winter, currency),
      capital: makeMoney(amounts.capital, currency),
      otherTargeted: makeMoney(amounts.otherTargeted, currency),
    });
  }

  if (columnSumMismatches.length > 0) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${fiscalYear}): ${columnSumMismatches.length} row(s) ` +
        `violate the table's declared "2(3+4+5+6)" identity — the columns are ` +
        `likely misaligned. First: ${columnSumMismatches.slice(0, 3).join("; ")}`,
    );
  }

  if (municipalities.length === 0) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${fiscalYear}): parsed 0 municipality rows from ` +
        `the table — the column layout likely changed.`,
    );
  }

  // `otherTargeted` is deliberately outside the missingLead check because the
  // 2018-2022 laws genuinely declare no such transfer. But the envelope now
  // folds the lead value in with `?? 0`, so nothing else distinguishes "this
  // law has none" from "parseOtherTargetedTotal stopped matching" — and in the
  // second case the envelope canary fires and blames the table, which is fine,
  // for a defect that is entirely in the prose. The rows are the ground truth
  // for whether the category exists in this law, so assert the pairing and
  // report the real cause. Safe on the legacy years: 2018-2022 carry no column
  // 7 either, so the row sum is 0 and this cannot false-positive.
  const otherTargetedRowSum = municipalities.reduce(
    (s, m) => s + (m.otherTargeted?.amountEur ?? 0),
    0,
  );
  if (otherTargeted === null && otherTargetedRowSum > 0) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${fiscalYear}): the table carries column 7 ` +
        `(€${otherTargetedRowSum.toLocaleString("en")}) but the lead paragraph ` +
        `yielded no "трансфери за други целеви разходи" total — that sentence's ` +
        `wording or unit suffix likely changed.`,
    );
  }

  return {
    fiscalYear,
    totals: {
      delegated: makeMoney(leadAmounts.delegated, currency),
      equalization: makeMoney(leadAmounts.equalization, currency),
      winter: makeMoney(leadAmounts.winter, currency),
      capital: makeMoney(leadAmounts.capital, currency),
      otherTargeted: makeMoney(otherTargeted, currency),
    },
    rowSum: {
      total: sumMoney(
        municipalities.map((m) => m.total),
        currency,
      ),
      basic: sumMoney(
        municipalities.map((m) => m.basic),
        currency,
      ),
      delegated: sumMoney(
        municipalities.map((m) => m.delegated),
        currency,
      ),
      equalization: sumMoney(
        municipalities.map((m) => m.equalization),
        currency,
      ),
      winter: sumMoney(
        municipalities.map((m) => m.winter),
        currency,
      ),
      capital: sumMoney(
        municipalities.map((m) => m.capital),
        currency,
      ),
      otherTargeted: sumMoney(
        municipalities.map((m) => m.otherTargeted),
        currency,
      ),
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
    // All five categories — column 2 + column 7. `basic` is column 2 alone.
    total: Money;
    basic: Money;
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

// Rolls municipality rows up to an oblast. `currency` follows the addends
// rather than being pinned to BGN: from FY2026 the rows are euro-denominated,
// and labelling a euro `amount` as BGN invites a second conversion downstream.
// The zero seed keeps whatever the first real addend brings.
//
// Precision note: this sums each municipality's ALREADY-ROUNDED `amountEur`, so
// for leva-denominated years an oblast's `total` and the sum of its five
// categories differ by the accumulated BGN→EUR rounding — 53 of 252
// oblast-years drift, by 1-8 EUR (FY2026 drifts by 0, needing no conversion).
// Immaterial at 3 parts in 10^8, and every rendered percentage is unaffected at
// one decimal, but the parsed ROWS hold the identity exactly and the rollups do
// not — worth knowing before asserting the stronger claim on an aggregate.
const addMoney = (a: Money, b: Money | null): Money => {
  if (!b) return a;
  return {
    amount: a.amount + b.amount,
    currency: a.amount === 0 ? b.currency : a.currency,
    amountEur: a.amountEur + b.amountEur,
  };
};

export const buildTotalsFile = (
  parsed: ParsedMunicipalTransfers,
  asOf: string,
  source: { documentId: string; url: string },
): MunicipalTransfersTotalsFile => {
  const deltas: Partial<Record<TransferType, number>> = {};
  for (const k of TRANSFER_TYPES) {
    const lead = parsed.totals[k]?.amountEur ?? null;
    const sum = parsed.rowSum[k]?.amountEur ?? 0;
    if (lead === null) continue;
    const diff = sum - lead;
    if (Math.abs(diff) > 0) deltas[k] = diff;
  }
  // Whole-envelope canary. The per-category deltas above compare like with
  // like, so they cannot see a `total` that spans the wrong set of columns —
  // each of the five agreed to the lev for years while `rowSum.total` quietly
  // omitted column 7. Comparing the envelope against the sum of the five lead
  // totals is the check that closes it: both sides are "all five categories",
  // derived from different halves of the article.
  const leadEnvelope = TRANSFER_TYPES.reduce(
    (s, k) => s + (parsed.totals[k]?.amountEur ?? 0),
    0,
  );
  const envelopeDelta = parsed.rowSum.total.amountEur - leadEnvelope;
  // Per-category rounding is already reported above; this guards the SHAPE of
  // the total, so it only fires beyond what those roundings can explain.
  if (Math.abs(envelopeDelta) > ENVELOPE_TOLERANCE_EUR) {
    throw new MunicipalTransfersIntegrityError(
      `Municipal-transfers (${parsed.fiscalYear}): the summed envelope ` +
        `(€${parsed.rowSum.total.amountEur.toLocaleString("en")}) differs from ` +
        `the lead paragraph's five totals ` +
        `(€${leadEnvelope.toLocaleString("en")}) by ` +
        `€${envelopeDelta.toLocaleString("en")} — \`total\` is spanning the ` +
        `wrong set of columns, or a transfer type is missing from the table.`,
    );
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
    for (const k of TRANSFER_TYPES) row[k] = addMoney(row[k], m[k]);
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
        for (const k of TRANSFER_TYPES) totals[k] = addMoney(totals[k], m[k]);
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
