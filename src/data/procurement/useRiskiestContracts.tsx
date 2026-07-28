// Top contracts by number of fired risk checks — the contract-grain sibling of
// useAwarderRiskTop (which ranks BUYERS). Reads the generic /api/db/table
// engine against the server-side index (contract_risk_cache, migration 112), so
// the ranking is over the WHOLE corpus rather than a loaded page.
//
// ⚠️ Orders by `risk_fired`, not `risk_cri`. The CRI divides by a denominator
// that varies 7..11, so it is only almost monotone in the fired count — a
// 4-of-11 contract scores 36 and a 3-of-8 scores 38. For a "most-flagged"
// board that inversion would be visible and wrong, so the count leads and the
// CRI is only the tiebreak.

import { useQuery } from "@tanstack/react-query";
import type { RiskGradeLetter } from "@/lib/riskGrade";

export type RiskiestContract = {
  key: string;
  date?: string;
  awarderName?: string;
  contractorName?: string;
  title?: string;
  amountEur?: number;
  riskFired?: number;
  riskAvailable?: number;
  riskCri?: number;
  riskGrade?: RiskGradeLetter;
  riskFiredMask?: number;
};

const fetchRiskiest = async (limit: number): Promise<RiskiestContract[]> => {
  const req = {
    resource: "contracts",
    fixedFilters: [{ id: "tag", value: ["contract"] }],
    // Only the elevated tail is worth a leaderboard: D and worse is 3+ fired
    // checks, ~0.84% of the corpus.
    filters: { columns: [{ id: "risk_grade", value: ["D", "E", "F"] }] },
    sort: [
      ["risk_fired", "desc"],
      ["risk_cri", "desc"],
    ],
    pageSize: limit,
  };
  const res = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  if (!res.ok) throw new Error(`riskiest contracts: ${res.status}`);
  const json = (await res.json()) as { rows?: RiskiestContract[] };
  return json.rows ?? [];
};

export const useRiskiestContracts = (limit = 8) =>
  useQuery({
    queryKey: ["riskiest-contracts", limit],
    queryFn: () => fetchRiskiest(limit),
    staleTime: Infinity,
    retry: false,
  });
