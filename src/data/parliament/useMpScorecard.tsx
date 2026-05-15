// Per-MP scorecard: combines four already-precomputed signals into one tile.
// Each metric carries its value + rank within the currently-selected NS
// (1 = highest), so the UI can show "X из N" without re-deriving ranks at
// render time. Composed from existing hooks; no new data file needed.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProcurementMpConnectedFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "./nsFolders";
import { useMps } from "./useMps";
import { useMpLoyalty } from "./votes/useMpLoyalty";
import { useMpAssets } from "./useMpAssets";
import { useAssetsRankings } from "./useAssetsRankings";

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

const fetchConnected = async (): Promise<ProcurementMpConnectedFile | null> => {
  const response = await fetch(
    dataUrl("/procurement/derived/mp_connected.json"),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as ProcurementMpConnectedFile;
};

/** Combined scorecard for a single MP, scoped to the selected NS. Returns
 *  `hasAny: false` when none of the metrics have data for this person — the
 *  caller can then skip rendering the tile entirely. */
export const useMpScorecard = (
  name?: string | null,
): { scorecard: MpScorecard; isLoading: boolean } => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);
  const { findMpByName, isLoading: mpsLoading } = useMps();
  const mp = findMpByName(name);
  const mpId = mp?.id ?? null;

  const {
    entry: loyaltyEntry,
    entries: loyaltyEntries,
    file: loyaltySlice,
    isLoading: loyaltyLoading,
  } = useMpLoyalty(mpId, name);

  const { rollup: assetsRollup, isLoading: assetsLoading } = useMpAssets(name);
  const { rankings: assetsRankings, isLoading: assetsRankingsLoading } =
    useAssetsRankings();

  const connectedQuery = useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: fetchConnected,
    staleTime: Infinity,
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
    const loyalty: ScorecardMetric = {
      value: loyaltyValue,
      rank: rankIn(loyaltyValue, loyaltyValues),
      cohortSize: loyaltyValues.length,
      median: medianOf(loyaltyValues),
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
    const attendanceMedian =
      totalItems > 0 ? (medianOf(attendanceCounts) ?? 0) / totalItems : null;
    const attendance: ScorecardMetric = {
      value: attendanceValue,
      rank: rankIn(loyaltyEntry?.votesCast ?? null, attendanceCounts),
      cohortSize: attendanceCounts.length,
      median: attendanceMedian,
    };

    // --- Net worth --------------------------------------------------------
    // Rank cohort = the same-NS assets-rankings slice. This already includes
    // every MP we have a parsed declaration for in that parliament (not just
    // top-N), so rank within it is meaningful.
    const netWorthValue = assetsRollup?.netWorthEur ?? null;
    const nsSlice =
      ns && assetsRankings?.byNs?.[ns]?.topMps
        ? assetsRankings.byNs[ns].topMps
        : [];
    const netWorthValues = nsSlice
      .map((m) => m.netWorthEur)
      .sort((a, b) => b - a);
    const netWorth: ScorecardMetric = {
      value: netWorthValue,
      rank: rankIn(netWorthValue, netWorthValues),
      cohortSize: netWorthValues.length,
      median: medianOf(netWorthValues),
    };

    // --- Connected contracts ---------------------------------------------
    // mp_connected.json carries one row per (mp × contractor). Roll up to a
    // per-MP total, then rank. Cohort here = every MP that has at least one
    // connected contract; MPs with zero are excluded from the rank denominator
    // (so a rank of "1 из 23" reads as "1 of the 23 MPs whose firms won state
    // contracts", not "1 of 240").
    const allEntries = connectedQuery.data?.entries ?? [];
    const totalByMp = new Map<number, number>();
    for (const e of allEntries) {
      totalByMp.set(e.mpId, (totalByMp.get(e.mpId) ?? 0) + e.totalEur);
    }
    const contractTotalsDesc = Array.from(totalByMp.values()).sort(
      (a, b) => b - a,
    );
    const contractsValue =
      mpId != null && totalByMp.has(mpId) ? totalByMp.get(mpId)! : null;
    const connectedContracts: ScorecardMetric = {
      value: contractsValue,
      rank: rankIn(contractsValue, contractTotalsDesc),
      cohortSize: contractTotalsDesc.length,
      median: medianOf(contractTotalsDesc),
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
    assetsRollup,
    assetsRankings,
    ns,
    connectedQuery.data,
    mpId,
  ]);

  const isLoading =
    mpsLoading ||
    loyaltyLoading ||
    assetsLoading ||
    assetsRankingsLoading ||
    connectedQuery.isLoading;

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
    };
  }

  return { scorecard, isLoading };
};
