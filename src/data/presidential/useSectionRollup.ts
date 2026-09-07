// One presidential round's per-SECTION results for one oblast —
// `<cycle>/tur<round>/sections/<oblast>.json`.
//
// ⚠ IT IS SHARDED BY OBLAST, unlike every other level of this tree, and that is the whole
// reason a settlement map is servable at all. The region/municipality/settlement roll-ups are
// ONE file per round covering the country (0.96 MB and 14.63 MB raw); the section level is cut
// per oblast, so a settlement page reads only its own oblast: 2.4 MB raw for Бургас, the
// largest, and 62 KB gzipped. `scripts/bucket_gzip.ts` carries these for that reason — read its
// note before assuming this page is cheap.
//
// ⚠ THESE RECORDS CARRY NO COORDINATES. A section here has `code`, `ekatte`, `oblast`,
// `obshtina`, `protocol` and `votes` and nothing to plot with; the geography is joined from the
// parliamentary settlement shard on the 9-digit station code. See `PresidentialSectionsMap`.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR — the same rule `useRoundRollup`,
// `useElectionSurface` and `usePresidentialSummary` state. Most of this corpus is unpublished.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

/** One ticket's votes in one section. Mirrors `RollupVotes`; kept separate because this file's
 *  producer is the section writer rather than the roll-up writer, and a shared type would make
 *  a change to one silently a change to the other. */
export interface SectionVotes {
  partyNum: number;
  totalVotes: number;
}

export interface PresidentialSectionRow {
  /** The 9-digit CIK station code — the join key to the parliamentary archive's coordinates. */
  code: string;
  /** ⚠ MAY BE ABSENT. A section whose ЕКАТТЕ the catalogue cannot name is real (mobile and ship
   *  sections, and the abroad ones), and it simply cannot be placed on a settlement's map. */
  ekatte?: string;
  oblast?: string;
  obshtina?: string;
  votes: SectionVotes[];
}

export type SectionRollupState =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "ready"; rows: PresidentialSectionRow[] };

export const sectionRollupPath = (
  cycle: string,
  round: 1 | 2,
  oblast: string,
): string => `${cycle}/tur${round}/sections/${oblast}.json`;

/** ⚠ EVERY LEAF THE MAP DEREFERENCES, for the reason `useRoundRollup`'s guard states: a check
 *  that stopped at „it is an array" lets a truncated file through, and the consumer then reads
 *  `votes` off `undefined` — which, with no error boundary in `src/`, unmounts the React root
 *  rather than degrading to a missing map. */
const isRows = (v: unknown): v is PresidentialSectionRow[] =>
  Array.isArray(v) &&
  v.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.code === "string" &&
      Array.isArray(r.votes) &&
      r.votes.every(
        (x) =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as Record<string, unknown>).partyNum === "number" &&
          typeof (x as Record<string, unknown>).totalVotes === "number",
      )
    );
  });

export const usePresidentialSectionRollup = (
  cycle: string,
  round: 1 | 2,
  oblast: string | undefined,
): SectionRollupState => {
  const path = oblast ? sectionRollupPath(cycle, round, oblast) : null;
  const query = useQuery({
    queryKey: ["presidential_section_rollup", path],
    enabled: !!path,
    // The shard is a published artifact for a settled election; it never changes under a reader.
    staleTime: Infinity,
    queryFn: async (): Promise<PresidentialSectionRow[] | null> => {
      const res = await fetch(dataUrl(`/${path}`));
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const body: unknown = await res.json().catch(() => null);
      return isRows(body) ? body : null;
    },
  });
  if (!path || query.isPending) return { status: "loading" };
  return query.data
    ? { status: "ready", rows: query.data }
    : { status: "absent" };
};

/** The leading ticket in each section, keyed by station code.
 *
 *  ⚠ A SECTION THAT CAST NOTHING HAS NO LEADER — not ticket 1 with 0 votes. Colouring it would
 *  put a named pair's colour on a station nobody voted at. Ties break on the ballot number, so
 *  the same corpus always colours the same way. Same rule as `leadersByPlace`. */
export const sectionLeaders = (
  rows: readonly PresidentialSectionRow[],
  ekatte: string,
): Map<string, { number: number; votes: number; share: number }> => {
  const out = new Map<
    string,
    { number: number; votes: number; share: number }
  >();
  for (const r of rows) {
    if (r.ekatte !== ekatte) continue;
    let best: SectionVotes | undefined;
    let total = 0;
    for (const v of r.votes) {
      total += v.totalVotes;
      if (
        !best ||
        v.totalVotes > best.totalVotes ||
        (v.totalVotes === best.totalVotes && v.partyNum < best.partyNum)
      )
        best = v;
    }
    if (!best || best.totalVotes === 0 || total === 0) continue;
    out.set(r.code, {
      number: best.partyNum,
      votes: best.totalVotes,
      share: best.totalVotes / total,
    });
  }
  return out;
};
