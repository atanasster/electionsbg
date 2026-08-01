// Shared identity keys for local-election office holders, used by BOTH the person resolver
// (scripts/person/resolve_persons.ts, which MINTS the person_role rows) and the personSlug bake
// (scripts/parsers_local/decorate_local_person_links.ts, which READS them back to stamp the JSON).
//
// The two MUST agree on (a) which candidate row is the winner of a contest and (b) the `ref`
// string that keys that winner in person_role. If they drift, the bake looks up a ref the
// resolver never wrote and silently stamps nothing — the exact failure the plan
// (docs/plans/local-person-links-v1.md, Phase 2) is built to avoid. Keeping both in one module,
// unit-tested, is what makes the two walks provably consistent.

/** A mayoral-contest candidate row as it appears in a município bundle — the shape shared by the
 *  headline mayor race, kmetstvo village-mayor races and район-mayor races. */
export type LocalMayorMention = {
  candidateName?: string;
  localPartyNum?: number;
  primaryCanonicalId?: string | null;
  isElected?: boolean;
  votes?: number;
};

/** Resolve the winner of a kmetstvo/район contest. CIK marks BOTH runoff finalists `isElected`
 *  in round 1 and these bundles carry no resolved `elected` field, so a naive
 *  `candidates.find(isElected)` can return the runoff LOSER. Prefer the round-2 table when
 *  present (its higher-vote finalist won), else the highest-vote elected round-1 candidate. */
export const pickLocalWinner = (
  candidates?: LocalMayorMention[],
  round2?: LocalMayorMention[],
): LocalMayorMention | undefined => {
  const pool = round2?.length ? round2 : (candidates ?? []);
  const named = pool.filter((c) => c.candidateName);
  const elected = named.filter((c) => c.isElected);
  return (elected.length ? elected : named)
    .slice()
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0];
};

// The `person_role.ref` keys (NO `local:` prefix — the resolver prepends `local:` for the
// mention id / person_slug_lock key, but the stored ref is the unprefixed form these return).
// `kmetstvo`/`district` fall back to the array index because `ekatte`/`districtCode` are empty in
// today's bundles and `kmetstvoName` is not unique within a município.
export const mayorRef = (cycle: string, obshtinaCode: string): string =>
  `${cycle}:${obshtinaCode}:mayor`;

export const councillorRef = (
  cycle: string,
  obshtinaCode: string,
  localPartyNum: number,
  listPos: number,
): string => `${cycle}:${obshtinaCode}:${localPartyNum}:${listPos}`;

export const kmetstvoRef = (
  cycle: string,
  obshtinaCode: string,
  ekatte: string | undefined,
  index: number,
): string => `${cycle}:${obshtinaCode}:kmetstvo:${ekatte || String(index)}`;

export const districtRef = (
  cycle: string,
  obshtinaCode: string,
  districtCode: string | undefined,
  index: number,
): string =>
  `${cycle}:${obshtinaCode}:district:${districtCode || String(index)}`;

/** Sofia (`SOF`) районни кметове are materialized as role 'mayor' from the per-район `S2***`
 *  shards' `mayor.elected`, so the SOF parent bundle's `districts[]` must be SKIPPED to avoid a
 *  24-per-cycle double-count. Plovdiv/Varna районни have no shards and come from districts[]. */
export const districtsAreShardedElsewhere = (obshtinaCode: string): boolean =>
  obshtinaCode === "SOF";

/** Sofia's 24 район shards (obshtinaCode `S2***`) REPLICATE the city-wide Столичен общински
 *  съвет slate for display; only the parent `SOF` shard is authoritative for it. So a район
 *  shard's council block is NOT its own body and must not mint councillor roles (that made one
 *  councillor hold "Общински съветник" across every район). The район shard's own office is its
 *  кмет на район (`mayor`), which IS taken. BOTH walks apply this guard to the council slot, so
 *  the resolver and the bake agree on which councils exist. */
export const councilShardReplicatesSofia = (obshtinaCode: string): boolean =>
  /^S2\d{3}$/.test(obshtinaCode);
