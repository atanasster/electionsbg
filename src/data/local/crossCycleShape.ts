// Shared shape + party-bucketing helpers for the local cross-cycle trend
// tiles. Both the national tile (useLocalCrossCycle — reads the per-cycle
// `index_trends.json` sidecars) and the per-município tile
// (useLocalMunicipalityCrossCycle — reads each cycle's full bundle) produce
// the same `CrossCycleData` so a single chart component renders both.

export type CrossCyclePoint = {
  cycle: string;
  year: string;
  councilPct: number | null;
  mayors: number | null;
  /** Raw council votes this cycle — drives the bubble area (∝ votes). */
  votes?: number | null;
};

export type CrossCycleParty = {
  canonicalId: string;
  displayName: string;
  color: string;
  points: CrossCyclePoint[]; // aligned 1:1 to cyclesAsc
  latestCouncilPct: number;
};

export type CrossCycleData = {
  cyclesAsc: { cycle: string; year: string }[];
  parties: CrossCycleParty[];
};

/** "2023-10-29" → "2023". */
export const yearOf = (round1Date: string): string => round1Date.slice(0, 4);

// Bucket alias: keep a party on a single line across cycles even when its
// canonical lineage is sparse. Pre-2019 local cycles credit some major
// parties to an unresolved bucket — a `local:*` id in the national sidecars,
// or a plain `null` primaryCanonicalId in the per-município bundles (e.g.
// 2011/2015 БСП, before canonical_parties.json resolved that local-party
// row). The name patterns here fold both forms back into the canonical
// bucket so one line spans the full series instead of fragmenting per cycle.
const ALIASES: Array<{ pattern: RegExp; canonicalId: string }> = [
  { pattern: /\bбългарска социалистическа партия\b/i, canonicalId: "bsp" },
  { pattern: /\bгерб\b/i, canonicalId: "gerb" },
  { pattern: /\bдпс\b/i, canonicalId: "p_16" },
];

// Resolve a party row to a stable cross-cycle bucket id.
//   - a real canonical id ("gerb", "p_16") passes through unchanged;
//   - a `local:*` id or a `null` canonical is name-matched against ALIASES
//     and folded into the canonical lineage when it matches;
//   - anything still unresolved buckets by its normalised local-party name
//     (so a purely-local slate, e.g. "Съюз за Пловдив", still draws one line).
export const bucketId = (
  canonicalId: string | null | undefined,
  displayName: string,
): string => {
  if (canonicalId && !canonicalId.startsWith("local:")) return canonicalId;
  const hay = `${canonicalId ?? ""} ${displayName}`;
  for (const a of ALIASES) if (a.pattern.test(hay)) return a.canonicalId;
  return canonicalId ?? `name:${displayName.toLocaleLowerCase("bg").trim()}`;
};
