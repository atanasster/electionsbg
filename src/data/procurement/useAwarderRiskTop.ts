// Buyer risk-grade leaderboard, DB-backed (/api/db/awarder-risk-top →
// awarder_risk_grade_top from the precomputed awarder_risk_grade_scoped table,
// schema 041). SCOPED to the live ?pscope window (all / y:<year> / ns:<election>)
// like the rest of the /procurement module — the scope key is derived from
// useScopeWindow below. `minScore` is an optional grade floor (bands have
// no plus grades; 55 = the E floor, 70 = the F floor).

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import type { RiskGradeLetter } from "@/lib/riskGrade";

export type AwarderRiskTopRow = {
  eik: string;
  name: string | null;
  totalEur: number;
  supplierCount: number;
  linkedEur: number;
  score: number;
  grade: RiskGradeLetter;
  connectionShare: number | null;
  singleShare: number | null;
  directShare: number | null;
  concShare: number | null;
  // Share of the buyer's merits-decided КЗК appeals that were upheld — the one
  // regulator-ruled grade component (awarder_risk_grade_top returns it, 041).
  upheldShare: number | null;
};

// `scope` is the EFFECTIVE window served; when it differs from `requested` the DB
// fell back to 'all' (no precomputed rows for the selected year/parliament) — the
// tile badges that so corpus leaders aren't mislabeled as the selected scope.
export type AwarderRiskTop = {
  requested: string;
  scope: string;
  rows: AwarderRiskTopRow[];
};

export const useAwarderRiskTop = (limit = 20, minScore = 0) => {
  // Follow the /procurement pscope selector: 'all' | 'y:<year>' | 'ns:<election>'
  // — the exact keys precomputed into awarder_risk_grade_scoped by the loader.
  const { all, year, selected } = useScopeWindow();
  const scope = all ? "all" : year != null ? `y:${year}` : `ns:${selected}`;
  return useQuery({
    queryKey: [
      "procurement",
      "awarder_risk_top",
      scope,
      limit,
      minScore,
    ] as const,
    queryFn: async (): Promise<AwarderRiskTop> => {
      const r = await fetch(
        `/api/db/awarder-risk-top?scope=${encodeURIComponent(scope)}&limit=${limit}&minScore=${minScore}`,
      );
      // Migration lag (404) → empty so the tile just hides. Any OTHER non-OK
      // status (500/503) is a transient outage — throw so `[]` isn't cached as a
      // fresh success (staleTime: Infinity would keep the tile empty until a hard
      // reload); retry:false still prevents a storm and it refetches next mount.
      if (r.status === 404) return { requested: scope, scope, rows: [] };
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as AwarderRiskTop;
    },
    staleTime: Infinity,
    retry: false,
  });
};
