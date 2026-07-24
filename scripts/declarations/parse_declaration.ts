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
 */

import { load, type CheerioAPI } from "cheerio";
import type {
  MpAsset,
  MpAssetCategory,
  MpDeclaration,
  MpDeclarationEvent,
  MpIncomeRecord,
  MpOwnershipStake,
} from "../../src/data/dataTypes";
import { toEur } from "../../src/lib/currency";
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
): MpOwnershipStake => ({
  table: "10",
  itemType: cellByNum(row, col(2)),
  shareSize: cellByNum(row, col(3)),
  companyName: cellByNum(row, col(4)),
  registeredOffice: cellByNum(row, col(5)),
  // Cell 6 is the declared BGN value — convert to euros (locked peg).
  valueEur: toEur(toNumber(cellByNum(row, col(6))), "BGN"),
  holderName: cellByNum(row, col(7)),
  legalBasis: cellByNum(row, col(9)),
  fundsOrigin: cellByNum(row, col(10)),
});

const parseTable11Row = (
  row: ReturnType<CheerioAPI>,
  col: ColumnResolver,
): MpOwnershipStake => ({
  table: "11",
  itemType: cellByNum(row, col(2)),
  shareSize: cellByNum(row, col(3)),
  companyName: cellByNum(row, col(4)),
  registeredOffice: cellByNum(row, col(5)),
  valueEur: toEur(toNumber(cellByNum(row, col(6))), "BGN"),
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
// 2.5, not 20. Cell A and cell C are the same sum in two currencies, so the
// honest ratio is the FX rate (1.96 for EUR, 1.0 for BGN) — anything past ~2.5
// is already unexplainable. A looser 20x let a clean 72-row cluster sitting at
// exactly ~10x through, seven of them over EUR 500k and one at EUR 3.63M
// ranking 14th nationally. The nearest genuine survivor is 19.56x.
const MONEY_EQUIV_TYPO_FACTOR = 2.5;

export const pickEurValue = (
  amount: number | null,
  currency: string | null,
  bgnEquiv: number | null,
  pureMoney = false,
): number | null => {
  const fromEquiv =
    bgnEquiv != null && bgnEquiv !== 0 ? toEur(bgnEquiv, "BGN") : null;
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
): number | null => {
  if (rawValue == null || areaSqm == null || areaSqm < MIN_ANCHOR_SQM) {
    return null;
  }
  const desc = description?.toLowerCase() ?? "";
  if (!BUILDING_TYPE_TOKENS.some((tok) => desc.includes(tok))) return null;
  if (rawValue / areaSqm <= MAX_PLAUSIBLE_BGN_PER_SQM) return null;
  const corrected = rawValue / 100;
  if (corrected / areaSqm > MAX_PLAUSIBLE_BGN_PER_SQM) return null;
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
): MpAsset => {
  const holder = cellByNum(row, col(8));
  const rawValue = toNumber(cellByNum(row, col(11)));
  const location = cellByNum(row, col(3));
  const areaSqm = toLooseNumber(cellByNum(row, col(5)));
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
    const auto = correctRealEstateSeparatorTypo(rawValue, areaSqm, description);
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
    builtAreaSqm: toLooseNumber(cellByNum(row, col(6))),
    acquiredYear: toIntYear(cellByNum(row, col(7))),
    share: cellByNum(row, col(10)),
    currency: value != null ? "BGN" : null,
    amount: value,
    valueEur: toEur(value, "BGN"),
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
    currency: value != null ? "BGN" : null,
    amount: value,
    valueEur: toEur(value, "BGN"),
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
): MpAsset => {
  const amount = toNumber(cellByNum(row, col(cells.amount)));
  const currency = cellByNum(row, col(cells.currency));
  const bgnEquiv = toNumber(cellByNum(row, col(cells.bgnEquiv)));
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
    currency: price != null ? "BGN" : null,
    amount: price,
    valueEur: toEur(price, "BGN"),
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

const parseAssetTables = (
  $: CheerioAPI,
  declarantName: string,
  sourceUrl: string,
  version: FormVersion,
): MpAsset[] => {
  const out: MpAsset[] = [];

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
    for (const row of rowsOfTable($, version, tn)) {
      out.push(parseTable1Row(row, declarantName, sourceUrl, col));
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
    for (const row of rowsOfTable($, version, tn)) {
      out.push(parseTable3Row(row, declarantName, sourceUrl, col));
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
      ),
    );
  }

  // Table 7 — debts > 10k BGN
  const debtCol = columnResolver(version, "debt");
  for (const row of rowsOfTable($, version, "debt")) {
    out.push(
      parseMoneyRow(
        row,
        declarantName,
        "debt",
        {
          amount: 3,
          currency: 4,
          bgnEquiv: 5,
          holder: 6,
          legalBasis: 8,
          description: 2,
        },
        debtCol,
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
      ),
    );
  }

  // Table 9 — securities & financial instruments
  const securityCol = columnResolver(version, "security");
  for (const row of rowsOfTable($, version, "security")) {
    out.push(parseTable9Row(row, declarantName, securityCol));
  }

  return dedupeRealEstateRows(out, declarantName);
};

const parseIncomeRow = (
  row: ReturnType<CheerioAPI>,
  col: ColumnResolver,
): MpIncomeRecord => ({
  parent: row.attr("Parent") || null,
  category: cellByNum(row, col(2)),
  // Income cells are declared in leva — convert to euros at the locked peg.
  amountEurDeclarant: toEur(toNumber(cellByNum(row, col(3))), "BGN"),
  amountEurSpouse: toEur(toNumber(cellByNum(row, col(4))), "BGN"),
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
      currency: "BGN",
      valueEur: toEur(corrected ?? rawValue, "BGN"),
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
      currency: "BGN",
      valueEur: toEur(toNumber(cellByNum(row, vehicleCol(4))), "BGN"),
      legalBasis: cellByNum(row, vehicleCol(8)),
    });
  }

  // Table 13 — securities given / expenses made in the declarant's favour that
  // they did not pay for. Amount is in leva; the form carries no currency cell.
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
      currency: "BGN",
      valueEur: toEur(toNumber(cellByNum(row, guaranteeCol(3))), "BGN"),
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
  // Which numbering the filing uses. Every table read below goes through it.
  const version = detectFormVersion($);

  const declarantName =
    text($, "PublicPerson > Personal > Name") || "(unknown)";
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

  const sharesCol = columnResolver(version, "shares");
  for (const row of rowsOfTable($, version, "shares")) {
    const stake = parseTable10Row(row, sharesCol);
    const k = dedupKey(stake);
    if (seen.has(k)) continue;
    seen.add(k);
    ownershipStakes.push(stake);
  }

  const transferCol = columnResolver(version, "shareTransfer");
  for (const row of rowsOfTable($, version, "shareTransfer")) {
    const stake = parseTable11Row(row, transferCol);
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
  for (const row of rowsOfTable($, version, "income")) {
    const rec = parseIncomeRow(row, incomeCol);
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
