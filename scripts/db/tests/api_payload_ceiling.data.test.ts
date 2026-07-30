// A SIZE CEILING on the parameterless /api/db routes.
//
// WHY: the whole payload diet started because `procurement-risk-indexes` had
// grown to 1.29 MB without anyone noticing — it got there one honest slice at a
// time, each individually defensible. Nothing measured the total, so nothing
// objected. This is the thing that objects.
//
// The ceilings below are deliberately set ABOVE today's measurement, not at it.
// A ceiling pinned to the current byte count fails on every legitimate corpus
// growth and gets raised reflexively until it means nothing; one with headroom
// only fires on a step change, which is the event worth a human looking. Every
// one is ~1.3x its measurement, so the headroom is uniform rather than an
// accident of which number happened to be handy.
//
// ⚠️ `measuredKb` is measured HERE, in-process, in KiB. Do not transcribe it from
// the plan's prod table — those are decimal kB over the wire and disagree by ~2%,
// which is enough to make the recorded headroom a fiction.
//
// Routes are invoked directly (functions/db_routes.js) against the local
// database, so this measures what actually goes on the wire.
//
// ⚠️ Measured RAW, not gzipped. T0 compresses these ~5x in transit, but the raw
// size is what the browser must parse and hold, and it is the number that grew
// unnoticed. If a route legitimately crosses its ceiling, RAISE IT DELIBERATELY
// in the same commit that grows it, with the reason.
//
// Auto-skips when Postgres is down — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { allRows, dbReachable, end } from "../lib/pg";

const require_ = createRequire(import.meta.url);
const { DB_ROUTES } = require_("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params?: unknown[]) => Promise<unknown[]>,
      q?: Record<string, unknown>,
    ) => Promise<{ body: unknown }>
  >;
};

const dbRows = (sql: string, params: unknown[] = []) => allRows(sql, params);

/** route → raw-JSON ceiling in KB, with the measurement it was set from.
 *  Ordered biggest-first, which is also roughly the order worth worrying about.
 *
 *  Only routes that answer with NO query parameters belong here — each is called
 *  with an empty `q`. A route needing a scope, an eik or a key returns a slice
 *  whose size is the caller's choice, not a payload budget. */
const CEILINGS: [route: string, kb: number, measuredKb: number][] = [
  // The one that started this. Cannot shrink until the tender screens get their
  // own risk index (see the plan's T2 note), so the ceiling holds the line rather
  // than driving it down — and its headroom is the tightest here on purpose.
  ["procurement-risk-indexes", 1600, 1287],
  ["mp-roster", 1150, 869],
  ["procurement-concentration", 1100, 837],
  ["municipal-officials-name-index", 1050, 804],
  ["municipal-officials-search-index", 1050, 791],
  ["procurement-rankings", 560, 425],
  ["procurement-flow", 490, 375],
  ["magistrate-search", 490, 374],
  ["cpv-catalog", 460, 355],
  ["dual-corpus-rankings", 320, 246],
  ["procurement-by-settlement", 175, 133],
  ["procurement-scanner", 130, 99],
  ["excise-warehouses", 80, 57],
  ["mp-avatars", 50, 36],
  ["procurement-overview", 35, 25],
  ["kzk-appeals", 30, 21],
  ["procurement-ngo-foreign", 12, 7],
];

// A reachable-but-UNLOADED database would pass every ceiling vacuously — several
// of these routes swallow a missing migration into `{entries: []}` with a 200, so
// "0 KB" reads as a pass. Gate on the corpus the biggest payloads derive from.
const haveDb = await dbReachable();
const corpusLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>("SELECT count(*) n FROM contracts").catch(
        () => [{ n: "0" }],
      )
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !corpusLoaded
    ? "contracts corpus empty — every ceiling would pass vacuously"
    : false;

afterAll(async () => {
  await end();
});

for (const [route, ceilingKb, measuredKb] of CEILINGS) {
  test.skipIf(skip)(
    `${route} stays under ${ceilingKb} KB (was ${measuredKb} KB)`,
    async () => {
      const fn = DB_ROUTES[route];
      assert.ok(fn, `route ${route} no longer exists — update this list`);

      let body: unknown;
      try {
        ({ body } = await fn(dbRows, {}));
      } catch (e) {
        // A route that cannot run on a loaded database is a different failure,
        // and one this gate should not disguise as a size pass.
        throw new Error(
          `${route} threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const kb = Buffer.byteLength(JSON.stringify(body ?? null)) / 1024;
      assert.ok(
        kb <= ceilingKb,
        `${route} is ${kb.toFixed(0)} KB, over its ${ceilingKb} KB ceiling ` +
          `(was ${measuredKb} KB when the ceiling was set). Either trim the ` +
          `payload or raise the ceiling deliberately in the commit that grew it — ` +
          `this gate exists because a 1.29 MB payload got there unnoticed.`,
      );
    },
  );
}
