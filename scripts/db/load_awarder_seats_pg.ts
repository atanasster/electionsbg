// Load resolved awarder seats (buyer HQ: settlement · município · oblast) into
// Postgres so the DB company page can build a geographic footprint DB-only.
// Reuses computeAwarderSeats() — the same resolver the JSON awarder enrichment
// uses (geo EKATTE, else a unique name-parsed settlement) — so PG matches the
// /awarder JSON page's seats. Full rebuild from the awarder shards.
//
//   npm run db:load:awarder-seats:pg     (needs `npm run db:pg:up` first)
//
// See docs/plans/pg-datasets-roadmap.md + project_awarder_seat.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROC_DIR } from "./lib/paths";
import { exec, getPool, withClient, end } from "./lib/pg";
import { refreshScopedPrecomputes } from "./lib/scopedMatviews";
import { computeAwarderSeats } from "../procurement/enrich_awarder_seats";

const SCHEMA_FILE = path.join(
  PROC_DIR,
  "..",
  "..",
  "scripts",
  "db",
  "schema",
  "pg",
  "021_awarder_seats.sql",
);

const COLS = [
  "eik",
  "ekatte",
  "settlement",
  "municipality",
  "oblast",
  "is_village",
  "source",
  "tier",
  "is_local_hq",
];
const N = COLS.length;
const BATCH = 1000;

const waitForPg = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Postgres not reachable — run `npm run db:pg:up`.");
};

export const loadAwarderSeatsPg = async (): Promise<{ rows: number }> => {
  await waitForPg();
  await exec(readFileSync(SCHEMA_FILE, "utf8"));

  const seats = computeAwarderSeats();
  const rows = [...seats.entries()].map(([eik, s]) => [
    eik,
    s.ekatte ?? null,
    s.settlement ?? null,
    s.municipality ?? null,
    s.oblast ?? null,
    s.isVillage ?? null,
    s.source ?? null,
    s.tier ?? null,
    s.isLocalHQ ?? null,
  ]);

  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query("TRUNCATE awarder_seats");
    const insertCols = COLS.join(", ");
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = batch
        .map(
          (_, r) =>
            `(${COLS.map((_, col) => `$${r * N + col + 1}`).join(",")})`,
        )
        .join(",");
      await c.query(
        `INSERT INTO awarder_seats (${insertCols}) VALUES ${values}
         ON CONFLICT (eik) DO NOTHING`,
        batch.flat(),
      );
    }
    await c.query("COMMIT");
  });

  // INSIDE the exported loader, not in the CLI block below. This table decides WHICH buyers
  // are seated in a settlement, so every settlement-keyed precompute is stale the moment it
  // changes — 119's ranking, and 123's payloads, which additionally BAKE the seat's identity
  // into a stored blob. Without it a reload moves a buyer between settlements everywhere on
  // the site EXCEPT the by-settlement pages, on a 200, with nothing red anywhere. Putting it
  // in the CLI block would mean any future caller that imports this function (the
  // parallel-deploy orchestrator in docs/plans/cloud-deploy-speed-v1.md is the likely one)
  // silently re-opens exactly that gap.
  //
  // Only the awarder_seats-derived matviews: 122 has no settlement dimension and cannot be
  // moved by this table. 124 IS in that set, and for a reason that is easy to miss — it has no
  // settlement dimension either, but one of the six aggregates it stores
  // (procurement_concentration) resolves its `oblast` from this table, so a standalone reload
  // would otherwise leave /procurement/concentration on the previous attribution. Redundant
  // inside db:refresh (the scopes loader rebuilds everything a few steps later); the
  // standalone reload is the case this exists for.
  try {
    await refreshScopedPrecomputes(["awarder_seats"]);
  } catch (err) {
    // The table is loaded and COMMITTED — only the precompute refresh failed. Say so, or the
    // operator reads the stack trace under a success line and re-runs a loader that already
    // did its work (68 min on the cloud path). Rethrown: a silently-skipped refresh is the
    // failure class this call exists to prevent.
    console.error(
      "awarder_seats loaded OK, but the scoped precompute refresh failed. " +
        "Re-run `npm run db:load:procurement-scopes:pg` to rebuild them.",
    );
    throw err;
  }

  return { rows: rows.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  loadAwarderSeatsPg()
    .then(async ({ rows }) => {
      // Covers the refresh too, now that it runs inside the loader — the number
      // cloud-deploy-speed-v1 profiles this command against has to be the whole command.
      console.log(
        `loaded ${rows} awarder seats + refreshed precomputes in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
