// Cross-cycle trends for the country/region dashboards. Fans out the regular
// _mi cycle `index_trends.json` sidecars (2011 → 2023, trimmed to just the
// `councilVoteShare` + `mayorsByCanonical` arrays) and joins them on the
// stable canonicalId so a tile can plot council vote share + mayoralties won
// per party over time. Local-only party buckets (`local:*`) appear/disappear
// between cycles — the consumer selects the top parties by the latest cycle,
// which naturally surfaces the lineage parties (ГЕРБ, БСП, ДПС, …).
//
// Fetches the trimmed sidecars rather than the full index.json (which carries
// a ~265-row `municipalities` catalogue the trends tile never reads).

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { LocalElectionIndex } from "./types";
import {
  CrossCycleData,
  CrossCycleParty,
  bucketId,
  yearOf,
} from "./crossCycleShape";

// Subset of LocalElectionIndex that the trends sidecar carries — no
// `municipalities` catalogue.
type LocalIndexTrends = Pick<
  LocalElectionIndex,
  | "cycle"
  | "round1Date"
  | "round2Date"
  | "councilVoteShare"
  | "mayorsByCanonical"
>;
import { useLocalElectionList } from "./useLocalCycles";

export type {
  CrossCyclePoint,
  CrossCycleParty,
  CrossCycleData,
} from "./crossCycleShape";

const fetchIndex = async (
  cycle: string,
): Promise<LocalIndexTrends | undefined> => {
  const r = await fetch(dataUrl(`/${cycle}/index_trends.json`));
  if (r.status === 404) return undefined;
  if (!r.ok)
    throw new Error(`local index_trends fetch failed: ${r.status} ${r.url}`);
  return r.json();
};

export const useLocalCrossCycle = (
  topN = 6,
): { data?: CrossCycleData; isLoading: boolean } => {
  const list = useLocalElectionList();
  const cyclesAsc = useMemo(
    () =>
      [...list]
        .sort((a, b) => a.round1Date.localeCompare(b.round1Date))
        .map((e) => ({ cycle: e.name, year: yearOf(e.round1Date) })),
    [list],
  );

  const queries = useQueries({
    queries: cyclesAsc.map((e) => ({
      queryKey: ["local_index_trends", e.cycle],
      queryFn: () => fetchIndex(e.cycle),
      staleTime: Infinity,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const indexes = queries.map((q) => q.data);

  const data = useMemo<CrossCycleData | undefined>(() => {
    const loaded = indexes.filter((x): x is LocalIndexTrends => !!x);
    if (loaded.length === 0) return undefined;

    // canonicalId → { meta, per-cycle council pct + mayors }
    type Acc = {
      displayName: string;
      color: string;
      council: Map<string, number>;
      votes: Map<string, number>;
      mayors: Map<string, number>;
    };
    const byId = new Map<string, Acc>();
    const ensure = (id: string, displayName: string, color: string): Acc => {
      let a = byId.get(id);
      if (!a) {
        a = {
          displayName,
          color,
          council: new Map(),
          votes: new Map(),
          mayors: new Map(),
        };
        byId.set(id, a);
      }
      return a;
    };

    // Cycles where the index has no usable council totals (e.g. 2015's bundles
    // currently ship 0-vote council rows) would otherwise drag every party's
    // line to 0; skip them entirely so the chart shows a gap, not a false dip.
    const cycleHasCouncilSignal = (idx: LocalIndexTrends): boolean =>
      idx.councilVoteShare.some((r) => r.pctOfValid > 0 || r.totalVotes > 0);

    for (let i = 0; i < cyclesAsc.length; i++) {
      const idx = indexes[i];
      if (!idx) continue;
      const cycle = cyclesAsc[i].cycle;
      const usableCouncil = cycleHasCouncilSignal(idx);
      if (usableCouncil) {
        for (const r of idx.councilVoteShare) {
          const id = bucketId(r.canonicalId, r.displayName);
          // Prefer canonical display name/color when aliasing into a canonical
          // bucket — the local-row displayName is the raw uppercase party name.
          const isAlias = id !== r.canonicalId;
          const a = ensure(
            id,
            isAlias ? "" : r.displayName,
            isAlias ? "" : r.color,
          );
          // Sum in case two local-only rows alias to the same canonical id.
          a.council.set(cycle, (a.council.get(cycle) ?? 0) + r.pctOfValid);
          a.votes.set(cycle, (a.votes.get(cycle) ?? 0) + r.totalVotes);
          if (!isAlias && !a.displayName) a.displayName = r.displayName;
          if (!isAlias && !a.color) a.color = r.color;
        }
      }
      for (const r of idx.mayorsByCanonical) {
        const id = bucketId(r.canonicalId, r.displayName);
        const isAlias = id !== r.canonicalId;
        const a = ensure(
          id,
          isAlias ? "" : r.displayName,
          isAlias ? "" : r.color,
        );
        a.mayors.set(cycle, (a.mayors.get(cycle) ?? 0) + r.count);
        if (!isAlias && !a.displayName) a.displayName = r.displayName;
        if (!isAlias && !a.color) a.color = r.color;
      }
    }

    // Fill in any aliased buckets that never saw the canonical id directly —
    // give them a default displayName/color from the latest party metadata.
    for (const a of byId.values()) {
      if (!a.displayName) a.displayName = "—";
      if (!a.color) a.color = "#9CA3AF";
    }

    const latestCycle = cyclesAsc[cyclesAsc.length - 1]?.cycle;
    const parties: CrossCycleParty[] = Array.from(byId.entries()).map(
      ([canonicalId, a]) => ({
        canonicalId,
        displayName: a.displayName,
        color: a.color,
        latestCouncilPct: (latestCycle && a.council.get(latestCycle)) || 0,
        points: cyclesAsc.map((c) => ({
          cycle: c.cycle,
          year: c.year,
          councilPct: a.council.has(c.cycle)
            ? (a.council.get(c.cycle) ?? null)
            : null,
          mayors: a.mayors.has(c.cycle)
            ? (a.mayors.get(c.cycle) ?? null)
            : null,
          votes: a.votes.get(c.cycle) ?? null,
        })),
      }),
    );

    // Rank by latest council share, then by peak share so a party that faded
    // out (e.g. a once-large coalition) can still make the cut.
    parties.sort((x, y) => {
      if (y.latestCouncilPct !== x.latestCouncilPct)
        return y.latestCouncilPct - x.latestCouncilPct;
      const peak = (p: CrossCycleParty) =>
        Math.max(0, ...p.points.map((pt) => pt.councilPct ?? 0));
      return peak(y) - peak(x);
    });

    return { cyclesAsc, parties: parties.slice(0, topN) };
  }, [indexes, cyclesAsc, topN]);

  return { data, isLoading };
};
