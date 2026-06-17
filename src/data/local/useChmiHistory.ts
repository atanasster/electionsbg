// Fetch chmi (partial + new election) history.
//
// Two access patterns, two file shapes — both anchored to the currently
// selected parliamentary election via ElectionContext: when a *historical*
// election is selected, events dated after it are dropped so the as-of view
// stays consistent. When the latest election is selected (the default), no
// cutoff applies — there is no "future" to be anachronistic about, so every
// chmi event through today shows, including partials held after that election
// (e.g. the June 2026 частични избори held after the April 2026 vote).
//
//   useChmiHistoryAll()        → /local_chmi_history.json (global, ~61KB)
//     For the national /local/chmi feed which needs every event.
//
//   useChmiHistory(code)       → /chmi_history/<code>.json (per município, ~1KB)
//     For the per-município page + settlement dashboard which only need that
//     município's events. Município codes without any chmi history 404 → []
//     (treated as "no events").
//
// Schema mirrors scripts/parsers_local/build_chmi_history.ts.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";

export type ChmiHistoryEvent = {
  cycle: string;
  date: string;
  kind: "obshtina_mayor" | "kmetstvo_mayor" | "rayon_mayor" | "council";
  obshtinaCode: string;
  obshtinaName: string;
  kmetstvoName: string | null;
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string | null;
  isIndependent: boolean;
  round: 1 | 2;
  pctOfValid: number;
  votes: number;
  mpId?: number;
  // Council re-election events only: leading party's seats + council size.
  councilSeatsWon?: number;
  councilTotalSeats?: number;
};

type ChmiHistory = {
  generatedAt: string;
  cyclesIncluded: string[];
  byObshtina: Record<string, ChmiHistoryEvent[]>;
  allEvents: ChmiHistoryEvent[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string]>): Promise<ChmiHistory | undefined> => {
  void queryKey;
  const response = await fetch(dataUrl("/local_chmi_history.json"));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `chmi history fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useChmiHistoryAll = () => {
  const query = useQuery({
    queryKey: ["local_chmi_history"],
    queryFn,
  });
  const { selected, elections } = useElectionContext();
  const isLatestElection = !selected || selected === elections[0];
  const asOfDate =
    selected && !isLatestElection ? selected.replace(/_/g, "-") : undefined;
  const data = useMemo<ChmiHistory | undefined>(() => {
    if (!query.data) return query.data;
    if (!asOfDate) return query.data;
    const allEvents = query.data.allEvents.filter((e) => e.date <= asOfDate);
    const byObshtina: Record<string, ChmiHistoryEvent[]> = {};
    for (const [code, events] of Object.entries(query.data.byObshtina)) {
      const kept = events.filter((e) => e.date <= asOfDate);
      if (kept.length > 0) byObshtina[code] = kept;
    }
    return { ...query.data, allEvents, byObshtina };
  }, [query.data, asOfDate]);
  return { ...query, data };
};

type ChmiHistoryShard = {
  obshtinaCode: string;
  events: ChmiHistoryEvent[];
};

const shardQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string]>): Promise<
  ChmiHistoryShard | undefined
> => {
  const code = queryKey[1];
  const response = await fetch(dataUrl(`/chmi_history/${code}.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `chmi history shard fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useChmiHistory = (
  obshtinaCode?: string | null,
): ChmiHistoryEvent[] => {
  const { data } = useQuery({
    queryKey: ["local_chmi_history_shard", obshtinaCode ?? ""],
    queryFn: shardQueryFn,
    enabled: !!obshtinaCode,
  });
  const { selected, elections } = useElectionContext();
  const isLatestElection = !selected || selected === elections[0];
  const asOfDate =
    selected && !isLatestElection ? selected.replace(/_/g, "-") : undefined;
  return useMemo(() => {
    if (!data) return [];
    if (!asOfDate) return data.events;
    return data.events.filter((e) => e.date <= asOfDate);
  }, [data, asOfDate]);
};
