import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import type { RiskBand } from "./useRiskScore";

// Risk clusters — a geographic VIEW over the section risk scores (see
// scripts/reports/risk_score.ts). A cluster is a knot of physically
// adjacent sections that all screen elevated-or-above and were won by the
// same party — the fingerprint of a controlled / corporate-vote bloc.
// Not a new signal: it does not feed the 0–100 score.

/** One detected cluster. */
export type RiskCluster = {
  id: string;
  ekatte?: string;
  oblast?: string;
  obshtina?: string;
  partyNum?: number;
  sectionCount: number;
  sections: string[];
  meanScore: number;
  maxScore: number;
  maxBand: RiskBand;
  centroid: { lat: number; lng: number };
};

/** One map marker — an elevated-or-above section with coordinates.
 * `clusterId` is set when the section belongs to a detected cluster. */
export type RiskMapSection = {
  section: string;
  lat: number;
  lng: number;
  band: RiskBand;
  score: number;
  partyNum?: number;
  ekatte?: string;
  clusterId?: string;
};

export type RiskClustersReport = {
  election: string;
  generatedAt: string;
  thresholds: {
    minSections: number;
    maxDistanceMeters: number;
    minBand: RiskBand;
  };
  clusters: RiskCluster[];
  mapSections: RiskMapSection[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<RiskClustersReport | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/section/risk_clusters.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRiskClusters = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["risk_clusters", selected],
    queryFn,
  });
};
