import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";

// Section-level risk SCREENING score — see scripts/reports/risk_score.ts
// for the full methodology + framing.

export type RiskBand = "low" | "elevated" | "high" | "critical";

export type RiskComponentId =
  | "recount"
  | "suemgMismatch"
  | "invalidBallots"
  | "additionalVoters"
  | "concentrated"
  | "peerOutlier";

export type RiskComponent = {
  id: RiskComponentId;
  rawValue?: number;
  normalized: number;
  weight: number;
  contribution: number;
};

export type RiskScoreRow = {
  section: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  /** Section winner — for the standard ПАРТИЯ/ГЛАСОВЕ/% columns. */
  partyNum?: number;
  totalVotes?: number;
  pctPartyVote?: number;
  /** Party affected by a party-specific risk signal (recount / SUEMG)
   * and its signed vote change. Undefined when no party-specific
   * signal fired. */
  affectedPartyNum?: number;
  affectedPartyChange?: number;
  score: number;
  band: RiskBand;
  signalsAvailable: number;
  signalsTotal: number;
  components: RiskComponent[];
  neighborhoodFlag?: boolean;
  percentileInMunicipality?: number;
};

export type RiskScoreReport = {
  election: string;
  generatedAt: string;
  signalsTotal: number;
  weights: Record<RiskComponentId, number>;
  caps: Record<string, number>;
  rows: RiskScoreRow[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<RiskScoreReport | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/section/risk_score.json`),
  );
  if (!response.ok) return null;
  return response.json();
};

export const useRiskScore = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["risk_score", selected],
    queryFn,
  });
};

// Single-section lookup. Used by SectionScreen to show the risk badge.
// Re-uses the same query (one fetch per election, cached) and just
// filters client-side.
export const useRiskScoreForSection = (sectionId?: string) => {
  const q = useRiskScore();
  const row = q.data?.rows.find((r) => r.section === sectionId);
  return { ...q, row };
};
