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
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

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
