// The /votes table's two derived columns — each plenary day's topic set and its outcome mix.
//
// POSTGRES FIRST, `topic_index.json` AS THE FALLBACK, and the ordering is the whole point.
// That artifact is 8 MB — the single largest thing this module ever asked a reader to
// download — and it was fetched IN FULL by two consumers that between them render a chip set
// and a four-segment bar. The route answers the same question in 39 rows and 34 ms.
//
// The fallback is not dead weight: /votes is prerendered, `topic_index.json` is bucket-served
// and needs no database, so a checkout without Postgres and a first cloud deploy before
// db:load:rollcall:pg has run both still render the page. It is reached only when the route
// fails, which — per the degrade contract in db_routes.js — means the table is genuinely
// absent rather than merely empty.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { TopicIndexFile, TopicEntry, VoteTopic } from "./types";
import { outcomeBucket, type OutcomeBucket } from "./outcomeBucket";

export interface DaySummary {
  date: string;
  topics: VoteTopic[];
  /** Item counts per outcome bucket. Sums to the day's STANDING item count — re-votes are
   *  filtered, matching the artifact this replaces. */
  buckets: Record<OutcomeBucket, number>;
}

interface PgDayRow {
  date: string;
  topics: string[];
  unanimous: number;
  passed: number;
  rejected: number;
  contested: number;
}

const pgQueryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string];
}): Promise<PgDayRow[] | null> => {
  const [, ns] = queryKey;
  // EVERY failure resolves to null, including a THROWN one. `!r.ok` alone is not enough:
  // a network error, an aborted request or a non-JSON body (the SPA shell served for an
  // unknown /api path) throws, React Query then settles with data === undefined rather
  // than null, `routeMissed` never becomes true, and the fallback this file's header
  // promises is unreachable — /votes renders blank with nothing logged.
  try {
    const r = await fetch(
      `/api/db/vote-day-summary?ns=${encodeURIComponent(ns)}`,
    );
    if (!r.ok) return null;
    const body = (await r.json()) as PgDayRow[] | null;
    return Array.isArray(body) && body.length > 0 ? body : null;
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

const EMPTY: Record<OutcomeBucket, number> = {
  unanimous: 0,
  passed: 0,
  rejected: 0,
  contested: 0,
};

/** Per-date summaries for the selected parliament, keyed by ISO date. */
export const useVoteDaySummary = (): {
  byDate: Map<string, DaySummary>;
  isLoading: boolean;
} => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  const { data: pg, isLoading: pgLoading } = useQuery({
    queryKey: ["rollcall_day_summary_pg", ns ?? ""] as const,
    queryFn: pgQueryFn,
    enabled: !!ns,
    staleTime: Infinity,
  });

  // The 8 MB fetch is issued ONLY when the route came back empty — `enabled` on a resolved
  // null, not on `!pg`, so it does not fire while the route is still in flight.
  const routeMissed = !!ns && !pgLoading && pg === null;
  const { data: json, isLoading: jsonLoading } = useQuery({
    queryKey: ["rollcall_topic_index"] as [string],
    queryFn: jsonQueryFn,
    enabled: routeMissed,
    staleTime: Infinity,
  });

  const byDate = useMemo(() => {
    const out = new Map<string, DaySummary>();
    if (pg) {
      for (const row of pg) {
        out.set(row.date, {
          date: row.date,
          topics: row.topics as VoteTopic[],
          buckets: {
            unanimous: row.unanimous,
            passed: row.passed,
            rejected: row.rejected,
            contested: row.contested,
          },
        });
      }
      return out;
    }
    const entries: TopicEntry[] = ns ? (json?.byNs?.[ns]?.entries ?? []) : [];
    for (const e of entries) {
      const prev = out.get(e.date) ?? {
        date: e.date,
        topics: [] as VoteTopic[],
        buckets: { ...EMPTY },
      };
      if (!prev.topics.includes(e.topic)) prev.topics.push(e.topic);
      prev.buckets[outcomeBucket(e.outcome)] += 1;
      out.set(e.date, prev);
    }
    return out;
  }, [pg, json, ns]);

  return { byDate, isLoading: pgLoading || (routeMissed && jsonLoading) };
};
