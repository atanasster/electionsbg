// Refresh the procurement risk caches without running a full loader.
//
//   npm run db:refresh:risk          # local
//   npm run db:refresh:risk:cloud    # Cloud SQL (via the proxy on :5434)
//
// WHY: both caches are derived from `contracts` + the 033 views, but until now
// the ONLY way to rebuild either was a complete db:load:pg / db:load:tr:pg /
// db:load:ngo-funding:pg run. So any change that moves the inputs without
// reloading the corpus — a company_founded ship, a debarred update, a КЗК
// appeals ingest, a re-applied migration — left the served numbers stale with
// no cheap way to fix them. Locally the risk-indexes cache had drifted ~32h
// behind its own source before anyone noticed.
//
// Refreshes BOTH, in this order and never just one: the payload the browser
// scores with (procurement_risk_indexes_cache) and the per-contract index the
// column sorts on (contract_risk_cache) read the same views, so refreshing one
// alone is what makes the contract page and the browser column disagree.

import { allRows, exec, end } from "./lib/pg";

const main = async () => {
  const target = /:5434\b/.test(process.env.DATABASE_URL ?? "")
    ? "cloud"
    : "local";
  console.log(`→ refreshing procurement risk caches (${target})…`);

  let t = Date.now();
  await exec("REFRESH MATERIALIZED VIEW procurement_risk_indexes_cache");
  const [payload] = await allRows<{ n: string }>(
    `SELECT length(r::text)::text AS n FROM procurement_risk_indexes_cache`,
  );
  console.log(
    `  procurement_risk_indexes_cache: ${payload?.n ?? 0} bytes ` +
      `(${Math.round((Date.now() - t) / 1000)}s)`,
  );

  t = Date.now();
  const [built] = await allRows<{ n: string }>(
    `SELECT rebuild_contract_risk_cache()::text AS n`,
  );
  console.log(
    `  contract_risk_cache: ${built?.n ?? 0} row(s) ` +
      `(${Math.round((Date.now() - t) / 1000)}s)`,
  );

  const [dist] = await allRows<{ summary: string }>(
    `SELECT string_agg(grade || ':' || n, '  ' ORDER BY grade) AS summary
       FROM (SELECT grade, count(*)::text AS n
               FROM contract_risk_cache GROUP BY grade) g`,
  );
  console.log(`  grades — ${dist?.summary ?? "(none)"}`);
  await end();
};

main().catch(async (e) => {
  console.error("✗ refresh_risk failed:", e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
