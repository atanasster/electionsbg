// THE ONE DEFINITION of how a foreign-currency declaration row becomes a euro figure.
//
// Read by the parser (which applies it), by fetch_fx_rates.ts (which builds the table) and by
// declaration_fx_conversion.data.test.ts (which gates it). Nothing else may restate the rule —
// this file exists because the repo has twice paid for a rule copied by hand into a second
// place (the six-way `magistrate_current` duplication, and `councilNameKey`'s TS/SQL split that
// cost 4,899 votes their attribution).
//
// THREE CURRENCY LISTS, AND THEY ARE NOT THE SAME QUESTION. Merging any two is the defect this
// header exists to prevent:
//
//   EUR_RATE (src/lib/currency.ts)   folds into euro at a FIXED rate?   EUR, BGN + spellings
//   FX_CURRENCIES (here)             convertible at a DATED rate?       USD, GBP, CHF
//   is_crypto_asset's fiat list (090) is this money AT ALL?             ~24 codes + typos
//
// „ДОЛАРА" is fiat and is not fixed-rate. „ЕВРО" is fiat and IS fixed-rate — and 090 already
// lists it, so normalising it in EUR_RATE makes the two agree rather than diverge.
//
// SERVER-SIDE ONLY, deliberately. Everything the browser receives is already in euro, so the
// dated table has no business in the bundle; keeping it out of src/lib/currency.ts is what
// stops ~13 KB of rates reaching every page. See src/entryGraph.test.ts for the general rule.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isEurConvertible, normCurrency } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(__filename), "../..");

/** Currencies converted at a DATED rate. Kept to what the corpus actually contains: every
 *  additional currency is a claim that we hold a rate for it, and a rate we never verified
 *  against the declarant medians is exactly the silent spot rate this design rules out. */
export const FX_CURRENCIES = ["USD", "GBP", "CHF"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** `{ USD: { "2019": 0.8902, … }, … }` — EUR per ONE unit, at the last ECB-quoted day of the
 *  year. Keyed by YEAR as a string because it is JSON. */
export type FxTable = Partial<Record<FxCurrency, Record<string, number>>>;

export const FX_TABLE_PATH = "data/declarations/fx_year_end.json";

/** The register's spellings, folded onto the ISO code. `normCurrency` has already stripped
 *  punctuation and upper-cased, so „шв. фр." arrives as „ШВФР". These mirror the Cyrillic
 *  entries in 090's `is_crypto_asset` fiat list — that list decides "is it money", this one
 *  decides "which money", and a spelling in one and not the other is how a real balance ends
 *  up published as a crypto holding. */
const ALIASES: Record<string, FxCurrency> = {
  USD: "USD",
  УСД: "USD",
  ДОЛАР: "USD",
  ДОЛАРА: "USD",
  GBP: "GBP",
  ПАУНД: "GBP",
  ПАУНДА: "GBP",
  ЛИРА: "GBP",
  ЛИРИ: "GBP",
  CHF: "CHF",
  ШВФР: "CHF",
  ФРАНК: "CHF",
  ФРАНКА: "CHF",
  ШВЕЙЦАРСКИФРАНК: "CHF",
  ШВЕЙЦАРСКИФРАНКА: "CHF",
};

/** The ISO code we would convert this currency cell at, or null when we would not.
 *  Fixed-rate currencies (EUR/BGN and their spellings) return null: they are `pickEurValue`'s
 *  job and must never reach the dated table. */
export const fxCurrencyOf = (
  currency: string | null | undefined,
): FxCurrency | null => {
  if (isEurConvertible(currency)) return null;
  return ALIASES[normCurrency(currency)] ?? null;
};

let cached: FxTable | null = null;

/** The committed table. Absent is a hard error rather than a degrade: silently converting
 *  nothing is the exact pre-existing defect, and it would look like a clean run. */
export const fxTable = (): FxTable => {
  if (cached) return cached;
  const abs = path.join(REPO, FX_TABLE_PATH);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `${FX_TABLE_PATH} is missing — run \`npx tsx scripts/declarations/fetch_fx_rates.ts --apply\`. Parsing without it would silently drop every foreign-currency asset row, which is the defect this table exists to fix.`,
    );
  }
  cached = JSON.parse(fs.readFileSync(abs, "utf8")) as FxTable;
  return cached;
};

/** EUR per one unit of `currency` at the end of `periodYear`, or null when we hold no rate.
 *
 *  NULL IS A SUPPORTED OUTCOME, not a gap to paper over. A currency the ECB does not quote, or
 *  a period year past the committed table, must leave the row unvalued and COUNTED (090's
 *  `excluded_asset_rows`) rather than guessed — that residue path is the design. */
export const fxRate = (
  currency: string | null | undefined,
  periodYear: number | null | undefined,
): number | null => {
  const iso = fxCurrencyOf(currency);
  if (iso == null || periodYear == null || !Number.isFinite(periodYear))
    return null;
  return fxTable()[iso]?.[String(periodYear)] ?? null;
};

/** How a row's `valueEur` was arrived at. Stored per row so no surface can present our
 *  arithmetic as the declarant's. */
export type ValueBasis = "equiv" | "peg" | "fx_ecb";

/** The euro figure for a row the parser could not already value, plus its basis.
 *  Returns null when the row stays unvalued — see fxRate's note on why that is a real outcome.
 *
 *  NEVER applied on top of a declarant-supplied figure: `pickEurValue` runs first and wins.
 *  We are filling a blank, not overriding a filing. */
export const fxValueEur = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  periodYear: number | null | undefined,
): number | null => {
  if (amount == null || !Number.isFinite(amount)) return null;
  const rate = fxRate(currency, periodYear);
  return rate == null ? null : amount * rate;
};
