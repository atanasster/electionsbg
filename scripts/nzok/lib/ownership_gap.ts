// An INDEPENDENT second reading of the ЕЕОФ roster, used only by the gate
// (scripts/db/tests/nzok_ownership_register.data.test.ts) — never by the
// classifier. It answers one question: "is there a facility we call PRIVATE whose
// name looks like a hospital the state/municipal register lists?"
//
// It deliberately tolerates what the classifier refuses to (a wrong public label
// is worse than none there, so the classifier stays exact-first): one-letter
// spelling slips (Василев/Василиев, Панталеймон/Пантелеймон, Югозпадна/Югозападна),
// tokens the register glues together („ЧиловЕООД Мадан", „ТемковБургас"), and
// names that are a facility type plus a town and nothing else (МБАЛ Исперих).
// Every hit is a candidate for a hand-verified override in ./ownership.ts, never
// an automatic relabel — a fuzzy detector is fine as a tripwire and not as a
// classifier. Audit 2026-11-21: residual-private held 33 such facilities, €98m of
// 2025 НЗОК money.

import { fold } from "../../db/lib/nzok_fold";
import { CITY, COMMON, TYPE } from "./ownership";

const LEGAL = new Set(["ЕООД", "ЕАД", "ООД", "АД"]);

/** Undo the register's glued tokens before folding: „ЧиловЕООД" → „Чилов ЕООД",
 *  „ТемковБургас" → „Темков Бургас", „МБАЛПроф" → „МБАЛ Проф". */
export const unglue = (s: string): string =>
  s
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}{2,})(\p{Lu}\p{Ll})/gu, "$1 $2");

const tokens = (s: string): string[] =>
  fold(unglue(s)).split(" ").filter(Boolean);
const cities = (s: string): Set<string> =>
  new Set(tokens(s).filter((t) => CITY.has(t)));
const distinct = (s: string): string[] => [
  ...new Set(
    tokens(s).filter(
      (t) => t.length >= 4 && !CITY.has(t) && !TYPE.has(t) && !LEGAL.has(t),
    ),
  ),
];

const typeOf = (s: string): string | null =>
  tokens(s).find((t) => TYPE.has(t)) ?? null;

const lev1 = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
// A slip is only tolerated on a long token — a one-letter edit between two short
// words is usually two different words.
const near = (a: string, b: string): boolean =>
  a === b || (a.length >= 6 && b.length >= 6 && lev1(a, b));

/** Does a payment-facility name look like this ЕЕОФ register name? */
export const looksLikeRegisterEntry = (
  paymentName: string,
  registerName: string,
): boolean => {
  const pc = cities(paymentName);
  const rc = cities(registerName);
  const citiesAgree = [...pc].some((c) => rc.has(c));
  const citiesConflict = pc.size > 0 && rc.size > 0 && !citiesAgree;
  if (citiesConflict) return false;
  const pd = distinct(paymentName);
  const rd = distinct(registerName);
  // Type + town and nothing else on both sides (МБАЛ Исперих ↔ МБАЛ - Исперих).
  // The TYPE must agree too, or every hospital in a town matches every other
  // one (МБАЛ Света София ↔ ЦПЗ-София — "Света" folds away).
  if (!pd.length && !rd.length) {
    const pt = typeOf(paymentName);
    return citiesAgree && pt !== null && pt === typeOf(registerName);
  }
  const shared = pd.filter((t) => rd.some((u) => near(t, u)));
  if (!shared.length) return false;
  const distinctive = shared.filter((t) => !COMMON.has(t) && t.length >= 5);
  // A lone common saint (Св. Иван Рилски is in a dozen towns) needs the town.
  if (!distinctive.length)
    return citiesAgree && shared.length === Math.min(pd.length, rd.length);
  return (
    distinctive.length >= 2 ||
    citiesAgree ||
    shared.length === Math.min(pd.length, rd.length)
  );
};

export interface GapFacility {
  regNo: string;
  name: string;
  ownership: string;
  eur: number;
}

export interface RegisterGap {
  regNo: string;
  name: string;
  eur: number;
  register: string;
  registerOwnership: string;
}

/** Facilities labelled private, at or above `floorEur`, that look like a
 *  state/municipal register entry. Sorted by € descending. */
export const findRegisterGaps = (
  register: { name: string; ownership: string }[],
  facilities: GapFacility[],
  floorEur: number,
): RegisterGap[] => {
  const out: RegisterGap[] = [];
  for (const f of facilities) {
    if (f.ownership !== "private" || f.eur < floorEur) continue;
    const hit = register.find((r) => looksLikeRegisterEntry(f.name, r.name));
    if (hit)
      out.push({
        regNo: f.regNo,
        name: f.name,
        eur: f.eur,
        register: hit.name,
        registerOwnership: hit.ownership,
      });
  }
  return out.sort((a, b) => b.eur - a.eur);
};
