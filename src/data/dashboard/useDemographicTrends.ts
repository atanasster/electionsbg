import { useQuery } from "@tanstack/react-query";
import type { CensusMetric } from "../census/censusTypes";
import { dataUrl } from "@/data/dataUrl";

// One point in a party's demographic-trend series — its Pearson r against each
// demographic in a single election. `rs` is aligned to the payload's `metrics`
// order; `pctNational` (0..100) sizes the bubble by salience.
export type DemographicTrendPoint = {
  election: string;
  pctNational: number;
  rs: number[];
};

export type DemographicTrendParty = {
  canonicalId: string;
  nickName: string;
  nickName_en?: string;
  color?: string;
  // Oldest → newest, only the elections this lineage actually ran in.
  points: DemographicTrendPoint[];
};

export type DemographicTrendsPayload = {
  // Election names (YYYY_MM_DD) present across the series, oldest → newest.
  elections: string[];
  // The demographic axis order that every party's `rs` array is aligned to.
  metrics: CensusMetric[];
  parties: DemographicTrendParty[];
};

// Loads the precomputed cross-election demographic-trends artifact written by
// scripts/parties/build_demographics.ts. A single ~20KB fetch covers every
// election, so — unlike the per-election cleavages hook — it is not keyed on
// the selected election.
export const useDemographicTrends = () =>
  useQuery({
    queryKey: ["demographic_trends"],
    queryFn: async (): Promise<DemographicTrendsPayload | undefined> => {
      const res = await fetch(dataUrl(`/party_demographic_trends.json`));
      if (!res.ok) return undefined;
      return (await res.json()) as DemographicTrendsPayload;
    },
  });
