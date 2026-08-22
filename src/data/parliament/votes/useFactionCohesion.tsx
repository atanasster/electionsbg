// Group cohesion — how unified each parliamentary group votes.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 3a: /api/db/party-cohesion, which
// returns the per-sitting series (party_cohesion, 135) and the per-group rollup
// (party_cohesion_summary, 181) together. It used to fetch
// data/parliament/votes/derived/cohesion.json — the whole byNs envelope, of which one slice
// was used.
//
// ⚠️ THE NUMBERS MOVE, AND THAT IS THE FIX RATHER THAN THE REGRESSION. The route excludes
// НЕЗ and НЕЧЛ В ПГ; cohesion.json did not. Those are members WITHOUT a group, so their
// "cohesion" is a number about individuals, and charting them alongside the groups made the
// 50th read 0.94 against a real-group 0.973. Do not "restore" them for parity with the file.
//
// Parity otherwise, measured 2026-08-21 across every (ns, party) the file carried: 68 of 69
// entries identical on all four rendered columns, the 69th differing in the fourth decimal
// of a mean. The 181 header explains why the median and the member count needed their own
// matview rather than a query over the series.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type {
  CohesionEntry,
  CohesionSeriesPoint,
  CohesionSlice,
} from "./types";

interface Body {
  series: Array<{
    date: string;
    items: string | number;
    cohesion: string | number;
    party: string;
  }>;
  entries: Array<{
    party: string;
    items_covered: string | number;
    mean_cohesion: string | number;
    median_cohesion: string | number;
    members_tracked: string | number;
  }>;
  computedAt: string | null;
}

/** node-postgres hands `numeric` back as a STRING, and every one of these columns is either
 *  numeric or a bigint count — so a bare spread would put strings into fields the screens do
 *  arithmetic and `formatPct` on. Coerced once, here. */
const num = (v: string | number | null | undefined): number => Number(v ?? 0);

const queryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string | null];
}): Promise<{ slice: CohesionSlice; computedAt?: string } | undefined> => {
  const ns = queryKey[1];
  if (!ns) return undefined;
  const r = await fetch(`/api/db/party-cohesion?ns=${encodeURIComponent(ns)}`);
  if (!r.ok) throw new Error(`party-cohesion fetch failed: ${r.status}`);
  const body = (await r.json()) as Body | null;
  if (!body) return undefined;
  const series: CohesionSeriesPoint[] = (body.series ?? []).map((p) => ({
    date: p.date,
    partyShort: p.party,
    cohesion: num(p.cohesion),
    items: num(p.items),
  }));
  const entries: CohesionEntry[] = (body.entries ?? []).map((e) => ({
    partyShort: e.party,
    itemsCovered: num(e.items_covered),
    meanCohesion: num(e.mean_cohesion),
    medianCohesion: num(e.median_cohesion),
    membersTracked: num(e.members_tracked),
  }));
  return {
    slice: { entries, series },
    computedAt: body.computedAt ?? undefined,
  };
};

export const useFactionCohesion = () => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  // KEYED ON ns. The retired file was one whole-corpus fetch a single cache entry could
  // hold; this is per-parliament, so an unkeyed query would serve the 51st's numbers under
  // the 52nd after a switch — the same wrong-people failure pickSlice() guarded against by
  // being STRICT about the slice.
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_cohesion", ns] as [string, string | null],
    queryFn,
    enabled: !!ns,
    staleTime: Infinity,
  });

  const slice = data?.slice;

  const byParty = useMemo(() => {
    const m = new Map<string, CohesionEntry>();
    for (const e of slice?.entries ?? []) m.set(e.partyShort, e);
    return m;
  }, [slice]);

  return {
    // `file` is aliased to the slice so existing accessors like `entries`,
    // `series` work without callers needing to know about per-NS layering.
    file: slice,
    slice,
    computedAt: data?.computedAt,
    ns,
    entries: slice?.entries ?? [],
    series: slice?.series ?? [],
    byParty,
    isLoading,
  };
};
