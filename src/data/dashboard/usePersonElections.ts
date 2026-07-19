// One person's electoral history re-keyed by person_id (person_election_stats via
// /api/db/person-elections) — the PG source for the merged dashboard's electoral block. Each
// row carries the RAW shard arrays so computeCandidateSummary runs over them unchanged
// (person-candidate-merge-v1). Replaces the name-folder shard fetch (useCandidateSummary) on
// the person page.

import { useQuery } from "@tanstack/react-query";
import { CandidateStatsYearly, PreferencesInfo } from "../dataTypes";

export type PersonElectionRow = {
  election: string;
  partyNum: number;
  totalVotes: number;
  regions: PreferencesInfo[];
  history: CandidateStatsYearly[];
  topSettlements: PreferencesInfo[];
  topSections: PreferencesInfo[];
};

export const usePersonElections = (slug?: string) =>
  useQuery({
    queryKey: ["person_elections", slug],
    queryFn: async (): Promise<PersonElectionRow[]> => {
      if (!slug) return [];
      const res = await fetch(
        `/api/db/person-elections?slug=${encodeURIComponent(slug)}`,
      );
      if (!res.ok) return [];
      return (await res.json()) as PersonElectionRow[];
    },
    enabled: !!slug,
    staleTime: Infinity,
  });
