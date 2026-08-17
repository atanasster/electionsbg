// Rebuild the /subsidies hub stat cache (migration 162) on its own.
//
//   npm run db:load:agri-hub-stats:pg          (local)
//   npm run db:load:agri-hub-stats:pg:cloud    (Cloud SQL proxy :5434)
//
// WHY THIS EXISTS SEPARATELY FROM `db:load:agri:pg`, which also applies and refreshes
// 162: the cache has FIVE inputs and the agri ingest owns only one of them.
//
//     agri_subsidies / agri_payloads  ← db:load:agri:pg      (this corpus)
//     person_role, person             ← db:resolve:persons
//     fund_projects                   ← db:load:funds:pg
//     contracts                       ← db:load:pg
//     budget_muni_transfer            ← db:load:budget-muni:pg
//
// `db:refresh` runs the agri ingest at step 14 and `db:resolve:persons` at step 45, so
// the political arm built during the ingest is ALWAYS one vintage behind — and on a
// FIRST run, against a person layer 081 has just created empty, it is not merely stale
// but zero. That is a claim, not an absence, and it is what plan §13.2 left open.
//
// The obvious fix — a second `npm run db:load:agri:pg` late in the chain — re-parses
// and re-publishes 2.48M rows (5m44s measured) to rebuild one matview that takes 5.9 s.
// This does only the second part. It is also the right command to run by hand after any
// of the five inputs above is reloaded, on either side, which the agri ingest is far too
// heavy to be.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withClient, end, vacuumAfterReload } from "./lib/pg";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema",
  "pg",
);

const main = async (): Promise<void> => {
  // The same preflight the agri ingest runs, and for the same reason: CREATE
  // MATERIALIZED VIEW resolves its query at creation, so a missing input is not a
  // narrower cache but a 42P01 that rolls the whole file back. Skipping is the honest
  // outcome — /api/db/agri-hub-stats degrades and logs `ahs:not-built` once — and the
  // warning names what to run.
  const missing = await withClient(async (c) => {
    const { rows } = await c.query<{ missing: string[] }>(
      `SELECT array_remove(ARRAY[
         CASE WHEN to_regclass('public.agri_payloads') IS NULL THEN 'agri_payloads (db:load:agri:pg)' END,
         CASE WHEN to_regclass('public.contracts') IS NULL THEN 'contracts (db:load:pg)' END,
         CASE WHEN to_regclass('public.fund_projects') IS NULL THEN 'fund_projects (db:load:funds:pg)' END,
         CASE WHEN to_regclass('public.person_role') IS NULL THEN 'person_role (db:resolve:persons)' END,
         CASE WHEN to_regclass('public.agri_beneficiary_year') IS NULL THEN 'agri_beneficiary_year (db:load:agri:pg)' END,
         CASE WHEN to_regclass('public.budget_muni_transfer') IS NULL THEN 'budget_muni_transfer (db:load:budget-muni:pg)' END
       ], NULL) AS missing`,
    );
    return rows[0].missing;
  });
  if (missing.length) {
    console.warn(
      `[agri-hub-stats] skipped — absent: ${missing.join(", ")}. ` +
        "The /subsidies hub will render without its figures until those load.",
    );
    return;
  }

  for (const f of ["162_agri_hub_stats.sql", "163_agri_political.sql"])
    await exec(readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

  // 162 is created WITH NO DATA (it is refreshed here, and building it at apply time
  // would compute a vintage that is immediately replaced), so this REFRESH is not
  // optional — without it the matview raises 55000 on every read.
  const n = await withClient(async (c) => {
    await c.query("REFRESH MATERIALIZED VIEW agri_hub_stats_cache");
    // 163 shares this loader's person_role dependency exactly — it is the same gate,
    // resolved at the same moment — so refreshing it anywhere else would let the hub's
    // „политически свързани" count and the list behind it describe two vintages.
    await c.query("REFRESH MATERIALIZED VIEW agri_political_link");
    await c.query("REFRESH MATERIALIZED VIEW agri_cross_programme");
    const { rows } = await c.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agri_hub_stats_cache",
    );
    return rows[0].n;
  });
  // Outside the client above: VACUUM cannot run inside a transaction block, and a
  // non-concurrent REFRESH rewrites the heap wholesale, leaving the visibility map
  // empty like any other matview in this repo.
  await vacuumAfterReload(
    "agri_hub_stats_cache",
    "agri_political_link",
    "agri_cross_programme",
  );

  // A loud, cheap check on the arm this loader exists to fix. Zero politically-linked
  // companies across the whole corpus means the person layer was empty when the cache
  // was built — the exact state a first `db:refresh` leaves behind — and publishing it
  // as „0 фирми" would be a claim rather than an absence.
  const political = await withClient(async (c) => {
    const { rows } = await c.query<{ n: string | null }>(
      "SELECT (agri_hub_stats('all')->>'politicalEiks') AS n",
    );
    return rows[0].n;
  });
  console.log(
    `agri_hub_stats_cache rebuilt → ${n} scopes, ` +
      `${political ?? "no"} politically-linked companies (all scope)`,
  );
  if (political === null)
    console.warn(
      "[agri-hub-stats] the political arm is EMPTY — person_role carries no tr/ngo " +
        "roles. Run npm run db:resolve:persons, then re-run this loader.",
    );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then(end)
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
