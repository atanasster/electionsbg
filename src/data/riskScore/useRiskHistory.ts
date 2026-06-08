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

// One file per section (sections/risk_history/<sectionId>.json holding the
// chronological array) — the rap-sheet tile renders a single section, so it
// fetches ~1–2 KB instead of the whole oblast's ~1.6 MB bucket the earlier
// 2-digit-prefix layout forced. Sections with <2 elections have no file and
// 404 → null, which the tile reads as "nothing to show".
const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  RiskHistoryEntry[] | null
> => {
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
  const q = useQuery({
    queryKey: ["risk_history", sectionId] as [
      string,
      string | null | undefined,
    ],
    queryFn,
    enabled: !!sectionId,
    retry: false,
  });
  return { ...q, history: q.data ?? undefined };
};
