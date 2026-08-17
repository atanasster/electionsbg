// The three CAP funds for one scope — ЕФГЗ-ДП (direct payments), ЕЗФРСР (rural
// development) and ЕФГЗ (market measures).
//
// Read as an AGGREGATE off the same `agri_schemes` resource /subsidies/schemes ranks,
// so the split and the rows beneath it are one query shape and cannot disagree about
// which scope they describe. `pageSize: 1` because only the aggregates are wanted; the
// row itself is discarded.
//
// The three sum to the corpus total with a −€5.73 residual on €11.04bn, from rounding
// in the source register — small enough to state and never worth silently absorbing
// into one of the three.

import { useQuery } from "@tanstack/react-query";

export interface AgriPillars {
  dpEur: number;
  ruralEur: number;
  marketEur: number;
  totalEur: number;
  /** total − (dp + rural + market). Non-zero only from source rounding. */
  residualEur: number;
}

const fetchPillars = async (scopeKey: string): Promise<AgriPillars | null> => {
  const req = {
    resource: "agri_schemes",
    page: 0,
    pageSize: 1,
    // `scope`, not a filter: the resource declares defaultScope { scope_key: 'all' }
    // and buildWhere ANDs a same-column filter with it, so a filter here contradicts
    // the default and returns zero for every scope but 'all'.
    scope: { col: "scope_key", val: scopeKey },
  };
  const r = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  // null on ANY failure, thrown or not: a caller gating on `=== null` for its empty
  // state is unreachable if a !r.ok path lets React Query settle with undefined.
  if (!r.ok) return null;
  const body = (await r.json()) as { aggregates?: Record<string, number> };
  const a = body.aggregates ?? {};
  // camelCase keys: buildAggSelect emits `sum` + Cap(snakeToCamel(col)).
  const dpEur = Number(a.sumDpEur ?? 0);
  const ruralEur = Number(a.sumRuralEur ?? 0);
  const marketEur = Number(a.sumMarketEur ?? 0);
  const totalEur = Number(a.sumTotalEur ?? 0);
  return {
    dpEur,
    ruralEur,
    marketEur,
    totalEur,
    residualEur: totalEur - (dpEur + ruralEur + marketEur),
  };
};

export const useAgriPillars = (scopeKey: string | null) =>
  useQuery({
    queryKey: ["agri", "pillars", scopeKey ?? "(none)"],
    queryFn: () => fetchPillars(scopeKey as string),
    enabled: scopeKey !== null,
    staleTime: Infinity,
  });
