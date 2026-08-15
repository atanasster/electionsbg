/**
 * Parse a single MP property/interest declaration XML from register.cacbg.bg.
 *
 * The XML schema is fixed by ordinance and stable across declarants:
 *   <PublicPerson>
 *     <Personal>...</Personal>
 *     <DeclarationData>...</DeclarationData>
 *     <Tables>
 *       <Table Num="10" Description="..." Declared="True">
 *         <Row Num="1">
 *           <Cell Num="2" Description="...">value</Cell>
 *           ...
 *
 * See docs/plans/mp-financial-connections-slice0-findings.md for the full schema.
 *
 * THREE forms share that envelope, and only the root element tells them apart:
 * see `detectFormKind` below.
 */

import { load, type CheerioAPI } from "cheerio";
import type {
  DeclarationEventKind,
  MpAsset,
  MpAssetCategory,
  MpDeclaration,
  MpDeclarationEvent,
  MpIncomeRecord,
  MpOwnershipStake,
} from "../../src/data/dataTypes";
import { isEurConvertible, toEur } from "../../src/lib/currency";
import { registerFolderYear } from "../lib/cacbg_register";

const text = ($: CheerioAPI, sel: string): string | null => {
  const el = $(sel).first();
  if (el.length === 0) return null;
  const t = el.text().trim();
  return t === "" ? null : t;
};

// Cell values use comma as decimal separator (RegionalSettings says "."
// for DecimalSeparator but the actual data uses commas — declarants enter
// numbers in Bulgarian convention regardless).
const toNumber = (raw: string | null): number | null => {
  if (raw == null) return null;
  const cleaned = raw.replace(/\s+/g, "").replace(/,/g, ".");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// 2.5, not 20. Cell A and cell C are the same sum in two currencies, so the
// honest ratio is the FX rate (1.96 for EUR, 1.0 for BGN) — anything past ~2.5
// is already unexplainable. A looser 20x let a clean 72-row cluster sitting at
// exactly ~10x through, seven of them over EUR 500k and one at EUR 3.63M
// ranking 14th nationally. The nearest genuine survivor is 19.56x.
const MONEY_EQUIV_TYPO_FACTOR = 2.5;

/** A money amount whose cell carries an inline note: `98000 - дебитна карта`.
 *
 *  `toNumber` above is deliberately all-or-nothing, and that is right for most cells — but
 *  in the money tables it silently drops REAL BALANCES. Йотова's 2026 filing declares seven
 *  bank accounts and the seventh reads `98000 - дебитна карта`; we published six of them and
 *  a „1 позиция без стойност" note, understating her accounts by EUR 50,107 (EUR 220,829
 *  against the EUR 270,936 the filing actually adds up to).
 *
 *  Extracting a leading number generally would be far worse than the bug. The same shape in
 *  this corpus also covers things that are NOT money:
 *
 *      369 476 дяла        — a count of company shares
 *      2.1 Bitcoin         — a coin balance
 *      19 унции злато      — ounces of gold
 *      1/2 Ипотечен кредит — an ideal-part fraction, not an amount of 1
 *
 *  ⚠️ THE CURRENCY CELL DOES NOT SEPARATE THOSE. An earlier version of this comment claimed
 *  it did — that a coin or gold row "names its unit in the currency cell" — and the corpus
 *  says the opposite: declarants put the UNIT in the amount cell and a fiat code in the
 *  currency cell, which is what the form asks for. All 31 unit-count rows in
 *  `raw_data/declarations/` carry BGN or EUR, so `isEurConvertible` rejects none of them.
 *  Two gates therefore do the work, and neither is the currency:
 *
 *   1. The note must be DELIMITED — a dash, an opening parenthesis, or a spaced `/`. The unit
 *      counts above run the unit straight on, so they do not parse. `/` is in because it is
 *      the Bulgarian bracket the form's own headers use (`Цена на придобиване /лв./`) and four
 *      money rows turn on it; the required leading whitespace is what keeps `1/2 Ипотечен
 *      кредит` out, and no cell in the corpus writes a fraction with spaces around the slash.
 *   2. The declarant's own lev-equivalent must not CONTRADICT the parse, on the same
 *      `MONEY_EQUIV_TYPO_FACTOR` the money rows already use. This is the independent gate:
 *      every unit-count row carries an equivalent (`2.1 Bitcoin` / eq 377 866), while most
 *      genuine annotated balances carry none, and where they do it agrees. Without it a
 *      delimited `2.1 - Bitcoin` would not merely add a stray number — `pickEurValue`'s
 *      `pureMoney` branch would treat the true equivalent as the typo and publish EUR 1.07
 *      in place of EUR 193,199, logging a warning that reads like the correction working.
 *
 *  Undelimited notes (`41222 дебитна карта`, 12 rows) stay REFUSED on purpose: they are
 *  indistinguishable from `369476 ДЯЛА` without reading the words. Positive amounts only —
 *  a leading `-` beside a dash delimiter is ambiguous, so `-500 - овърдрафт` is refused where
 *  bare `-500` parses.
 *
 *  Area cells use `toLooseNumber` (below), which is ungated leading-number extraction; it is
 *  right for an area and wrong for money, for every reason above.
 *
 *  Measured 2026-08 over `raw_data/declarations/2026/` + `raw_data/officials/2026/`:
 *  44,188 money-amount cells, 109 of which fail `toNumber` while starting with a digit. */
const toAnnotatedNumber = (
  raw: string | null,
  currency: string | null,
  bgnEquiv: number | null,
): number | null => {
  const strict = toNumber(raw);
  if (strict != null) return strict;
  if (raw == null || !isEurConvertible(currency)) return null;
  // The capture must END in a digit so it cannot share whitespace with the `\s*` that
  // follows: overlapping quantifiers made this O(n²) on a long interior space run (2.1 s at
  // 64 KB of untrusted register XML), and this accepts exactly the same strings.
  const m = raw
    .trim()
    .replace(/,/g, ".")
    .match(/^(\d(?:[\d\s]*\d)?(?:\.\d+)?)(?:\s*[-−–—(]|\s+\/)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\s+/g, ""));
  if (!Number.isFinite(n)) return null;
  // Gate 2 — see the header. A loose parse is a guess; the declarant's own equivalent wins.
  if (bgnEquiv != null && bgnEquiv !== 0 && n !== 0) {
    const ratio = Math.abs(bgnEquiv) / Math.abs(n);
    // 2.5 already allows the honest spread: a BGN row's equivalent equals the amount
    // (ratio 1) and an EUR row's is the peg (1.96). Either direction disqualifies.
    if (
      ratio > MONEY_EQUIV_TYPO_FACTOR ||
      1 / ratio > MONEY_EQUIV_TYPO_FACTOR
    ) {
      return null;
    }
  }
  return n;
};

// ISO-format a "dd.MM.yyyy" date.
const parseBgDate = (raw: string | null): string | null => {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const cellByNum = (row: ReturnType<CheerioAPI>, num: number): string | null => {
  const cell = row.find(`Cell[Num="${num}"]`).first();
  if (cell.length === 0) return null;
  const t = cell.text().trim();
  return t === "" ? null : t;
};

// A row is "empty" when the only populated cell is the row number (cell 1).
const isEmptyRow = ($: CheerioAPI, row: ReturnType<CheerioAPI>): boolean => {
  const populated = row
    .find("Cell")
    .toArray()
    .filter((c) => {
      const num = $(c).attr("Num");
      if (num === "1") return false;
      return ($(c).text() || "").trim() !== "";
    });
  return populated.length === 0;
};

/** WHICH FORM this filing is — read from the XML root element, which is the
 *  only thing in the document that says so.
 *
 *  Three forms share one envelope (`Personal` / `DeclarationData` / `Tables`)
 *  and the register publishes all three side by side in the same folder:
 *
 *    <PublicPerson>      имущество и интереси — tables 1…14, the asset form
 *                        every column map below was written for.
 *    <PublicPersonDekl2> интереси при встъпване — tables 15…22 ONLY.
 *    <PublicPersonDekl3> интереси при промяна   — tables 1…9, which COLLIDE
 *                        with the asset numbering while meaning something
 *                        completely different.
 *
 *  That collision is the whole reason this exists. Read through the asset map,
 *  a Dekl3 filing published garbage: its table 9 ("произхода на средствата при
 *  предсрочно погасяване на задължения") was filed as table 9 "Ценни книжа",
 *  its table 2 ("управител или член на орган") as table 2 "Прехвърляне на
 *  имоти". 565 of the 575 Dekl3 filings on file carried such rows — 808 phantom
 *  assets and 377 phantom disposals — and one of them read a declarant's LOAN
 *  CONTRACT NUMBER out of the "правно основание" cell as a price, publishing a
 *  €3.58bn security. Dekl2 failed the other way and was therefore invisible:
 *  none of its table numbers exist in the asset map, so all 4,331 filings
 *  parsed to nothing at all and 3,176 declared interests were silently dropped.
 *
 *  Detecting by CONTENT rather than by root element was considered and
 *  rejected: Dekl3's tables 1-9 are a strict subset of the asset form's
 *  numbering, so no table number, count or description can separate a Dekl3
 *  from an asset filing whose declarant left the later tables blank. The root
 *  element is the only discriminator that cannot be forged by an empty form. */
export type FormKind =
  | "assets"
  | "interests_entry"
  | "interests_change"
  | "unknown";

const ROOT_TO_KIND: Record<string, FormKind> = {
  PublicPerson: "assets",
  PublicPersonDekl2: "interests_entry",
  PublicPersonDekl3: "interests_change",
};

/** Unrecognised roots seen since the last reset, by tag.
 *
 *  The fail-closed branch below is right, but a per-file `console.warn` inside
 *  a run that parses 48,073 files is not a signal — a new `PublicPersonDekl4`
 *  would publish silently-empty filings behind scrollback, which is the exact
 *  signature of the Dekl2 failure this module exists to fix. So the ingests ask
 *  for the tally at the end and print ONE line, the way the loaders already
 *  summarise their `person_id` NULL residue. */
const unknownRoots = new Map<string, number>();

/** `[tag, count]` for every unrecognised root seen, commonest first. Empty on a
 *  healthy corpus. */
export const unknownRootTally = (): Array<[string, number]> =>
  [...unknownRoots.entries()].sort((a, b) => b[1] - a[1]);

export const resetUnknownRootTally = (): void => unknownRoots.clear();

export const detectFormKind = ($: CheerioAPI): FormKind => {
  const root = $.root().children().first();
  const tag = (root.get(0) as { name?: string } | undefined)?.name ?? "";
  const kind = ROOT_TO_KIND[tag];
  if (kind) return kind;
  // A form the register has added since. Guessing either map is how the damage
  // above happened, so guess NEITHER: the filing still publishes (year,
  // institution, source link) and simply carries no rows until someone writes
  // its map. A missing row is a gap; a row read against the wrong map is a
  // false statement about a named person.
  const seen = tag || "?";
  unknownRoots.set(seen, (unknownRoots.get(seen) ?? 0) + 1);
  console.warn(
    `[parse] unknown declaration root <${seen}> — parsing no tables`,
  );
  return "unknown";
};

/** The register renumbered its tables.
 *
 *  Filings up to 2017 use one layout and 2018-onward another, and the numbers
 *  do NOT line up: in the older form table 7 is "Банкови влогове" where the
 *  newer one has "Задължения", and 13 is income where the newer one has
 *  guarantees. Reading by raw number therefore filed 642 declarations into the
 *  wrong categories entirely — 638 across the 2015-2017 folders plus 4
 *  stragglers filed on the old form inside the 2018 folder — with bank deposits
 *  counted as debts, debts as securities, and the income table parsed as
 *  guarantees.
 *
 *  So every table lookup goes through a LOGICAL name resolved per document.
 *  Version is detected from a description rather than a date: the filing itself
 *  is the only thing that knows which form it was filed on, and those four
 *  stragglers inside the 2018 folder are what a date-based rule would get
 *  wrong. */
type FormVersion = "v1" | "v2";

type LogicalTable =
  | "realEstate"
  | "agriLand"
  | "foreignRealEstate"
  | "propertyDisposal"
  | "vehicles"
  | "agriMachinery"
  | "boats"
  | "otherVehicles"
  | "foreignVehicles"
  | "vehicleDisposal"
  | "cash"
  | "bank"
  | "receivable"
  | "debt"
  | "investment"
  | "security"
  | "shares"
  | "shareTransfer"
  | "income"
  | "guarantees"
  | "expenses";

// A logical table absent from a form version maps to null — the older form has
// no separate "foreign real estate", "other vehicles" or "investment funds"
// table at all, so those simply yield no rows rather than matching by accident.
const TABLE_NUMS: Record<FormVersion, Record<LogicalTable, string | null>> = {
  v2: {
    realEstate: "1",
    agriLand: "1.1",
    foreignRealEstate: "1.2",
    propertyDisposal: "2",
    vehicles: "3",
    agriMachinery: "3.1",
    boats: "3.2",
    otherVehicles: "3.3",
    foreignVehicles: "3.4",
    vehicleDisposal: "3.5",
    cash: "4",
    bank: "5",
    receivable: "6",
    debt: "7",
    investment: "8",
    security: "9",
    shares: "10",
    shareTransfer: "11",
    income: "12",
    guarantees: "13",
    expenses: "14",
  },
  v1: {
    realEstate: "1",
    agriLand: "1.1",
    foreignRealEstate: null,
    propertyDisposal: "2",
    vehicles: "3",
    agriMachinery: "3.1",
    boats: "4",
    otherVehicles: null,
    foreignVehicles: null,
    vehicleDisposal: "5",
    cash: "6",
    bank: "7",
    receivable: "8",
    debt: "9",
    investment: null,
    security: "10",
    shares: "11",
    shareTransfer: "12",
    income: "13",
    guarantees: "14",
    expenses: "15",
  },
};

export const detectFormVersion = ($: CheerioAPI): FormVersion => {
  const norm = (raw: string | undefined) => (raw ?? "").trim();
  // Table 13 is the cleanest discriminator: income in the old form, guarantees
  // in the new one. Every one of the 642 old-form filings on file resolves
  // here.
  const desc = norm($('Table[Num="13"]').first().attr("Description"));
  if (desc.startsWith("Доходи")) return "v1";
  if (desc.startsWith("Дадени")) return "v2";
  // No table 13 at all: fall back on table 15, which the old form uses for
  // expenses and the new one for the conflict-of-interest section — so this is
  // checked by DESCRIPTION, never by presence.
  const t15 = norm($('Table[Num="15"]').first().attr("Description"));
  if (t15.startsWith("Направени разходи")) return "v1";
  // Otherwise assume the current form: it is 98.5% of the corpus and every
  // filing since 2018. A filing that carries asset tables yet matches neither
  // discriminator means the register reworded a description, and guessing the
  // version wrong misfiles the whole declaration — so say so. A несъвместимост
  // filing carries no tables at all and stays quiet.
  if ($("Table").length > 0) {
    console.warn(
      `[parse] no form-version discriminator (table 13 = "${desc.slice(0, 40)}") — assuming the current form`,
    );
  }
  return "v2";
};

/** Which column each table gained when the 2018 form added a national-ID cell.
 *
 *  That single insertion is the ONLY layout difference between the two forms:
 *  every column after "Име: собствено, бащино, фамилно" moved one place right.
 *  So rather than carry two full column maps, cell numbers are written once in
 *  NEW-form terms and translated back for old-form rows. null = the table never
 *  had an ЕГН column (income, guarantees, expenses) and both forms agree. */
const EGN_COLUMN: Record<LogicalTable, number | null> = {
  realEstate: 9,
  agriLand: 9,
  foreignRealEstate: 9,
  propertyDisposal: 8,
  vehicles: 7,
  agriMachinery: 7,
  boats: 7,
  otherVehicles: 7,
  foreignVehicles: 7,
  vehicleDisposal: 6,
  cash: 6,
  bank: 6,
  receivable: 7,
  debt: 7,
  investment: 6,
  security: 9,
  shares: 8,
  shareTransfer: 8,
  income: null,
  guarantees: null,
  expenses: null,
};

/** Translates a new-form column number to where that column sits in this
 *  document. Identity for every 2018+ filing. */
export type ColumnResolver = (newFormNum: number) => number;

const columnResolver = (
  version: FormVersion,
  logical: LogicalTable,
): ColumnResolver => {
  const egn = EGN_COLUMN[logical];
  if (version === "v2" || egn == null) return (n) => n;
  return (n) => (n > egn ? n - 1 : n);
};

/** The <Table> element for a logical table in THIS document, or an empty
 *  selection when the form has no such table. */
const tableOf = (
  $: CheerioAPI,
  version: FormVersion,
  logical: LogicalTable,
): ReturnType<CheerioAPI> | null => {
  const num = TABLE_NUMS[version][logical];
  if (num == null) return null;
  const t = $(`Table[Num="${num}"]`).first();
  return t.length > 0 ? t : null;
};

/** The currency the form's money COLUMNS are denominated in.
 *
 *  ⚠️ THIS IS NOT ALWAYS BGN, and assuming it was is a defect that shipped.
 *  Bulgaria adopted the euro on 2026-01-01, and register.cacbg.bg switched its
 *  form template with it: the same column that used to read
 *  `Цена на придобиване /лв./` now reads `Цена на придобиване /евро/`. Tables
 *  4-8 (cash, bank, receivables …) were never affected because they carry an
 *  explicit `Вид на валутата` CELL — but real estate, vehicles, securities and
 *  income state their unit ONLY in the column header, and those were hard-coded
 *  to "BGN". Every euro-template filing therefore had those values divided by
 *  1.95583.
 *
 *  Measured on the 2026 register when this was found (2026-08-14): 2,151 of
 *  18,124 filings use the euro template — 1,101 встъпителни and 1,041 финални,
 *  but only 5 годишни, because the annual for 2025 is still a lev-denominated
 *  form. So the damage was to the opening declarations of everyone seated after
 *  the euro changeover: 11,840 real-estate rows published at €129.8m against
 *  €253.9m declared, and 3,690 vehicle rows at €20.2m against €39.6m.
 *
 *  Found by checking our own €4,230 for Radev's Škoda against the €8,274 the
 *  press reported from the same filing. The press was right. */
export type FormCurrency = "BGN" | "EUR";

// The unit as the register spells it in a column header. Tolerant of the
// stray inner spacing the forms carry ("Цена на отчужда ването /лв./").
const EURO_HEADER = /\/\s*евро\s*\//i;
const LEVA_HEADER = /\/\s*лв\.?\s*\//i;
// The "equivalent value" column flips with the template too ("Равностойност в
// лв." → "в евро"), and it is the ONLY currency marker on a filing whose tables
// are all money tables — those state their unit in a cell, not a header, so
// they carry no /лв./ column at all. Measured on the 2026 corpus: this
// identifies 133 euro forms the column headers alone miss, and matches ZERO
// leva forms, so it is a safe one-way signal. Deliberately not mirrored for
// leva: "лв" occurs in ordinary prose ("надвишава 10000 лв."), where matching
// it would flip a euro form back by accident.
const EURO_EQUIV_HEADER = /^Равностойност\s+в\s+евро/i;

/** Which currencies a scope's column headers name. Both flags can be true on a
 *  malformed form, which is why this returns the pair rather than a verdict. */
const headerCurrencies = (
  $: CheerioAPI,
  scope: ReturnType<CheerioAPI>,
): { euro: boolean; leva: boolean } => {
  let euro = false;
  let leva = false;
  scope.find("[Description]").each((_, el) => {
    const d = $(el).attr("Description") ?? "";
    if (EURO_HEADER.test(d) || EURO_EQUIV_HEADER.test(d)) euro = true;
    else if (LEVA_HEADER.test(d)) leva = true;
  });
  return { euro, leva };
};

/** The document's currency, from every column header in it.
 *
 *  BGN is the fallback for a form that names neither — pre-2018 filings, and
 *  the 1,247 of 18,124 whose tables are all empty. It is the historical default
 *  and the conservative direction: a form with no money columns has no value to
 *  mis-convert. */
export const documentFormCurrency = ($: CheerioAPI): FormCurrency => {
  const { euro, leva } = headerCurrencies($, $.root());
  if (euro && !leva) return "EUR";
  return "BGN";
};

/** The currency for ONE table, preferring its own headers over the document's.
 *
 *  Per-table rather than per-document because the two disagreed on exactly one
 *  filing in the 2026 corpus. That is rare enough to be a transcription slip
 *  upstream and cheap enough to honour rather than average away. */
const tableFormCurrency = (
  $: CheerioAPI,
  version: FormVersion,
  logical: LogicalTable,
  docCurrency: FormCurrency,
): FormCurrency => {
  const t = tableOf($, version, logical);
  if (!t) return docCurrency;
  const { euro, leva } = headerCurrencies($, t);
  if (euro && !leva) return "EUR";
  if (leva && !euro) return "BGN";
  return docCurrency;
};

/** Non-empty rows of a logical table that the declarant actually filled in. */
const rowsOfTable = (
  $: CheerioAPI,
  version: FormVersion,
  logical: LogicalTable,
): ReturnType<CheerioAPI>[] => {
  const t = tableOf($, version, logical);
  if (!t || t.attr("Declared") !== "True") return [];
  return t
    .find("Row")
    .toArray()
    .map((el) => $(el))
    .filter((row) => !isEmptyRow($, row));
};

const parseTable10Row = (
  row: ReturnType<CheerioAPI>,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpOwnershipStake => ({
  table: "10",
  // Table 10 is "Дялове в дружества с ограничена отговорност и командитни
  // дружества" — a holding by definition. The asset form has no roles table at
  // all (a sitting MP cannot hold one), so every asset-form stake is a share.
  stakeKind: "share",
  itemType: cellByNum(row, col(2)),
  shareSize: cellByNum(row, col(3)),
  companyName: cellByNum(row, col(4)),
  registeredOffice: cellByNum(row, col(5)),
  // Cell 6 is the declared value in the FORM's currency — see FormCurrency.
  valueEur: toEur(toNumber(cellByNum(row, col(6))), ccy),
  holderName: cellByNum(row, col(7)),
  legalBasis: cellByNum(row, col(9)),
  fundsOrigin: cellByNum(row, col(10)),
});

const parseTable11Row = (
  row: ReturnType<CheerioAPI>,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpOwnershipStake => ({
  table: "11",
  stakeKind: "share",
  itemType: cellByNum(row, col(2)),
  shareSize: cellByNum(row, col(3)),
  companyName: cellByNum(row, col(4)),
  registeredOffice: cellByNum(row, col(5)),
  valueEur: toEur(toNumber(cellByNum(row, col(6))), ccy),
  holderName: null,
  transfereeName: cellByNum(row, col(7)),
  legalBasis: cellByNum(row, col(9)),
  fundsOrigin: null,
});

const toIntYear = (raw: string | null): number | null => {
  if (!raw) return null;
  const m = raw.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
};

// Extract the leading number from a free-text cell. Used for area fields
// where declarants commonly append the unit ("917 кв.м.", "350 м²") even
// though the form already labels the column unit.
// Area fields ONLY — ungated leading-number extraction. For a money cell use
// `toAnnotatedNumber` above, which gates on a delimiter and the declarant's lev-equivalent;
// the counter-examples there explain why this one would be wrong on money.
const toLooseNumber = (raw: string | null): number | null => {
  if (raw == null) return null;
  const m = raw.replace(/,/g, ".").match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// Compare a holder name to the declarant's. Used to flag spouse/family rows
// without identifying who the spouse is (cacbg redacts <Spouse/>).
const normName = (s: string | null): string =>
  (s ?? "")
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const isSpouseHolder = (
  holderName: string | null,
  declarantName: string,
): boolean => {
  const h = normName(holderName);
  if (!h) return false;
  return h !== normName(declarantName);
};

/** Pick the euro figure for an asset row.
 *
 * Cacbg rows have:
 *   - amount in declared currency (cell A)
 *   - currency code (cell B)
 *   - "Равностойност в лв." BGN equivalent (cell C)
 *
 * Preference: the declarant's BGN equivalent (converted to euros at the
 * locked peg) → the declared amount when it's in BGN or EUR → null. Foreign
 * currencies (USD/GBP/CHF, …) without a declarant-provided BGN equivalent
 * stay unvalued: we don't apply approximate cross-rates. See src/lib/currency.ts.
 *
 * `pureMoney` (bank / cash) means cell A is a currency amount, not a count of
 * units — so cell A and cell C describe the SAME sum and must agree up to the
 * FX rate. When the лв-equivalent implies a value wildly larger than the
 * declared amount, cell C is a separator typo (a declarant typed a balance with
 * no decimal, turning €16k into €1.6bn — that one row topped the whole
 * leaderboard). Distrust it and value the row from the amount instead. NOT
 * applied to investment/security, where cell A can legitimately be a share count
 * far smaller than the market value in cell C. */

export const pickEurValue = (
  amount: number | null,
  currency: string | null,
  bgnEquiv: number | null,
  pureMoney = false,
  // The "Равностойност" column is denominated in the FORM's currency: leva
  // before the changeover, euro after. Defaulted so the many call sites that
  // predate the euro template keep their behaviour.
  equivCurrency: FormCurrency = "BGN",
): number | null => {
  const fromEquiv =
    bgnEquiv != null && bgnEquiv !== 0 ? toEur(bgnEquiv, equivCurrency) : null;
  const fromAmount = toEur(amount, currency);
  if (fromEquiv == null) return fromAmount;
  if (
    pureMoney &&
    fromAmount != null &&
    fromAmount !== 0 &&
    Math.abs(fromEquiv) / Math.abs(fromAmount) > MONEY_EQUIV_TYPO_FACTOR
  ) {
    // Say so. Every sibling correction in this parser logs; a silent override
    // is one nobody can audit against the source filing.
    console.warn(
      `[parse] lev-equivalent ${bgnEquiv} contradicts declared ${amount} ${currency ?? "?"} — valuing from the amount`,
    );
    return fromAmount;
  }
  return fromEquiv;
};

/** Hand-curated fixes for the rare separator typos the generic detector
 * (`correctRealEstateSeparatorTypo`, below) cannot resolve on its own —
 * chiefly /1000 typos, since the detector only corrects the dominant /100
 * stripped-decimal-comma case. The manual table is consulted first, so an
 * entry here always wins over the heuristic.
 *
 * Each entry matches by (sourceUrl, location, areaSqm, raw amount) — narrow
 * by construction, so it never touches a row it was not written for. */
const REAL_ESTATE_VALUE_OVERRIDES: Array<{
  sourceUrlContains: string;
  location: string;
  areaSqm: number;
  rawValue: number;
  correctedValue: number;
  note: string;
}> = [
  {
    // Страцимир Павлов 2021 — apartment in Varna 71.14m² 1999.
    // Source XML says 33,383,100 BGN; companion office (41.28m², 2000)
    // is 27,169 BGN. Three-orders-of-magnitude gap → declarant typed
    // thousand-separators in place of decimals. Corrected to /1000.
    sourceUrlContains: "BA28CE20-4161-418F-A6A7-F02741296A4B125934",
    location: "Варна",
    areaSqm: 71.14,
    rawValue: 33383100,
    correctedValue: 33383,
    note: "Corrected: declarant misplaced separator (source value 33,383,100 BGN for 71m² Varna apartment).",
  },
  {
    // Рена Енчева Стефанова 2022 + 2023 — same 73m² apartment in Ruse
    // acquired 1998 declared at 5,887,000 BGN each year. ~80,000 BGN/m²
    // is implausible for 1998 Ruse (regional city, before EU accession);
    // declarant typed thousand-separators in place of decimals — same
    // pattern as the Pavlov 2021 entry above. Corrected to /1000.
    //
    // Match key uses the persistent UUID prefix so a single entry covers
    // both filing years (2022 suffix 136935, 2023 suffix 145755).
    sourceUrlContains: "AC71611D-C92E-42B2-AC71-068007E03AEB",
    location: "гр.Русе",
    areaSqm: 73,
    rawValue: 5887000,
    correctedValue: 5887,
    note: "Corrected: declarant misplaced separator (source value 5,887,000 BGN for 73m² Ruse apartment, applied to every filing year that includes the row).",
  },
  {
    // Рена Енчева Стефанова 2025 — the same 73m² Ruse apartment as the
    // entry above, declared again in her municipal-tier filing (she is a
    // council member). Same 5,887,000 BGN figure; the 2025 filing spells
    // the town "гр. Русе" (with a space) where her earlier MP filings wrote
    // "гр.Русе", so it needs its own match key. Same /1000 correction.
    // (The /1000 reading — not the generic detector's /100 — keeps her
    // 1998 acquisition price-per-m² consistent with her 2005 and 2013
    // purchases once the 1/4 ideal-part share is accounted for.)
    sourceUrlContains: "AC71611D-C92E-42B2-AC71-068007E03AEB",
    location: "гр. Русе",
    areaSqm: 73,
    rawValue: 5887000,
    correctedValue: 5887,
    note: "Corrected: declarant misplaced separator (source value 5,887,000 BGN for 73m² Ruse apartment — 2025 municipal-tier filing).",
  },
  {
    // Янаки Стефанов Лазаров 2024 + 2025 — a 28m² нива in Иванча (общ.
    // Полски Тръмбеш), acquired 1999 by дарение off реституция and held by
    // his spouse, declared at 18,347,000 BGN. That is ~655,000 BGN/m² for
    // restituted village farmland, against his own 62m² Veliko Tarnovo
    // apartment at 247,196 BGN and bank holdings of 118,000 BGN — three
    // orders of magnitude out of line with every other row he files.
    // Corrected to /1000.
    //
    // The generic per-m² detector cannot catch this one: нива is a land
    // parcel, and BUILDING_TYPE_TOKENS deliberately excludes land because
    // declared parcel areas are unreliable (декари vs m², ideal parts).
    // Hence the manual entry.
    //
    // Match key uses the persistent UUID prefix so a single entry covers
    // both filing years (2024 suffix 191281, 2025 suffix 215001). areaSqm
    // 28 also separates it from his other "Иванча" row (къща с двор,
    // 2000m², no declared amount).
    sourceUrlContains: "B0324716-29B9-48B0-B942-D019012591AB",
    location: "Иванча",
    areaSqm: 28,
    rawValue: 18347000,
    correctedValue: 18347,
    note: "Corrected: declarant misplaced separator (source value 18,347,000 BGN for a 28m² restituted нива in Иванча, applied to every filing year that includes the row).",
  },
  {
    // Георги Стефанов Касчиев 2026 (В889) — a 36m² вила on a 980m² Sofia plot,
    // acquired 1999, declared at 15,248,104 EUR. That row alone made him #1 on
    // /officials/assets, and it is declared TWICE (his 1/2 and his spouse's 1/2),
    // so it published at 2× again — €30.85m of a €30.89m "net worth".
    //
    // /1000, not the detector's /100. His own comparable Sofia rows put land at
    // €12/m² (40m² parcel, 2011, €490) and a 128m² flat at €15,288 (2001).
    // /100 would leave €152,481 — €156/m² of plot, an order of magnitude past
    // anything else he declares and past 1999 Sofia villa-zone prices. /1000
    // gives €15,248, i.e. €15.6/m² of plot, consistent with both.
    //
    // Both rows share one match key, so this single entry covers the declarant's
    // and the spouse's copy. Only the В889 filing carries assets (В890 has none).
    sourceUrlContains: "AF943490-BBF9-4CE1-86F8-77B86DD2F3B3",
    location: "гр. София",
    areaSqm: 980,
    rawValue: 15248104,
    correctedValue: 15248,
    note: "Corrected: declarant misplaced separator (source value 15,248,104 EUR for a 36m² вила on a 980m² Sofia plot).",
  },
];

// Property-type tokens whose declared floor area reliably bounds the
// price-per-m². Land parcels (нива, земеделска земя, поземлен имот, …) are
// deliberately excluded: their declared area is unreliable (декари vs m²,
// ideal parts) and coastal/urban land can legitimately reach extreme
// per-m² values, so the per-m² sanity check below does not hold for them.
const BUILDING_TYPE_TOKENS = [
  "апартамент",
  "къща",
  "ателие",
  "гараж",
  "магазин",
  "офис",
  "вила",
  "етаж",
  "студио",
  "мезонет",
];

// The priciest Bulgarian real estate tops out near 16,000 BGN/m² (~8,000
// EUR/m² in central Sofia). A built property an order of magnitude past
// that is a separator typo, not a luxury holding — no genuine row sits
// here, so /100-correcting it cannot rewrite a real value.
const MAX_PLAUSIBLE_BGN_PER_SQM = 100_000;
// Below this floor the declared m² is itself unreliable (ideal parts,
// cellars, mis-entered units), so per-m² cannot anchor the check.
const MIN_ANCHOR_SQM = 10;

/** Generic detector for the dominant separator typo: a declarant entered a
 * value like "177309,00" and the decimal comma was dropped in digitisation,
 * leaving a figure 100× too high. Returns the /100 correction when the row
 * is a built property whose raw price-per-m² is implausible AND whose /100
 * value lands back in a realistic band; otherwise null — leaving the raw
 * value for the manual table above or the suspicious-value report. Never
 * touches land, tiny-area rows, or values that /100 does not fully resolve
 * (those need a human — they may be /1000 typos or a wrong area). */
const correctRealEstateSeparatorTypo = (
  rawValue: number | null,
  areaSqm: number | null,
  description: string | null,
  builtAreaSqm: number | null = null,
): number | null => {
  if (rawValue == null) return null;
  const desc = description?.toLowerCase() ?? "";
  if (!BUILDING_TYPE_TOKENS.some((tok) => desc.includes(tok))) return null;
  // Anchor on the BUILDING, not the plot. The filing instructions are explicit for a
  // house-plus-yard row: „в колона 5 се посочва площта на парцела, а в колона 6 - на
  // сградата" — so for a built property column 6 is the area the price per m² means
  // anything against. Anchoring on column 5 was wrong in both directions:
  //
  //   • a villa on a big plot diluted its own per-m² past detection. Георги Касчиев's
  //     36m² вила on a 980m² Sofia plot was declared at 15,248,104 — 423,558/m² of
  //     building, but only 15,559/m² of plot, so it sailed under the threshold and
  //     published as €15.2m (his own 2011 Sofia parcel is €12/m²). It ranked #1 on
  //     /officials/assets.
  //   • an apartment declares its plot as "0" (площ 0, РЗП 41), so 662 valued building
  //     rows had NO usable anchor at all and were never checked.
  //
  // Falls back to the plot only when there is no built area to use.
  const anchor =
    builtAreaSqm != null && builtAreaSqm > 0 ? builtAreaSqm : areaSqm;
  if (anchor == null || anchor < MIN_ANCHOR_SQM) return null;
  if (rawValue / anchor <= MAX_PLAUSIBLE_BGN_PER_SQM) return null;
  const corrected = rawValue / 100;
  if (corrected / anchor > MAX_PLAUSIBLE_BGN_PER_SQM) return null;
  return corrected;
};

/** Manual vehicle-value fixes for cases the generic old-vehicle detector
 * (`correctOldVehicleSeparatorTypo`, below) cannot resolve. Currently empty
 * — the detector handles every known vehicle separator typo, including the
 * 1999 VW Golf and 1997 Fiat that used to be hand-listed here. Add an entry
 * (set `correctedValue` to the raw value to force "leave as-is") only when
 * the detector gets a row wrong. */
const VEHICLE_VALUE_OVERRIDES: Array<{
  sourceUrlContains: string;
  detailContains?: string;
  acquiredYear: number;
  rawValue: number;
  correctedValue: number;
  note: string;
}> = [];

const CURRENT_YEAR = new Date().getFullYear();
// Vehicle age past which a 150k+ BGN valuation is almost always a misplaced
// separator rather than a collector price.
const OLD_VEHICLE_AGE_YEARS = 20;
// A vehicle older than the age gate declared above this is treated as a
// separator typo. Genuine classics this valuable are vanishingly rare in
// declarant filings; the few that exist can be pinned via the table above.
const OLD_VEHICLE_TYPO_BGN = 150_000;

/** Generic detector for the dominant old-vehicle separator typo: an aged
 * car declared at ~1000× its real value (e.g. "400,000" for a value of
 * 400). Returns the /1000 correction when the vehicle clears the age gate,
 * the raw value is implausibly high, AND /1000 lands back under the typo
 * threshold; otherwise null. Vehicles have no per-unit anchor, so the age
 * gate does the discriminating — recent machinery (a 2024 combine that is
 * genuinely worth 600k BGN) is never touched. */
const correctOldVehicleSeparatorTypo = (
  rawValue: number | null,
  acquiredYear: number | null,
): number | null => {
  if (rawValue == null || acquiredYear == null) return null;
  if (CURRENT_YEAR - acquiredYear < OLD_VEHICLE_AGE_YEARS) return null;
  if (rawValue <= OLD_VEHICLE_TYPO_BGN) return null;
  const corrected = rawValue / 1000;
  if (corrected > OLD_VEHICLE_TYPO_BGN) return null;
  return corrected;
};

const parseTable1Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  sourceUrl: string,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpAsset => {
  const holder = cellByNum(row, col(8));
  const rawValue = toNumber(cellByNum(row, col(11)));
  const location = cellByNum(row, col(3));
  const areaSqm = toLooseNumber(cellByNum(row, col(5)));
  const builtAreaSqm = toLooseNumber(cellByNum(row, col(6)));
  const description = cellByNum(row, col(2));
  let value = rawValue;
  let overridden = false;
  if (rawValue != null && location != null && areaSqm != null) {
    const fix = REAL_ESTATE_VALUE_OVERRIDES.find(
      (o) =>
        sourceUrl.includes(o.sourceUrlContains) &&
        o.location === location &&
        Math.abs(o.areaSqm - areaSqm) < 0.01 &&
        o.rawValue === rawValue,
    );
    if (fix) {
      value = fix.correctedValue;
      overridden = true;
    }
  }
  // No hand-curated override → run the generic separator-typo detector.
  if (!overridden) {
    const auto = correctRealEstateSeparatorTypo(
      rawValue,
      areaSqm,
      description,
      builtAreaSqm,
    );
    if (auto != null) {
      console.warn(
        `[parse] auto-corrected real-estate value — ${declarantName}: ` +
          `${description ?? "?"} ${areaSqm}m² ${rawValue} → ${auto} BGN ` +
          `(${sourceUrl})`,
      );
      value = auto;
    }
  }
  return {
    category: "real_estate",
    description,
    detail: null,
    location,
    municipality: cellByNum(row, col(4)),
    areaSqm,
    builtAreaSqm,
    acquiredYear: toIntYear(cellByNum(row, col(7))),
    share: cellByNum(row, col(10)),
    currency: value != null ? ccy : null,
    amount: value,
    valueEur: toEur(value, ccy),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, col(12)),
    fundsOrigin: cellByNum(row, col(13)),
  };
};

const parseTable3Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  sourceUrl: string,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpAsset => {
  const holder = cellByNum(row, col(6));
  const rawValue = toNumber(cellByNum(row, col(4)));
  const detail = cellByNum(row, col(3));
  const acquiredYear = toIntYear(cellByNum(row, col(5)));
  let value = rawValue;
  let overridden = false;
  if (rawValue != null && acquiredYear != null) {
    const fix = VEHICLE_VALUE_OVERRIDES.find(
      (o) =>
        sourceUrl.includes(o.sourceUrlContains) &&
        o.acquiredYear === acquiredYear &&
        o.rawValue === rawValue &&
        (o.detailContains == null ||
          (detail != null &&
            detail.toLowerCase().includes(o.detailContains.toLowerCase()))),
    );
    if (fix) {
      value = fix.correctedValue;
      overridden = true;
    }
  }
  // No hand-curated override → run the generic old-vehicle typo detector.
  if (!overridden) {
    const auto = correctOldVehicleSeparatorTypo(rawValue, acquiredYear);
    if (auto != null) {
      console.warn(
        `[parse] auto-corrected vehicle value — ${declarantName}: ` +
          `${detail ?? "?"} (${acquiredYear}) ${rawValue} → ${auto} BGN ` +
          `(${sourceUrl})`,
      );
      value = auto;
    }
  }
  return {
    category: "vehicle",
    description: cellByNum(row, col(2)),
    detail,
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear,
    share: cellByNum(row, col(8)),
    currency: value != null ? ccy : null,
    amount: value,
    valueEur: toEur(value, ccy),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, col(9)),
    fundsOrigin: cellByNum(row, col(10)),
  };
};

// Tables 4, 5, 6, 7, 8 share an "amount + currency + BGN equivalent" layout.
// Cell positions vary slightly per table — pass them explicitly.
type MoneyCellMap = {
  amount: number;
  currency: number;
  bgnEquiv: number;
  holder: number;
  legalBasis?: number;
  fundsOrigin?: number;
  description?: number;
};

const parseMoneyRow = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  category: MpAssetCategory,
  cells: MoneyCellMap,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpAsset => {
  const currency = cellByNum(row, col(cells.currency));
  const bgnEquiv = toNumber(cellByNum(row, col(cells.bgnEquiv)));
  const amount = toAnnotatedNumber(
    cellByNum(row, col(cells.amount)),
    currency,
    bgnEquiv,
  );
  const holder = cellByNum(row, col(cells.holder));
  return {
    category,
    description: cells.description
      ? cellByNum(row, col(cells.description))
      : null,
    detail: currency,
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: null,
    share: null,
    currency,
    amount,
    // bank/cash: cell A is money, so it and the лв-equivalent must agree — a
    // large gap is a typo. cash/receivable/investment/security: cell A may be a
    // count, so trust the лв-equivalent as-is.
    valueEur: pickEurValue(
      amount,
      currency,
      bgnEquiv,
      category === "bank" || category === "cash",
      ccy,
    ),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cells.legalBasis ? cellByNum(row, col(cells.legalBasis)) : null,
    fundsOrigin: cells.fundsOrigin
      ? cellByNum(row, col(cells.fundsOrigin))
      : null,
  };
};

const parseTable9Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpAsset => {
  const holder = cellByNum(row, col(8));
  const price = toNumber(cellByNum(row, col(7)));
  return {
    category: "security",
    description: cellByNum(row, col(2)),
    detail: cellByNum(row, col(6)), // emitter / issuer
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: null,
    share: cellByNum(row, col(3)), // count of securities — preserve raw text
    currency: price != null ? ccy : null,
    amount: price,
    valueEur: toEur(price, ccy),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, col(10)),
    fundsOrigin: cellByNum(row, col(11)),
  };
};

/** Drop *built* real-estate rows byte-identical to an earlier row in the
 * same declaration — a data-entry duplication (the same property keyed
 * twice, or a row repeated across Tables 1 / 1.1 / 1.2).
 *
 * Two conditions, both deliberately strict, keep this from eating real
 * holdings:
 *  - Only **building** types (апартамент, къща, гараж, …) are considered.
 *    Byte-identical *land* rows (нива, ливада, гора, …) are routinely
 *    genuine — land restitution left owners holding many equal fragmented
 *    parcels the form cannot tell apart — so they are always kept.
 *  - Only **byte-identical** rows collapse. Two апартамент rows sharing a
 *    town and floor area but differing in acquisition year, ideal-part
 *    share or price are distinct holdings (often ideal parts of one
 *    property bought separately) and are kept. */
const dedupeRealEstateRows = (
  assets: MpAsset[],
  declarantName: string,
): MpAsset[] => {
  const seen = new Set<string>();
  const out: MpAsset[] = [];
  for (const asset of assets) {
    const desc = asset.description?.toLowerCase() ?? "";
    const isBuilding =
      asset.category === "real_estate" &&
      BUILDING_TYPE_TOKENS.some((tok) => desc.includes(tok));
    if (!isBuilding) {
      out.push(asset);
      continue;
    }
    const sig = JSON.stringify(asset);
    if (seen.has(sig)) {
      console.warn(
        `[parse] dropped duplicate real-estate row — ${declarantName}: ` +
          `${asset.description ?? "?"} ${asset.location ?? "?"} ` +
          `${asset.areaSqm ?? "?"}m²`,
      );
      continue;
    }
    seen.add(sig);
    out.push(asset);
  }
  return out;
};

/** Is this Table 7 row an available credit LINE rather than money owed?
 *
 *  Keyed on the declarant's own words in the description cell. „лимит" alone is the
 *  reliable marker — it is what makes the figure a ceiling rather than a balance — and a
 *  bare „кредитна карта" with no limit wording is left as debt, since a card CAN carry a
 *  drawn balance and we cannot tell which was meant.
 *
 *  Deliberately narrow: mislabelling a real debt as a credit line inflates net worth, which
 *  is the more damaging direction of the two. */
export const creditLimitRow = (description: string | null): boolean =>
  /лимит/i.test(description ?? "");

const parseAssetTables = (
  $: CheerioAPI,
  declarantName: string,
  sourceUrl: string,
  version: FormVersion,
): MpAsset[] => {
  const out: MpAsset[] = [];
  // The unit every header-only money column on this form is denominated in.
  // Resolved per table below, with this as the fallback — see FormCurrency.
  const docCcy = documentFormCurrency($);

  // Table 1 family — real estate. The cacbg form splits this into:
  //   1   = own real estate ("Право на собственост и ограничени вещни права")
  //   1.1 = agricultural land & forests
  //   1.2 = foreign real estate the declarant uses (rented/granted by an
  //         owner that is not the declarant). Cell layout matches Table 1.
  // Table 2 ("transfer of property in prior year") is intentionally NOT
  // parsed here — those properties have already left the declarant's
  // estate and would inflate totals.
  for (const tn of ["realEstate", "agriLand", "foreignRealEstate"] as const) {
    const col = columnResolver(version, tn);
    const ccy = tableFormCurrency($, version, tn, docCcy);
    for (const row of rowsOfTable($, version, tn)) {
      out.push(parseTable1Row(row, declarantName, sourceUrl, col, ccy));
    }
  }

  // Table 3 family — vehicles. Subtables share the same cell layout:
  //   3   = motor vehicles (cars, motorcycles)
  //   3.1 = agricultural & forestry machinery
  //   3.2 = boats & aircraft
  //   3.3 = other registrable vehicles
  //   3.4 = foreign vehicles over 10k BGN that the declarant uses
  // Table 3.5 ("transferred in prior year") is skipped for the same reason
  // as Table 2.
  for (const tn of [
    "vehicles",
    "agriMachinery",
    "boats",
    "otherVehicles",
    "foreignVehicles",
  ] as const) {
    const col = columnResolver(version, tn);
    const ccy = tableFormCurrency($, version, tn, docCcy);
    for (const row of rowsOfTable($, version, tn)) {
      out.push(parseTable3Row(row, declarantName, sourceUrl, col, ccy));
    }
  }

  // Table 4 — cash on hand
  const cashCol = columnResolver(version, "cash");
  for (const row of rowsOfTable($, version, "cash")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        "cash",
        {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 7,
        },
        cashCol,
        tableFormCurrency($, version, "cash", docCcy),
      ),
    );
  }

  // Table 5 — bank accounts / deposits
  const bankCol = columnResolver(version, "bank");
  for (const row of rowsOfTable($, version, "bank")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        "bank",
        {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 9,
        },
        bankCol,
        tableFormCurrency($, version, "bank", docCcy),
      ),
    );
  }

  // Table 6 — receivables > 10k BGN
  const receivableCol = columnResolver(version, "receivable");
  for (const row of rowsOfTable($, version, "receivable")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        "receivable",
        {
          amount: 3,
          currency: 4,
          bgnEquiv: 5,
          holder: 6,
          legalBasis: 8,
          description: 2,
        },
        receivableCol,
        tableFormCurrency($, version, "receivable", docCcy),
      ),
    );
  }

  // Table 7 — debts > 10k BGN.
  //
  // ⚠️ NOT EVERY ROW HERE IS MONEY OWED. Declarants routinely list a credit card by its
  // LIMIT — „кредитна карта - лимит", 2,654 rows across 1,421 people in the 2026 filings —
  // and a limit is what they COULD draw, not what they have. Subtracting it from net worth
  // asserts a debt nobody declared: Илияна Йотова's only Table 7 rows are two cards
  // totalling EUR 20,000, so her published net worth was 8% below the filing. The press
  // reports the figure as its own line („Кредитни карти – лимит – 20 000 евро") beside the
  // assets, never netted off, and that is the honest reading.
  //
  // Split at PARSE time rather than filtered at each aggregate: `category = 'debt'` is
  // tested in 090_person_wealth.sql, 105_mp_serving.sql, officials/rankings.ts and the two
  // asset screens, and a rule restated in six places is one somebody misses.
  const debtCol = columnResolver(version, "debt");
  for (const row of rowsOfTable($, version, "debt")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        creditLimitRow(cellByNum(row, debtCol(2))) ? "credit_limit" : "debt",
        {
          amount: 3,
          currency: 4,
          bgnEquiv: 5,
          holder: 6,
          legalBasis: 8,
          description: 2,
        },
        debtCol,
        tableFormCurrency($, version, "debt", docCcy),
      ),
    );
  }

  // Table 8 — investment & pension funds (incl. crypto since 2024 ordinance)
  const investmentCol = columnResolver(version, "investment");
  for (const row of rowsOfTable($, version, "investment")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        "investment",
        {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 9,
        },
        investmentCol,
        tableFormCurrency($, version, "investment", docCcy),
      ),
    );
  }

  // Table 9 — securities & financial instruments
  const securityCol = columnResolver(version, "security");
  for (const row of rowsOfTable($, version, "security")) {
    out.push(
      parseTable9Row(
        row,
        declarantName,
        securityCol,
        tableFormCurrency($, version, "security", docCcy),
      ),
    );
  }

  return dedupeRealEstateRows(out, declarantName);
};

const parseIncomeRow = (
  row: ReturnType<CheerioAPI>,
  col: ColumnResolver,
  ccy: FormCurrency,
): MpIncomeRecord => ({
  parent: row.attr("Parent") || null,
  category: cellByNum(row, col(2)),
  // Income columns state their unit in the header only ("На декларатора /лв./"
  // vs "/евро/"), so they follow the form's currency like the asset tables.
  amountEurDeclarant: toEur(toNumber(cellByNum(row, col(3))), ccy),
  amountEurSpouse: toEur(toNumber(cellByNum(row, col(4))), ccy),
});

// The register itself starts in 2005 (see MIN_PLAUSIBLE_YEAR in
// scripts/lib/cacbg_register.ts) — a filing cannot predate it. This is the
// absolute floor; the plausibility window below is the one that actually does
// the work, because it is relative to the folder rather than to 2005.
const MIN_DECLARATION_YEAR = 2005;

// How far below its register folder a declared year may sit before it reads as
// a typo rather than a late filing. Generous: the register does publish
// genuinely late filings, and a correction to a several-years-old declaration
// is a real thing. Anything beyond it is a mis-keyed date (2005 in a 2025
// folder), and the point of the window is to stop BELIEVING that value, not to
// rewrite it to something equally invented.
const PLAUSIBLE_YEAR_SLACK = 3;

// Which year a filing belongs to, in descending order of trustworthiness.
//
// `DeclarationData > Year` is the fiscal year the filing covers, and an annual
// filed in year N covers N-1 — so an annual's own year is fiscal+1. But that
// element is EMPTY on every one-off filing (Entry / Vacate / Other), which is
// ~40% of the corpus. Those used to fall through to `new Date().getFullYear()`,
// stamping a 2023 incompatibility filing with whatever year the pipeline
// happened to run in. Because every consumer sorts newest-first on this field,
// one wall-clock row jumped ahead of the declarant's real filings and became
// their "latest declaration" — which is how ~29% of the officials index came to
// claim a 2026 that does not exist.
//
// So: never consult the clock. Fall through to the filing date, then to the
// register folder the XML was published in, which is always knowable from the
// source URL.
//
// Returns the fiscal year as well, because disbelieving a value for DATING and
// then publishing it as fact would be incoherent: `fiscalYear` is what
// priorAssetDeclaration keys the "vs prior year" comparison on, so a 2004 left
// on a 2024 filing produces a delta across a 19-year gap that never happened.
export const resolveDeclarationYear = ({
  declType,
  fiscalYear,
  filedAt,
  sourceUrl,
}: {
  declType: string;
  fiscalYear: number | null;
  filedAt: string | null;
  sourceUrl: string;
}): { declarationYear: number; fiscalYear: number | null } => {
  const folderYear = registerFolderYear(sourceUrl, { allowSuffixed: true });

  // Finiteness, not nullishness. `<Year>` is read with `Number(...)`, so any
  // non-numeric content ("2023 г.", "н/д", a stray NBSP) arrives as NaN — and
  // `NaN != null` is true, which would take this rung and then fail out of the
  // whole chain even when `filedAt` and the folder are both perfectly good.
  const fy =
    fiscalYear != null && Number.isFinite(fiscalYear) ? fiscalYear : null;
  if (fiscalYear != null && fy == null) {
    console.warn(
      `[parse] unusable <Year> "${fiscalYear}" — dating from filedAt/folder instead (${sourceUrl})`,
    );
  }

  // A filing published in folder N declares fiscal N-1 (annual) or N
  // (entry/exit). A `<Year>` outside that neighbourhood is an upstream typo,
  // not a late filing, and it must not be TRUSTED — clamping it would still
  // invent a year. Fall through to the next rung instead, exactly as for a
  // non-numeric one.
  //
  // Real example: a 2025-folder Vacate declaring 2005. Clamping to the register
  // floor left it dated 2005, so it sorted BELOW the declarant's 3-row annual
  // filed the same day and became the "prior" filing to difference against —
  // publishing a net worth of −€79,546.
  const fyPlausible =
    fy != null &&
    (folderYear == null ||
      (fy >= folderYear - PLAUSIBLE_YEAR_SLACK && fy <= folderYear));
  if (fy != null && !fyPlausible) {
    console.warn(
      `[parse] <Year> ${fy} is implausible for register folder ${folderYear} — dating from filedAt/folder instead (${sourceUrl})`,
    );
  }

  const filedYear = filedAt != null ? Number(filedAt.slice(0, 4)) : null;
  // The filing date is typo'd upstream too — a 2024 annual "filed" in 2004 —
  // so it gets the same plausibility test before it is believed.
  const filedPlausible =
    filedYear != null &&
    Number.isFinite(filedYear) &&
    (folderYear == null ||
      (filedYear >= folderYear - PLAUSIBLE_YEAR_SLACK &&
        filedYear <= folderYear + 1));

  // Only a believed fiscal year is published. An implausible one is dropped
  // rather than carried forward as a fact we already refused to date from.
  const believedFiscalYear = fyPlausible ? (fy as number) : null;

  const derived = fyPlausible
    ? declType === "Annualy"
      ? (fy as number) + 1
      : (fy as number)
    : filedPlausible
      ? filedYear
      : folderYear;

  if (derived == null || !Number.isFinite(derived)) {
    throw new Error(
      `cannot resolve declarationYear for ${sourceUrl} (type=${declType}, fiscalYear=${fiscalYear}, filedAt=${filedAt})`,
    );
  }

  // A filing cannot declare a year later than the folder that published it —
  // the folder year IS when it was published, for every filing type. An annual
  // filed in folder N covers fiscal N-1, so `fy+1` lands on N (the folder), not
  // N+1. The register does carry annuals whose `Year` equals the folder year
  // (fiscal 2018 in the 2018 folder, filed that May); `fy+1` makes those 2019,
  // one year past the folder. An earlier version excepted annuals from the bound
  // to "allow the +1" — but that +1 is relative to the fiscal year, not the
  // folder, so the exception let exactly those 136 rows read a year into the
  // future. The bound is the folder year, no exception.
  //
  // Two-sided: `registerFolderYear` already refuses anything below 2005, but a
  // typo'd `Year` of 1900 would otherwise strand the row at the bottom of the
  // declarant's history. Clamp and say so, rather than silently trusting or
  // silently rewriting.
  if (folderYear != null) {
    const maxYear = folderYear;
    if (derived > maxYear) {
      console.warn(
        `[parse] declarationYear ${derived} exceeds register folder ${folderYear} — clamping to ${maxYear} (${sourceUrl})`,
      );
      return { declarationYear: maxYear, fiscalYear: believedFiscalYear };
    }
    if (derived < MIN_DECLARATION_YEAR) {
      console.warn(
        `[parse] declarationYear ${derived} precedes the register itself — clamping to ${MIN_DECLARATION_YEAR} (${sourceUrl})`,
      );
      return {
        declarationYear: MIN_DECLARATION_YEAR,
        fiscalYear: believedFiscalYear,
      };
    }
  }
  return { declarationYear: derived, fiscalYear: believedFiscalYear };
};

/** Tables the form records but that are NOT part of the estate at filing time:
 *  prior-year disposals (2, 3.5) and things other people paid for (13, 14).
 *
 *  Skipping 2 and 3.5 in the TOTALS is right — the declarant no longer owns
 *  them — but skipping them entirely threw away the disposal event itself,
 *  which is the part with any signal in it. 13 and 14 were never read at all,
 *  and between them they are the closest thing this form has to a gifts
 *  register. */
const parseEventTables = (
  $: CheerioAPI,
  version: FormVersion,
  declarantName: string,
): MpDeclarationEvent[] => {
  const out: MpDeclarationEvent[] = [];
  const rowsOf = (logical: LogicalTable) => rowsOfTable($, version, logical);
  // Same header-only currency question as the asset tables — see FormCurrency.
  const docCcy = documentFormCurrency($);
  const propertyDisposalCcy = tableFormCurrency(
    $,
    version,
    "propertyDisposal",
    docCcy,
  );
  const vehicleDisposalCcy = tableFormCurrency(
    $,
    version,
    "vehicleDisposal",
    docCcy,
  );
  const guaranteeCcy = tableFormCurrency($, version, "guarantees", docCcy);

  // Table 2 — real estate transferred during the previous year.
  //
  // Sale prices are hand-keyed into the same kind of cell as acquisition
  // prices and carry the same separator typos, so they get the same guard the
  // asset side gets. Skipping it here would publish a disposal an order of
  // magnitude larger than the acquisition of the very same property — and a
  // disposal feed is read for exactly those outliers.
  const propertyCol = columnResolver(version, "propertyDisposal");
  for (const row of rowsOf("propertyDisposal")) {
    const description = cellByNum(row, propertyCol(2));
    const areaSqm = toLooseNumber(cellByNum(row, propertyCol(5)));
    const rawValue = toNumber(cellByNum(row, propertyCol(10)));
    const corrected = correctRealEstateSeparatorTypo(
      rawValue,
      areaSqm,
      description,
      toLooseNumber(cellByNum(row, propertyCol(6))),
    );
    if (corrected != null) {
      console.warn(
        `[parse] auto-corrected disposal value — ${declarantName}: ` +
          `${description ?? "?"} ${areaSqm}m² ${rawValue} → ${corrected} BGN`,
      );
    }
    out.push({
      kind: "disposal_property",
      description,
      detail: null,
      location: cellByNum(row, propertyCol(3)),
      municipality: cellByNum(row, propertyCol(4)),
      areaSqm,
      builtAreaSqm: toLooseNumber(cellByNum(row, propertyCol(6))),
      currency: propertyDisposalCcy,
      valueEur: toEur(corrected ?? rawValue, propertyDisposalCcy),
      legalBasis: cellByNum(row, propertyCol(11)),
    });
  }

  // Table 3.5 — vehicles transferred during the previous year.
  const vehicleCol = columnResolver(version, "vehicleDisposal");
  for (const row of rowsOf("vehicleDisposal")) {
    out.push({
      kind: "disposal_vehicle",
      description: cellByNum(row, vehicleCol(2)),
      detail: cellByNum(row, vehicleCol(3)),
      location: null,
      municipality: null,
      areaSqm: null,
      builtAreaSqm: null,
      currency: vehicleDisposalCcy,
      valueEur: toEur(
        toNumber(cellByNum(row, vehicleCol(4))),
        vehicleDisposalCcy,
      ),
      legalBasis: cellByNum(row, vehicleCol(8)),
    });
  }

  // Table 13 — securities given / expenses made in the declarant's favour that
  // they did not pay for. No currency cell: the unit is the form's.
  const guaranteeCol = columnResolver(version, "guarantees");
  for (const row of rowsOf("guarantees")) {
    out.push({
      kind: "guarantee",
      description: cellByNum(row, guaranteeCol(2)),
      detail: null,
      location: null,
      municipality: null,
      areaSqm: null,
      builtAreaSqm: null,
      currency: guaranteeCcy,
      valueEur: toEur(toNumber(cellByNum(row, guaranteeCol(3))), guaranteeCcy),
      legalBasis: null,
    });
  }

  // Table 14 — expenses for the declarant, spouse or minor children paid by a
  // third party. This one DOES carry a currency and a leva equivalent, so it
  // gets the same treatment as a money asset row.
  const expenseCol = columnResolver(version, "expenses");
  for (const row of rowsOf("expenses")) {
    const amount = toNumber(cellByNum(row, expenseCol(3)));
    const currency = cellByNum(row, expenseCol(4));
    out.push({
      kind: "third_party_expense",
      description: cellByNum(row, expenseCol(2)),
      detail: null,
      location: null,
      municipality: null,
      areaSqm: null,
      builtAreaSqm: null,
      currency,
      valueEur: pickEurValue(
        amount,
        currency,
        toNumber(cellByNum(row, expenseCol(5))),
        true,
      ),
      legalBasis: null,
    });
  }

  return out;
};

/** The interests forms, whose numbering the two maps above have nothing to do
 *  with. Both carry the SAME six-table interests block twice over — once as at
 *  the date of appointment, once as at twelve months before it — plus contracts
 *  and related persons. Only Dekl3 has the early-repayment table.
 *
 *  Every column layout here is 3 cells wide (ном. по ред + two content cells)
 *  except the early-repayment table, and it is identical across all 4,906
 *  filings on file — verified by enumerating every <Cell Num=/Description=>
 *  tuple in the cache. So unlike the asset form there is no version axis. */
type InterestTable =
  | "sharesNow"
  | "rolesNow"
  | "soleTraderNow"
  | "sharesPrior"
  | "rolesPrior"
  | "soleTraderPrior"
  | "contracts"
  | "relatedPersons"
  | "earlyRepayment";

const INTEREST_TABLE_NUMS: Record<
  "interests_entry" | "interests_change",
  Record<InterestTable, string | null>
> = {
  // Dekl3 — "при промяна". Tables 1-9.
  interests_change: {
    sharesNow: "1",
    rolesNow: "2",
    soleTraderNow: "3",
    sharesPrior: "4",
    rolesPrior: "5",
    soleTraderPrior: "6",
    contracts: "7",
    relatedPersons: "8",
    earlyRepayment: "9",
  },
  // Dekl2 — "при встъпване". Tables 15-22; it has no early-repayment table at
  // all, which is null rather than a number so it cannot fall through to some
  // neighbouring table by accident.
  interests_entry: {
    sharesNow: "15",
    rolesNow: "16",
    soleTraderNow: "17",
    sharesPrior: "18",
    rolesPrior: "19",
    soleTraderPrior: "20",
    contracts: "21",
    relatedPersons: "22",
    earlyRepayment: null,
  },
};

/** WHAT each interests table declares, and how to label it.
 *
 *  `kind` is the machine discriminator every consumer must filter on — a
 *  directorship is NOT a holding, and the two are indistinguishable once the
 *  row is in `declaration_stake` unless this travels with it. `label` is the
 *  register's own wording for display, and is deliberately NOT what anything
 *  branches on: matching a Bulgarian sentence in SQL breaks silently the day
 *  somebody improves the phrasing. */
const INTEREST_STAKE_KIND: Record<
  string,
  { kind: "share" | "role" | "sole_trader"; label: string }
> = {
  sharesNow: { kind: "share", label: "Участие в търговско дружество" },
  rolesNow: {
    kind: "role",
    label: "Управител или член на орган на управление",
  },
  soleTraderNow: { kind: "sole_trader", label: "Едноличен търговец" },
  sharesPrior: { kind: "share", label: "Участие в търговско дружество" },
  rolesPrior: {
    kind: "role",
    label: "Управител или член на орган на управление",
  },
  soleTraderPrior: { kind: "sole_trader", label: "Едноличен търговец" },
};

/** Who an early-repaid debt was owed to, from cells 8 and 9 ("Към банки" /
 *  "Към физически и юридически лица").
 *
 *  Declarants use these two columns in one of two ways: they name the creditor
 *  (ОББ ×30, ДСК ×26, Банка ДСК ×12, ЦКБ ×11, Уникредит Булбанк ×11 across the
 *  320 declared rows) or they tick the column with a bare да/не, which only
 *  restates which of the two columns they filled and adds nothing. So keep a
 *  name and drop a token: "потребителски кредит към ОББ" is worth reading,
 *  "потребителски кредит към да" is noise. Banks first, since that is the
 *  column declarants actually name. */
const YES_NO_CELL = /^(да|не)$/i;

const creditorOf = (row: ReturnType<CheerioAPI>): string | null => {
  for (const n of [8, 9]) {
    const v = cellByNum(row, n);
    if (v && !YES_NO_CELL.test(v)) return v;
  }
  return null;
};

const interestRows = (
  $: CheerioAPI,
  kind: "interests_entry" | "interests_change",
  logical: InterestTable,
): ReturnType<CheerioAPI>[] => {
  const num = INTEREST_TABLE_NUMS[kind][logical];
  if (num == null) return [];
  const t = $(`Table[Num="${num}"]`).first();
  if (t.length === 0 || t.attr("Declared") !== "True") return [];
  return t
    .find("Row")
    .toArray()
    .map((el) => $(el))
    .filter((row) => !isEmptyRow($, row));
};

/** The interests forms, parsed onto the shapes the site already serves.
 *
 *  Company holdings become STAKES — the same shape tables 10/11 of the asset
 *  form produce, so they render in the existing "Дялове в дружества" block and
 *  feed the declared-stake → EIK → public-contracts resolver (096) without a
 *  new table. `table` encodes WHEN: "10" = held now, "11" = held in the twelve
 *  months before appointment and not since, which is the same "no longer held"
 *  reading table 11 already carries for a transferred share.
 *
 *  Contracts, related persons and early repayments become EVENTS — things the
 *  filing records that are not holdings, which is exactly the line `events`
 *  already draws. None of them touch net worth. */
const parseInterestTables = (
  $: CheerioAPI,
  kind: "interests_entry" | "interests_change",
): { stakes: MpOwnershipStake[]; events: MpDeclarationEvent[] } => {
  const stakes: MpOwnershipStake[] = [];
  const events: MpDeclarationEvent[] = [];

  for (const logical of [
    "sharesNow",
    "rolesNow",
    "soleTraderNow",
    "sharesPrior",
    "rolesPrior",
    "soleTraderPrior",
  ] as const) {
    const held = logical.endsWith("Now");
    for (const row of interestRows($, kind, logical)) {
      const what = INTEREST_STAKE_KIND[logical];
      stakes.push({
        table: held ? "10" : "11",
        stakeKind: what.kind,
        itemType: what.label,
        // Cell 3 is "Размер на дяловото участие" / "Участие" / "Предмет на
        // дейност" depending on the table — all raw text, all the same slot.
        shareSize: cellByNum(row, 3),
        companyName: cellByNum(row, 2),
        registeredOffice: null,
        // The interests form asks WHETHER, never for how much. A declared
        // interest with no declared value must stay null: a 0 here would enter
        // the stake as worth nothing rather than as unpriced.
        valueEur: null,
        holderName: null,
        legalBasis: null,
        fundsOrigin: null,
      });
    }
  }

  const flat = (
    logical: InterestTable,
    eventKind: DeclarationEventKind,
  ): void => {
    for (const row of interestRows($, kind, logical)) {
      events.push({
        kind: eventKind,
        // Cell 2 names the counterparty (the person a contract is with, or the
        // related person); cell 3 says what the connection is about.
        description: cellByNum(row, 2),
        detail: cellByNum(row, 3),
        location: null,
        municipality: null,
        areaSqm: null,
        builtAreaSqm: null,
        currency: null,
        valueEur: null,
        legalBasis: null,
      });
    }
  };
  flat("contracts", "interest_contract");
  flat("relatedPersons", "related_person");

  // The early-repayment table is the one interests table that carries money:
  // a debt settled ahead of term, and — the reason the table exists at all —
  // where the money to settle it came from.
  for (const row of interestRows($, kind, "earlyRepayment")) {
    const amount = toNumber(cellByNum(row, 3));
    const currency = cellByNum(row, 4);
    const kindOfDebt = cellByNum(row, 2);
    const creditor = creditorOf(row);
    events.push({
      kind: "early_repayment",
      // "потребителски кредит", "ипотечен кредит" — plus who it was owed to
      // where the declarant named them.
      description:
        kindOfDebt && creditor ? `${kindOfDebt} към ${creditor}` : kindOfDebt,
      detail: cellByNum(row, 6), // титуляр на задължението
      location: null,
      municipality: null,
      areaSqm: null,
      builtAreaSqm: null,
      currency,
      // Cell 5 is the declarant's own "Равностойност в лв." for the same sum,
      // so pureMoney applies: the two must agree up to the FX rate. Cell 7
      // ("правно основание") is deliberately NOT read as money — a declarant
      // typing their loan CONTRACT NUMBER there is what the asset-map misparse
      // published as a €3.58bn holding.
      valueEur: pickEurValue(
        amount,
        currency,
        toNumber(cellByNum(row, 5)),
        true,
      ),
      // "дарение", "спестявания", "продажба на имот" — the origin of the funds,
      // which is the whole point of the table.
      legalBasis: cellByNum(row, 10),
    });
  }

  return { stakes, events };
};

export type ParseInput = {
  xml: string;
  mpId: number;
  institution: string;
  sourceUrl: string;
};

export const parseDeclarationXml = ({
  xml,
  mpId,
  institution,
  sourceUrl,
}: ParseInput): MpDeclaration => {
  const $ = load(xml, { xmlMode: true });
  // WHICH FORM. Which NUMBERING is resolved only on the asset path below, past
  // the interests early return: detectFormVersion reads asset-form table
  // descriptions, so on an интереси filing it would both warn spuriously and
  // yield a form version that filing does not have.
  const formKind = detectFormKind($);

  // NOT `PublicPerson > Personal > Name`: that ancestor selector matches only
  // the asset form, so every one of the 4,906 interests filings parsed to
  // declarant "(unknown)" — which then differed from every holder name on the
  // row, tagging the declarant's own holdings as a spouse's.
  const declarantName = text($, "Personal > Name") || "(unknown)";
  const declType = text($, "DeclarationData > DeclarationType") || "Other";
  const declYearRaw = text($, "DeclarationData > Year");
  const fiscalYear = declYearRaw ? Number(declYearRaw) : null;
  const filedAt = parseBgDate(text($, "DeclarationData > DeclarationDate"));
  const entryNumber = text($, "DeclarationData > EntryNumber");
  const controlHash = text($, "DeclarationData > ControlHash");

  // `believedFiscalYear` is the raw <Year> only when it is plausible for the
  // register folder — an implausible one is dropped, not carried forward.
  const { declarationYear, fiscalYear: believedFiscalYear } =
    resolveDeclarationYear({
      declType,
      fiscalYear,
      filedAt,
      sourceUrl,
    });

  const ownershipStakes: MpOwnershipStake[] = [];

  // Source filings occasionally include the same row twice (the declarant
  // entered it both at the top and bottom of the table). Dedup by the
  // identifying tuple — same company + same holder + same share size.
  const seen = new Set<string>();
  const dedupKey = (s: MpOwnershipStake): string =>
    [
      s.table,
      s.companyName ?? "",
      s.holderName ?? "",
      s.shareSize ?? "",
      s.registeredOffice ?? "",
      s.valueEur ?? "",
    ].join("|");

  // An interests filing has no asset tables to read — and, crucially, no table
  // number in common with the asset map even where the numbers coincide. It
  // returns here rather than falling through: everything below this point is
  // keyed on the asset numbering.
  if (formKind !== "assets") {
    const interests =
      formKind === "unknown"
        ? { stakes: [], events: [] }
        : parseInterestTables($, formKind);
    for (const stake of interests.stakes) {
      const k = dedupKey(stake);
      if (seen.has(k)) continue;
      seen.add(k);
      ownershipStakes.push(stake);
    }
    return {
      mpId,
      declarantName,
      institution,
      declarationYear,
      fiscalYear: believedFiscalYear,
      declarationType: declType,
      filedAt,
      entryNumber,
      controlHash,
      sourceUrl,
      ownershipStakes,
      income: [],
      assets: [],
      events: interests.events,
    };
  }

  const version = detectFormVersion($);
  // See FormCurrency: pre-2026 forms state these columns in leva, post-euro
  // ones in euro, and nothing but the header says which.
  const docCcy = documentFormCurrency($);
  const sharesCol = columnResolver(version, "shares");
  for (const row of rowsOfTable($, version, "shares")) {
    const stake = parseTable10Row(
      row,
      sharesCol,
      tableFormCurrency($, version, "shares", docCcy),
    );
    const k = dedupKey(stake);
    if (seen.has(k)) continue;
    seen.add(k);
    ownershipStakes.push(stake);
  }

  const transferCol = columnResolver(version, "shareTransfer");
  for (const row of rowsOfTable($, version, "shareTransfer")) {
    const stake = parseTable11Row(
      row,
      transferCol,
      tableFormCurrency($, version, "shareTransfer", docCcy),
    );
    const k = dedupKey(stake);
    if (seen.has(k)) continue;
    seen.add(k);
    ownershipStakes.push(stake);
  }

  const assets = parseAssetTables($, declarantName, sourceUrl, version);
  const events = parseEventTables($, version, declarantName);

  // The income table's layout is identical in both forms — it never gained the
  // ЕГН column — so its resolver is the identity function. It still goes
  // through one: "every table read is resolved" has to hold for all of them, or
  // the next form revision reintroduces exactly this class of bug.
  const income: MpIncomeRecord[] = [];
  const incomeCol = columnResolver(version, "income");
  const incomeCcy = tableFormCurrency($, version, "income", docCcy);
  for (const row of rowsOfTable($, version, "income")) {
    const rec = parseIncomeRow(row, incomeCol, incomeCcy);
    // Income table has many empty rows for unused categories; keep only
    // rows where at least one amount is set.
    if (rec.amountEurDeclarant != null || rec.amountEurSpouse != null) {
      income.push(rec);
    }
  }

  return {
    mpId,
    declarantName,
    institution,
    declarationYear,
    fiscalYear: believedFiscalYear,
    declarationType: declType,
    filedAt,
    entryNumber,
    controlHash,
    sourceUrl,
    ownershipStakes,
    income,
    assets,
    events,
  };
};
