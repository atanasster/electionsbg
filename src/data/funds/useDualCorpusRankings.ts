// Cross-corpus leaderboard — companies that appear in BOTH the procurement
// (ЗОП/АОП) and EU-funds (ИСУН) corpora, ranked by combined public money.
// DB-backed (/api/db/dual-corpus-rankings → dual_corpus_rankings(), served from
// the load-time cache matview 077). All-time only: funds are EUR-native lifetime
// totals that carry no date window, so unlike the procurement leaderboards this
// one is not ?pscope-scoped. Resolves to null on a non-OK response, like every
// sibling consolidated-payload hook.

import { useQuery } from "@tanstack/react-query";

export type DualCorpusRow = {
  eik: string;
  name: string;
  orgType: string | null;
  procurementEur: number;
  procurementCount: number;
  fundsContractedEur: number;
  fundsPaidEur: number;
  fundsProjects: number;
  combinedEur: number;
  mpTied: boolean;
  mpIds: number[];
};

export type DualCorpusRankings = {
  companyCount: number;
  combinedEur: number;
  procurementEur: number;
  fundsContractedEur: number;
  fundsPaidEur: number;
  mpTiedCount: number;
  rows: DualCorpusRow[];
};

export const fetchDualCorpusRankings =
  async (): Promise<DualCorpusRankings | null> => {
    const r = await fetch("/api/db/dual-corpus-rankings");
    if (!r.ok) return null;
    return (await r.json()) as DualCorpusRankings;
  };

export const useDualCorpusRankings = () =>
  useQuery({
    queryKey: ["db", "dual-corpus-rankings"] as const,
    queryFn: fetchDualCorpusRankings,
    staleTime: Infinity,
    retry: false,
  });
