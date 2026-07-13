// "How typical is this tender?" — fetches the cohort-distribution card for one
// tender (/api/db/tender-normalcy → tender_normalcy(), migration 067). The
// ex-ante companion to the contract-stage normalcy panel: positions this tender
// against similar tenders (same adaptive CPV prefix × era) on estimated value,
// submission window (the rushed-deadline signal), and procedure type.
// DESCRIPTIVE context, never a verdict. null when the tender has no comparable
// data or the migration hasn't reached this DB.

import { useQuery } from "@tanstack/react-query";
import type {
  NormalcyDir,
  NormalcyMetric,
  NormalcyProcedure,
} from "./useContractNormalcy";

// Re-export the shared metric/procedure/dir shapes — the tender payload reuses
// the same numeric-metric and procedure contracts as contracts.
export type { NormalcyDir, NormalcyMetric, NormalcyProcedure };

/** Submission-window metric (publication → deadline, in days). Risk direction is
 *  LOW — a short window suppresses competition. */
export type NormalcyWindow = NormalcyMetric & {
  /** Share of the cohort whose window was below the ~14-day EU reference. */
  shortShare: number;
  /** This tender's window is below the ~14-day reference. */
  isShort: boolean;
};

export type TenderNormalcyCohort = {
  division: string;
  cpvPrefix: string;
  cpvLen: number;
  n: number;
  yearFrom: string;
  yearTo: string;
  sufficient: boolean;
  /** Share of the cohort that was cancelled (context, not a deviation). */
  cancelledShare: number;
  /** Share of the cohort that was EU-funded (context, not a deviation). */
  euFundedShare: number;
};

export type TenderNormalcy = {
  unp: string;
  cohort: TenderNormalcyCohort | null;
  value: NormalcyMetric | null;
  window: NormalcyWindow | null;
  procedure: NormalcyProcedure | null;
};

const fetchTenderNormalcy = async (
  unp: string,
): Promise<TenderNormalcy | null> => {
  const r = await fetch(
    `/api/db/tender-normalcy?unp=${encodeURIComponent(unp)}`,
  );
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as TenderNormalcy | null;
};

export const useTenderNormalcy = (unp?: string | null) =>
  useQuery({
    queryKey: ["procurement", "tender-normalcy", unp] as const,
    queryFn: () => fetchTenderNormalcy(unp as string),
    enabled: !!unp,
    staleTime: Infinity,
  });
