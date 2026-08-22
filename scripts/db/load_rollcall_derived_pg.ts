// Apply 135_rollcall_derived.sql + 181_party_cohesion_summary.sql and refresh the six
// roll-call precomputes.
//
// Run: `npm run db:load:rollcall-derived:pg` (local) / `:cloud` (Cloud SQL proxy).
// Must run AFTER db:load:rollcall:pg — it reads vote_item and vote_cast.
//
// This is a DERIVED serving layer, like person_search / contractor_search, so it takes no
// recent_updates row of its own: the fact loader already recorded the ingest, and a feed
// entry per precompute would report the same votes four more times.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, end, vacuumAfterReload } from "./lib/pg";
import { refreshRollcallMatviews } from "./lib/rollcallMatviews";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
// 181 after 135: it is a sibling of party_cohesion, not a dependent, but 135 opens with
// `DROP MATERIALIZED VIEW party_cohesion CASCADE` and applying them the other way round
// would leave the ordering meaningful only by luck.
const SCHEMA_FILES = [
  path.join(ROOT, "scripts/db/schema/pg/135_rollcall_derived.sql"),
  path.join(ROOT, "scripts/db/schema/pg/181_party_cohesion_summary.sql"),
];

const run = async (): Promise<void> => {
  // Preflight: refreshing against an absent or empty fact table produces four empty
  // matviews and exits 0, which is the shape that leaves a page serving nothing while
  // every command in the chain reports success.
  const facts = await allRows<{ items: string; casts: string }>(
    `SELECT (SELECT count(*) FROM vote_item) items,
            (SELECT count(*) FROM vote_cast) casts`,
  ).catch(() => []);
  if (!facts.length || Number(facts[0].items) === 0) {
    console.warn(
      "rollcall-derived: vote_item is absent or empty — run db:load:rollcall:pg first. " +
        "Refusing to build four empty matviews over it.",
    );
    await end();
    process.exitCode = 1;
    return;
  }
  console.log(
    `rollcall-derived: building over ${Number(facts[0].items).toLocaleString("en")} items / ` +
      `${Number(facts[0].casts).toLocaleString("en")} casts`,
  );

  for (const f of SCHEMA_FILES) await exec(readFileSync(f, "utf8"));
  const refreshed = await refreshRollcallMatviews();

  // A freshly created matview has no planner stats until autoanalyze eventually runs, so its
  // first serves are planned on a guess. Same reason as the ANALYZE loops in
  // load_declarations_pg / load_mp_roster_pg.
  //
  // vacuumAfterReload rather than a bare ANALYZE, because stats are only half of what a
  // fresh matview is missing. `REFRESH MATERIALIZED VIEW` rewrites into a new relfilenode
  // whose visibility map is EMPTY, so until something vacuums it Postgres cannot plan an
  // index-only scan — and ANALYZE stamps `last_analyze` without touching that map, which
  // makes the table look freshly maintained while it is not. Measured 2026-08-21, before
  // this change: `mp_similarity` at 97.7% of pages visible with `last_vacuum` NULL, i.e.
  // autovacuum had happened to reach it, which is timing rather than a guarantee.
  //
  // It matters most on exactly the matview that is most expensive to rebuild: `mp_similarity`
  // is the quadratic one (744.5 s on Cloud SQL), so its per-MP peer reads must ride
  // idx_mp_similarity_pk / _b cleanly rather than fall back to heap fetches.
  //
  // ⚠️ THE FIVE NAMES ARE SPELLED OUT AS LITERALS ON PURPOSE — do not "tidy" this into
  // `vacuumAfterReload(...refreshed)`. reload_visibility_map.data.test.ts scans loader call
  // sites with `/(?:vacuumAfterReload|compactAfterReload)\(([^)]*)\)/` and then reads STRING
  // LITERALS out of the captured argument list, so a variable spread contributes nothing and
  // the gate goes silently one-directional: it would neither notice these five missing from
  // RELOADED, nor notice a revert to a bare ANALYZE. The first draft of this change used the
  // spread and was caught by review, not by the gate — which is the whole point.
  //
  // Filtered by `refreshed` rather than called unconditionally because a matview 135 has not
  // created yet is a legitimate state (refreshRollcallMatviews warns and skips), and VACUUM
  // on an absent relation is 42P01 — unlike compactAfterReload, this helper does not
  // to_regclass its way past that. An empty result is a safe no-op: the helper builds one
  // statement per name, so zero names issue zero VACUUMs rather than vacuuming the database.
  await vacuumAfterReload(
    ...(
      [
        "mp_attendance",
        "party_cohesion",
        "party_cohesion_summary",
        "mp_dissent",
        "mp_vote_norm",
        "mp_similarity",
      ] as const
    ).filter((t) => refreshed.includes(t)),
  );

  const counts = await allRows<{ mv: string; n: string }>(
    `SELECT 'mp_attendance' mv, count(*)::text n FROM mp_attendance
     UNION ALL SELECT 'party_cohesion', count(*)::text FROM party_cohesion
     UNION ALL SELECT 'party_cohesion_summary', count(*)::text FROM party_cohesion_summary
     UNION ALL SELECT 'mp_dissent', count(*)::text FROM mp_dissent
     UNION ALL SELECT 'mp_similarity', count(*)::text FROM mp_similarity`,
  );
  console.log(
    `rollcall-derived: ${counts.map((c) => `${c.mv}=${Number(c.n).toLocaleString("en")}`).join(" · ")}`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
