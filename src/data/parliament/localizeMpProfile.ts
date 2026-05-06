export const englishOrdinal = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

// "52-ро Народно събрание" → "52nd National Assembly". When the source uses
// the verbose Cyrillic ordinal form (e.g. "ЧЕТИРИДЕСЕТ И ДЕВЕТО НАРОДНО
// СЪБРАНИЕ") we leave it as-is — only the numeric prefix form is in current
// use for the seated NS.
export const localizeNs = (ns: string, isEn: boolean): string => {
  if (!isEn) return ns;
  const m = ns.match(/^(\d{1,3})[-\s]/);
  if (!m) return ns;
  return `${englishOrdinal(parseInt(m[1], 10))} National Assembly`;
};

// "40 НС" → "40th NA"; "7 ВНС" → "7th GNA" (Grand National Assembly).
// Also accepts a stripped current-NS short like "52-ро НС" — the BG ordinal
// suffix is dropped in the English form.
export const localizeNsShort = (s: string, isEn: boolean): string => {
  if (!isEn) return s;
  const m = s.match(/^(\d{1,3})(?:-\S+)?\s+(В?НС)$/);
  if (!m) return s;
  const ord = englishOrdinal(parseInt(m[1], 10));
  return `${ord} ${m[2] === "ВНС" ? "GNA" : "NA"}`;
};

const COUNTRY_EN: Record<string, string> = {
  България: "Bulgaria",
  Русия: "Russia",
  Украйна: "Ukraine",
  Либия: "Libya",
  САЩ: "USA",
  Куба: "Cuba",
  Аржентина: "Argentina",
  Франция: "France",
};

export const localizeCountry = (
  c: string | null | undefined,
  isEn: boolean,
): string | null => {
  if (!c) return null;
  if (!isEn) return c;
  return COUNTRY_EN[c] ?? c;
};

const POSITION_EN: Record<string, string> = {
  "Председател на НС": "Speaker of the National Assembly",
  "зам.-председател на НС": "Deputy Speaker",
  "парламентарен секретар": "Parliamentary Secretary",
  член: "Member",
};

export const localizePosition = (
  p: string | null | undefined,
  isEn: boolean,
): string | null => {
  if (!p) return null;
  if (!isEn) return p;
  return POSITION_EN[p] ?? p;
};
