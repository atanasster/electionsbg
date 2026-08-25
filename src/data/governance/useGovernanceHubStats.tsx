// The /governance hub's figures — ONE blob for the KPI band AND every tile metric.
//
// This page made ZERO page-specific fetches and showed ZERO numbers before it existed: the
// first figure on the whole hub was a tile DESCRIPTION at 2 355 px. The rule it has to keep
// (dashboard-hub §1, §3.1 rule 3) is that it stays at exactly ONE fetch — folding the four
// sibling hubs' blobs client-side is four requests on the hub that had none, which
// docs/plans/hub-hero-v1.md §9.4 rules out. The fold happens in the GENERATOR
// (scripts/db/gen_governance/hub_stats.ts), at build time, where it costs a reader nothing.
//
// `undefined` is an ANSWER, not a loading state. A checkout that never ran the generator, and
// any tile whose source did not answer, renders descriptor-only — exactly as the hub did
// before. A zero would be a claim.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";

export interface GovTileStat {
  kind: "eur" | "count";
  value: number;
  /** An ENUM KEY, not prose — `governanceBasisLabel()` turns it into copy. */
  basis: string;
  year?: number;
  extra?: number;
  /** A YEAR the caption names beside `year` — today the seasonal anchor a forecast was scaled
   *  through, so „прогноза за 2026" is not a forecast from nowhere. ⚠️ Its own field rather
   *  than `extra`, which is rendered through `Intl.NumberFormat` and would print „2 025". */
  basisYear?: number;
}

export interface GovernanceHubStats {
  computedAt: string;
  tiles: Record<string, GovTileStat>;
  byNs: Record<string, Record<string, GovTileStat>>;
  /** Corpus sizes for the head's ranked list — figures deliberately NOT on any tile, so the
   *  head and the grid say two different things. `to` is minted by the generator from the
   *  destination's own path, scope included. */
  coverage: { id: string; value: number; to: string }[];
  sources: Record<string, boolean>;
}

const queryFn = async (): Promise<GovernanceHubStats | null> => {
  const r = await fetch(dataUrl("/governance/hub_stats.json"));
  if (!r.ok) return null;
  return r.json();
};

export const useGovernanceHubStats = (): {
  stats: GovernanceHubStats | undefined;
  /** Figure for a tile id, resolving the `?elections`-scoped ones through the SELECTED
   *  parliament. A link cannot clear the election (usePreserveParams carries it), so those
   *  tiles quote what their destination will actually open on — the other half of the
   *  hub-of-hubs rule in hub-hero-v1 §9.2. */
  tile: (id: string) => GovTileStat | undefined;
} => {
  const { data } = useQuery({
    queryKey: ["governance", "hub-stats"] as const,
    queryFn,
    staleTime: Infinity,
  });
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  return {
    stats: data ?? undefined,
    tile: (id) =>
      (ns ? data?.byNs?.[ns]?.[id] : undefined) ?? data?.tiles?.[id],
  };
};
