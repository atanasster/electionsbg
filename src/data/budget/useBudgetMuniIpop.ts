// ИПОП — the municipal investment programme, for /budget/municipal/investments.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.13.
//
// ⚠️ `stalledCount` COUNTS A THRESHOLD, NOT A JUDGEMENT. A project is flagged
// when its agreement is at least €100 000 AND under 5% has been paid
// (`scripts/budget/ipop/ingest.ts`). Two things qualify it, and both travel in
// the payload so no surface can present the count bare:
//
//   * THE COHORT. The project id encodes a vintage — OP-24 is 35.4% paid,
//     OP-25 is 5.5% — so 91 of the 769 are simply young.
//   * THE CLAIM. 306 of the 769 (€343.4m) already have money submitted or
//     awaiting payment. „Nothing paid" is not „nothing happening".

import { useQuery } from "@tanstack/react-query";

export interface IpopMuniRow {
  obshtina: string;
  nameBg: string | null;
  nameEn: string | null;
  projectCount: number;
  agreementEur: number | null;
  paidEur: number | null;
  /** Already computed server-side against this municipality's own agreements. */
  paidPct: number | null;
  stalledCount: number;
}

export interface IpopNational {
  projectCount: number;
  municipalityCount: number;
  agreementEur: number | null;
  paidEur: number | null;
  stalledCount: number;
  /** What the flagged projects are worth — the figure that makes the count
   *  mean something. */
  stalledAgreementEur: number | null;
  /** Of the flagged, those with money already submitted or awaiting payment. */
  stalledWithClaimCount?: number | null;
  stalledWithClaimEur?: number | null;
  /** The OP-<yy> vintages, so „5% paid" reads against its own cohort. */
  cohorts?: IpopCohort[] | null;
}

export interface IpopCohort {
  cohort: string;
  projectCount: number;
  agreementEur: number | null;
  paidEur: number | null;
  stalledCount: number;
}

export interface BudgetMuniIpop {
  fiscalYear?: number | null;
  stalledRule?: { minAgreementEur: number; maxPaidPct: number } | null;
  national?: IpopNational | null;
  rows: IpopMuniRow[];
}

const fetchIpop = async (q: string | null): Promise<BudgetMuniIpop | null> => {
  const params = new URLSearchParams({ limit: "300" });
  if (q) params.set("q", q);
  try {
    const res = await fetch(`/api/db/budget-municipal-ipop?${params}`);
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetMuniIpop & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200.
    if (body?.error || !Array.isArray(body?.rows)) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetMuniIpop = (q: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-municipal-ipop", q ?? ""] as const,
    queryFn: () => fetchIpop(q),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { ipop: data ?? null, isLoading };
};
