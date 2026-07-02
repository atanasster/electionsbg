// Live activity for the watchlist — DB-backed. For every followed entity it
// fetches a light activity signature (/api/db/watch-signature: contract count,
// total awarded, latest date, top counterparty in one indexed aggregate);
// followed contracts reuse the contract-detail query, and followed persons
// read the shared corpus scanner payload. It then diffs that live signature
// against the per-item "last seen" snapshot to flag "new activity since you
// last looked", and baselines any entity we've never snapshotted (so
// following something doesn't immediately read as "new").
//
// One request per followed entity is intentional: signatures are tiny, cached
// per-item (staleTime Infinity + 1h CDN), and lists are short. If following
// 20+ entities ever becomes a hot path, the batched-endpoint pattern used by
// procurement-risk-indexes is the shape to reach for.
//
// Reused by the watchlist screen (cards + new-activity section), the unread
// badge on the procurement nav, and the overview digest tile.

import { useEffect, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ProcurementContract } from "@/data/dataTypes";
// Same fetcher AND same query key as the contract detail page — the cache
// entry is shared, so the error semantics must stay identical (it throws).
import { fetchContract } from "./useContract";
import {
  useWatchlist,
  useSeenMap,
  markManySeen,
  setCachedNewCount,
  type WatchItem,
  type WatchKind,
  type WatchSignature,
} from "./useWatchlist";

export type WatchActivity = {
  item: WatchItem;
  loading: boolean;
  /** We successfully fetched data for this entity. */
  resolved: boolean;
  count: number | null;
  totalEur: number | null;
  totalOther?: Record<string, number>;
  /** ISO date of the most recent contract we can see (best-effort), or "". */
  latestDate: string;
  /** Top counterparty (biggest buyer for a supplier, biggest supplier for a
   *  buyer), when available. */
  topName?: string;
  topEik?: string;
  topKind?: "company" | "awarder";
  sig: WatchSignature | null;
  /** Live signature exceeds the last-seen snapshot. */
  isNew: boolean;
  deltaCount: number;
  deltaEur: number;
};

const ID_OK: Record<WatchKind, RegExp> = {
  company: /^\d{9,13}$/,
  awarder: /^\d{9,13}$/,
  place: /^\d{5}$/,
  contract: /^[0-9a-f]{12}$/,
  person: /^\d+$/,
};

type Signature = {
  found: boolean;
  count?: number;
  totalEur?: number;
  /** Rare native USD/GBP/CHF remainder — kept so the watchlist card shows the
   *  same "+ other currency" note as the entity's own page. */
  totalOther?: Record<string, number>;
  latestDate?: string;
  topEik?: string | null;
  topName?: string | null;
  topKind?: "company" | "awarder";
};

const fetchSignature = async (it: WatchItem): Promise<Signature | null> => {
  const r = await fetch(
    `/api/db/watch-signature?kind=${it.kind}&id=${encodeURIComponent(it.id)}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as Signature;
};

const fetchEntity = async (it: WatchItem): Promise<unknown | null> =>
  it.kind === "contract" ? fetchContract(it.id) : fetchSignature(it);

const queryKeyFor = (it: WatchItem): readonly unknown[] =>
  it.kind === "contract"
    ? // Same key as useContract → shared cache with the detail page.
      ["procurement", "contract", it.id]
    : ["db", "watch-signature", it.kind, it.id];

// Person rows come from the shared corpus scanner (same payload the
// /procurement/people page uses with no window).
type PersonRow = {
  kind: "mp" | "official";
  name: string;
  totalEur: number;
  contractCount: number;
  mpId?: number;
};
const fetchPersonIndex = async (): Promise<PersonRow[]> => {
  const r = await fetch("/api/db/procurement-scanner");
  if (!r.ok) return [];
  const j = (await r.json()) as { rows?: PersonRow[] };
  return j.rows ?? [];
};

const EMPTY = {
  activities: [] as WatchActivity[],
  newCount: 0,
  loading: false,
};

export const useWatchlistActivity = (): {
  activities: WatchActivity[];
  newCount: number;
  loading: boolean;
} => {
  const items = useWatchlist();
  const seen = useSeenMap();

  const hasPerson = items.some((i) => i.kind === "person");
  const personQ = useQuery({
    queryKey: ["procurement", "scanner", null, null] as const,
    queryFn: fetchPersonIndex,
    enabled: hasPerson,
    staleTime: Infinity,
    retry: false,
  });

  const entityItems = items.filter((i) => i.kind !== "person");
  const results = useQueries({
    queries: entityItems.map((it) => ({
      queryKey: queryKeyFor(it),
      queryFn: () => fetchEntity(it),
      enabled: ID_OK[it.kind].test(it.id),
      staleTime: Infinity,
      retry: false,
    })),
  });

  const activities = useMemo<WatchActivity[]>(() => {
    const byKey = new Map<string, (typeof results)[number]>();
    entityItems.forEach((it, idx) =>
      byKey.set(`${it.kind}:${it.id}`, results[idx]),
    );

    return items.map((item): WatchActivity => {
      const seenSnap = seen[`${item.kind}:${item.id}`];

      // --- person: look up the shared scanner row ----------------------------
      if (item.kind === "person") {
        const row = personQ.data?.find(
          (r) => r.kind === "mp" && String(r.mpId) === item.id,
        );
        const loading = personQ.isLoading;
        if (!row) {
          return baseActivity(item, loading, null, seenSnap);
        }
        const sig: WatchSignature = {
          count: row.contractCount,
          totalEur: row.totalEur,
          latestDate: "",
        };
        return {
          ...baseActivity(item, false, sig, seenSnap),
          resolved: true,
          count: row.contractCount,
          totalEur: row.totalEur,
        };
      }

      // --- contract: one row, keyed like the detail page ---------------------
      const q = byKey.get(`${item.kind}:${item.id}`);
      const loading = !!q?.isLoading;
      const data = q?.data ?? null;
      if (!data) return baseActivity(item, loading, null, seenSnap);

      if (item.kind === "contract") {
        const d = data as ProcurementContract;
        const latestDate = d.dateSigned || d.date || "";
        const sig: WatchSignature = {
          count: 1,
          totalEur: d.amountEur ?? 0,
          latestDate,
        };
        return {
          ...baseActivity(item, false, sig, seenSnap),
          resolved: true,
          count: 1,
          totalEur: d.amountEur ?? null,
          latestDate,
        };
      }

      // --- company / awarder / place: the signature IS the payload -----------
      const d = data as Signature;
      if (!d.found) return baseActivity(item, false, null, seenSnap);
      const sig: WatchSignature = {
        count: d.count ?? 0,
        totalEur: d.totalEur ?? 0,
        latestDate: d.latestDate ?? "",
      };
      const totalOther =
        d.totalOther && Object.keys(d.totalOther).length > 0
          ? d.totalOther
          : undefined;
      return {
        ...baseActivity(item, false, sig, seenSnap),
        resolved: true,
        count: d.count ?? 0,
        totalEur: d.totalEur ?? null,
        totalOther,
        latestDate: d.latestDate ?? "",
        topName: d.topName ?? undefined,
        topEik: d.topEik ?? undefined,
        topKind: d.topKind,
      };
    });
  }, [items, results, personQ.data, personQ.isLoading, seen, entityItems]);

  // Baseline any resolved entity we've never snapshotted — so freshly-followed
  // items read as "seen", and only genuine later growth flags as new.
  useEffect(() => {
    const toBaseline: Array<{
      kind: WatchKind;
      id: string;
      sig: WatchSignature;
    }> = [];
    for (const a of activities) {
      if (a.resolved && a.sig && !seen[`${a.item.kind}:${a.item.id}`])
        toBaseline.push({ kind: a.item.kind, id: a.item.id, sig: a.sig });
    }
    if (toBaseline.length > 0) markManySeen(toBaseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  const newCount = activities.filter((a) => a.isNew).length;
  const loading =
    (hasPerson && personQ.isLoading) || results.some((r) => r.isLoading);

  // Publish the count for the nav badge + overview digest to read without
  // fetching anything. Only once the data has settled, so the badge doesn't
  // flicker through a transient 0 while rollups load.
  useEffect(() => {
    if (!loading) setCachedNewCount(newCount);
  }, [loading, newCount]);

  if (items.length === 0) return EMPTY;
  return { activities, newCount, loading };
};

// A resolved-or-not activity skeleton with the new-vs-seen diff filled in.
function baseActivity(
  item: WatchItem,
  loading: boolean,
  sig: WatchSignature | null,
  seenSnap: WatchSignature | undefined,
): WatchActivity {
  let isNew = false;
  let deltaCount = 0;
  let deltaEur = 0;
  if (sig && seenSnap) {
    deltaCount = Math.max(0, sig.count - seenSnap.count);
    deltaEur = Math.max(0, sig.totalEur - seenSnap.totalEur);
    // A 1-cent rounding wobble shouldn't read as activity.
    isNew = deltaCount > 0 || deltaEur > 1;
  }
  return {
    item,
    loading,
    resolved: false,
    count: null,
    totalEur: null,
    latestDate: "",
    sig,
    isNew,
    deltaCount,
    deltaEur,
  };
}
