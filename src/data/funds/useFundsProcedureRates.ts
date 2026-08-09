// /api/db/funds-procedure-rates — the base-rate card on /funds/procedure/:code (migration 143).
//
// SEPARATE FROM `useFundsProcedureSummary`, which reads the committed `fund_payloads` blob. This
// one is derived from Postgres, and folding it into that blob would mean generating JSON from PG.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

export interface FundsProcedureRates {
  procedureCode: string;
  /** Published for only 41% of procedures; `sampleTitle` stands in. Kept separate so a consumer
   *  can tell the scheme's name from an example of what it funded. */
  procedureName: string | null;
  sampleTitle: string | null;
  programName: string | null;
  projectCount: number;
  beneficiaryCount: number;
  /** Signed contracts that have been PAID something. NOT an approval rate — ИСУН publishes no
   *  rejected applications, so that denominator does not exist. */
  paidProjectCount: number;
  totalEur: number;
  grantEur: number;
  paidEur: number;
  grantP25: number | null;
  grantMedian: number | null;
  grantP75: number | null;
  orgForms: { label: string; n: number; eur: number }[];
  orgKinds: { label: string; n: number }[];
  oblasti: Record<string, number>;
}

export const useFundsProcedureRates = (code: string | undefined) =>
  useQuery({
    queryKey: ["funds-procedure-rates", code ?? ""] as const,
    queryFn: async (): Promise<FundsProcedureRates | null> =>
      await fetchJson<FundsProcedureRates | null>(
        `/api/db/funds-procedure-rates?code=${encodeURIComponent(code!)}`,
      ),
    enabled: !!code,
    // Moves only on a funds reload.
    staleTime: 60 * 60_000,
  });

/** The share of a procedure's signed contracts that have been paid something.
 *
 *  Named for what it measures. It is NOT an approval rate and must never be relabelled as one:
 *  the corpus holds only SIGNED contracts, so the denominator for „how many applicants were
 *  approved" is not published by ИСУН at all. */
export const disbursedShare = (r: FundsProcedureRates): number | null =>
  r.projectCount > 0 ? (100 * r.paidProjectCount) / r.projectCount : null;

/** The consultancy fee a reader was quoted, expressed against this procedure's median grant.
 *
 *  ARITHMETIC, NOT ADVICE. The measured question (funds-module-v2 Appendix A, category D) is
 *  „поискаха ми 4000 € предварително и 5% от сумата — това реални цифри ли са?", and the answer
 *  we can honestly give is the denominator, not a verdict: there is no fee corpus anywhere, so
 *  „a fair fee is Y" is unsupportable and explicitly out of scope (plan §8.4-4). Exported and
 *  computed in the open so the reader can redo the division with their own percentage. */
export const feeOnMedian = (
  r: FundsProcedureRates,
  pct: number,
): number | null =>
  r.grantMedian !== null && r.grantMedian > 0
    ? (r.grantMedian * pct) / 100
    : null;
