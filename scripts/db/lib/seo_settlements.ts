// Build-time enumeration of the procurement-by-settlement pages for the SEO
// prerender + sitemap, read straight from Postgres.
//
// The procurement corpus is Postgres-served — the SPA reads it via the /api/db
// routes and the GCS bucket excludes the procurement tree — so the static page
// generator now reads the SAME live source instead of the retired
// data/procurement/by_settlement/index.json shard. This queries the
// `procurement_by_settlement(NULL, NULL)` function directly (full corpus,
// ~0.4s once at build time) so the enumeration is never stale.
//
// Returns [] on ANY failure (Postgres unreachable, function absent) so a build
// without the Docker/Cloud Postgres degrades gracefully to "no per-settlement
// pages" — exactly the previous `if (!fs.existsSync(index)) return []` behaviour.
// That envelope is shared with the other build-time SEO readers (seo_read.ts),
// so a robustness fix lands once for all of them rather than per family.

import { readSeoRows } from "./seo_read";

export type SeoProcurementSettlement = {
  ekatte: string;
  name: string;
  province?: string;
  obshtina?: string;
  contractCount: number;
  totalEur: number;
  awarderCount: number;
};

export const readProcurementSeoSettlements = async (): Promise<
  SeoProcurementSettlement[]
> => {
  const rows = await readSeoRows<{
    r: { settlements?: SeoProcurementSettlement[] } | null;
  }>(
    "/procurement/settlement/*",
    `SELECT procurement_by_settlement(NULL, NULL) AS r`,
  );
  const list = rows[0]?.r?.settlements ?? [];
  return list.filter((s) => s && s.ekatte);
};
