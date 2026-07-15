// The person-name normalization key for magistrate /person lookups: lower-case,
// collapse runs of whitespace/hyphens to a single space, trim. The client hook
// (usePersonMagistrateHoldings) and the PG loader (load_magistrates_pg.ts) BOTH key on
// this, so it lives here as one pure (no-React) module they share — the two MUST stay
// byte-identical or a /person magistrate lookup silently misses. Pure so the Node
// loader can import it without pulling in React Query.
export const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim();
