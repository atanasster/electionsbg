// Robust BG/EU number parse for the ДФЗ subsidy amounts. Strips whitespace
// (JS \s already covers NBSP / figure / narrow-NBSP spaces), then normalises
// decimal/thousands separators. When BOTH separators are present the LAST one
// is the decimal (handles US "1,234.56" and BG/EU "1.234,56" — the latter
// previously parsed to NaN → 0). A single comma is the decimal. Anything
// non-numeric falls back to 0.
export const parseAmount = (v: unknown): number => {
  if (v == null) return 0;
  let s = String(v).replace(/\s/g, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
