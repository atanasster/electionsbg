// Populate procurement_scopes (schema: 118_procurement_scopes.sql) — the pscope windows the
// scoped procurement precomputes iterate over.
//
// THE WINDOWS ARE NOT DEFINED HERE. They come from allScopeWindows() in
// src/data/scope/windows.ts, the same function useScopeWindow calls to decide which window
// the page is asking for. That shared definition is the whole point: a precompute keyed on
// a window the UI computes differently does not fail — it serves one period's numbers under
// another period's label, which no test of either side alone would catch.
//
// Re-run whenever a NEW ELECTION lands in src/data/json/elections.json (a new `ns:` window)
// or the calendar year turns over (a new `y:` window). Cheap and idempotent — a few dozen
// rows — so db:refresh just runs it every time.
//
// Run: `npm run db:load:procurement-scopes:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withTx, end } from "./lib/pg";
import {
  allScopeWindows,
  type ElectionRef,
  type ScopeWindow,
} from "../../src/data/scope/windows";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/118_procurement_scopes.sql",
);
// The per-scope precomputes that ITERATE those rows. Applied here rather than in load_pg
// because they read place_dim (117) and procurement_scopes (118), both of which are loaded
// after it — building them any earlier would populate them from empty inputs.
const SCOPED = path.join(
  ROOT,
  "scripts/db/schema/pg/119_procurement_settlement_scoped.sql",
);
// The per-scope contractor leaderboard (122). Same shape as 119 — reads
// procurement_scopes (118) + contracts, so applied here rather than in load_pg.
const CONTRACTORS = path.join(
  ROOT,
  "scripts/db/schema/pg/122_contractor_rank.sql",
);
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

const SCOPED_MATVIEWS = [
  "procurement_settlement_rank",
  "procurement_geo_payloads",
  // contractor_rank BEFORE contractor_scope_kpis: the KPI matview reads the rank
  // matview, so it must see the freshly-refreshed rows.
  "contractor_rank",
  "contractor_scope_kpis",
] as const;

/** REFRESH the scoped precomputes, CONCURRENTLY where possible.
 *
 *  CONCURRENTLY because both sit on the /procurement/by-settlement serving path and a plain
 *  REFRESH holds an AccessExclusiveLock for the whole ~12 s recompute — it would stall the
 *  page rather than merely delay its data. It requires a populated matview and a unique
 *  index (119 creates both), so the first refresh after a CREATE falls back to the plain
 *  form. Cannot run inside a transaction, hence exec() rather than withTx(). */
export const refreshScopedSettlement = async (): Promise<void> => {
  for (const mv of SCOPED_MATVIEWS) {
    try {
      await exec(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
    } catch (err) {
      // ONLY 0A000 (feature_not_supported) — Postgres raises it for "CONCURRENTLY cannot be
      // used when the materialized view is not populated". 119 creates both WITH NO DATA,
      // so the first refresh after an apply always lands here and must fall back to the
      // plain form. (0A000, not the more intuitive 55000: verified against the server.)
      //
      // Narrow on purpose: a bare catch would swallow a lock timeout, a permissions error
      // or a unique violation and then silently take the very AccessExclusiveLock the
      // CONCURRENTLY form exists to avoid — turning a loud failure into a stalled page.
      if ((err as { code?: string })?.code !== "0A000") throw err;
      await exec(`REFRESH MATERIALIZED VIEW ${mv}`);
    }
  }
};

export const readScopeWindows = (nowYear: number): ScopeWindow[] => {
  const elections = JSON.parse(
    readFileSync(ELECTIONS, "utf8"),
  ) as ElectionRef[];
  return allScopeWindows(elections, nowYear);
};

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  const windows = readScopeWindows(new Date().getFullYear());

  await withTx(async (c) => {
    // Upsert + delete-the-rest rather than TRUNCATE + insert. Both forms are atomic for a
    // reader (one transaction, READ COMMITTED sees either the whole old set or the whole
    // new one) — the difference is the LOCK: TRUNCATE takes an AccessExclusiveLock that
    // blocks every reader of this table for the duration, while these row-level writes do
    // not. Cheap either way at ~30 rows, but this table sits under the scoped precomputes,
    // so it should never be the thing that stalls them.
    for (const [i, w] of windows.entries())
      await c.query(
        `INSERT INTO procurement_scopes (scope_key, date_from, date_to, sort_ord)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scope_key) DO UPDATE
           SET date_from = EXCLUDED.date_from,
               date_to   = EXCLUDED.date_to,
               sort_ord  = EXCLUDED.sort_ord`,
        [w.key, w.from, w.to, i],
      );
    await c.query(
      `DELETE FROM procurement_scopes WHERE scope_key <> ALL($1::text[])`,
      [windows.map((w) => w.key)],
    );
  });

  // Rebuild the per-scope precomputes against the window set just written. Applied AND
  // refreshed here so "the scopes changed" and "the precomputes match the scopes" can never
  // be two separate states — a new election otherwise leaves its own scope with no rows,
  // which reads as "this parliament awarded nothing" rather than as staleness.
  await exec(readFileSync(SCOPED, "utf8"));
  await exec(readFileSync(CONTRACTORS, "utf8"));
  await refreshScopedSettlement();

  console.log(
    `procurement_scopes: ${windows.length} window(s) ` +
      `(${windows.filter((w) => w.key.startsWith("ns:")).length} parliament, ` +
      `${windows.filter((w) => w.key.startsWith("y:")).length} year, 1 all)`,
  );
};

// Guarded so a test can import readScopeWindows() without the loader firing — main()
// applies DDL and writes against whatever DATABASE_URL is set, including a Cloud SQL proxy
// target left in the shell (see pinLocalDatabase in lib/pg.ts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(end);
}
