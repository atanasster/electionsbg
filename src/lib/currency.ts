// Single source of truth for currency conversion and display.
//
// Bulgaria adopted the euro on 2026-01-01 at the legally locked rate
// 1 EUR = 1.95583 BGN. Data ingested for periods before the changeover is
// denominated in leva (BGN); 2026-onward data is already in euros. Our
// pipelines convert BGN -> EUR at ingest time and store euro values in the
// JSON, keeping the native amount alongside so the UI can footnote the
// original ("originally 5 000 лв").
//
// USD/GBP/CHF turn up in a handful of procurement contracts and MP asset
// declarations. We do NOT fold them into euro totals — the rates would be
// approximate and the volume is negligible — so toEur() returns null for
// them and the UI shows those amounts in their native currency.

/** Legally locked BGN/EUR parity used for the eurozone changeover. */
export const BGN_PER_EUR = 1.95583;

// Currencies we fold into the euro total. EUR is identity; BGN uses the
// locked peg. The Cyrillic spellings show up in MP declaration source XML.
const EUR_RATE: Record<string, number> = {
  EUR: 1,
  BGN: 1 / BGN_PER_EUR,
  ЛВ: 1 / BGN_PER_EUR,
  "ЛВ.": 1 / BGN_PER_EUR,
  ЛЕВА: 1 / BGN_PER_EUR,
};

const normCurrency = (currency: string | null | undefined): string =>
  (currency ?? "").trim().toUpperCase();

/** True when the currency is one we fold into euro totals (EUR or BGN). */
export const isEurConvertible = (
  currency: string | null | undefined,
): boolean => EUR_RATE[normCurrency(currency)] !== undefined;

/** Convert a native amount to euros. Returns null when the amount is missing
 * or the currency is one we keep native (USD/GBP/CHF, unrecognized) — callers
 * should display those in their own currency instead of a euro figure. */
export const toEur = (
  amount: number | null | undefined,
  currency: string | null | undefined,
): number | null => {
  if (amount == null || !Number.isFinite(amount)) return null;
  const rate = EUR_RATE[normCurrency(currency)];
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
      const code = normCurrency(currency);
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
  const code = normCurrency(currency);
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
  const code = normCurrency(currency);
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
    if (amount > 0 && EUR_RATE[normCurrency(code)] === undefined)
      parts.push(formatNative(amount, code, locale));
  }
  return parts.join(" · ");
};

/** A fraction (0..1) as a localised percentage. Shares `formatEurCompact`'s
 *  `lang` signature so the number-formatting helpers read alike at call sites. */
export const formatPct = (v: number, lang: string, digits = 1): string =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: digits }) + "%";

/** A count as a localised integer (BG groups with a space above 4 digits). */
export const formatInt = (v: number, lang: string): string =>
  v.toLocaleString(lang);
