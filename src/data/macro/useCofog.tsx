import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Top-level COFOG-99 functions plus the rolled-up TOTAL the dataset emits.
// Matches scripts/macro/fetch_cofog.ts.
export const COFOG_CODES = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
  "TOTAL",
] as const;
export type CofogCode = (typeof COFOG_CODES)[number];

// Pre-filtered list of just the 10 function codes (excludes TOTAL) for tile
// rendering — TOTAL is the denominator, not a renderable slice.
export const COFOG_FUNCTIONS: ReadonlyArray<Exclude<CofogCode, "TOTAL">> = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
];

export type CofogPoint = { year: number; valueEur: number };

// Peer-band summary per top-level function. Built by the fetcher from
// Eurostat's PC_GDP grain across the 27 EU member states + the EU27 aggregate.
// `rank` is 1-indexed where 1 = highest spender as % of GDP; `total` is the
// count of member states that reported a value at `year`.
export type CofogPeerBand = {
  year: number;
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
  // The highest-spending EU member state at `year` (rank 1): geo code + its
  // % of GDP. null when Bulgaria is itself #1. Emitted by fetch_cofog.ts.
  top?: { geo: string; pctGdp: number } | null;
};

// Per-peer COFOG % of GDP composition at a given year. Keyed first by peer
// geo (BG, EU27_2020, RO, GR, HU, HR), then by COFOG code. The dashboard
// can hold any of the years emitted in `peerSeriesByYear`.
export type CofogPeerComposition = Partial<
  Record<string, Partial<Record<Exclude<CofogCode, "TOTAL">, number>>>
>;

export type CofogPayload = {
  fetchedAt: string;
  source: {
    name: string;
    dataset: string;
    url: string;
    unit: string;
    sector: string;
    filters: Record<string, string>;
    peerFilters?: Record<string, string | string[]>;
  };
  cofogTopLevel: CofogCode[];
  latestYear: number;
  series: Record<CofogCode, CofogPoint[]>;
  peers?: Partial<Record<CofogCode, CofogPeerBand>>;
  // v3 — per-year, per-peer composition for the EU compare dashboard so the
  // user can pick a year matching the selected election cycle. Keyed by
  // year-as-string ("2024", "2023", ...). `peerSeriesLatestYear` is a
  // convenience pointer to the highest available year.
  peerSeriesByYear?: Record<string, CofogPeerComposition>;
  peerSeriesLatestYear?: number;
};

export const useCofog = () =>
  useQuery({
    queryKey: ["cofog"],
    queryFn: async (): Promise<CofogPayload | undefined> => {
      const res = await fetch(dataUrl("/cofog.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as CofogPayload;
    },
    staleTime: Infinity,
  });
