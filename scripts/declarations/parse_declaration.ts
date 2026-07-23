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

const parseTable10Row = (row: ReturnType<CheerioAPI>): MpOwnershipStake => ({
  table: "10",
  itemType: cellByNum(row, 2),
  shareSize: cellByNum(row, 3),
  companyName: cellByNum(row, 4),
  registeredOffice: cellByNum(row, 5),
  // Cell 6 is the declared BGN value — convert to euros (locked peg).
  valueEur: toEur(toNumber(cellByNum(row, 6)), "BGN"),
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
  valueEur: toEur(toNumber(cellByNum(row, 6)), "BGN"),
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
 * stay unvalued: we don't apply approximate cross-rates. See src/lib/currency.ts. */
const pickEurValue = (
  amount: number | null,
  currency: string | null,
  bgnEquiv: number | null,
): number | null => {
  if (bgnEquiv != null && bgnEquiv !== 0) return toEur(bgnEquiv, "BGN");
  return toEur(amount, currency);
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
): MpAsset => {
  const holder = cellByNum(row, 8);
  const rawValue = toNumber(cellByNum(row, 11));
  const location = cellByNum(row, 3);
  const areaSqm = toLooseNumber(cellByNum(row, 5));
  const description = cellByNum(row, 2);
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
    municipality: cellByNum(row, 4),
    areaSqm,
    builtAreaSqm: toLooseNumber(cellByNum(row, 6)),
    acquiredYear: toIntYear(cellByNum(row, 7)),
    share: cellByNum(row, 10),
    currency: value != null ? "BGN" : null,
    amount: value,
    valueEur: toEur(value, "BGN"),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, 12),
    fundsOrigin: cellByNum(row, 13),
  };
};

const parseTable3Row = (
  row: ReturnType<CheerioAPI>,
  declarantName: string,
  sourceUrl: string,
): MpAsset => {
  const holder = cellByNum(row, 6);
  const rawValue = toNumber(cellByNum(row, 4));
  const detail = cellByNum(row, 3);
  const acquiredYear = toIntYear(cellByNum(row, 5));
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
    description: cellByNum(row, 2),
    detail,
    location: null,
    municipality: null,
    areaSqm: null,
    builtAreaSqm: null,
    acquiredYear,
    share: cellByNum(row, 8),
    currency: value != null ? "BGN" : null,
    amount: value,
    valueEur: toEur(value, "BGN"),
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
    valueEur: pickEurValue(amount, currency, bgnEquiv),
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
    valueEur: toEur(price, "BGN"),
    holderName: holder,
    isSpouse: isSpouseHolder(holder, declarantName),
    legalBasis: cellByNum(row, 10),
    fundsOrigin: cellByNum(row, 11),
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
      out.push(parseTable3Row(row, declarantName, sourceUrl));
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

  return dedupeRealEstateRows(out, declarantName);
};

const parseIncomeRow = (row: ReturnType<CheerioAPI>): MpIncomeRecord => ({
  parent: row.attr("Parent") || null,
  category: cellByNum(row, 2),
  // Income cells are declared in leva — convert to euros at the locked peg.
  amountEurDeclarant: toEur(toNumber(cellByNum(row, 3)), "BGN"),
  amountEurSpouse: toEur(toNumber(cellByNum(row, 4)), "BGN"),
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
  // except for the +1 an ANNUAL legitimately carries, since an annual filed in
  // folder N covers fiscal N-1. Granting that +1 to a one-off filing would leave
  // a typo'd `Year` still resolving to a future year, i.e. the very defect this
  // function exists to close, merely narrowed.
  //
  // The bound is two-sided: `registerFolderYear` already refuses anything below
  // 2005, but a typo'd `Year` of 1900 would otherwise pass straight through and
  // strand the row at the bottom of the declarant's history. Clamp and say so,
  // rather than silently trusting or silently rewriting.
  if (folderYear != null) {
    const maxYear = folderYear + (declType === "Annualy" ? 1 : 0);
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
      if (rec.amountEurDeclarant != null || rec.amountEurSpouse != null) {
        income.push(rec);
      }
    });
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
  };
};
