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

  return { rows: rows.length };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const t0 = Date.now();
  loadAwarderSeatsPg()
    .then(async ({ rows }) => {
      console.log(
        `loaded ${rows} awarder seats → Postgres in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await end();
    })
    .catch(async (e) => {
      console.error(e);
      await end();
      process.exit(1);
    });
}
