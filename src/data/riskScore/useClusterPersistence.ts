import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { RiskBand } from "./useRiskScore";

// Cross-election cluster persistence — see
// scripts/reports/cluster_persistence.ts for how the artifact is built.
// A persistent locus is a geographic knot of adjacent same-party
// sections that clustered (screened elevated-or-above as a bloc) in two
// or more elections. NOT election-scoped — one file covers all cycles.
// A VIEW over the published risk clusters; it makes no fraud claim.

/** One election in which a locus clustered. */
export type ClusterAppearance = {
  election: string;
  partyNum?: number;
  winnerNickName?: string;
  winnerColor?: string;
  sectionCount: number;
  maxBand: RiskBand;
  maxScore: number;
};

/** A geographic knot that clustered in two or more elections. */
export type PersistentLocus = {
  id: string;
  /** Distinct elections the locus clustered in — its "persistence". */
  electionCount: number;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  centroid: { lat: number; lng: number };
  sectionCount: number;
  sections: string[];
  /** Chronological — one entry per election. */
  appearances: ClusterAppearance[];
  maxScore: number;
  maxBand: RiskBand;
};

export type ClusterPersistenceReport = {
  generatedAt: string;
  minSharedSections: number;
  loci: PersistentLocus[];
};

const queryFn = async (): Promise<ClusterPersistenceReport | null> => {
  const response = await fetch(dataUrl(`/cluster_persistence.json`));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useClusterPersistence = () => {
  return useQuery({
    queryKey: ["cluster_persistence"],
    queryFn,
  });
};
