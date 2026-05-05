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
  MpIncomeRecord,
  MpOwnershipStake,
} from "../../src/data/dataTypes";

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

const parseTable10Row = (row: ReturnType<CheerioAPI>): MpOwnershipStake => ({
  table: "10",
  itemType: cellByNum(row, 2),
  shareSize: cellByNum(row, 3),
  companyName: cellByNum(row, 4),
  registeredOffice: cellByNum(row, 5),
  valueBgn: toNumber(cellByNum(row, 6)),
  holderName: cellByNum(row, 7),
  legalBasis: cellByNum(row, 9),
  fundsOrigin: cellByNum(row, 10),
});

const parseTable11Row = (row: ReturnType<CheerioAPI>): MpOwnershipStake => ({
  table: "11",
  itemType: cellByNum(row, 2),
  shareSize: cellByNum(row, 3),
  companyName: cellByNum(row, 4),
  registeredOffice: cellByNum(row, 5),
  valueBgn: toNumber(cellByNum(row, 6)),
  holderName: null,
  transfereeName: cellByNum(row, 7),
  legalBasis: cellByNum(row, 9),
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

/** Approximate cross-rates to BGN, used only when the declarant filled the
 * foreign-currency amount column but left "Равностойност в лв." blank. EUR
 * is a fixed peg (the rate the Bulgarian National Bank publishes); the
 * others are recent (~2024) BNB averages. Declarations span ~5 years so
 * pinpoint accuracy is impossible — these are good-enough for ranking. */
const BGN_RATES: Record<string, number> = {
  BGN: 1,
  ЛВ: 1,
  ЛЕВА: 1,
  EUR: 1.95583, // BGN/EUR fixed peg
  USD: 1.8,
  GBP: 2.3,
  CHF: 2.05,
  CAD: 1.35,
  AUD: 1.2,
  TRY: 0.06,
  RUB: 0.02,
};

/** Pick the BGN figure for an asset row.
 *
 * Cacbg rows have:
 *   - amount in declared currency (cell A)
 *   - currency code (cell B)
 *   - "Равностойност в лв." BGN equivalent (cell C)
 *
 * Preference: BGN equivalent when present → amount converted to BGN via
 * BGN_RATES → null. The conversion ensures foreign-currency holdings show
 * up in totals and rankings instead of being treated as "unvalued". */
const pickBgnValue = (
  amount: number | null,
  currency: string | null,
  bgnEquiv: number | null,
): number | null => {
  if (bgnEquiv != null && bgnEquiv !== 0) return bgnEquiv;
  if (amount == null) return null;
  const c = (currency ?? "").trim().toUpperCase();
  const rate = BGN_RATES[c];
  if (rate != null) return amount * rate;
  // Unknown currency — return amount as-is rather than dropping it. Keeps
  // the row out of "no value" without inflating it 1.95×.
  return amount;
};

/** Hand-curated fixes for declaration entries where the declarant clearly
 * misplaced a decimal/thousand separator in the source XML, producing a
 * value 100×–1000× too high. We apply the correction silently in the
 * parser so totals on the candidate / rankings pages aren't dominated by
 * obvious data-entry errors.
 *
 * Each entry matches by (sourceUrl, location, areaSqm, raw amount). This
 * is intentionally narrow — heuristic value-clamping ("any property over
 * 100k BGN/m² must be wrong") would silently rewrite legitimate luxury
 * properties. */
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
];

const parseTable1Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  sourceUrl: string,
): MpAsset => {
  const holder = cellByNum(row, 8);
  const rawValue = toNumber(cellByNum(row, 11));
  const location = cellByNum(row, 3);
  const areaSqm = toLooseNumber(cellByNum(row, 5));
  let value = rawValue;
  if (rawValue != null && location != null && areaSqm != null) {
    const fix = REAL_ESTATE_VALUE_OVERRIDES.find(
      (o) =>
        sourceUrl.includes(o.sourceUrlContains) &&
        o.location === location &&
        Math.abs(o.areaSqm - areaSqm) < 0.01 &&
        o.rawValue === rawValue,
    );
    if (fix) value = fix.correctedValue;
  }
  return {
    category: "real_estate",
    description: cellByNum(row, 2),
    detail: null,
    location,
    municipality: cellByNum(row, 4),
    areaSqm,
    builtAreaSqm: toLooseNumber(cellByNum(row, 6)),
    acquiredYear: toIntYear(cellByNum(row, 7)),
    share: cellByNum(row, 10),
    currency: value != null ? "BGN" : null,
    amount: value,
    valueBgn: value,
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, 12),
    fundsOrigin: cellByNum(row, 13),
  };
};

const parseTable3Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
): MpAsset => {
  const holder = cellByNum(row, 6);
  const value = toNumber(cellByNum(row, 4));
  return {
    category: "vehicle",
    description: cellByNum(row, 2),
    detail: cellByNum(row, 3),
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: toIntYear(cellByNum(row, 5)),
    share: cellByNum(row, 8),
    currency: value != null ? "BGN" : null,
    amount: value,
    valueBgn: value,
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, 9),
    fundsOrigin: cellByNum(row, 10),
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
): MpAsset => {
  const amount = toNumber(cellByNum(row, cells.amount));
  const currency = cellByNum(row, cells.currency);
  const bgnEquiv = toNumber(cellByNum(row, cells.bgnEquiv));
  const holder = cellByNum(row, cells.holder);
  return {
    category,
    description: cells.description ? cellByNum(row, cells.description) : null,
    detail: currency,
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: null,
    share: null,
    currency,
    amount,
    valueBgn: pickBgnValue(amount, currency, bgnEquiv),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cells.legalBasis ? cellByNum(row, cells.legalBasis) : null,
    fundsOrigin: cells.fundsOrigin ? cellByNum(row, cells.fundsOrigin) : null,
  };
};

const parseTable9Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
): MpAsset => {
  const holder = cellByNum(row, 8);
  const price = toNumber(cellByNum(row, 7));
  return {
    category: "security",
    description: cellByNum(row, 2),
    detail: cellByNum(row, 6), // emitter / issuer
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear: null,
    share: cellByNum(row, 3), // count of securities — preserve raw text
    currency: price != null ? "BGN" : null,
    amount: price,
    valueBgn: price,
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, 10),
    fundsOrigin: cellByNum(row, 11),
  };
};

const parseAssetTables = (
  $: CheerioAPI,
  declarantName: string,
  sourceUrl: string,
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
  for (const tn of ["1", "1.1", "1.2"]) {
    const t = $(`Table[Num="${tn}"]`).first();
    if (t.attr("Declared") !== "True") continue;
    t.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(parseTable1Row(row, declarantName, sourceUrl));
    });
  }

  // Table 3 family — vehicles. Subtables share the same cell layout:
  //   3   = motor vehicles (cars, motorcycles)
  //   3.1 = agricultural & forestry machinery
  //   3.2 = boats & aircraft
  //   3.3 = other registrable vehicles
  //   3.4 = foreign vehicles over 10k BGN that the declarant uses
  // Table 3.5 ("transferred in prior year") is skipped for the same reason
  // as Table 2.
  for (const tn of ["3", "3.1", "3.2", "3.3", "3.4"]) {
    const t = $(`Table[Num="${tn}"]`).first();
    if (t.attr("Declared") !== "True") continue;
    t.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(parseTable3Row(row, declarantName));
    });
  }

  // Table 4 — cash on hand
  const t4 = $('Table[Num="4"]').first();
  if (t4.attr("Declared") === "True") {
    t4.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(
        parseMoneyRow(row, declarantName, "cash", {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 7,
        }),
      );
    });
  }

  // Table 5 — bank accounts / deposits
  const t5 = $('Table[Num="5"]').first();
  if (t5.attr("Declared") === "True") {
    t5.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(
        parseMoneyRow(row, declarantName, "bank", {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 9,
        }),
      );
    });
  }

  // Table 6 — receivables > 10k BGN
  const t6 = $('Table[Num="6"]').first();
  if (t6.attr("Declared") === "True") {
    t6.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(
        parseMoneyRow(row, declarantName, "receivable", {
          amount: 3,
          currency: 4,
          bgnEquiv: 5,
          holder: 6,
          legalBasis: 8,
          description: 2,
        }),
      );
    });
  }

  // Table 7 — debts > 10k BGN
  const t7 = $('Table[Num="7"]').first();
  if (t7.attr("Declared") === "True") {
    t7.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(
        parseMoneyRow(row, declarantName, "debt", {
          amount: 3,
          currency: 4,
          bgnEquiv: 5,
          holder: 6,
          legalBasis: 8,
          description: 2,
        }),
      );
    });
  }

  // Table 8 — investment & pension funds (incl. crypto since 2024 ordinance)
  const t8 = $('Table[Num="8"]').first();
  if (t8.attr("Declared") === "True") {
    t8.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(
        parseMoneyRow(row, declarantName, "investment", {
          amount: 2,
          currency: 3,
          bgnEquiv: 4,
          holder: 5,
          fundsOrigin: 9,
        }),
      );
    });
  }

  // Table 9 — securities & financial instruments
  const t9 = $('Table[Num="9"]').first();
  if (t9.attr("Declared") === "True") {
    t9.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      out.push(parseTable9Row(row, declarantName));
    });
  }

  return out;
};

const parseIncomeRow = (row: ReturnType<CheerioAPI>): MpIncomeRecord => ({
  parent: row.attr("Parent") || null,
  category: cellByNum(row, 2),
  amountBgnDeclarant: toNumber(cellByNum(row, 3)),
  amountBgnSpouse: toNumber(cellByNum(row, 4)),
});

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

  const declarantName =
    text($, "PublicPerson > Personal > Name") || "(unknown)";
  const declType = text($, "DeclarationData > DeclarationType") || "Other";
  const declYearRaw = text($, "DeclarationData > Year");
  const fiscalYear = declYearRaw ? Number(declYearRaw) : null;
  const filedAt = parseBgDate(text($, "DeclarationData > DeclarationDate"));
  const entryNumber = text($, "DeclarationData > EntryNumber");
  const controlHash = text($, "DeclarationData > ControlHash");

  // Annual declaration filed in year N covers fiscal year N-1.
  const declarationYear =
    fiscalYear != null && declType === "Annualy"
      ? fiscalYear + 1
      : (fiscalYear ?? new Date().getFullYear());

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
      s.valueBgn ?? "",
    ].join("|");

  const t10 = $('Table[Num="10"]').first();
  if (t10.attr("Declared") === "True") {
    t10.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      const stake = parseTable10Row(row);
      const k = dedupKey(stake);
      if (seen.has(k)) return;
      seen.add(k);
      ownershipStakes.push(stake);
    });
  }

  const t11 = $('Table[Num="11"]').first();
  if (t11.attr("Declared") === "True") {
    t11.find("Row").each((_, el) => {
      const row = $(el);
      if (isEmptyRow($, row)) return;
      const stake = parseTable11Row(row);
      const k = dedupKey(stake);
      if (seen.has(k)) return;
      seen.add(k);
      ownershipStakes.push(stake);
    });
  }

  const assets = parseAssetTables($, declarantName, sourceUrl);

  const income: MpIncomeRecord[] = [];
  const t12 = $('Table[Num="12"]').first();
  if (t12.attr("Declared") === "True") {
    t12.find("Row").each((_, el) => {
      const row = $(el);
      const rec = parseIncomeRow(row);
      // Income table has many empty rows for unused categories; keep only
      // rows where at least one amount is set.
      if (rec.amountBgnDeclarant != null || rec.amountBgnSpouse != null) {
        income.push(rec);
      }
    });
  }

  return {
    mpId,
    declarantName,
    institution,
    declarationYear,
    fiscalYear,
    declarationType: declType,
    filedAt,
    entryNumber,
    controlHash,
    sourceUrl,
    ownershipStakes,
    income,
    assets,
  };
};
