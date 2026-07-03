// Risk-signals feed, DB-backed (/api/db/procurement-risk-feed →
// procurement_risk_feed): top single-supplier concentration pairs + top
// MP-tied contractor relationships + headline counts + per-oblast tally,
// scoped to the selected parliament window / year or the full corpus
// (?pscope). Shared by /procurement/flags and the dashboard's risk-signals
// preview tile. (Debarred suppliers stay a corpus register — no date
// dimension — and are fetched separately via useDebarred.)

import { useQuery } from "@tanstack/react-query";
import { useProcurementWindow } from "./useProcurementWindow";

export type RiskFeedFile = {
  topConcentration: Array<{
    awarderEik: string;
    awarderName: string;
    contractorEik: string;
    contractorName: string;
    sharePct: number;
    pairTotalEur: number;
  }>;
  topMpTied: Array<{
    mpId: number;
    mpName: string;
    contractorEik: string;
    contractorName: string;
    totalEur: number;
  }>;
  concentrationTotal?: number;
  concentration100Total?: number;
  mpTiedTotal?: number;
  connectedPeopleTotal?: number;
  concentrationByOblast?: Array<{ oblast: string; count: number }>;
  concentrationNationalCount?: number;
};

export const useRiskFeed = () => {
  const { from, to } = useProcurementWindow();
  return useQuery({
    queryKey: ["procurement", "risk_feed", from, to],
    queryFn: async (): Promise<RiskFeedFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/db/procurement-risk-feed?${qs.toString()}`);
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as RiskFeedFile;
    },
    staleTime: Infinity,
  });
};
