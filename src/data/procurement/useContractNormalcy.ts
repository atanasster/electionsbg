// "How normal is this procurement?" — fetches the cohort-distribution card for
// one contract (/api/db/procurement-normalcy → procurement_normalcy(), migration
// 063). Descriptive context (percentiles vs similar procurements), the ex-post
// companion to the per-contract CRI. null when the contract has no comparable
// data or the migration hasn't reached this DB.

import { useQuery } from "@tanstack/react-query";

/** Risk-tail direction for a metric: which way is "weaker competition". */
export type NormalcyDir = "low" | "high" | "neutral";

/** A numeric metric positioned in its cohort. `percentile` = share of the cohort
 *  strictly below `value`, 0..1. */
export type NormalcyMetric = {
  dir: NormalcyDir;
  value: number;
  n: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  percentile: number;
};

export type NormalcyBidders = NormalcyMetric & {
  /** Share of the cohort that was single-bidder, 0..1 (competition context). */
  singleShare: number;
  singleBidder: boolean;
};

export type NormalcyProcedure = {
  /** procedureBucket of this contract (open | direct | competition | …). */
  bucket: string;
  isOpen: boolean;
  /** Share of the cohort that ran an OPEN procedure, 0..1. */
  openShare: number;
  n: number;
};

export type NormalcyConcentration = {
  dir: "high";
  /** This supplier's share of the buyer's contracted spend, 0..1. */
  value: number;
  /** Number of distinct suppliers this buyer has. */
  peerN: number;
  median: number;
  p75: number;
  p90: number;
  percentile: number;
};

export type NormalcyCohort = {
  division: string;
  cpvPrefix: string;
  cpvLen: number;
  n: number;
  yearFrom: string;
  yearTo: string;
  sufficient: boolean;
};

export type ContractNormalcy = {
  key: string;
  cohort: NormalcyCohort | null;
  value: NormalcyMetric | null;
  bidders: NormalcyBidders | null;
  procedure: NormalcyProcedure | null;
  concentration: NormalcyConcentration | null;
};

const fetchContractNormalcy = async (
  key: string,
): Promise<ContractNormalcy | null> => {
  const r = await fetch(
    `/api/db/procurement-normalcy?key=${encodeURIComponent(key)}`,
  );
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as ContractNormalcy | null;
};

export const useContractNormalcy = (key?: string | null) =>
  useQuery({
    queryKey: ["procurement", "normalcy", key] as const,
    queryFn: () => fetchContractNormalcy(key as string),
    enabled: !!key && /^[0-9a-f]{12}$/.test(key),
    staleTime: Infinity,
  });
