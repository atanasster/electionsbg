// Single source of truth for currency conversion and display.
//
// Bulgaria adopted the euro on 2026-01-01 at the legally locked rate
// 1 EUR = 1.95583 BGN. Data ingested for periods before the changeover is
// denominated in leva (BGN); 2026-onward data is already in euros. Our
// pipelines convert BGN -> EUR at ingest time and store euro values in the
// JSON, keeping the native amount alongside so the UI can footnote the
// original ("originally 5 000 лв").
//
// USD/GBP/CHF turn up in a handful of procurement contracts and in MP asset
// declarations. This module does NOT fold them into euro totals — a FIXED rate
// for a floating currency is wrong in every year but one — so toEur() returns
// null and the UI shows those amounts in their native currency.
//
// ⚠️ THAT IS NOT THE SAME AS "unvaluable". Declaration asset rows ARE converted,
// at the dated ECB reference rate for the period the filing covers, by
// scripts/declarations/fx.ts — server-side only, so the rate table never reaches
// the bundle. Read that file's header before adding a currency anywhere: it sets
// out the three lists (fixed-rate, dated-rate, "is it money at all") and why
// merging any two of them republishes somebody's bank balance as something else.

/** Legally locked BGN/EUR parity used for the eurozone changeover. */
export const BGN_PER_EUR = 1.95583;

/** Fold a currency cell to a lookup key.
 *
 *  Strips non-alphanumerics as well as upper-casing, so „лв." and „ЛВ" are one key and
 *  „шв. фр." reaches scripts/declarations/fx.ts as „ШВФР". Deliberately IDENTICAL to
 *  `asset_unit_norm(text)` in 090_person_wealth.sql — the SQL side classifies the same cells
 *  for `is_crypto_asset`, and two normalisations that disagree on punctuation would sort the
 *  same row into different buckets on either side of the wire. On ISO codes it is a no-op,
 *  so the procurement callers of `splitBag` are unaffected. */
export const normCurrency = (currency: string | null | undefined): string =>
  (currency ?? "").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();

// Every spelling folds to its ISO code FIRST, and the rate is then keyed on the code alone.
// Keying rates directly on the spellings is what made an earlier cut of this render „евро"
// as „лв": `formatNative` asks "is this in EUR_RATE and not the string 'EUR'?" to choose
// between € and лв, so a euro spelling sitting in the rate table is a lev to every formatter.
//
// The Cyrillic spellings and homoglyph typos (ЕUR with a Cyrillic Е, ВGN with a Cyrillic В)
// come from the declaration register, which is full of them. „ФЖХ" is a BGN mistype and is
// provable as one — its €/unit across the corpus is exactly the 1.95583 peg.
const CURRENCY_ALIASES: Record<string, "EUR" | "BGN"> = {
  EUR: "EUR",
  ЕВРО: "EUR", // 30 rows carried „евро"/„Евро"/„ЕВРО" and went unvalued
  ЕВРА: "EUR",
  ЕUR: "EUR",
  BGN: "BGN",
  ВGN: "BGN",
  ЛВ: "BGN",
  ЛЕВ: "BGN",
  ЛЕВА: "BGN",
  ФЖХ: "BGN",
};

/** Currencies folded into a euro total at a FIXED rate — and ONLY those. */
const EUR_RATE: Record<string, number> = {
  EUR: 1,
  BGN: 1 / BGN_PER_EUR,
};

/** The ISO code for a currency cell, or the folded cell itself when we do not recognise it
 *  (USD, a coin name, a mis-keyed number). Exported so the declaration parser and the crypto
 *  classifier's gate ask the same question of the same string. */
export const canonicalCurrency = (
  currency: string | null | undefined,
): string => {
  const folded = normCurrency(currency);
  return CURRENCY_ALIASES[folded] ?? folded;
};

/** True when the currency is one we fold into euro totals (EUR or BGN). */
export const isEurConvertible = (
  currency: string | null | undefined,
): boolean => EUR_RATE[canonicalCurrency(currency)] !== undefined;

/** Convert a native amount to euros. Returns null when the amount is missing
 * or the currency is one we keep native (USD/GBP/CHF, unrecognized) — callers
 * should display those in their own currency instead of a euro figure. */
export const toEur = (
  amount: number | null | undefined,
  currency: string | null | undefined,
): number | null => {
  if (amount == null || !Number.isFinite(amount)) return null;
  const rate = EUR_RATE[canonicalCurrency(currency)];
  if (rate === undefined) return null;
  return amount * rate;
};

/** Split a per-currency bag into a euro subtotal (EUR + BGN folded) and the
 * untouched remainder of currencies we keep native. Used by the procurement
 * pipeline to turn legacy `totalByCurrency` bags into `totalEur`/`totalOther`. */
export const splitBag = (
  bag: Record<string, number>,
): { totalEur: number; totalOther: Record<string, number> } => {
  let totalEur = 0;
  const totalOther: Record<string, number> = {};
  for (const [currency, amount] of Object.entries(bag)) {
    if (!amount || !Number.isFinite(amount)) continue;
    const eur = toEur(amount, currency);
    if (eur === null) {
      const code = canonicalCurrency(currency);
      totalOther[code] = (totalOther[code] ?? 0) + amount;
    } else {
      totalEur += eur;
    }
  }
  return { totalEur, totalOther };
};

const resolveLocale = (locale: string | undefined): string =>
  locale === "bg" ? "bg-BG" : locale === "en" ? "en-US" : (locale ?? "bg-BG");

const numberFormatter = (
  locale: string | undefined,
  decimals: number,
): Intl.NumberFormat =>
  new Intl.NumberFormat(resolveLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Format a euro amount: "€1 234". Returns "" for null/non-finite input.
 * Aggregate figures round to whole euros by default. */
export const formatEur = (
  value: number | null | undefined,
  locale: string = "bg-BG",
  opts: { decimals?: number } = {},
): string => {
  if (value == null || !Number.isFinite(value)) return "";
  return `€${numberFormatter(locale, opts.decimals ?? 0).format(value)}`;
};

/** A euro figure whose SIGN is the point — a deficit, a delta, a variance.
 *
 *  `formatEur(-1365386)` yields „€-1 365 386", putting the minus between the
 *  currency symbol and the digits, where it is easy to read past on a column
 *  scanned for direction. This puts the sign in front of the symbol and uses a
 *  real minus (U+2212) rather than a hyphen, so „−€1 365 386" reads at a
 *  glance.
 *
 *  `plusForPositive` is for delta columns, where „+€70m" and „€70m" must not
 *  look alike; leave it off for a level (a deficit is negative, a surplus
 *  positive, and neither needs a „+"). Zero never takes a sign. */
export const formatEurSigned = (
  value: number | null | undefined,
  locale: string = "bg-BG",
  opts: { decimals?: number; plusForPositive?: boolean } = {},
): string => {
  if (value == null || !Number.isFinite(value)) return "";
  const sign =
    value < 0 ? "\u2212" : value > 0 && opts.plusForPositive ? "+" : "";
  return `${sign}${formatEur(Math.abs(value), locale, opts)}`;
};

/** The compact twin of `formatEurSigned` — „−€1,9 млрд." rather than
 *  `formatEurCompact`'s „€-1,9 млрд.", which buries the minus between the
 *  currency symbol and the digits. Used wherever a compact figure can be
 *  NEGATIVE and the sign is the information: a budget balance is the whole
 *  case. */
export const formatEurCompactSigned = (
  value: number | null | undefined,
  locale: string = "bg-BG",
  opts: { plusForPositive?: boolean } = {},
): string => {
  if (value == null || !Number.isFinite(value)) return "";
  const sign =
    value < 0 ? "\u2212" : value > 0 && opts.plusForPositive ? "+" : "";
  return `${sign}${formatEurCompact(Math.abs(value), locale)}`;
};

/** A plain count/ratio: "4,3" / "5 835". Returns "—" for null/non-finite. */
export const formatCount = (
  value: number | null | undefined,
  locale: string = "bg-BG",
  digits = 1,
): string =>
  value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat(resolveLocale(locale), {
        maximumFractionDigits: digits,
      }).format(value);

/** Compact euro figure for tight layouts: "€3,5 млн" / "€3.5M". Uses the
 * locale's compact notation so a billion-euro total fits a narrow KPI cell. */
export const formatEurCompact = (
  value: number | null | undefined,
  locale: string = "bg-BG",
): string => {
  if (value == null || !Number.isFinite(value)) return "";
  return `€${new Intl.NumberFormat(resolveLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
};

/** Compact plain number: "4,1 млн" / "4.1M". The non-currency sibling of
 * formatEurCompact — for counts (nights, arrivals) in tight chart labels. */
export const formatCompact = (
  value: number | null | undefined,
  locale: string = "bg-BG",
): string =>
  value == null || !Number.isFinite(value)
    ? ""
    : new Intl.NumberFormat(resolveLocale(locale), {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

/** Format an amount in its native currency, for the "originally …" footnote
 * on legacy rows: "5 000 лв", "€1 234", "1 200 USD". */
export const formatNative = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string = "bg-BG",
  opts: { decimals?: number } = {},
): string => {
  if (amount == null || !Number.isFinite(amount)) return "";
  const formatted = numberFormatter(locale, opts.decimals ?? 0).format(amount);
  const code = canonicalCurrency(currency);
  if (code === "EUR") return `€${formatted}`;
  if (EUR_RATE[code] !== undefined) return `${formatted} лв`; // BGN + spellings
  return `${formatted} ${code}`;
};

/** Format a single contract/asset amount for display: the euro figure as the
 * primary string, plus the original native amount as a footnote when the row
 * was converted from leva. `original` is "" when no footnote is warranted
 * (EUR-native rows, or USD/GBP/CHF rows we keep native). */
export const formatAmountEur = (
  amountEur: number | null | undefined,
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string = "bg-BG",
): { primary: string; original: string } => {
  const code = canonicalCurrency(currency);
  if (amountEur != null && Number.isFinite(amountEur)) {
    return {
      primary: formatEur(amountEur, locale),
      // Euro is Bulgaria's currency since 2026-01-01 — NEVER footnote the original
      // leva amount (or a redundant EUR-native). Only a genuinely foreign
      // currency we couldn't peg (USD/GBP/CHF, outside EUR_RATE) would footnote —
      // but those carry no amountEur, so in practice this is always "".
      original:
        EUR_RATE[code] === undefined
          ? formatNative(amount, currency, locale)
          : "",
    };
  }
  // No euro figure → a currency we keep native (USD/GBP/CHF, unrecognized).
  if (amount != null && Number.isFinite(amount)) {
    return { primary: formatNative(amount, currency, locale), original: "" };
  }
  return { primary: "", original: "" };
};

/** Render a euro subtotal plus any native remainder in a currency we could NOT
 * fold into euro (USD/GBP/CHF): "€1 234" or "€1 234 · 1 200 USD". Leva and
 * EUR-native remainders are dropped — they're already inside totalEur, and euro
 * is Bulgaria's currency since 2026-01-01 (no leva display anywhere). */
export const formatEurWithOther = (
  totalEur: number,
  totalOther: Record<string, number> | undefined,
  locale: string = "bg-BG",
): string => {
  const parts: string[] = [];
  if (totalEur > 0) parts.push(formatEur(totalEur, locale));
  for (const [code, amount] of Object.entries(totalOther ?? {})) {
    if (amount > 0 && EUR_RATE[canonicalCurrency(code)] === undefined)
      parts.push(formatNative(amount, code, locale));
  }
  return parts.join(" · ");
};

/** A fraction (0..1) as a localised percentage. Shares `formatEurCompact`'s
 *  `lang` signature so the number-formatting helpers read alike at call sites.
 *  Null/non-finite → "—" (the НЗОК financial tiles feed nullable share columns). */
export const formatPct = (
  v: number | null | undefined,
  lang: string,
  digits = 1,
): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : (v * 100).toLocaleString(resolveLocale(lang), {
        maximumFractionDigits: digits,
      }) + "%";

/** A count as a localised integer (BG groups with a space above 4 digits). */
export const formatInt = (v: number, lang: string): string =>
  v.toLocaleString(lang);
