// One person's electoral history re-keyed by person_id (person_election_stats via
// /api/db/person-elections) — the PG source for the merged dashboard's electoral block. Each
// row carries the RAW shard arrays so computeCandidateSummary runs over them unchanged
// (person-candidate-merge-v1). Replaces the name-folder shard fetch (useCandidateSummary) on
// the person page.

import { useMemo } from "react";
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

// A row "counts" only when the person actually ran with results — a roster-only candidacy
// (an mp-{id} shard with no preference folder) has empty regions and zero votes.
export const hasElectionResults = (r: PersonElectionRow): boolean =>
  (r.regions?.length ?? 0) > 0 || r.totalVotes > 0;

// Cycles with results, newest first. Pure (testable) — the hook below just memoizes it.
export const personDataCycles = (rows: PersonElectionRow[]): string[] =>
  rows
    .filter(hasElectionResults)
    .map((r) => r.election)
    .sort((a, b) => b.localeCompare(a));

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

// Is the electoral block still UNDECIDED — i.e. can it still turn out to render nothing?
// True only while the person-elections fetch is in flight for someone we EXPECT results for
// (they hold a candidacy role). The block reserves its ~1450px footprint with a skeleton
// while this is true, so the dashboard below it must hold back for exactly as long: a
// candidacy role whose person_election_stats row is missing (a roster-only candidacy, or a
// cloud reload mid-flight) resolves to NO block, and a reserved 1450px collapsing under
// already-painted sections is a 0.32 CLS — three times the budget the perf gate enforces.
// One hook so the two conditions cannot drift apart.
export const usePersonElectoralPending = (
  slug: string | undefined,
  hasCandidacies: boolean,
): boolean => {
  const { isLoading } = usePersonElections(slug);
  return hasCandidacies && isLoading;
};

// The person's cycles that carry actual results, newest first — the single source of truth for
// the header party badge (dataCycles[0]) and the electoral cycle selector (the full list). Both
// read this so "what counts as a real candidacy" can't drift between them.
export const usePersonDataCycles = (
  slug?: string,
): { rows: PersonElectionRow[]; dataCycles: string[]; isLoading: boolean } => {
  const { data, isLoading } = usePersonElections(slug);
  const dataCycles = useMemo(() => personDataCycles(data ?? []), [data]);
  return { rows: data ?? [], dataCycles, isLoading };
};
