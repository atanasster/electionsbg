// Display-label helpers for cabinets. When the same PM has held office
// more than once (Borisov I/II/III, Yanev I/II, Glavchev I/II), the
// surname alone — and even the full three-name form — is ambiguous in
// every UI surface that doesn't also show the tenure dates. The header
// anchor pill "СПРЯМО Борисов" was the worst offender: three distinct
// cabinets share that string.
//
// Convention: append the Roman numeral in chronological order (matches
// Bulgarian media + Wikipedia naming). Singleton PMs get no numeral.
//
// Disambiguation key = the BG surname (last token of pmBg). It's the
// stable language-independent grouping signal — slugs like `borisov-3`
// happen to encode the same info but are an implementation detail; sorting
// by `startDate` keeps the numeral ↔ tenure mapping correct even if a
// future cabinet gets a non-`-N` slug.

import type { Government } from "./useGovernments";

const ROMAN: Record<number, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV",
  5: "V",
  6: "VI",
  7: "VII",
  8: "VIII",
  9: "IX",
  10: "X",
};

const toRoman = (n: number): string => ROMAN[n] ?? String(n);

const lastToken = (s: string): string => s.split(" ").pop() ?? "";

/** Roman numeral for a cabinet when its PM has multiple cabinets; "" for
 *  singletons. Exposed separately so callers can render the numeral as a
 *  chip / badge rather than concatenating into a name string. */
export const cabinetOrdinalNumeral = (
  cabinet: Government,
  allCabinets: readonly Government[],
): string => {
  const bgSurname = lastToken(cabinet.pmBg);
  const siblings = allCabinets
    .filter((g) => lastToken(g.pmBg) === bgSurname)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (siblings.length <= 1) return "";
  const idx = siblings.findIndex((g) => g.id === cabinet.id);
  if (idx < 0) return "";
  return toRoman(idx + 1);
};

/** Localized surname + optional Roman numeral. Used in the header anchor
 *  pill, KpiTile footer ("При [Surname N]: ..."), and the inline label on
 *  each CabinetStrip pill. */
export const cabinetShortLabel = (
  cabinet: Government,
  allCabinets: readonly Government[],
  lang: "bg" | "en",
): string => {
  const surname = lastToken(lang === "bg" ? cabinet.pmBg : cabinet.pmEn);
  const numeral = cabinetOrdinalNumeral(cabinet, allCabinets);
  return numeral ? `${surname} ${numeral}` : surname;
};

/** Localized full PM name + optional Roman numeral. Used in section
 *  headings, hero card titles, breadcrumbs, and table rows where the
 *  three-name form is the visual primary. */
export const cabinetFullLabel = (
  cabinet: Government,
  allCabinets: readonly Government[],
  lang: "bg" | "en",
): string => {
  const fullName = lang === "bg" ? cabinet.pmBg : cabinet.pmEn;
  const numeral = cabinetOrdinalNumeral(cabinet, allCabinets);
  return numeral ? `${fullName} ${numeral}` : fullName;
};
