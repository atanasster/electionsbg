// Apply 135_rollcall_derived.sql and refresh the four roll-call precomputes.
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
import { exec, allRows, end } from "./lib/pg";
import { refreshRollcallMatviews } from "./lib/rollcallMatviews";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/135_rollcall_derived.sql");

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

  await exec(readFileSync(SCHEMA, "utf8"));
  const refreshed = await refreshRollcallMatviews();

  // A freshly created matview has no planner stats until autoanalyze eventually runs, so
  // its first serves are planned on a guess. Same reason as the ANALYZE loops in
  // load_declarations_pg / load_mp_roster_pg.
  for (const name of refreshed) await exec(`ANALYZE ${name}`);

  const counts = await allRows<{ mv: string; n: string }>(
    `SELECT 'mp_attendance' mv, count(*)::text n FROM mp_attendance
     UNION ALL SELECT 'party_cohesion', count(*)::text FROM party_cohesion
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
