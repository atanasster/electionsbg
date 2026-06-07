// Resolve a free-text party reference ("ГЕРБ", "gerb", "ПП-ДБ", "DPS") to a
// party entry, against nickName / name / commonName aliases.

import { fuzzyBestMatch } from "./resolve";
import { translitKey } from "./translit";

// Romanize first, THEN strip separators — so a latin token the router extracts
// from an English question ("gerb", "dps", "pp-db") matches the Cyrillic-only
// party records ("ГЕРБ" → "gerb", "ПП-ДБ" → "ppdb"), and Cyrillic queries still
// match (they romanize to the same key).
const normalize = (s: string): string => translitKey(s).replace(/[\s/]+/g, "");

export type PartyLike = {
  partyNum?: number;
  number?: number;
  nickName?: string;
  name?: string;
  commonName?: string[];
};

const aliasesOf = (p: PartyLike): string[] => {
  const out: string[] = [];
  if (p.nickName) out.push(p.nickName);
  if (p.name) out.push(p.name);
  if (p.commonName) out.push(...p.commonName);
  return out;
};

// Returns the best match or undefined. Strategy: exact normalized alias match
// first, then "alias contains query / query contains alias" fallback.
export const matchParty = <T extends PartyLike>(
  query: string,
  parties: T[],
): T | undefined => {
  const q = normalize(query);
  if (!q) return undefined;

  // 1. exact normalized alias
  for (const p of parties) {
    if (aliasesOf(p).some((a) => normalize(a) === q)) return p;
  }
  // 2. substring either direction (longest alias wins to avoid "ПП" eating "ПП-ДБ")
  let best: { p: T; len: number } | undefined;
  for (const p of parties) {
    for (const a of aliasesOf(p)) {
      const na = normalize(a);
      if (na && (na.includes(q) || q.includes(na))) {
        if (!best || na.length > best.len) best = { p, len: na.length };
      }
    }
  }
  if (best) return best.p;

  // 3. typo-tolerant fuzzy fallback (last resort). Tight threshold + a 4-char
  // floor so short abbreviations ("БСП", "ДПС", "ИТН") stay exact-only — one
  // edit there flips the party — while a misspelt longer name ("Възраждене")
  // still resolves.
  return fuzzyBestMatch(
    query,
    parties.map((p) => ({ item: p, keys: aliasesOf(p) })),
    { threshold: 0.28, minLen: 4 },
  )?.item;
};
