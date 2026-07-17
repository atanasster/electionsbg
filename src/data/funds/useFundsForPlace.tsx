// EU-funds (ИСУН) per-муни summary — slim "tile-ready" snapshot for one
// обshtina. Backs MyAreaProjectsMapTile and the AI placeEuProjects tool.
// Source-of-truth at scripts/funds/projects_ingest.ts.
//
// The companion full-corpus file (by-muni/{obshtina}.json) can be tens of MB
// for Sofia; the summary is always <5 KB, so a tile loads instantly even on
// the largest place.

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";
import type { FundsProjectsSummaryFile } from "./types";

export const useFundsForMuni = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "muni", obshtina ?? ""] as const,
    queryFn: () =>
      fetchFundPayload<FundsProjectsSummaryFile>("muni-summary", obshtina),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
