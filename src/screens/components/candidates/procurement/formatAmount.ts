// Amount formatter for procurement totals. Two variants:
//
//   formatTotalByCurrency — preserves the per-currency split. Used only on
//     the single-contract detail page where the contract's native currency
//     is the right thing to show ("this contract was for 5,000 BGN" not
//     "this contract was for 2,556 EUR" — the underlying transaction was in
//     leva, not euros).
//
//   formatTotalAsEur — collapses every currency to EUR using fixed rates,
//     for any aggregate. Bulgaria's eurozone transition (BGN→EUR on
//     2026-01-01) uses a legally locked rate (1 EUR = 1.95583 BGN); the rest
//     are approximate conversions for the rare USD/GBP/CHF holdouts.

const FORMATTER_BG = new Intl.NumberFormat("bg-BG", {
  maximumFractionDigits: 0,
});

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  BGN: "лв",
};

// Render { EUR: 12345, BGN: 678 } → "€12 345 · 678 лв".
export const formatTotalByCurrency = (bag: Record<string, number>): string => {
  const parts: string[] = [];
  const order = [
    "EUR",
    "BGN",
    ...Object.keys(bag)
      .filter((c) => c !== "EUR" && c !== "BGN")
      .sort(),
  ];
  for (const cur of order) {
    const amt = bag[cur];
    if (!amt || amt <= 0) continue;
    const formatted = FORMATTER_BG.format(Math.round(amt));
    const sym = CURRENCY_SYMBOL[cur];
    if (sym === "€") parts.push(`€${formatted}`);
    else if (sym === "лв") parts.push(`${formatted} лв`);
    else parts.push(`${formatted} ${cur}`);
  }
  return parts.join(" · ");
};

// EUR-conversion rates. BGN is the legally-locked eurozone parity rate.
// USD/GBP/CHF are approximate fixed values — these currencies represent
// <0.2% of total spend and live in fewer than 50 contracts each across the
// full 13-year corpus, so the loss of precision is acceptable.
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1,
  BGN: 1 / 1.95583,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
};

const sumAsEur = (bag: Record<string, number>): number => {
  let eur = 0;
  for (const [cur, amt] of Object.entries(bag)) {
    if (!amt || amt <= 0) continue;
    const rate = EUR_PER_UNIT[cur];
    if (rate === undefined) continue;
    eur += amt * rate;
  }
  return eur;
};

// Render any { currency: amount } bag as a single EUR figure. Returns ""
// when the bag is empty or all zero.
export const formatTotalAsEur = (bag: Record<string, number>): string => {
  const eur = sumAsEur(bag);
  if (eur <= 0) return "";
  return `€${FORMATTER_BG.format(Math.round(eur))}`;
};
