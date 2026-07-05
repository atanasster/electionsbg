// EU-funds (ИСУН) per-place summary — slim "tile-ready" snapshot for one
// EKATTE or one обshtina. Backs the `EuFundsTile` on settlement and муни
// dashboards. Source-of-truth at scripts/funds/projects_ingest.ts.
//
// The companion full-corpus files (by-ekatte/{ekatte}.json,
// by-muni/{obshtina}.json) can be tens of MB for Sofia; the summary is
// always <5 KB, so the tile loads instantly even on the largest place.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsSummaryFile } from "./types";

export const useFundsForEkatte = (ekatte: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "ekatte", ekatte ?? ""] as const,
    queryFn: () =>
      fetchFundPayload<FundsProjectsSummaryFile>("ekatte-summary", ekatte),
    enabled: !!ekatte,
    staleTime: Infinity,
  });

export const useFundsForMuni = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "muni", obshtina ?? ""] as const,
    queryFn: () =>
      fetchFundPayload<FundsProjectsSummaryFile>("muni-summary", obshtina),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
