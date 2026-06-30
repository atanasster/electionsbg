// Shared contract-key helpers. The contract `key` is the SPA's stable URL slug
// (/contract/:key) and the row identity used by every per-entity list and the
// by-id detail store. It must stay stable across re-runs — see [[Contract.key]]
// in types.ts.
//
// Three generators mint keys from a per-source base string:
//   - normalize.ts      (OCDS):   `${releaseId}::${contractId ?? ""}::${eik}::${tag}`
//   - normalize_eop.ts  (ЦАИС ЕОП): same shape, `eop-…` releaseId namespace
//   - legacy_csv.ts     (annual CSV): `legacy::${dataset}::${documentId}::${eik}`
//
// All three previously collided whenever a single procurement event yielded more
// than one distinct row to the SAME supplier with NO distinguishing id in the
// base string — multiple awards/contracts to one supplier (OCDS), or several
// lots / обособени позиции under one document number (legacy, whose base string
// omits contractId). Colliding rows then either silently collapsed at the
// shard merge (OCDS, where the merge key equals the base string) or survived on
// disk sharing one key (legacy, whose merge key DOES include contractId) —
// producing React "two children with the same key" warnings and conflating
// distinct contracts on /contract/:key.
//
// `disambiguateContractKeys` fixes both: a base key that is unique in the batch
// keeps its bare 12-hex form (so the 98%+ non-colliding URLs never move), and a
// base key shared by N distinct rows is re-derived to hash(`${baseKey}::${disc}`)
// for EACH member, giving N distinct keys (only the colliding minority changes).

import { createHash } from "crypto";

// 12 hex chars of sha256 — short enough for a clean URL, long enough that
// collisions across our row count (~300k) are astronomical.
export const hashKey = (input: string): string =>
  createHash("sha256").update(input).digest("hex").slice(0, 12);

// Re-key colliding rows in place. `rows[i].key` must hold the BASE key (the bare
// hash of the per-source base string) on entry. `discAt(i)` returns rows[i]'s
// stable, re-run-reproducible discriminator (a contract / award id, falling back
// to amount).
//
// A base key is only re-keyed when its group holds ≥2 DISTINCT discriminators —
// i.e. genuinely different contracts. Two rows sharing both a base key AND a
// discriminator are the same logical contract emitted twice by the feed; they
// keep the bare base key (stable URL) and the shard merge collapses them. A base
// key unique in `rows` is likewise untouched. So only distinct-but-colliding
// rows move — the 98%+ stable-URL majority never does.
//
// The new key is derived from the base KEY (not the raw base string), so the
// offline re-derive — which only has the stored 12-hex key on disk, not the
// original hash input — reproduces a fresh ingest's output exactly, as long as
// it groups by the same stored key and supplies the same discriminator.
//
// Idempotent: re-running over already-disambiguated rows (all keys unique) is a
// no-op. Returns the number of rows whose key was changed.
export const disambiguateContractKeys = (
  rows: Array<{ key: string }>,
  discAt: (index: number) => string,
): number => {
  const idxsByKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const arr = idxsByKey.get(r.key);
    if (arr) arr.push(i);
    else idxsByKey.set(r.key, [i]);
  });
  let changed = 0;
  for (const idxs of idxsByKey.values()) {
    if (idxs.length <= 1) continue; // unique base key → bare key stays stable
    const discs = idxs.map(discAt);
    if (new Set(discs).size <= 1) continue; // genuine duplicate → bare key stays
    idxs.forEach((i, j) => {
      rows[i].key = hashKey(`${rows[i].key}::${discs[j]}`);
      changed++;
    });
  }
  return changed;
};

// Discriminator for legacy-CSV rows (and the offline re-derive over them). The
// legacy base string is `legacy::${dataset}::${documentId}::${eik}`, which omits
// the per-contract id — so lots sharing a document number collide. contractId is
// the stable per-lot id; amount is the belt-and-suspenders tiebreaker for the
// rare blank-contractId row. Computed from the stored Contract fields so the
// generator and the migration produce identical keys.
export const legacyKeyDiscriminator = (row: {
  contractId?: string;
  amount?: number;
}): string => `${row.contractId ?? ""}::${row.amount ?? ""}`;
