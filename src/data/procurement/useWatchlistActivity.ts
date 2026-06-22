// Live activity for the watchlist. For every followed entity it fetches the
// same rollup the entity page already uses (so the cache is shared) and
// normalises it into a comparable signature — contract count, total awarded,
// latest contract date — plus a few display fields (top counterparty). It then
// diffs that live signature against the per-item "last seen" snapshot to flag
// "new activity since you last looked", and baselines any entity we've never
// snapshotted (so following something doesn't immediately read as "new").
//
// Reused by the watchlist screen (cards + new-activity section), the unread
// badge on the procurement nav, and the overview digest tile.

import { useEffect, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  ProcurementContractorRollup,
  ProcurementAwarderRollup,
  ProcurementBySettlementFile,
  ProcurementContract,
  ProcurementRollupContractRow,
} from "@/data/dataTypes";
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

const urlFor = (it: WatchItem): string => {
  switch (it.kind) {
    case "company":
      return dataUrl(`/procurement/contractors/${it.id}.json`);
    case "awarder":
      return dataUrl(`/procurement/awarders/${it.id}.json`);
    case "place":
      return dataUrl(`/procurement/by_settlement/${it.id}.json`);
    case "contract":
      return dataUrl(`/procurement/contracts/by-id/${it.id}.json`);
    default:
      return "";
  }
};

const queryKeyFor = (it: WatchItem): readonly unknown[] => {
  switch (it.kind) {
    case "company":
      return ["procurement", "contractor", it.id];
    case "awarder":
      return ["procurement", "awarder", it.id];
    case "place":
      return ["procurement", "by_settlement", it.id];
    case "contract":
      return ["procurement", "contract", it.id];
    default:
      return ["procurement", "noop", it.id];
  }
};

const fetchEntity = async (it: WatchItem): Promise<unknown | null> => {
  const url = urlFor(it);
  if (!url) return null;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return r.json();
};

const maxDate = (rows?: ProcurementRollupContractRow[]): string => {
  if (!rows || rows.length === 0) return "";
  let m = "";
  for (const c of rows) if (c.date && c.date > m) m = c.date;
  return m;
};

// Person index (full corpus) — one shared file for all watched MPs.
type PersonRow = {
  kind: "mp" | "official";
  name: string;
  totalEur: number;
  contractCount: number;
  mpId?: number;
};
const fetchPersonIndex = async (): Promise<PersonRow[]> => {
  const r = await fetch(
    dataUrl("/procurement/derived/person_procurement_index.json"),
  );
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

  // Person rows come from one shared corpus index; everything else is a
  // per-entity rollup fetched in parallel via useQueries.
  const hasPerson = items.some((i) => i.kind === "person");
  const personQ = useQuery({
    queryKey: ["procurement", "person_index", "all"],
    queryFn: fetchPersonIndex,
    enabled: hasPerson,
    staleTime: Infinity,
  });

  const entityItems = items.filter((i) => i.kind !== "person");
  const results = useQueries({
    queries: entityItems.map((it) => ({
      queryKey: queryKeyFor(it),
      queryFn: () => fetchEntity(it),
      enabled: ID_OK[it.kind].test(it.id),
      staleTime: Infinity,
    })),
  });

  const activities = useMemo<WatchActivity[]>(() => {
    const byKey = new Map<string, (typeof results)[number]>();
    entityItems.forEach((it, idx) =>
      byKey.set(`${it.kind}:${it.id}`, results[idx]),
    );

    return items.map((item): WatchActivity => {
      const seenSnap = seen[`${item.kind}:${item.id}`];

      // --- person: look up the shared index row -----------------------------
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

      // --- entity kinds (company / awarder / place / contract) --------------
      const q = byKey.get(`${item.kind}:${item.id}`);
      const loading = !!q?.isLoading;
      const data = q?.data ?? null;
      if (!data) return baseActivity(item, loading, null, seenSnap);

      let count: number;
      let totalEur: number | null;
      let totalOther: Record<string, number> | undefined;
      let topName: string | undefined;
      let topEik: string | undefined;
      let topKind: "company" | "awarder" | undefined;
      let latestDate = "";

      if (item.kind === "company") {
        const d = data as ProcurementContractorRollup;
        count = d.contractCount;
        totalEur = d.totalEur;
        totalOther = d.totalOther;
        latestDate = maxDate(d.topContracts);
        const top = d.byAwarder?.[0];
        if (top) {
          topName = top.name;
          topEik = top.eik;
          topKind = "awarder";
        }
      } else if (item.kind === "awarder") {
        const d = data as ProcurementAwarderRollup;
        count = d.contractCount;
        totalEur = d.totalEur;
        totalOther = d.totalOther;
        latestDate = maxDate(d.topContracts);
        const top = d.byContractor?.[0];
        if (top) {
          topName = top.name;
          topEik = top.eik;
          topKind = "company";
        }
      } else if (item.kind === "place") {
        const d = data as ProcurementBySettlementFile;
        count = d.contractCount;
        totalEur = d.totalEur;
        totalOther = d.totalOther;
        latestDate = maxDate(d.topContracts);
        const top = d.awarders?.[0];
        if (top) {
          topName = top.name;
          topEik = top.eik;
          topKind = "awarder";
        }
      } else {
        // contract
        const d = data as ProcurementContract;
        count = 1;
        totalEur = d.amountEur ?? null;
        latestDate = d.dateSigned || d.date || "";
      }

      const sig: WatchSignature = {
        count,
        totalEur: totalEur ?? 0,
        latestDate,
      };
      const base = baseActivity(item, false, sig, seenSnap);
      return {
        ...base,
        resolved: true,
        count,
        totalEur,
        totalOther,
        latestDate,
        topName,
        topEik,
        topKind,
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
