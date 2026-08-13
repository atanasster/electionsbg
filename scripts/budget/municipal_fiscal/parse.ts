// Parser for МФ's „Финансови показатели за общините" workbook (ЗПФ чл. 130г
// ал. 2), sheet „показатели".
//
// Layout, verified against the 2025 releases (see the README in
// data/_cache/minfin_municipal_fiscal/):
//
//   row 1  indicator title, on the first column of each group (sometimes on all
//          three — do not rely on it being merged)
//   row 2  period label per column, e.g. "2024 Q3"
//   row 3+ one row per община; col A = МФ/ЕБК code, col B = name
//
//   cols 3–62   20 indicator groups × 3 columns, one per period, in the
//               workbook's own prev / final / current order
//   cols 63–65  collection rates — SINGLE columns, all on the year-end period
//
// **Periods come from row 2, never from the filename.** The filename encodes the
// same three quarters (T7.1 of the plan) but the naming rule is derived from two
// samples and is not guaranteed to hold for older releases, so it is a
// cross-check at most.
//
// **The published ratios are FRACTIONS** (0.01355 = 1.355%) and their denominator
// SWITCHES by quarter: планирани разходи in Q1–Q3, отчетени разходи (arrears) or
// средногодишни разходи за 4 г. (obligations, commitments) at Q4. Only the Q4
// column is the actual чл. 130а criterion, so the three columns of one ratio
// group are not a time series. `ratioBasis` records which.

import { BGN_PER_EUR } from "../../../src/lib/currency";
import { buildCrosswalk, loadMunicipalities, type MuniRef } from "./codes";
import type {
  CollectionRates,
  Money,
  MunicipalFiscalPeriod,
  MunicipalFiscalQuarter,
  ParsedWorkbook,
  RatioBases,
  Rms436Indicators,
} from "./types";

/** 1-based first column of each 3-wide group, in workbook order. */
/** The column map is RESOLVED FROM THE HEADER TITLES, not hard-coded.
 *
 *  МФ has shipped at least four layouts of this sheet — 58, 59, 62 and 65
 *  columns — and the money groups sit at a different offset in each: просрочени
 *  is c39 in the 2016-2021 releases, c42 in 2022-2023 and c45 in 2024-2025.
 *  Reading a 2022 workbook with the 2024 map returns `задължения` where
 *  `просрочени` belongs, which is a silent misattribution at a 200 with every
 *  row count reconciling — the exact defect this module exists to prevent.
 *
 *  A per-era table was the obvious fix and is the wrong one: the 2016 release
 *  is uniformly ONE column left of 2017-2021, so the table needs a row per
 *  variant and a new variant is a silent misread until somebody notices. The
 *  titles, by contrast, have been stable for a decade. Anchored on those, one
 *  code path reads every era — and the period-alignment check below still
 *  verifies the result, so a title that matched the wrong column fails loudly
 *  rather than shifting the money.
 *
 *  Every pattern is anchored at the start of the title, because the RATIO
 *  columns repeat the money columns' wording after „Дял на …" — an unanchored
 *  „Просрочени задължения" matches the ratio group nine columns later. */
const GROUP_TITLES = {
  revenueShare: /^1\.\s*Дял на приходите/i,
  localCoverage: /^2\.\s*Покритие на разходите/i,
  balanceShare: /^3\.\s*Бюджетно салдо/i,
  debtToOwnRevenue: /^4\.\s*Размер на дълга/i,
  debtPerCapita: /^5\.\s*Просрочени задължения като процент/i,
  arrearsToOwnRevenue: /^6\.\s*Население на един/i,
  populationPerEmployee: /^7\.\s*Дял на разходите за заплати/i,
  wageShare: /^8\.\s*Дял на капиталовите разходи/i,
  capitalShare: /^9\./,
  revenue: /^Общински приходи по чл\.?\s*45/i,
  expenditure: /^Общински разходи по чл\.?\s*45/i,
  budgetBalance: /^Бюджетно салдо/i,
  cashOnHand: /^Налични средства/i,
  debtStock: /^Размер на общинския дълг/i,
  arrears: /^Просрочени задължения по бюджет/i,
  expenseObligations: /^Задължения за разходи по бюджет/i,
  commitments: /^Поети ангажименти за разходи по бюджет/i,
  arrearsRatio: /^Дял на просрочените задължения/i,
  obligationsRatio: /^Дял на задълженията за разходи/i,
  commitmentsRatio: /^Дял на поетите ангажименти/i,
} as const;

const COLLECTION_TITLES = {
  dni: /^Събираемост на данъка?\s+върху недвижимите имоти/i,
  dprs: /^Събираемост на данъка?\s+върху превозните средства/i,
  // No `\b` anywhere in these patterns: JS word boundaries are defined on
  // ASCII word characters, so between a Cyrillic letter and a space there is
  // no boundary at all and the match silently fails.
  avg: /^Осреднен[оаи].*събираемост/i,
} as const;

export type GroupKey = keyof typeof GROUP_TITLES;
/** 1-based first column per group. `null` for a group this era omits — only
 *  `cashOnHand` is legitimately absent (the pre-2024 releases publish no
 *  „Налични средства" group), and every other absence is an error. */
export type ColumnMap = Record<GroupKey, number | null> & {
  collection: Record<keyof typeof COLLECTION_TITLES, number | null>;
};

/** The РМС 436/2017 indicator groups. The 2016 release ships eight of the nine,
 *  so they are read where present and left null where not — unlike the money
 *  groups, whose absence is fatal. */
const INDICATOR_GROUPS: GroupKey[] = [
  "revenueShare",
  "localCoverage",
  "balanceShare",
  "debtToOwnRevenue",
  "debtPerCapita",
  "arrearsToOwnRevenue",
  "populationPerEmployee",
  "wageShare",
  "capitalShare",
];

/** Groups whose absence means we are not reading this workbook correctly. The
 *  three stocks are the point of the corpus; the rest anchor the layout. */
const REQUIRED_GROUPS: GroupKey[] = [
  "revenue",
  "expenditure",
  "budgetBalance",
  "debtStock",
  "arrears",
  "expenseObligations",
  "commitments",
];

const norm = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\s+/g, " ").trim();

export const resolveColumns = (titleRow: readonly unknown[]): ColumnMap => {
  const found = {} as Record<GroupKey, number | null>;
  for (const key of Object.keys(GROUP_TITLES) as GroupKey[]) {
    const re = GROUP_TITLES[key];
    // FIRST match wins, and the patterns are start-anchored, so a ratio title
    // cannot claim its money group's slot.
    const at = titleRow.findIndex((c) => re.test(norm(c)));
    found[key] = at === -1 ? null : at + 1;
  }
  const collection = {} as Record<
    keyof typeof COLLECTION_TITLES,
    number | null
  >;
  for (const key of Object.keys(
    COLLECTION_TITLES,
  ) as (keyof typeof COLLECTION_TITLES)[]) {
    const at = titleRow.findIndex((c) => COLLECTION_TITLES[key].test(norm(c)));
    collection[key] = at === -1 ? null : at + 1;
  }
  const missing = REQUIRED_GROUPS.filter((k) => found[k] == null);
  if (missing.length > 0) {
    throw new Error(
      `municipal_fiscal: header row 1 names no column for ${missing.join(", ")} — ` +
        "this is not a layout of the индикатори sheet we recognise",
    );
  }
  // The money groups must appear in this order. Out of order means two
  // patterns matched each other's column, which the period check would not
  // catch — every group would still align, just against the wrong figures.
  const seq = REQUIRED_GROUPS.map((k) => found[k] as number);
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] <= seq[i - 1]) {
      throw new Error(
        `municipal_fiscal: money groups are out of order (${REQUIRED_GROUPS[i - 1]}=c${seq[i - 1]}, ` +
          `${REQUIRED_GROUPS[i]}=c${seq[i]}) — two title patterns matched the same region`,
      );
    }
  }
  return { ...found, collection };
};

const HEADER_ROWS_POKAZATELI = 2;
/** The recovery sheet carries two extra marker rows above the same header. */
const HEADER_ROWS_RECOVERY = 4;

/** Two spellings, a decade apart and both live in the cache: „2022 Q1" from
 *  2022 onward and „Q1-2021 г." before it. One regex with the year on either
 *  side, because a parser that knows only the newer one reads every pre-2022
 *  release as „no periods in the header" — which reports as an unsupported era
 *  rather than as a label it could have read. */
const PERIOD_RE =
  /^(?:(20\d{2})\s*Q([1-4])|Q([1-4])\s*-\s*(20\d{2})(?:\s*г\.?)?)$/;

export const parsePeriodLabel = (
  raw: unknown,
): MunicipalFiscalPeriod | null => {
  const label = String(raw ?? "").trim();
  const m = PERIOD_RE.exec(label);
  if (!m) return null;
  // Groups 1-2 are the „2022 Q1" spelling, 3-4 the „Q1-2021 г." one — and they
  // are in the OPPOSITE order, so reading m[1]/m[2] blindly would give a
  // fiscalYear of 1 and a quarter of 2021 for every pre-2022 release.
  const [year, quarter] = m[1] != null ? [m[1], m[2]] : [m[4], m[3]];
  return {
    fiscalYear: Number(year),
    quarter: Number(quarter) as 1 | 2 | 3 | 4,
    label,
  };
};

export const num = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Anything non-scalar (`[]` coerces to "") must not become 0. The whitespace
  // strip has to run BEFORE the emptiness check, or " " falls through to
  // Number("") === 0 — a fabricated zero in a field where zero is a legally
  // meaningful чл. 130а value.
  if (typeof v !== "string") return null;
  const stripped = v.replace(/\s/g, "");
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
};

/** Published fractions → percent. */
const pct = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : n * 100;
};

const money = (v: unknown, currency: "BGN" | "EUR"): Money | null => {
  const n = num(v);
  if (n == null) return null;
  return {
    amount: n,
    currency,
    amountEur: currency === "EUR" ? n : n / BGN_PER_EUR,
  };
};

/** BGN through 2025, EUR from 2026 — the workbook states this explicitly. */
export const currencyForYear = (fiscalYear: number): "BGN" | "EUR" =>
  fiscalYear >= 2026 ? "EUR" : "BGN";

/** Which denominator the source used, PER RATIO. At Q4 the three do not share
 *  one: arrears divides by ACTUAL expenditure (чл. 130а т. 4) while obligations
 *  and commitments divide by the 4-year average (т. 2 / т. 3) — the workbook
 *  says so in its own column titles, and it is measurable: for all 121 Q4 rows
 *  with non-zero arrears the implied denominator equals `expenditure` and
 *  matches the derived 4-year average in none of them. A single scalar here
 *  sends a consumer re-deriving levels to the wrong denominator silently. */
export const ratioBasisFor = (quarter: 1 | 2 | 3 | 4): RatioBases =>
  quarter === 4
    ? { arrears: "actual", obligations: "avg4y", commitments: "avg4y" }
    : { arrears: "planned", obligations: "planned", commitments: "planned" };

const UNIT_RE = /\(\s*в\s*(лв\.?|лева|евро|eur)\s*\)/iu;

/** The unit МФ declares in the row-1 group title. One label governs that group's
 *  three period columns, so the unit is a property of the GROUP, not of the
 *  period — which is why `currencyForYear` can only ever be a fallback. */
export const currencyFromTitle = (title: unknown): "BGN" | "EUR" | null => {
  const m = UNIT_RE.exec(String(title ?? ""));
  if (!m) return null;
  return /евро|eur/i.test(m[1]) ? "EUR" : "BGN";
};

/** Read row 2 and return the distinct periods in column order. Every 3-wide
 *  group repeats the same sequence, so the first group defines it. */
export const readPeriods = (
  headerRow: readonly unknown[],
  anchor: number,
): MunicipalFiscalPeriod[] => {
  const out: MunicipalFiscalPeriod[] = [];
  for (let c = anchor; c < anchor + 3; c++) {
    const p = parsePeriodLabel(headerRow[c - 1]);
    if (p) out.push(p);
  }
  return out;
};

export interface ParseOptions {
  sourceFile: string;
  /** Injected for testing; defaults to the committed crosswalk. */
  crosswalk?: Map<number, string>;
  municipalities?: MuniRef[];
  /** МФ codes in формално финансово оздравяване, from the sibling sheet. */
  inRecovery?: ReadonlySet<number>;
}

/** Extract the МФ codes on the „общини фин. оздр." sheet — the official чл. 130д
 *  recovery list. Never derived from the criteria; see types.ts. */
export const parseRecoverySheet = (rows: readonly unknown[][]): Set<number> => {
  const out = new Set<number>();
  for (const r of rows.slice(HEADER_ROWS_RECOVERY)) {
    const mf = num(r?.[0]);
    if (mf != null) out.add(mf);
  }
  return out;
};

const indicatorsAt = (
  r: readonly unknown[],
  i: number,
  g: ColumnMap,
): Rms436Indicators => {
  // An indicator group this era omits reads null rather than reading whatever
  // sits at a guessed offset. Only the РМС indicators may be absent; the money
  // groups are required and `resolveColumns` has already refused without them.
  const at = (k: GroupKey) =>
    g[k] == null ? null : r[(g[k] as number) - 1 + i];
  return {
    revenueSharePct: pct(at("revenueShare")),
    localCoveragePct: pct(at("localCoverage")),
    balanceSharePct: pct(at("balanceShare")),
    debtToOwnRevenuePct: pct(at("debtToOwnRevenue")),
    debtPerCapita: num(at("debtPerCapita")),
    arrearsToOwnRevenuePct: pct(at("arrearsToOwnRevenue")),
    populationPerEmployee: num(at("populationPerEmployee")),
    wageSharePct: pct(at("wageShare")),
    capitalSharePct: pct(at("capitalShare")),
  };
};

/** Средногодишни разходи за 4 г. — the чл. 130а т. 2/т. 3 denominator, which the
 *  workbook does not publish. Recovered from the commitments pair, falling back
 *  to the obligations pair; null when neither can supply it. Year-end only,
 *  because only there does the ratio use that denominator. */
export const deriveAvg4y = (
  row: Pick<
    MunicipalFiscalQuarter,
    "commitments" | "expenseObligations" | "ratios" | "quarter"
  >,
): number | null => {
  if (row.quarter !== 4) return null;
  const pairs: [Money | null, number | null][] = [
    [row.commitments, row.ratios.commitmentsPct],
    [row.expenseObligations, row.ratios.obligationsPct],
  ];
  for (const [m, p] of pairs) {
    // The money leg needs its own guard: a zero commitments cell would return 0
    // AND suppress the valid obligations fallback, and a negative one would
    // return a negative denominator.
    if (m && m.amountEur > 0 && p != null && p > 0)
      return (m.amountEur / p) * 100;
  }
  return null;
};

export const parsePokazateli = (
  rows: readonly unknown[][],
  opts: ParseOptions,
): ParsedWorkbook => {
  const warnings: string[] = [];
  const header = rows[HEADER_ROWS_POKAZATELI - 1] ?? [];
  // Resolved from the titles BEFORE anything is read, so every offset below is
  // this workbook's own rather than the newest era's.
  const g = resolveColumns(rows[0] ?? []);
  // The period sequence is defined by the first group that HAS one — the 2016
  // release omits an РМС indicator, so anchoring on a fixed column would read
  // the sequence from the wrong place.
  const anchor =
    INDICATOR_GROUPS.map((k) => g[k]).find((c): c is number => c != null) ??
    (g.revenue as number);
  const periods = readPeriods(header, anchor);
  // The three must be DISTINCT, and this guard is not pedantry — it is the one
  // thing standing between us and a silently misread corpus.
  //
  // The Q4-anchored releases publish TWO periods per group, not three. Read
  // 3-wide, group N's third column is group N+1's first — so the sequence
  // comes back [Q4-2018, Q4-2019, Q4-2018] and EVERY group then satisfies the
  // alignment check below, because every group really does start Q4-2018,
  // Q4-2019 and is followed by another Q4-2018. The layout check passes, the
  // periods look plausible, and every figure from the second column onward is
  // attributed to the wrong group. Requiring distinctness is what turns that
  // into an unsupported era instead of a wrong number.
  if (new Set(periods.map((p) => p.label)).size !== periods.length) {
    throw new Error(
      `municipal_fiscal: header row ${HEADER_ROWS_POKAZATELI} repeats a period ` +
        `(${periods.map((p) => p.label).join(", ")}) — this is a 2-period ` +
        "Q4-anchored release, whose groups are not 3 columns wide",
    );
  }
  if (periods.length !== 3) {
    throw new Error(
      `municipal_fiscal: expected 3 period columns in header row ${HEADER_ROWS_POKAZATELI}, got ${periods.length}` +
        ` (${periods.map((p) => p.label).join(", ") || "none parsed"})`,
    );
  }

  // Group 1 defines the period sequence; every other group must repeat it. The
  // evidence is already in the header row being read, and an unchecked
  // extrapolation here is exactly the off-by-one that attributes one quarter's
  // money to another — the defect class this module exists to prevent.
  const aligned = (first: number): boolean =>
    periods.every(
      (p, i) => parsePeriodLabel(header[first - 1 + i])?.label === p.label,
    );

  for (const [name, first] of Object.entries(g)) {
    // `collection` is single-column and `cashOnHand` may be absent; neither
    // repeats the period sequence.
    if (typeof first !== "number") continue;
    if (aligned(first)) continue;

    // A misaligned РМС INDICATOR is dropped, not fatal. The 2016 release
    // numbers its indicators differently, and those nine columns are secondary
    // — nulling one costs a derived percentage nobody charts, while rejecting
    // the file costs four quarters of the three stocks this corpus exists for.
    // The money and ratio groups stay strict: a shift there is the
    // misattribution the whole module is built to prevent.
    if ((INDICATOR_GROUPS as string[]).includes(name)) {
      g[name as GroupKey] = null;
      warnings.push(
        `${opts.sourceFile}: РМС indicator „${name}" does not align with the ` +
          "period sequence — dropped for this release rather than read at a " +
          "guessed offset",
      );
      continue;
    }

    const got = parsePeriodLabel(header[first - 1]);
    throw new Error(
      `municipal_fiscal: group „${name}" column ${first} is ` +
        `„${got?.label ?? String(header[first - 1] ?? "")}", expected „${periods[0].label}" — ` +
        "the workbook's column layout has changed; re-read the column map before trusting any figure",
    );
  }

  // The unit is declared per money GROUP in row 1. Prefer what the source says;
  // fall back to the year rule only when a release omits the label, and warn on
  // disagreement rather than silently preferring the inference — at the euro
  // changeover a wrong guess understates two thirds of a file by ~49%.
  const titleRow = rows[0] ?? [];
  const MONEY_GROUPS = [
    g.revenue,
    g.expenditure,
    g.budgetBalance,
    g.cashOnHand,
    g.debtStock,
    g.arrears,
    g.expenseObligations,
    g.commitments,
  ].filter((c): c is number => c != null);
  const declared = [
    ...new Set(
      MONEY_GROUPS.map((c) => currencyFromTitle(titleRow[c - 1])).filter(
        (u): u is "BGN" | "EUR" => u != null,
      ),
    ),
  ];
  if (declared.length > 1) {
    throw new Error(
      `municipal_fiscal: money groups declare conflicting units (${declared.join(", ")})`,
    );
  }
  const declaredUnit = declared[0] ?? null;

  const crosswalk =
    opts.crosswalk ??
    buildCrosswalk(opts.municipalities ?? loadMunicipalities());
  const inRecovery = opts.inRecovery ?? new Set<number>();

  // The collection columns are single, on the workbook's year-end period. Which
  // of the three that is comes from the data, not from an assumption about
  // ordering — a release whose middle column is not Q4 would otherwise attach
  // the rates to the wrong quarter.
  const collectionPeriodIdx = periods.findIndex((p) => p.quarter === 4);

  if (declaredUnit) {
    const clash = periods.filter(
      (p) => currencyForYear(p.fiscalYear) !== declaredUnit,
    );
    if (clash.length > 0) {
      warnings.push(
        `workbook declares ${declaredUnit} but the year rule expects ` +
          `${clash.map((p) => `${p.label}=${currencyForYear(p.fiscalYear)}`).join(", ")}` +
          ` — using the DECLARED unit; check the release around the euro changeover`,
      );
    }
  } else {
    warnings.push(
      "no unit declared in row 1 of any money group — falling back to the year rule (лв. through 2025, евро from 2026)",
    );
  }

  const out: MunicipalFiscalQuarter[] = [];
  const mfCodes: number[] = [];

  for (const r of rows.slice(HEADER_ROWS_POKAZATELI)) {
    const mf = num(r?.[0]);
    if (mf == null) continue;
    mfCodes.push(mf);
    const nameBg = String(r[1] ?? "").trim();
    const obshtina = crosswalk.get(mf);
    if (!obshtina) {
      warnings.push(`unresolved МФ code ${mf} „${nameBg}" — row skipped`);
      continue;
    }

    periods.forEach((period, i) => {
      const inferred = currencyForYear(period.fiscalYear);
      const currency = declaredUnit ?? inferred;
      // A group this era omits reads null rather than reading a guessed
      // offset — `cashOnHand` is the one that is legitimately absent before
      // 2024, and reading it anyway would silently import the debt column.
      const m = (col: number | null) =>
        col == null ? null : money(r[col - 1 + i], currency);
      const at = (col: number | null) => (col == null ? null : r[col - 1 + i]);
      const ratios = {
        arrearsPct: pct(at(g.arrearsRatio)),
        obligationsPct: pct(at(g.obligationsRatio)),
        commitmentsPct: pct(at(g.commitmentsRatio)),
      };
      const collection: CollectionRates | null =
        i === collectionPeriodIdx
          ? {
              dniPct: pct(
                g.collection.dni == null ? null : r[g.collection.dni - 1],
              ),
              dprsPct: pct(
                g.collection.dprs == null ? null : r[g.collection.dprs - 1],
              ),
              avgPct: pct(
                g.collection.avg == null ? null : r[g.collection.avg - 1],
              ),
            }
          : null;

      const base = {
        mfCode: mf,
        obshtina,
        nameBg,
        fiscalYear: period.fiscalYear,
        quarter: period.quarter,
        commitments: m(g.commitments),
        expenseObligations: m(g.expenseObligations),
        arrears: m(g.arrears),
        revenue: m(g.revenue),
        expenditure: m(g.expenditure),
        budgetBalance: m(g.budgetBalance),
        cashOnHand: m(g.cashOnHand),
        debtStock: m(g.debtStock),
        ratios,
        ratioBasis: ratioBasisFor(period.quarter),
        indicators: indicatorsAt(r, i, g),
        collection,
        inRecoveryProcedure: inRecovery.has(mf),
        // Filled by the ingest from the year-end-anchored releases, which this
        // parser never sees. Null here means „no official verdict attached
        // yet", not „no criteria met".
        officialCriteriaMet: null,
        sourceFile: opts.sourceFile,
      };
      out.push({ ...base, expenditureAvg4yEur: deriveAvg4y(base) });
    });
  }

  return { periods, rows: out, mfCodes, warnings };
};
