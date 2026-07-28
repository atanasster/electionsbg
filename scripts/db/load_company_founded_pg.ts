// Publish `company_founded` (Registry-Agency incorporation dates) to Cloud SQL.
//
// company_founded is populated by a slow, rate-limited scrape
// (scripts/procurement/fetch_company_founded.ts) that only ever runs against
// LOCAL Postgres. Until this loader existed there was no way to get those rows
// to the cloud except `db:sync:cloud`, a destructive whole-database
// pg_restore --clean — so in practice nobody did, production served a ~10-entry
// stub, and the newFirmWinner risk flag was dormant for every user.
//
//   npm run db:load:company-founded:pg          # local (no-op sanity check)
//   npm run db:load:company-founded:pg:cloud    # ship local → Cloud SQL
//
// ⚠️ Apply 033 to the target first — the table carries http_status/attempts:
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
//     npx tsx scripts/db/apply_functions.ts 033_procurement_risk_indexes.sql
//
// After shipping, the served payload must be rebuilt or the new dates are in
// the table but not in `foundedByEik`; this refreshes it for you.

import { allRows, end } from "./lib/pg";
import { shipTable, targetIsCloud } from "./lib/shipTable";
import { refreshRiskIndexesIfPresent } from "./lib/refreshRiskIndexes";

const main = async () => {
  if (!targetIsCloud()) {
    // Local IS the source of truth for this table, so there is nothing to load
    // into it — report what is there so the command is still a useful check.
    // Only a pre-provenance NULL is suspect. A pre-provenance row that carries a
    // DATE is fine — the date could only have come from a real answer; it is the
    // absence of one that the old code could not distinguish from a failed fetch.
    const [row] = await allRows<{
      n: string;
      dated: string;
      untrusted: string;
    }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE founded_date IS NOT NULL)::text AS dated,
              count(*) FILTER (WHERE founded_date IS NULL
                                 AND http_status IS NULL)::text AS untrusted
         FROM company_founded`,
    );
    console.log(
      `· company_founded is LOCAL-authored: ${row?.n ?? 0} row(s), ` +
        `${row?.dated ?? 0} dated.`,
    );
    if (Number(row?.untrusted ?? 0) > 0)
      console.log(
        `  ⚠️ ${row.untrusted} NULL row(s) predate the provenance columns, so ` +
          "they cannot be told apart from a failed fetch — repair with " +
          "`fetch_company_founded.ts --requeue-nulls` before shipping.",
      );
    console.log("  Nothing to ship; run the :cloud variant to publish.");
    await end();
    return;
  }

  await shipTable("company_founded");
  // The risk-indexes payload embeds foundedByEik, so the ship is only visible
  // to the SPA once the cache is rebuilt.
  await refreshRiskIndexesIfPresent();
  await end();
};

main().catch(async (e) => {
  console.error(
    "✗ load_company_founded_pg failed:",
    e instanceof Error ? e.message : e,
  );
  await end().catch(() => {});
  process.exit(1);
});
