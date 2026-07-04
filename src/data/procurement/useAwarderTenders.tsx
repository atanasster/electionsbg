// Live per-buyer tender pipeline from Postgres (/api/db/tenders?eik=). This is
// NOT statically served anywhere — the tender tree is sharded by procedure, so a
// buyer's full pipeline (all their procedures + forecast, plus the actual awarded
// value via the ocid → contracts join) only exists live. Powers the awarder
// page's "Announced procedures" tile. Served by the `db` Cloud Function in prod,
// the Vite plugin (vite/db-api.ts) in dev — same path + shapes.
//
// estimated / forecast_eur is a FORECAST (прогнозна стойност), NEVER contracted
// spend; awarded_eur is the actual signed-contract total (contract-only rule).
// See docs/plans/pg-datasets-roadmap.md §0.

import { useQuery } from "@tanstack/react-query";

export interface AwarderTendersSummary {
  procedures: number;
  cancelled: number;
  with_estimate: number;
  forecast_eur: number;
  awarded_procedures: number;
  awarded_eur: number;
  first_day: string | null;
  last_day: string | null;
}

export interface AwarderTenderRow {
  unp: string;
  ocid: string | null;
  publication_date: string;
  subject: string;
  procedure_type: string | null;
  cpv: string | null;
  cpv_desc: string | null;
  forecast_eur: number | null;
  currency: string | null;
  lots_count: number | null;
  is_cancelled: boolean;
  awarded_eur: number | null;
  award_contracts: number | null;
  has_appeal: boolean | null;
}

export interface AwarderTendersResponse {
  eik: string;
  summary: AwarderTendersSummary | null;
  recent: AwarderTenderRow[];
}

export const useAwarderTenders = (
  eik: string | undefined,
  limit = 25,
  sort: "date" | "value" = "date",
) =>
  useQuery({
    queryKey: ["db", "awarder-tenders", eik, limit, sort] as const,
    enabled: !!eik,
    // Live endpoint may be absent (tenders not yet pushed to Cloud SQL) — soft
    // null so the tile simply doesn't render, never breaks the page.
    queryFn: async (): Promise<AwarderTendersResponse | null> => {
      const r = await fetch(
        `/api/db/tenders?eik=${encodeURIComponent(eik ?? "")}&limit=${limit}&sort=${sort}`,
      );
      if (!r.ok) return null;
      return (await r.json()) as AwarderTendersResponse;
    },
    staleTime: Infinity,
    retry: false,
  });
