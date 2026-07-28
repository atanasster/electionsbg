// Shared helper: the procurement risk-indexes payload matview (procurement_risk_
// indexes_cache) embeds foundedByEik, so any writer that changes company_founded
// (the CR founding fold, the local→cloud company_founded ship) must REFRESH it or
// the new dates sit in the table but never reach the SPA. Guarded on presence so it
// no-ops on a DB that has company_founded but not the procurement matview.

import { allRows, exec } from "./pg";

const MATVIEW = "procurement_risk_indexes_cache";

/** REFRESH procurement_risk_indexes_cache when it exists; log and skip otherwise. */
export const refreshRiskIndexesIfPresent = async (): Promise<void> => {
  const [mv] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_matviews WHERE matviewname = $1`,
    [MATVIEW],
  );
  if (mv?.n === "0") return;
  await exec(`REFRESH MATERIALIZED VIEW ${MATVIEW}`);
  console.log(`  refreshed ${MATVIEW}`);
};
