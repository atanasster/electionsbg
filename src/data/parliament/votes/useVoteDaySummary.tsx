// The /votes table's two derived columns — each plenary day's topic set and its outcome mix.
//
// POSTGRES ONLY since json-retirement-v2 Tier 3b. `topic_index.json` is 8,368,917 bytes,
// served UNCOMPRESSED — the single largest thing this module ever asked a reader to download
// — and it was fetched IN FULL by two consumers that between them render a chip set and a
// four-segment bar. The route answers the same question in 39 rows and 34 ms.
//
// The fallback arm was kept for two contingencies and both have passed: a first cloud deploy
// before db:load:rollcall:pg (vote_item has been loaded on prod since) and a checkout with no
// database. The second is real but narrow — /votes is one of many pages that need Postgres
// locally, so `npm run db:pg:up` is the answer rather than an 8 MB artifact kept alive to
// avoid it.
//
// ⚠️ THE FILE IS NOT RETIRED, only these two readers. ai/tools/parliament.ts still fetches
// it (and names it in its `provenance`), so it stays written, bucket-served and gzip-uploaded.
// Excluding it from the sync would freeze a tree the AI still reads — the company-connections
// failure. Retiring the FILE means moving those tools first.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { VoteTopic } from "./types";
import type { OutcomeBucket } from "./outcomeBucket";

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
}): Promise<PgDayRow[]> => {
  const [, ns] = queryKey;
  // ⚠️ FAILURE THROWS; EMPTY RETURNS []. These were one branch while the fallback existed —
  // everything collapsed to `null` so a `routeMissed` gate could fire — and keeping that
  // shape after removing the fallback is what review caught: a caught failure becomes a
  // SUCCESSFUL cached null, which defeats React Query's retry and, under
  // staleTime/gcTime: Infinity, pins a transient blip for the whole session. The fallback
  // used to self-heal that; nothing does now.
  //
  // Empty is a real answer and is NOT an error: `tableRows()` degrades a missing vote_item
  // to HTTP 200 `[]`, and a parliament with no loaded sittings is the same shape. The
  // consumers render an absent table for it, which is honest.
  const r = await fetch(
    `/api/db/vote-day-summary?ns=${encodeURIComponent(ns)}`,
  );
  if (!r.ok) throw new Error(`vote-day-summary failed: ${r.status}`);
  const body = (await r.json()) as PgDayRow[] | null;
  return Array.isArray(body) ? body : [];
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

  const byDate = useMemo(() => {
    const out = new Map<string, DaySummary>();
    for (const row of pg ?? []) {
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
  }, [pg]);

  return { byDate, isLoading: pgLoading };
};
