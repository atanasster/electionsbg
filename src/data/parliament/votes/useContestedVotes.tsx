// The most-contested votes of the selected parliament — the tile on /votes.
//
// The tile's rule has two halves and the route serves both in one response: the trailing
// window, and an all-time fallback for when the window is thin. Splitting that across two
// calls, or re-deriving the window client-side, is how one rule becomes two — and the
// anchor in particular is subtle: the window runs back from the corpus's NEWEST SITTING, not
// from wall-clock today, or the tile empties during every recess. 11-32% of every term's
// days sit inside a gap longer than ten.
//
// Same Postgres-first / topic_index.json-fallback shape as useVoteDaySummary, for the same
// reason: the 8 MB artifact keeps a database-less checkout rendering.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { TopicIndexFile, TopicEntry } from "./types";

/** Below this a "split" vote is procedural noise. Shared with the route, which applies the
 *  same floor server-side so the fallback and the fast path rank the same pool. */
const MIN_CONTEST = 0.05;
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
  // EVERY failure resolves to null, including a THROWN one. `!r.ok` alone is not enough:
  // a network error, an aborted request or a non-JSON body (the SPA shell served for an
  // unknown /api path) throws, React Query then settles with data === undefined rather
  // than null, `routeMissed` never becomes true, and the fallback this file's header
  // promises is unreachable — /votes renders blank with nothing logged.
  try {
    const r = await fetch(
      `/api/db/contested-votes?ns=${encodeURIComponent(ns)}&windowDays=${windowDays}&limit=${limit}`,
    );
    if (!r.ok) return null;
    const body = (await r.json()) as PgBody | null;
    return body && Array.isArray(body.allTime) && body.allTime.length > 0
      ? body
      : null;
  } catch {
    return null;
  }
};

const jsonQueryFn = async (): Promise<TopicIndexFile | undefined> => {
  // NOT wrapped: this is the last resort, so a genuine failure here must surface rather
  // than resolve to an empty page.
  const r = await fetch(dataUrl(`/parliament/votes/derived/topic_index.json`));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return r.json();
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

  const routeMissed = !!ns && !pgLoading && pg === null;
  const { data: json, isLoading: jsonLoading } = useQuery({
    queryKey: ["rollcall_topic_index"] as [string],
    queryFn: jsonQueryFn,
    enabled: routeMissed,
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
    const entries: TopicEntry[] = ns ? (json?.byNs?.[ns]?.entries ?? []) : [];
    if (entries.length === 0)
      return { items: [], basis: "window", anchor: null };
    // The artifact is pre-sorted newest-first, so entry 0 is the anchor — the same rule the
    // route applies with max(date).
    const anchorDate = entries[0].date;
    const cutoffAt = new Date(`${anchorDate}T00:00:00Z`);
    cutoffAt.setUTCDate(cutoffAt.getUTCDate() - windowDays);
    const cutoff = cutoffAt.toISOString().slice(0, 10);
    const pool = entries.filter((e) => e.contestScore >= MIN_CONTEST);
    const inWindow = pool.filter((e) => e.date >= cutoff);
    const enough = inWindow.length >= MIN_IN_WINDOW;
    return {
      items: [...(enough ? inWindow : pool)]
        .sort((a, b) =>
          b.contestScore !== a.contestScore
            ? b.contestScore - a.contestScore
            : b.date.localeCompare(a.date),
        )
        .slice(0, count),
      basis: enough ? "window" : "allTime",
      anchor: anchorDate,
    };
  }, [pg, json, ns, windowDays, count]);

  return {
    items,
    basis,
    anchor,
    isLoading: pgLoading || (routeMissed && jsonLoading),
  };
};
