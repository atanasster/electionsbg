// Per-município "open tenders" summary for the place dashboard tile: the município's
// municipal-tier buyers' recent ANNOUNCED procedures — estimated (forecast) value, count,
// top-by-value. Keyed by obshtina, like the alerts.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 4a (migration 179,
// /api/db/myarea-place-tenders). It used to read data/myarea/place_tenders/<obshtina>.json,
// 265 files that scripts/myarea/build_alerts.ts rebuilt and re-uploaded EVERY DAY from
// data/procurement/tenders/recent_by_buyer.json — itself derived from the `tenders` table.
// The shard was a cache of a Postgres table with no computation in it that the database
// could not do, and data/myarea/ was the highest churn-per-byte tree in the repo.
//
// The window, the per-buyer cap and the cancelled-exclusion all live in the SQL now; 179's
// header documents each and why none of them is the obvious rule. Measured parity over all
// 286 shards: identical on since/count/cancelled, 43 differ in total only, every one a
// same-day tie at the per-buyer cap that the old builder broke by ingest order.

import { useQuery } from "@tanstack/react-query";

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
// null = this município has no procedures in the window. The route returns it explicitly
// (the shard family expressed the same thing by not writing a file, which fetchJsonSoft
// mapped from a 404), so the tile's absent state is unchanged.
const fetchSummary = async (
  obshtina: string,
): Promise<PlaceTenderSummary | null> => {
  const r = await fetch(
    `/api/db/myarea-place-tenders?obshtina=${encodeURIComponent(obshtina)}`,
  );
  if (!r.ok) return null;
  return (await r.json()) as PlaceTenderSummary | null;
};

export const useMyAreaPlaceTenders = (obshtina?: string) =>
  useQuery({
    queryKey: ["myarea", "placeTenders", obshtina ?? ""] as const,
    // `enabled` guards the undefined case, so the queryFn always has an obshtina.
    queryFn: () => fetchSummary(obshtina!),
    enabled: !!obshtina,
    staleTime: Infinity,
  });
