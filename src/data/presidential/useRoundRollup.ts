// One presidential round's per-place roll-up — `<cycle>/tur<round>/<level>_votes.json`.
//
// ⚠ THIS IS THE COUNTRY MAP'S DATA SOURCE AND NOTHING ELSE'S, and the distinction is the whole
// reason `SURFACE_POLICY` calls the levels below the country `artifact`. The tree has NO
// per-place shards: each of these files covers the WHOLE country for one round, so a reader of
// one settlement would download every settlement. Measured 2021: region 113.9 KB (fine — the
// country map needs every oblast anyway), abroad 241.3 KB, municipality 974.6 KB, settlement
// 14.4 MB. Only the first two are servable as a map's input; the others are what the artifacts
// exist to avoid, which is why no adapter fetches them.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR — the same rule `useElectionSurface` and
// `usePresidentialSummary` state. A cycle whose tree has not been published is the expected
// answer for most of this corpus today.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

/** One ticket's votes in one place. ⚠ `paperVotes`/`machineVotes` are ABSENT before 2016 —
 *  the protocol did not record a split, and a stored 0 would claim nobody used a machine. */
export interface RollupVotes {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
}

export interface RollupEntry {
  /** The place key: a 3-letter oblast code, an obshtina code, an ЕКАТТЕ, or an ISO-2 country.
   *  ⚠ `""` IS A REAL BUCKET abroad — sections whose country the corpus cannot name. */
  key: string;
  results: { votes: RollupVotes[] };
}

export interface RoundRollup {
  /** ⚠ WHAT THIS FILE COVERS, IN ITS OWN WORDS. A settlement roll-up misses the eighth of
   *  sections whose ЕКАТТЕ the catalogue has no row for, so it is NOT a national total. */
  coverage: { basis: string; sections: number; excludedSections: number };
  entries: RollupEntry[];
}

export type RollupLevel = "region" | "municipality" | "settlement" | "abroad";

const FILE_OF: Record<RollupLevel, string> = {
  region: "region_votes.json",
  municipality: "municipality_votes.json",
  settlement: "settlement_votes.json",
  abroad: "abroad.json",
};

export const rollupPath = (
  cycle: string,
  round: 1 | 2,
  level: RollupLevel,
): string => `${cycle}/tur${round}/${FILE_OF[level]}`;

const isRollup = (v: unknown): v is RoundRollup => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.entries)) return false;
  // ⚠ EVERY LEAF THE MAP DEREFERENCES. A guard that stopped at „entries is an array" lets a
  // truncated file through, and the consumer then reads `results.votes` off `undefined` —
  // which, with no error boundary in `src/`, unmounts the React root rather than degrading.
  return r.entries.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const x = e as Record<string, unknown>;
    if (typeof x.key !== "string") return false;
    const votes = (x.results as Record<string, unknown> | undefined)?.votes;
    return (
      Array.isArray(votes) &&
      votes.every(
        (w) =>
          typeof (w as Record<string, unknown>)?.partyNum === "number" &&
          typeof (w as Record<string, unknown>)?.totalVotes === "number",
      )
    );
  });
};

export const fetchRoundRollup = async (
  path: string,
): Promise<RoundRollup | null> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${path}`));
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const body: unknown = await res.json();
    return isRollup(body) ? body : null;
  } catch {
    return null;
  }
};

/** ⚠ THREE STATES, NOT A NULLABLE VALUE. „Still fetching", „nothing published for this cycle"
 *  and „here it is" are three different instructions to a map, and collapsing the first two
 *  into `null` is what let the country map announce „няма подадени гласове" about all 31
 *  oblasts while the roll-up was still in flight — a statement of fact about named places,
 *  rendered above a ranking table showing 2.6 million votes. `usePresidentialSummary` already
 *  draws exactly this distinction; this hook was the one that did not. */
export type RollupState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "ready"; rollup: RoundRollup };

/**
 * @param cycle - The presidential cycle folder id.
 * @param round - Which round's roll-up.
 * @param level - Which grain. ⚠ Only `region` and `abroad` are small enough to serve as map
 *   input; see the header for the measured sizes of the other two.
 * @returns Which of the three states this roll-up is in.
 */
export const useRoundRollup = (
  cycle: string | undefined,
  round: 1 | 2,
  level: RollupLevel,
): RollupState => {
  const path = cycle ? rollupPath(cycle, round, level) : null;
  const { data, isPending } = useQuery({
    queryKey: ["presidential_rollup", path],
    queryFn: () => fetchRoundRollup(path!),
    enabled: path !== null,
  });
  // An unresolved cycle is `loading`, never `absent` — the same rule the surface hook states:
  // falling back on it renders the not-published body and never re-renders when the id lands.
  if (path === null || isPending) return { status: "loading" };
  return data ? { status: "ready", rollup: data } : { status: "absent" };
};

/**
 * The leading ticket in each place, and its share of that place's ticket votes.
 *
 * ⚠ THE DENOMINATOR IS THE TICKET SUM, NOT THE VALID VOTES, and that is a different quantity:
 * „не подкрепям никого" is valid and is not in this file. The figure is therefore „share of
 * the vote CAST FOR A PAIR", which is what a leader map is about — and a surface's own
 * `pct` (over valid votes) is the smaller number. Naming it here keeps the two from being
 * read as one.
 *
 * ⚠ TIES BREAK ON THE BALLOT NUMBER, so the same corpus always colours the same way.
 */
/**
 * One place's ticket votes and its leading pair — the ONE definition of both.
 *
 * ⚠ TIES BREAK ON THE BALLOT NUMBER, so the same corpus always colours and ranks the same way.
 * This was a five-line loop copied into `PresidentialTopRegionsTile`, whose comment asserted
 * „the same rule `leadersByPlace` uses, so the map and this list cannot name different leaders
 * for the same oblast" — a claim nothing enforced, since the two were independent copies. The
 * tile could not call `leadersByPlace` itself because it also needs each place's TOTAL, which
 * that function computes internally and discards; returning both makes the claim structural.
 */
export const foldPlace = (
  e: RollupEntry,
): { key: string; total: number; best?: RollupVotes } => {
  let best: RollupVotes | undefined;
  let total = 0;
  for (const v of e.results.votes) {
    total += v.totalVotes;
    if (
      !best ||
      v.totalVotes > best.totalVotes ||
      (v.totalVotes === best.totalVotes && v.partyNum < best.partyNum)
    )
      best = v;
  }
  return { key: e.key, total, best };
};

export const leadersByPlace = (
  rollup: RoundRollup | null,
): Map<
  string,
  { number: number; votes: number; shareOfTicketVotes: number }
> => {
  const out = new Map<
    string,
    { number: number; votes: number; shareOfTicketVotes: number }
  >();
  if (!rollup) return out;
  for (const e of rollup.entries) {
    const { best, total } = foldPlace(e);
    // ⚠ A PLACE THAT CAST NOTHING HAS NO LEADER — not ticket 1 with 0 votes. Colouring it
    // would put a named pair's colour on a place nobody voted in.
    if (!best || best.totalVotes === 0 || total === 0) continue;
    out.set(e.key, {
      number: best.partyNum,
      votes: best.totalVotes,
      shareOfTicketVotes: best.totalVotes / total,
    });
  }
  return out;
};
