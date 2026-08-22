// The most-contested votes of the selected parliament — the tile on /votes.
//
// The tile's rule has two halves and the route serves both in one response: the trailing
// window, and an all-time fallback for when the window is thin. Splitting that across two
// calls, or re-deriving the window client-side, is how one rule becomes two — and the
// anchor in particular is subtle: the window runs back from the corpus's NEWEST SITTING, not
// from wall-clock today, or the tile empties during every recess. 11-32% of every term's
// days sit inside a gap longer than ten.
//
// POSTGRES ONLY since json-retirement-v2 Tier 3b — the same change useVoteDaySummary took,
// whose header carries the reasoning and the ⚠️ about the FILE not being retired (the AI
// tools still fetch it). Previously the same Postgres-first / topic_index.json-fallback shape,
// for the same
// reason: the 8 MB artifact keeps a database-less checkout rendering.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { TopicEntry } from "./types";

// The 0.05 contest floor that used to live here is now ONLY in /api/db/contested-votes.
// It was a client copy kept in step with the route so the fallback ranked the same pool;
// with the fallback gone there is one definition, server-side, and this note exists so the
// next reader does not go looking for a second one.
/** The window is thin below this, and the tile shows the all-time ranking instead. */
const MIN_IN_WINDOW = 3;

interface PgBody {
  anchor: string | null;
  recent: TopicEntry[];
  allTime: TopicEntry[];
}

/** Which of the two tiers the caller is actually looking at. Returned rather than left
 *  implicit because the tile has to SAY which one: the window is anchored on the newest
 *  sitting, so during a recess "the last 7 days" is weeks ago in wall-clock terms, and the
 *  fallback is not a window at all. A fixed "this week" heading is wrong in both cases. */
export type ContestedBasis = "window" | "allTime";

export interface ContestedVotes {
  items: TopicEntry[];
  isLoading: boolean;
  basis: ContestedBasis;
  /** Newest sitting in the corpus — the day the window runs back from, not wall-clock
   *  today. Null only when there is nothing to show. */
  anchor: string | null;
}

const newestDate = (entries: TopicEntry[]): string | null =>
  entries.reduce<string | null>(
    (max, e) => (max === null || e.date > max ? e.date : max),
    null,
  );

const pgQueryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string, number, number];
}): Promise<PgBody | null> => {
  const [, ns, windowDays, limit] = queryKey;
  // ⚠️ FAILURE THROWS; EMPTY RETURNS null. See useVoteDaySummary's twin for why these were
  // one branch and must not stay one: a caught failure became a successful cached null,
  // which defeats the retry and pins a transient blip under staleTime: Infinity.
  const r = await fetch(
    `/api/db/contested-votes?ns=${encodeURIComponent(ns)}&windowDays=${windowDays}&limit=${limit}`,
  );
  if (!r.ok) throw new Error(`contested-votes failed: ${r.status}`);
  const body = (await r.json()) as PgBody | null;
  return body && Array.isArray(body.allTime) ? body : null;
};

export const useContestedVotes = (
  windowDays = 7,
  count = 5,
): ContestedVotes => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  const { data: pg, isLoading: pgLoading } = useQuery({
    queryKey: ["rollcall_contested_pg", ns ?? "", windowDays, count] as const,
    queryFn: pgQueryFn,
    enabled: !!ns,
    staleTime: Infinity,
  });

  const { items, basis, anchor } = useMemo((): Omit<
    ContestedVotes,
    "isLoading"
  > => {
    if (pg) {
      const inWindow = pg.recent.length >= MIN_IN_WINDOW;
      return {
        items: inWindow ? pg.recent : pg.allTime,
        basis: inWindow ? "window" : "allTime",
        // The route derives the anchor with max(date) over the whole ns, so it is present
        // whenever any row is; the reduce is only the no-rows guard.
        anchor: pg.anchor ?? newestDate(pg.allTime),
      };
    }
    // No fallback arm. `pg` is null only when the route genuinely failed, and the honest
    // answer then is an empty tile rather than an 8 MB download — see the header.
    return { items: [], basis: "window", anchor: null };
  }, [pg]);

  return {
    items,
    basis,
    anchor,
    isLoading: pgLoading,
  };
};
