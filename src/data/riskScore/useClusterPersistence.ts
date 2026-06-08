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

/** A flagged problem-section (Roma-махала) neighborhood a locus overlaps. */
export type ProblemNeighborhoodRef = {
  id: string;
  nameBg: string;
  nameEn: string;
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
  /** Member sections that also sit in a flagged problem-section
   * (Roma-махала) neighborhood. */
  problemSectionCount: number;
  /** The problem-section neighborhood most overlapping sections belong
   * to, when any do. */
  problemNeighborhood?: ProblemNeighborhoodRef;
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

// Slim section→locus membership for the section detail page — it only needs
// "is THIS section in a persistent locus, and its id + election count" to
// render one badge, not the full report (every locus's section list,
// appearances and centroid). See the reverse-index emitted by
// scripts/reports/cluster_persistence.ts.
export type ClusterMembership = { id: string; electionCount: number };

const membershipQueryFn = async (): Promise<Record<
  string,
  ClusterMembership
> | null> => {
  const response = await fetch(dataUrl(`/cluster_persistence_membership.json`));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useClusterMembership = (
  sectionCode?: string,
): ClusterMembership | undefined => {
  const { data } = useQuery({
    queryKey: ["cluster_persistence_membership"],
    queryFn: membershipQueryFn,
    retry: false,
  });
  return sectionCode ? (data?.[sectionCode] ?? undefined) : undefined;
};
