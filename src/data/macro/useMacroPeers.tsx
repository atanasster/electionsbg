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

// Annual peer point — used by SILC (Gini, S80/S20, AROPE), life expectancy,
// and any future indicator that only publishes annually. `period` is the
// year as a string ("YYYY") to keep the consumer interface symmetric with
// PeerQuarterlyPoint.period.
export type PeerAnnualPoint = {
  year: number;
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

// Annual variant of IndicatorDistribution. `quarter` is absent because the
// underlying series is yearly (SILC, demographics). `period` is "YYYY".
export type IndicatorDistributionAnnual = {
  period: string;
  year: number;
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

// Annual peer block — same shape as PeerIndicatorBlock but with an annual
// series and the annual distribution variant. Kept as a sibling type rather
// than a discriminated union so quarterly consumers (PeerSnapshotStrip,
// PeerSnapshotTable, GovernmentTimeline peer overlay) need no changes.
export type PeerIndicatorBlockAnnual = {
  cadence: "annual";
  sourceUrl: string;
  dataset: string;
  direction: "lower" | "higher" | "none";
  series: Partial<Record<PeerGeo, PeerAnnualPoint[]>>;
  latestDistribution: IndicatorDistributionAnnual | null;
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

// World Bank Worldwide Governance Indicators — six dimensions, one
// latest-year snapshot per (dimension, geo). EU27 average is computed
// client-side (the World Bank does not publish a regional aggregate) as
// the unweighted mean of the 27 member estimates and stored under the
// "EU27_2020" geo so the consumer interface mirrors the Eurostat blocks.
export const WGI_DIMENSIONS = [
  "VA", // Voice and Accountability
  "PV", // Political Stability and Absence of Violence/Terrorism
  "GE", // Government Effectiveness
  "RQ", // Regulatory Quality
  "RL", // Rule of Law
  "CC", // Control of Corruption
] as const;
export type WgiDimension = (typeof WGI_DIMENSIONS)[number];

export type WgiSnapshot = {
  year: number;
  // World Bank "Estimate" — approximately -2.5 (worst) to +2.5 (best),
  // with world mean ≈ 0 by construction.
  value: number;
  // World Bank "PercentileRank" — 0 (worst) to 100 (best). Surfaced as a
  // secondary scale option for the radar tile.
  percentile: number;
};

export type WgiBlock = {
  fetchedAt: string;
  latestYear: number;
  source: {
    name: string;
    url: string;
  };
  // Multi-year series per (dimension, geo). Sorted ascending by year so the
  // consumer can pick a target year (e.g. matching the selected election
  // cycle) and walk back to the latest available point ≤ that year.
  series: Partial<
    Record<WgiDimension, Partial<Record<PeerGeo, WgiSnapshot[]>>>
  >;
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
  // v3 — annual per-indicator peer series (SILC: gini, incomeQuintileRatio,
  // arope; demographics: lifeExpectancy). Added for the EU compare dashboard.
  indicatorsAnnual?: Record<string, PeerIndicatorBlockAnnual>;
  // v3 — World Bank WGI per-peer snapshot (6 dimensions × peer roster +
  // computed EU27 average). Powers the WGI radar tile on /indicators/compare.
  wgi?: WgiBlock;
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

// Annual-cadence sibling of usePeerIndicator. Returns the SILC / life-expectancy
// peer block for the requested key, or undefined.
export const usePeerIndicatorAnnual = (
  key: string,
): PeerIndicatorBlockAnnual | undefined => {
  const { data } = useMacroPeers();
  return data?.indicatorsAnnual?.[key];
};
