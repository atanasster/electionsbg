// Resolve a free-text party reference ("ГЕРБ", "gerb", "ПП-ДБ", "DPS") to a
// party entry, against nickName / name / commonName aliases.

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s.\-_/]+/g, "") // strip separators
    .trim();

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
  return best?.p;
};
