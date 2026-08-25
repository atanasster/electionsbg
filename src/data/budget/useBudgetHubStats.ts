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
  /** ⚠️ NOT ALWAYS MEASURED. Eurostat publishes a year ~18 months late, so
   *  `buildGdpByYear` extrapolates the in-progress year from the geometric mean
   *  of the last three YoY rates. `projectionBasisYear != null` is the tell: the
   *  same years that need a projected numerator have an extrapolated denominator.
   *  ⚠️ Perimeter is the КФП state budget, NOT the ESA general government that
   *  `peerBands` and /budget/execution use — they differ by ~18 points of GDP. */
  gdpEur: number | null;
  revenueExecutedEur: number | null;
  /** МФ's OWN budget-law column off the КФП report — what the Assembly
   *  appropriated. NULL until МФ publishes it, which for a running year it
   *  often has not. ⚠️ NOT interchangeable with `revenueProjectedEur`. */
  revenuePlannedEur: number | null;
  /** OURS: this year's actuals scaled through `projectionBasisYear`'s monthly
   *  profile. A forecast. Labelling it „план" asserts the Assembly voted a
   *  figure we computed — the defect this pair of keys exists to keep apart. */
  revenueProjectedEur: number | null;
  expenditureExecutedEur: number | null;
  /** The budget law's column — see `revenuePlannedEur`. */
  expenditurePlannedEur: number | null;
  /** Our seasonal forecast — see `revenueProjectedEur`. */
  expenditureProjectedEur: number | null;
  /** The prior complete year whose monthly shape every `*Projected*` figure here
   *  was scaled through. NULL on a complete year, where nothing is projected. */
  projectionBasisYear: number | null;
  /** Expenditure as a share of the same year's GDP, ALREADY DIVIDED — one per
   *  numerator, because a single share would leave its basis to be guessed. The
   *  division is a basis change, which `budgetBasis.test.ts` §7.1 keeps out of
   *  the screens: one implementation, in migration 156, over one
   *  `budget_fiscal_year` row so numerator and denominator share a year. */
  expenditurePlannedPctGdp: number | null;
  /** ⚠️ A forecast over a forecast — see `gdpEur`. A caption must say so. */
  expenditureProjectedPctGdp: number | null;
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
