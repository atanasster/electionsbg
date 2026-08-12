// Per-MP scorecard: combines four already-precomputed signals into one tile.
// Each metric carries its value + rank within the currently-selected NS
// (1 = highest), so the UI can show "X из N" without re-deriving ranks at
// render time. Composed from existing hooks; no new data file needed.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "./nsFolders";
import { useMpEntryForName } from "@/data/candidates/CandidateMpContext";
import { useMpLoyalty } from "./votes/useMpLoyalty";
import { useMpAssets } from "./useMpAssets";

// Connected-contracts scorecard metric, served by /api/db/mp-scorecard
// (mp_scorecard() — the MP's connected-contract total + its rank / cohort size /
// cohort median across all connected MPs). Replaces the derived/per-mp/ shard +
// chamber-wide mp_connected.json fetches the tile used to do.
interface MpScorecardStats {
  value: number | null;
  rank: number | null;
  cohortSize: number;
  cohortMedian: number | null;
}

const fetchMpScorecard = async (
  mpId: number,
): Promise<MpScorecardStats | null> => {
  const r = await fetch(`/api/db/mp-scorecard?mpId=${mpId}`);
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as MpScorecardStats | null;
};

// The net-worth metric's rank cohort, from PG (mp_assets_rankings_table, one ns slice) —
// replaces the client rankIn/median over the retired assets-rankings.json byNs slice (T2.2).
type NetWorthRank = {
  rank: number | null;
  cohortSize: number;
  median: number | null;
};
const fetchNetWorthRank = async (
  mpId: number,
  ns: string,
): Promise<NetWorthRank | null> => {
  const r = await fetch(
    `/api/db/mp-networth-rank?mpId=${mpId}&ns=${encodeURIComponent(ns)}`,
  );
  if (!r.ok) return null;
  const body = (await r.json()) as NetWorthRank | null;
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
};

export type ScorecardMetric = {
  /** Raw value for the MP. null when unavailable. */
  value: number | null;
  /** 1-based rank within the cohort, 1 = highest. null when unrankable. */
  rank: number | null;
  /** Number of MPs in the cohort. */
  cohortSize: number;
  /** Cohort median, for compact "vs median" context. */
  median: number | null;
};

export type MpScorecard = {
  /** Share of votes cast in line with party majority. value ∈ [0,1]. */
  loyalty: ScorecardMetric;
  /** Votes cast / total vote items in the slice. value ∈ [0,1]. */
  attendance: ScorecardMetric;
  /** Declared net worth in euros. Rank within the same NS's assets-rankings slice. */
  netWorth: ScorecardMetric;
  /** Procurement contracts (€) won by companies the MP is connected to. */
  connectedContracts: ScorecardMetric;
  /** True when any of the four metrics has a value. Used to hide the tile entirely. */
  hasAny: boolean;
};

const EMPTY: ScorecardMetric = {
  value: null,
  rank: null,
  cohortSize: 0,
  median: null,
};

/** Rank value within a list sorted descending. 1-based. null when value is null. */
const rankIn = (value: number | null, sortedDesc: number[]): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  let rank = 1;
  for (const v of sortedDesc) {
    if (v > value) rank += 1;
    else break;
  }
  return rank;
};

const medianOf = (sortedDesc: number[]): number | null => {
  const n = sortedDesc.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sortedDesc[(n - 1) >> 1];
  return (sortedDesc[n >> 1] + sortedDesc[(n >> 1) - 1]) / 2;
};

/** Combined scorecard for a single MP, scoped to the selected NS. Returns
 *  `hasAny: false` when none of the metrics have data for this person — the
 *  caller can then skip rendering the tile entirely. */
export const useMpScorecard = (
  name?: string | null,
): {
  scorecard: MpScorecard;
  isLoading: boolean;
  /** The most metrics that can resolve for this MP, known before any fetch — so a loading
   *  skeleton reserves the right height rather than a fixed four. See its computation. */
  maxMetrics: number;
} => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  // Resolve via CandidateMpContext on the candidate page (no roster fetch for
  // former MPs); falls back to the roster elsewhere.
  const {
    entry: mp,
    id: mpId,
    isLoading: mpsLoading,
  } = useMpEntryForName(name);

  // Loyalty + attendance only exist for the parliament the MP sat in. When the
  // roster says they didn't serve in the selected NS, skip the roll-call fetch
  // (~300 KB votes index) entirely — those two metrics would render blank.
  const servedInSelectedNs = !!(ns && mp?.nsFolders?.includes(ns));

  const {
    entry: loyaltyEntry,
    entries: loyaltyEntries,
    file: loyaltySlice,
    shard: loyaltyShard,
    isLoading: loyaltyLoading,
  } = useMpLoyalty(mpId, name, servedInSelectedNs);

  const { rollup: assetsRollup, isLoading: assetsLoading } = useMpAssets(name);
  // The net-worth metric ranks the MP within the selected NS's assets slice — one small PG
  // aggregate (rank + cohort + median) instead of the chamber-wide assets-rankings.json.
  // Only worth fetching when this MP has a declared net worth AND served in that NS; a
  // former / off-ballot MP has no rank to show.
  const hasNetWorth = assetsRollup?.netWorthEur != null;
  const netWorthRankQuery = useQuery({
    queryKey: ["mp_networth_rank", mpId ?? 0, ns ?? ""] as const,
    queryFn: () => fetchNetWorthRank(mpId!, ns!),
    enabled: hasNetWorth && servedInSelectedNs && mpId != null && !!ns,
    staleTime: Infinity,
    retry: false,
  });

  // Connected-contracts metric — one lightweight /api/db/mp-scorecard call
  // (value + rank + cohort) instead of the old per-MP shard + chamber-wide
  // mp_connected.json fetches.
  const scorecardQuery = useQuery({
    queryKey: ["procurement", "mp_scorecard", mpId ?? 0] as const,
    queryFn: () => fetchMpScorecard(mpId!),
    enabled: mpId != null,
    staleTime: Infinity,
    retry: false,
  });

  const scorecard = useMemo<MpScorecard>(() => {
    // --- Loyalty ----------------------------------------------------------
    const loyaltyValues = loyaltyEntries
      .filter((e) => e.votesCast > 0)
      .map((e) => e.loyaltyPct)
      .sort((a, b) => b - a);
    const loyaltyValue =
      loyaltyEntry && loyaltyEntry.votesCast > 0
        ? loyaltyEntry.loyaltyPct
        : null;
    // Prefer the shard's pre-computed cohort median when present (shard-only
    // fast-path doesn't load the aggregate, so `loyaltyValues` is empty).
    const loyaltyMedianFromAggregate = medianOf(loyaltyValues);
    const loyaltyMedian =
      loyaltyMedianFromAggregate ??
      loyaltyShard?.cohort?.loyaltyPctMedian ??
      null;
    const loyaltyCohortSize =
      loyaltyValues.length > 0
        ? loyaltyValues.length
        : (loyaltyShard?.cohort?.size ?? 0);
    const loyalty: ScorecardMetric = {
      value: loyaltyValue,
      rank: rankIn(loyaltyValue, loyaltyValues),
      cohortSize: loyaltyCohortSize,
      median: loyaltyMedian,
    };

    // --- Attendance -------------------------------------------------------
    // Total vote items in the slice is the same denominator for every MP, so
    // the rank by attendance is identical to the rank by votesCast. Compute on
    // raw votesCast (cheaper) and present the fraction in the UI.
    const totalItems = loyaltySlice?.totalVoteItems ?? 0;
    const attendanceCounts = loyaltyEntries
      .map((e) => e.votesCast)
      .sort((a, b) => b - a);
    const attendanceValue =
      loyaltyEntry && totalItems > 0
        ? loyaltyEntry.votesCast / totalItems
        : null;
    const attendanceMedianCount = medianOf(attendanceCounts);
    let attendanceMedian: number | null = null;
    if (attendanceMedianCount != null && totalItems > 0) {
      attendanceMedian = attendanceMedianCount / totalItems;
    } else if (
      loyaltyShard?.cohort?.votesCastMedian != null &&
      totalItems > 0
    ) {
      // Shard-only mode: cohort sample isn't loaded, but the shard carries
      // a pre-computed cohort median we can divide by the same denominator.
      attendanceMedian = loyaltyShard.cohort.votesCastMedian / totalItems;
    }
    const attendanceCohortSize =
      attendanceCounts.length > 0
        ? attendanceCounts.length
        : (loyaltyShard?.cohort?.size ?? 0);
    const attendance: ScorecardMetric = {
      value: attendanceValue,
      rank: rankIn(loyaltyEntry?.votesCast ?? null, attendanceCounts),
      cohortSize: attendanceCohortSize,
      median: attendanceMedian,
    };

    // --- Net worth --------------------------------------------------------
    // Rank cohort = the same-NS assets slice (mp_assets_rankings_table), which includes every
    // MP with a parsed declaration in that parliament — so rank within it is meaningful. The
    // rank/cohort/median come from PG (mp-networth-rank); the value stays from the MP's own
    // wealth rollup (same person_wealth_year series, so the two agree).
    const nwr = netWorthRankQuery.data;
    const netWorth: ScorecardMetric = {
      value: assetsRollup?.netWorthEur ?? null,
      rank: nwr?.rank ?? null,
      cohortSize: nwr?.cohortSize ?? 0,
      median: nwr?.median ?? null,
    };

    // --- Connected contracts ---------------------------------------------
    // mp_scorecard() returns the MP's connected-contract total + rank + cohort over all
    // connected MPs.
    //
    // `value` is null in TWO states this function cannot tell apart: the MP has no linked
    // companies at all, and the MP's linked companies won nothing. 034's `me` reads
    // `ranked` ← `polagg` ← an inner join to contractors PRESENT in `contracts`, so an MP
    // whose firms hold no contract row is absent from the aggregate entirely rather than
    // summing to 0. The scorecard therefore DROPS the metric rather than dashing it, and a
    // genuine "linked firms, €0 won" finding is currently unpublishable — making it
    // representable needs a `linkedFirms` count out of 034, which ships via
    // apply_functions.ts and no loader carries.
    //
    // (An earlier version of this comment promised the UI could render "0 vs N average".
    // It never could: `rankContext` returns null when rank is null, which it is for exactly
    // these MPs, so the old tile showed a bare dash with no context.)
    const sc = scorecardQuery.data;
    const connectedContracts: ScorecardMetric = {
      value: sc?.value ?? null,
      rank: sc?.rank ?? null,
      cohortSize: sc?.cohortSize ?? 0,
      median: sc?.cohortMedian ?? null,
    };

    const hasAny =
      loyalty.value != null ||
      attendance.value != null ||
      netWorth.value != null ||
      connectedContracts.value != null;

    return {
      loyalty,
      attendance,
      netWorth,
      connectedContracts,
      hasAny,
    };
  }, [
    loyaltyEntry,
    loyaltyEntries,
    loyaltySlice,
    loyaltyShard,
    assetsRollup,
    netWorthRankQuery.data,
    scorecardQuery.data,
  ]);

  const isLoading =
    mpsLoading ||
    loyaltyLoading ||
    assetsLoading ||
    netWorthRankQuery.isLoading ||
    (mpId != null && scorecardQuery.isLoading);

  // The most tiles that can possibly resolve, known SYNCHRONOUSLY — before any fetch — so a
  // loading skeleton can reserve the right height instead of always four.
  //
  // `servedInSelectedNs` is the same roster check that decides whether the roll-call fetch
  // happens at all, and it is exactly what rules loyalty + attendance out. For the 1,556 of
  // 2,122 MPs whose parliaments predate the corpus this is 2, not 4 — a skeleton of four
  // reserves two phone rows for a block that settles to one, and the tile sits above the
  // fold on /person/:slug where that shift is scored.
  //
  // It is a CEILING, not a prediction: net worth and connected contracts can still fail to
  // resolve, so a residual shrink remains. It removes the systematic over-reservation for
  // the majority case, which is the part that was avoidable.
  const maxMetrics = servedInSelectedNs ? 4 : 2;

  if (!mpId) {
    return {
      scorecard: {
        loyalty: EMPTY,
        attendance: EMPTY,
        netWorth: EMPTY,
        connectedContracts: EMPTY,
        hasAny: false,
      },
      isLoading: false,
      maxMetrics,
    };
  }

  return { scorecard, isLoading, maxMetrics };
};
