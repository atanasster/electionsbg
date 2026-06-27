// Per-município "open tenders" summary for the place dashboard tile. Built by
// scripts/myarea/build_alerts.ts (data/myarea/place_tenders/<obshtina>.json):
// the município's municipal-tier buyers' recent ANNOUNCED procedures — estimated
// (forecast) value, count, top-by-value. Keyed by obshtina, like the alerts.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "@/data/fetchJson";

export interface PlaceTenderRow {
  unp: string;
  buyerName: string;
  subject: string;
  estimatedValueEur?: number;
  publicationDate: string;
  isCancelled: boolean;
}

export interface PlaceTenderSummary {
  obshtina: string;
  generatedAt: string;
  since: string;
  count: number;
  cancelled: number;
  totalEstimatedEur: number;
  top: PlaceTenderRow[];
}

// 404 = município has no recent tenders → soft miss (null).
const fetchSummary = (obshtina: string): Promise<PlaceTenderSummary | null> =>
  fetchJsonSoft<PlaceTenderSummary>(
    dataUrl(`/myarea/place_tenders/${obshtina}.json`),
  );

export const useMyAreaPlaceTenders = (obshtina?: string) =>
  useQuery({
    queryKey: ["myarea", "placeTenders", obshtina ?? ""] as const,
    // `enabled` guards the undefined case, so the queryFn always has an obshtina.
    queryFn: () => fetchSummary(obshtina!),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
