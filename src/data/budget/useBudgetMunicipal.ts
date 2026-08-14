// The чл. 53 municipal envelope, for /budget/municipal.
//
// Plan: docs/plans/budget-hub-v1.md §8 / T6.12.
//
// ⚠️ THIS IS WHAT THE STATE SENDS, NOT WHAT MUNICIPALITIES OWE. The sibling
// corpus `municipal_fiscal` (migration 149) is the liabilities side — поети
// ангажименти, задължения за разходи, просрочия — a different grain from a
// different source. Migration 154's header exists to keep them apart, and no
// consumer may sum across them.

import { useQuery } from "@tanstack/react-query";

export interface BudgetMuniRow {
  obshtina: string;
  nameBg: string | null;
  nameEn: string | null;
  fiscalYear: number;
  /** Делегирани дейности — the state paying for schools, social care and the
   *  rest that municipalities administer on its behalf. The bulk of the line. */
  delegatedEur: number | null;
  /** Изравнителна субсидия. NULL — not zero — on the ~19 municipalities that
   *  receive none, so it must render as absent rather than as €0. */
  equalizationEur: number | null;
  capitalEur: number | null;
  winterEur: number | null;
  otherTargetedEur: number | null;
  totalEur: number | null;
  /** Census 2021. Present for all 265 — including Столична, whose key differs
   *  between the two tables (SFO_CITY vs SOF00) and which a naive join drops. */
  population: number | null;
  /** The census the population is from — 2021 today. Carried so the page can
   *  state the denominator's vintage where the division happens. */
  censusYear?: number | null;
  totalPerCapitaEur: number | null;
}

export interface BudgetMunicipal {
  fiscalYear?: number | null;
  rows: BudgetMuniRow[];
}

const fetchList = async (
  fy: number,
  q: string | null,
): Promise<BudgetMunicipal | null> => {
  const params = new URLSearchParams({ fy: String(fy), limit: "300" });
  if (q) params.set("q", q);
  try {
    const res = await fetch(`/api/db/budget-municipal?${params}`);
    if (!res.ok) return null;
    const body = (await res.json()) as BudgetMunicipal & { error?: string };
    // `/api/db/<unknown>` answers `{"error": …}` at a 200.
    if (body?.error || !Array.isArray(body?.rows)) return null;
    return body;
  } catch {
    return null;
  }
};

export const useBudgetMunicipal = (fy: number | null, q: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["budget-municipal", fy, q ?? ""] as const,
    queryFn: () => (fy == null ? null : fetchList(fy, q)),
    enabled: fy != null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { municipal: data ?? null, isLoading };
};
