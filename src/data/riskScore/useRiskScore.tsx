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
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRiskScore = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["risk_score", selected],
    queryFn,
  });
};

// Single-section lookup. Used by SectionScreen and section-detail tiles
// to show the risk badge + per-signal breakdown. Section IDs begin with
// a 2-digit oblast prefix, so we fetch only the ~300–700 KB bucket the
// section belongs to (`risk_score/<prefix>.json`) instead of the full
// ~12 MB report.
const riskScoreByPrefixQueryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, string | null | undefined]
>): Promise<RiskScoreRow[] | null> => {
  if (!queryKey[1] || !queryKey[2]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/section/risk_score/${queryKey[2]}.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRiskScoreForSection = (sectionId?: string) => {
  const { selected } = useElectionContext();
  const prefix = sectionId ? sectionId.slice(0, 2) : undefined;
  const q = useQuery({
    queryKey: ["risk_score_prefix", selected, prefix] as [
      string,
      string | null | undefined,
      string | null | undefined,
    ],
    queryFn: riskScoreByPrefixQueryFn,
    enabled: !!sectionId && !!prefix,
  });
  const row = q.data?.find((r) => r.section === sectionId);
  return { ...q, row };
};

// Tiny summary (~few KB) — band counts + top critical sections. Used
// by the home-page risk tiles, the /risk-analysis hero, and the top-
// sections card so they don't pull the full ~12 MB rows array.
export type RiskScoreSummary = {
  election: string;
  generatedAt: string;
  signalsTotal: number;
  totalSections: number;
  counts: Record<RiskBand, number>;
  /** Sum of section votes per band — used by the composite for
   * vote-weighted section screening. */
  votesByBand: Record<RiskBand, number>;
  /** Sum of section votes across every row (the denominator for
   * vote-weighted section screening). */
  totalActualVoters: number;
  /** Machine votes in sections flagged as missing flash drive — used by
   * the composite's vote-weighted Missing Flash component. */
  missingFlashMachineVotes: number;
  topCritical: RiskScoreRow[];
};

const summaryQueryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<RiskScoreSummary | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/section/risk_score_summary.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRiskScoreSummary = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["risk_score_summary", selected],
    queryFn: summaryQueryFn,
  });
};
