// „48-мо НС", „51-во НС", „52-ро НС".
//
// Bulgarian ordinal suffixes are NOT uniform, and the parliaments in this corpus land on
// four different ones: осмо → „-мо", първо → „-во", второ → „-ро", the rest „-то". A single
// hard-coded „-то" (which some older copy in this repo still uses) misspells the 47th, 48th,
// 51st and 52nd — that is, both parliaments anyone is currently reading about.

export const nsOrdinal = (ns: string, lang: string): string => {
  // Pass anything that is not a plain number straight through. `Number("")` is 0, not NaN,
  // so a finiteness check alone would render an empty NS as „0-то".
  if (!/^\d+$/.test(ns)) return ns;
  const n = Number(ns);
  if (lang !== "bg") {
    // Standard English rules, teens included even though this corpus never reaches them.
    const tens = n % 100;
    const suffix =
      tens >= 11 && tens <= 13
        ? "th"
        : n % 10 === 1
          ? "st"
          : n % 10 === 2
            ? "nd"
            : n % 10 === 3
              ? "rd"
              : "th";
    return `${n}${suffix}`;
  }
  const last = n % 10;
  const suffix =
    last === 1
      ? "во"
      : last === 2
        ? "ро"
        : last === 7 || last === 8
          ? "мо"
          : "то";
  return `${n}-${suffix}`;
};
