// The 3 headline KPIs for /procurement/contractors ("Топ изпълнители"), read from
// the per-scope blob (migration 122) via /api/db/contractor-scope-kpis. These are
// SCOPE-level (keyed by scope_key, over the whole 'ALL' division), deliberately NOT
// reactive to the CPV / MP-tied filters — the reactive Σ€ + contractor count ride the
// table's own server aggregates instead (onData / renderAggregates). Same split the
// contracts browser uses: window-fixed integrity KPIs beside a reactive money total.
//
// The route returns the matview row verbatim (snake_case, no camelCasing), so map it
// here. total_eur / *_share / *_eur are double precision (node-pg → JS number); a
// missing matview or scope yields null (the tiles hide rather than break the page).

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

export interface ContractorScopeKpis {
  contractorCount: number;
  totalEur: number;
  /** Share of value taken by the top 10 contractors — market concentration. */
  top10Share: number;
  mpTiedEur: number;
  /** Share of value flowing to MP-tied companies. */
  mpTiedShare: number;
  mpTiedCount: number;
}

type Raw = {
  contractor_count: number;
  total_eur: number;
  top10_share: number;
  mp_tied_eur: number;
  mp_tied_share: number;
  mp_tied_count: number;
};

const fetchKpis = async (
  scopeKey: string,
): Promise<ContractorScopeKpis | null> => {
  const r = await fetch(
    `/api/db/contractor-scope-kpis?scope=${encodeURIComponent(scopeKey)}`,
  );
  if (!r.ok) return null;
  const body = (await r.json()) as Raw | null;
  if (!body) return null;
  return {
    contractorCount: body.contractor_count,
    totalEur: body.total_eur,
    top10Share: body.top10_share,
    mpTiedEur: body.mp_tied_eur,
    mpTiedShare: body.mp_tied_share,
    mpTiedCount: body.mp_tied_count,
  };
};

export const useContractorScopeKpis = () => {
  const { scopeKey } = useScopeWindow();
  return useQuery({
    queryKey: ["contractor-scope-kpis", scopeKey],
    queryFn: () => fetchKpis(scopeKey),
    staleTime: Infinity,
  });
};
