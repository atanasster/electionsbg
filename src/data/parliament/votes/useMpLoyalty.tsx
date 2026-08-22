// Party-line loyalty — how often a member votes with their own group's majority.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 2: /api/db/mp-loyalty (mp_loyalty, 182).
// It used to read the per-MP shard (parliament/votes/derived/per-mp/, 2,330 files / 43 MB)
// with loyalty.json as a fallback — the last of the three hooks holding that tree alive.
//
// ⚠️ THE FIGURES MOVE FOR 9 OF 2,330 MEMBERS, and Postgres is the correct side. Measured
// against loyalty.json across the whole corpus: 2,321 identical, and every difference is a
// member of the 52nd carrying 9 DUPLICATE (item, mp) casts that the JSON counts twice and
// vote_cast_pkey collapses. The loader reports those 84 duplicates on every run; this is
// the first consumer that stops inheriting them.
//
// One call now serves what three sources did: the member's own figures, the chamber medians
// the candidate page shows them against, the sitting window, and the whole chamber for the
// most-loyal / most-independent leaderboards.
//
// ⚠️ `partyShort` IS THE SEAT'S GROUP, and it MOVES for 54 of 2,330 members against what
// loyalty.json labelled them. Measured, every one of the 54 is a swap between near-synonymous
// unaffiliated buckets — „НЕЗ" vs „НЕЧЛ В ПГ", or a group vs one of those — for members who
// left their group before the end of the term. The artifact's rule was neither "the seat" nor
// "the last affiliated cast" (both were tried; 54 and 55 differences respectively), but its
// own fold over the day files.
//
// The seat is kept deliberately rather than reproduced: /api/db/mp-attendance labels from the
// same source, and those two chips sit on ONE page. A chip that agrees with its neighbour is
// worth more than one that agrees with a retired file, and no FIGURE is affected — only the
// group name printed beside it.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { LoyaltyEntry, LoyaltySlice } from "./types";

// Stable identity for the empty case — see the twin in useAttendance.tsx. The MP
// scorecard depends on BOTH arrays in one useMemo, so a fresh `[]` from either
// recomputes it on every render.
const NO_ENTRIES: LoyaltyEntry[] = [];

interface Body {
  ns: number;
  me: { votesCast: number; withParty: number; loyaltyPct: number } | null;
  cohort: {
    size: number;
    votesCastMedian: number;
    loyaltyPctMedian: number;
    presentPctMedian?: number;
  } | null;
  windowFrom: string;
  windowTo: string;
  totalVoteItems: number;
  entries: Array<
    LoyaltyEntry & { name: string | null; loyaltyPct: number | null }
  >;
}

const queryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string | null, number | null];
}): Promise<Body | undefined> => {
  const [, ns, mp] = queryKey;
  if (!ns) return undefined;
  const r = await fetch(
    `/api/db/mp-loyalty?ns=${encodeURIComponent(ns)}${mp ? `&mp=${mp}` : ""}`,
  );
  if (!r.ok) throw new Error(`mp-loyalty fetch failed: ${r.status}`);
  return ((await r.json()) as Body | null) ?? undefined;
};

export const useMpLoyalty = (
  mpId?: number | null,
  name?: string | null,
  // When false, skip the fetch entirely. Callers pass false for MPs who didn't serve in the
  // selected NS — there is no loyalty record to show. Defaults true to keep chamber-browsing
  // callers unchanged.
  enabled = true,
) => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  // KEYED ON (ns, mpId). `mp` only decides the `me` arm — `entries` and `cohort` are the same
  // for every caller in a parliament — but a shared key would serve one member's `me` under
  // another, which is the wrong-person failure this module guards everywhere else.
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_loyalty", ns, mpId ?? null] as [
      string,
      string | null,
      number | null,
    ],
    queryFn,
    enabled: enabled && !!ns,
    staleTime: Infinity,
  });

  const byMpId = useMemo(() => {
    const m = new Map<number, LoyaltyEntry>();
    for (const e of data?.entries ?? []) {
      if (e.loyaltyPct == null) continue;
      m.set(e.mpId, e as LoyaltyEntry);
    }
    return m;
  }, [data]);

  // NAME FALLBACK. parliament.bg recycles CSV ids across parliaments, so a candidate page
  // reaching this hook with a roster id that is not this NS's id resolves by name instead —
  // the same two-step bridge useCandidateUrlForVote uses. The route supplies the names, so
  // this no longer costs a second fetch of the votes index.
  const fallbackEntry = useMemo(() => {
    if (!name) return undefined;
    const target = name.toLocaleLowerCase("bg");
    return (data?.entries ?? []).find(
      (e) => (e.name ?? "").toLocaleLowerCase("bg") === target,
    ) as LoyaltyEntry | undefined;
  }, [name, data]);

  const entry: LoyaltyEntry | undefined =
    (mpId != null ? byMpId.get(mpId) : undefined) ?? fallbackEntry;

  const slice: LoyaltySlice | undefined = data
    ? {
        windowFrom: data.windowFrom,
        windowTo: data.windowTo,
        totalVoteItems: data.totalVoteItems,
        entries: (data.entries ?? []) as LoyaltyEntry[],
      }
    : undefined;

  return {
    file: slice,
    slice,
    ns,
    entries: (data?.entries as LoyaltyEntry[]) ?? NO_ENTRIES,
    entry,
    byMpId,
    /** The chamber medians the scorecard shows a member against. Named `cohort` because that
     *  is what the retired per-MP shard called it and what the consumers read. */
    cohort: data?.cohort ?? undefined,
    isLoading: enabled ? isLoading : false,
  };
};

// Returns the top-N most-loyal and most-independent MPs in the current NS,
// filtered by a minimum votesCast threshold. The default 30 mirrors the
// embedding/cohesion runners — fewer cast votes makes the loyalty ratio
// noisy (an MP seated for a single sitting day with one defection would
// otherwise show up as the chamber's most independent).
export const useLoyaltyRanking = (topN = 5, bottomN = 5, minVotesCast = 30) => {
  const { entries, isLoading } = useMpLoyalty();
  const { top, bottom } = useMemo(() => {
    const eligible = entries.filter((e) => e.votesCast >= minVotesCast);
    const sorted = [...eligible].sort((a, b) => b.loyaltyPct - a.loyaltyPct);
    return {
      top: sorted.slice(0, topN),
      bottom: sorted.slice(-bottomN).reverse(),
    };
  }, [entries, topN, bottomN, minVotesCast]);
  return { top, bottom, isLoading };
};
