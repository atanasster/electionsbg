// `(election, partyNum) -> canonical party id` — the identity key, in the module both runtimes
// can read.
//
// ⚠ KEYED ON THE PAIR, NEVER ON THE NICKNAME. `partyNum` is a per-election ballot POSITION — 21
// is ПрБ in 2026 and somebody else in 2021 — and the nickname is not unique either
// (`byNickName` folds „ГЕРБ" and „ГЕРБ-СДС" onto one id, which is correct for display and wrong
// for identity). The `history` array is the only key that names one party in one election.
//
// ⚠ THE BUILDER IS SEPARATE FROM THE READ. The generator reads `canonical_parties.json` off
// disk; the browser already has the same corpus in memory through `useCanonicalParties`. Both
// hand the same array to `buildPartyIndex`, so a `canonical` level's client-side adapter (§5.0)
// resolves identity by the same rule the artifact generator does rather than by a lookalike.

export type PartyIndex = ReadonlyMap<string, string>;

export type PartyHistoryRow = {
  id: string;
  history: readonly { election: string; partyNum: number }[];
};

export const buildPartyIndex = (
  parties: readonly PartyHistoryRow[],
): PartyIndex => {
  const out = new Map<string, string>();
  for (const p of parties)
    for (const h of p.history) out.set(`${h.election}:${h.partyNum}`, p.id);
  return out;
};

export const partyIdFor = (
  index: PartyIndex,
  election: string,
  partyNum: number,
): string | null => index.get(`${election}:${partyNum}`) ?? null;
