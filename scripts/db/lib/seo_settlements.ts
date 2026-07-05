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

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

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
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<{
      r: { settlements?: SeoProcurementSettlement[] };
    }>(`SELECT procurement_by_settlement(NULL, NULL) AS r`);
    const list = rows[0]?.r?.settlements ?? [];
    return list.filter((s) => s && s.ekatte);
  } catch (err) {
    console.warn(
      `[seo] procurement settlements: Postgres unavailable, skipping /procurement/settlement/* pages (${
        (err as Error)?.message ?? String(err)
      })`,
    );
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
};
