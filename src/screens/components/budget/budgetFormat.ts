// Shared money/percent formatters for the budget simulator and its tiles —
// one rounding/sign/locale convention so the headline, the breakdown rows
// and the projection card can never drift apart. Sign character is U+2212.

/** Signed compact money: EN "+€447M", BG "+447 млн €". Deltas are 8-10
 *  digit numbers — millions/billions grain is the readable unit. */
export const fmtDelta = (v: number, lang: string): string => {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  const a = Math.abs(v);
  const raw =
    a >= 995e6 ? (a / 1e9).toFixed(1) : a >= 1e6 ? (a / 1e6).toFixed(0) : "0";
  const num = lang === "bg" ? raw.replace(".", ",") : raw;
  const unit =
    a >= 995e6
      ? lang === "bg"
        ? "млрд €"
        : "B"
      : lang === "bg"
        ? "млн €"
        : "M";
  const sgn = num === "0" ? "±" : sign;
  return lang === "bg" ? `${sgn}${num} ${unit}` : `${sgn}€${num}${unit}`;
};

/** Billions-grain money: EN "€11.0B", BG "11,0 млрд €". `signed` prefixes
 *  the minus for negative values (balances); unsigned suits baseline
 *  magnitudes (revenue lines, GDP). */
export const fmtCompactEur = (
  v: number,
  lang: string,
  signed = false,
): string => {
  const num = (Math.abs(v) / 1e9).toFixed(1);
  const numLoc = lang === "bg" ? num.replace(".", ",") : num;
  const sgn = signed && v < 0 ? "−" : "";
  return lang === "bg" ? `${sgn}${numLoc} млрд €` : `${sgn}€${numLoc}B`;
};

/** Locale-formatted percent value (no % suffix), fixed decimals. */
export const fmtPct1 = (v: number, locale: string, digits = 1): string =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(v)
    .replace(/-/g, "−");
