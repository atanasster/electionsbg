// The per-candidacy МИР rows, party-disambiguated.
//
// EXTRACTED, NOT DUPLICATED. Two callers need this and they run at different points in
// db:refresh: load_person_elections_pg (step 20) writes person_election_stats, and
// resolve_persons (step 18) needs the same answer two steps EARLIER to fill
// person_role.place_code. Reading the table would therefore give the resolver an empty
// one on a fresh refresh — correct only on a second run. So both read the shards, through
// this one implementation.
//
// The party filter is the non-obvious part and the reason this is not a plain file read:
// `data/{election}/candidates/{NAME}/regions.json` is keyed by DISPLAY NAME, so two
// namesakes running for different parties share a folder. Filtering to the candidacy's
// own party is what keeps them apart; when the party cannot be determined the honest
// answer is NO rows, never the mixed-party ones.

import fs from "node:fs";
import path from "node:path";

// Permissive on purpose: the rows are stored verbatim into person_election_stats.regions
// and carry more fields than either consumer reads.
export type RegionRow = {
  /** Site МИР code — `BLG`, `S23`, `PDV-00`. */
  oblast?: string;
  partyNum?: number | null;
  /** PREFERENCE VOTES in this МИР. Not to be confused with the row's `pref`, which is
   *  the ballot preference NUMBER. */
  totalVotes?: number;
};

export type CandidacyRegions = {
  /** Rows belonging to THIS candidacy, party-filtered. */
  regions: RegionRow[];
  /** The party the filter used: the c-{party} slug's, else a clean folder's sole party. */
  effectiveParty: number | null;
  /** Does the name folder mix more than one party (i.e. namesakes)? */
  isCollision: boolean;
};

const readJson = <T>(p: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * @param candidatesRoot `data/{election}/candidates`
 * @param displayName    the candidate's display name (the folder)
 * @param slugPartyNum   the party from a `c-{party}-…` slug, or null for an `mp-{id}` one
 */
export function candidacyRegions(
  candidatesRoot: string,
  displayName: string,
  slugPartyNum: number | null,
): CandidacyRegions {
  const regionsAll =
    readJson<RegionRow[]>(
      path.join(candidatesRoot, displayName, "regions.json"),
    ) ?? [];
  const distinctParties = new Set(
    regionsAll.map((r) => r.partyNum).filter((p) => p != null),
  );
  const isCollision = distinctParties.size > 1;
  const effectiveParty =
    slugPartyNum ??
    (distinctParties.size === 1 ? ([...distinctParties][0] ?? null) : null);
  const regions =
    effectiveParty != null
      ? regionsAll.filter((r) => r.partyNum === effectiveParty)
      : isCollision
        ? []
        : regionsAll;
  return { regions, effectiveParty, isCollision };
}

/**
 * The candidacy's PRIMARY МИР — the one to show as a badge when a candidate stood in
 * several (15.9% of candidacies do).
 *
 * `totalVotes` is the PREFERENCE VOTES received in that МИР. `pref` on the same row is
 * the ballot preference NUMBER, not a count — the candidate shards' `prefs` map is the
 * same thing, and reading either as a tally is the easy mistake here.
 *
 * Ties break on the oblast code so the answer is deterministic across runs.
 */
/**
 * The МИР to show for one candidacy, applying both rules of §3a in order.
 *
 * Rule 1 (`seatedMir`) DISAMBIGUATES among the МИР this candidacy actually contested —
 * it never asserts one. parliament.bg holds a single seat per person with no cycle
 * attached, so applying it wherever an mpId exists back-stamps a 39th-NS seat onto a
 * 2026 candidacy that recorded no votes anywhere. Requiring the seat to BE one of these
 * regions keeps the disambiguation win without inventing a constituency.
 *
 * Rule 2 is the most-preference-votes МИР; `ballotFallback` is the shard's own first
 * oblast, and null is a legitimate answer — 24% of candidacies recorded no preferences
 * anywhere, which is an absence rather than a place.
 */
export const pickPrimaryMir = (
  regions: RegionRow[],
  seatedMir: string | null,
  ballotFallback: string | null,
): string | null => {
  if (seatedMir && regions.some((r) => r.oblast === seatedMir))
    return seatedMir;
  return primaryRegion(regions) ?? ballotFallback;
};

export const primaryRegion = (regions: RegionRow[]): string | null => {
  let best: { oblast: string; votes: number } | null = null;
  for (const r of regions) {
    if (!r.oblast) continue;
    const cand = { oblast: r.oblast, votes: r.totalVotes ?? 0 };
    if (
      !best ||
      cand.votes > best.votes ||
      (cand.votes === best.votes && cand.oblast < best.oblast)
    )
      best = cand;
  }
  return best?.oblast ?? null;
};
