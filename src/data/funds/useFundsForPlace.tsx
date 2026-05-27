// EU-funds (ИСУН) per-place summary — slim "tile-ready" snapshot for one
// EKATTE or one обshtina. Backs the `EuFundsTile` on settlement and муни
// dashboards. Source-of-truth at scripts/funds/projects_ingest.ts.
//
// The companion full-corpus files (by-ekatte/{ekatte}.json,
// by-muni/{obshtina}.json) can be tens of MB for Sofia; the summary is
// always <5 KB, so the tile loads instantly even on the largest place.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { FundsProjectsSummaryFile } from "./types";

const fetchSummary = async (
  url: string,
): Promise<FundsProjectsSummaryFile | null> => {
  const r = await fetch(url);
  // 404 means the place has no EU-funds activity — render nothing-friendly.
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as FundsProjectsSummaryFile;
};

export const useFundsForEkatte = (ekatte: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "ekatte", ekatte ?? ""] as const,
    queryFn: () =>
      fetchSummary(dataUrl(`/funds/projects/by-ekatte/${ekatte}-summary.json`)),
    enabled: !!ekatte,
    staleTime: Infinity,
  });

export const useFundsForMuni = (obshtina: string | undefined) =>
  useQuery({
    queryKey: ["funds", "projects", "muni", obshtina ?? ""] as const,
    queryFn: () =>
      fetchSummary(dataUrl(`/funds/projects/by-muni/${obshtina}-summary.json`)),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
