import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { RiskBand } from "./useRiskScore";

// Cross-election section "rap sheet" — see scripts/reports/risk_history.ts
// for how the artifact is built. One chronological record per section,
// joining turnout + winner + winner-share with the risk SCREENING score.
// A VIEW over published data; it makes no fraud claim.

/** One election's row in a section's risk history. Risk fields are
 * undefined when no screening signal fired that cycle (a clean cycle). */
export type RiskHistoryEntry = {
  election: string;
  turnoutPct: number;
  winnerPartyNum?: number;
  winnerNickName?: string;
  winnerColor?: string;
  winnerSharePct?: number;
  score?: number;
  band?: RiskBand;
  signalsAvailable?: number;
  signalsTotal?: number;
};

// Sections are partitioned by 2-digit oblast prefix. Fetch only the
// bucket the section belongs to — matching useRiskScoreForSection.
type RiskHistoryBucket = Record<string, RiskHistoryEntry[]>;

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<RiskHistoryBucket | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/sections/risk_history/${queryKey[1]}.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRiskHistory = (sectionId?: string) => {
  const prefix = sectionId ? sectionId.slice(0, 2) : undefined;
  const q = useQuery({
    queryKey: ["risk_history", prefix] as [string, string | null | undefined],
    queryFn,
    enabled: !!prefix,
  });
  const history = sectionId ? q.data?.[sectionId] : undefined;
  return { ...q, history };
};
