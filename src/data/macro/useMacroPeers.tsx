import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Peer roster for the IndicatorsScreen overlay + Budget peer comparison tile.
// Eurostat fetches Greece under "EL" but the script rewrites to "GR" on the
// way out so the client only ever sees ISO codes.
export type PeerGeo = "BG" | "EU27_2020" | "RO" | "GR" | "HU" | "HR";
export type PeerMetric = "TR" | "TE" | "B9";

export type PeerPoint = { year: number; value: number };

// Quarterly peer point for the per-indicator series. Mirrors macro.json's
// quarterly shape so consumers can hand the array straight to a chart that
// already knows how to render BG points.
export type PeerQuarterlyPoint = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  period: string;
  value: number;
};

// Per-indicator latest-quarter snapshot for the 27-member EU distribution.
// Drives the "rank N/27" pill on the snapshot strip; only present for
// indicators where the "better" direction is unambiguous (inflation, debt,
// unemployment → lower; GDP growth, balance → higher).
export type IndicatorDistribution = {
  period: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  bgValue: number;
  euAverage: number | null;
  rank: number;
  total: number;
  direction: "lower" | "higher";
};

// Per-indicator peer block. `series[geo]` is the quarterly time series for
// each peer; `latestDistribution` is the rank snapshot (null if rank doesn't
// make sense for the indicator).
export type PeerIndicatorBlock = {
  cadence: "quarterly";
  sourceUrl: string;
  dataset: string;
  direction: "lower" | "higher" | "none";
  series: Partial<Record<PeerGeo, PeerQuarterlyPoint[]>>;
  latestDistribution: IndicatorDistribution | null;
};

// Peer-band per naItem built from the full 27-member EU distribution. Pinned
// to the latest year where BG and ≥20 peers report. Powers the
// budget-screen headline-card chips.
export type PeerBand = {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
};

export type MacroPeersPayload = {
  fetchedAt: string;
  source: {
    name: string;
    dataset: string;
    url: string;
    unit: string;
    sector: string;
    filters: Record<string, string>;
  };
  geos: PeerGeo[];
  naItems: PeerMetric[];
  latestYear: number;
  // Legacy gov_10a_main pivot (annual % GDP) — used by BudgetPeerComparisonTile
  series: Record<PeerGeo, Record<PeerMetric, PeerPoint[]>>;
  distribution?: Partial<Record<PeerMetric, PeerBand>>;
  // v2 — per-indicator quarterly peer series, populated since the
  // IndicatorsScreen peer-overlay rollout. Keys mirror macro.json indicator
  // keys (inflation, gdpGrowth, unemployment, govDebt, budgetBalance,
  // currentAccount, housePricesYoY, youthUnemployment).
  indicators?: Record<string, PeerIndicatorBlock>;
};

export const useMacroPeers = () =>
  useQuery({
    queryKey: ["macro_peers"],
    queryFn: async (): Promise<MacroPeersPayload | undefined> => {
      const res = await fetch(dataUrl("/macro_peers.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as MacroPeersPayload;
    },
  });

// Convenience hook: returns the per-indicator peer block, or undefined if the
// peers payload is loading / missing / has no entry for this key. Sized for a
// drop-in into the IndicatorsScreen sections without per-call destructuring.
export const usePeerIndicator = (
  key: string,
): PeerIndicatorBlock | undefined => {
  const { data } = useMacroPeers();
  return data?.indicators?.[key];
};
