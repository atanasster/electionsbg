// The /budget hub's single stat call.
//
// One ~1 KB fetch replaces the 1,202 KB across four eager requests the hub used
// to make — of which macro_peers.json alone was 794 KB, read for three scalars.
// Those three now ride in `peerBands` here.
//
// Plan: docs/plans/budget-hub-v1.md §6.3 / T4.

import { useQuery } from "@tanstack/react-query";

export interface BudgetPeerBand {
  year: number;
  bgPctGdp: number | null;
  euAvgPctGdp: number | null;
  rank: number | null;
  total: number | null;
}

/** Every money key names its BASIS. `expenditureEur` would let a consumer pick
 *  executed or projected by accident — the defect the plan's §2.1 is about. */
export interface BudgetHubStats {
  fiscalYear: number;
  asOf: string | null;
  complete: boolean;
  /** Monthly КФП observations CAPTURED — NOT the months the figures cover.
   *  FY2021 is 6 with complete: true, because the feed is cumulative and its
   *  December row is the whole year. Never render this as coverage. */
  monthsAvailable: number;
  gdpEur: number | null;
  revenueExecutedEur: number | null;
  revenueProjectedEur: number | null;
  expenditureExecutedEur: number | null;
  expenditureProjectedEur: number | null;
  euContributionExecutedEur: number | null;
  balanceExecutedEur: number | null;
  balanceProjectedEur: number | null;
  spendingUnitCount: number | null;
  /** Always rendered beside spendingUnitCount. A variance ranking without its
   *  denominator asserts it ranks the government's ministries; it covers 8 of
   *  48 in the best year and none in six of nine. */
  varianceCoveredUnits: number | null;
  programCount: number | null;
  /** ALL YEARS — documents span the corpus and one belongs to no fiscal year. */
  documentCountAllYears: number | null;
  obsCategoriesPresent: number | null;
  /** The LAW's чл. 53 envelope — an appropriation, not money paid out. */
  muniTransferPlannedEur: number | null;
  /** Year-scoped, like every count here. `ipopLatestYear` is what a tile shows
   *  when this is 0, so a year the programme does not cover reads as „ИПОП е за
   *  2025" rather than as „the programme stopped". */
  ipopProjectCount: number | null;
  ipopStalledCount: number | null;
  ipopLatestYear: number | null;
  /** 26 of 265, and NOT „oblast centres" — six of them are not. A caption over
   *  this names the count, never the category. */
  capitalMunicipalityCount: number | null;
  capitalLatestYear: number | null;
  latestKfpPeriod: string | null;
  latestDocumentOn: string | null;
  wireSource: string;
  yearsAvailable: number[] | null;
  /** COFOG's OWN coverage — 2010-2024, NOT `yearsAvailable`, which reaches 2026
   *  because the КФП feed does. A year picker on /budget/functional built from
   *  the wrong list opens on a year with no breakdown. */
  cofogYears?: number[] | null;
  /** The чл. 53 transfer table's OWN coverage — 2018-2026, wider than
   *  `yearsAvailable` (2021-2026, the КФП feed). */
  muniYears?: number[] | null;
  /** The ten COFOG functional shares, summing to 100, for the hub's tax
   *  receipt. ⚠️ S13 — the WHOLE general-government sector, a DIFFERENT
   *  perimeter from `expenditureExecutedEur` on the same object. Keyed on
   *  COFOG's own latest year, which trails the КФП feed by two. */
  cofogShares?: { code: string; pct: number | null }[] | null;
  /** The national municipal-commitments line (plan §8.4). NULL when migration
   *  149 has never run on this database — the hub then shows no line, never a
   *  zero. ⚠️ Its own object on purpose: municipal liabilities are a DIFFERENT
   *  debtor from the state, so this must never be summed with
   *  `balanceExecutedEur`, nor with the чл. 53 transfers, which are money the
   *  state SENDS rather than money municipalities OWE.
   *
   *  The quarter is the latest one that actually carries the figure, which is
   *  often not the latest quarter: МФ freezes the column and the ingest
   *  withholds it rather than carrying it forward. */
  municipalCommitments?: {
    fiscalYear: number;
    quarter: number;
    commitmentsEur: number | null;
    arrearsEur: number | null;
    /** Of `municipalityCount`. A national total over a partial roster is a
     *  smaller number pretending to be a complete one. */
    filedCount: number;
    municipalityCount: number;
  } | null;
  peerBands: Record<string, BudgetPeerBand> | null;
}

/** null on ANY failure, including a thrown one — `!res.ok` alone leaves React
 *  Query settling with `undefined`, so a fallback gated on `=== null` would be
 *  unreachable. */
const fetchHubStats = async (fy?: number): Promise<BudgetHubStats | null> => {
  try {
    // A RELATIVE url — /api/db is the Cloud Function, not the GCS bucket, so no
    // dataUrl(). Same idiom as useBudget.tsx's fetchDb.
    const res = await fetch(`/api/db/budget-hub-stats${fy ? `?fy=${fy}` : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as BudgetHubStats | null;
  } catch {
    return null;
  }
};

export const useBudgetHubStats = (fy?: number) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-hub-stats", fy ?? "latest"],
    queryFn: () => fetchHubStats(fy),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { stats: data ?? null, isLoading };
};
