// Tier 3 (Postgres-native) — the visibility map every single-transaction
// TRUNCATE+reload silently discards.
//
//   npm run test:data
//
// A loader that rebuilds a table with `TRUNCATE` + `INSERT`/`COPY` inside ONE
// transaction leaves `relallvisible = 0` PERMANENTLY, not transiently: TRUNCATE
// mints a new relfilenode with an empty map, every page is then written by a
// transaction that has not committed (so nothing can be marked all-visible), and
// the insert-threshold autovacuum that fires afterwards runs mid-`db:refresh`
// where a concurrent step holds back the xmin horizon — it marks nothing, resets
// `n_ins_since_vacuum` to 0, and with `n_dead_tup` also 0 never revisits the
// table. Postgres then cannot plan an index-only scan on it, ever.
//
// This is a gate on the CAUSE, and it is generic on purpose. The cost of the
// empty map is invisible in every direction a reviewer normally looks: row counts
// reconcile, the corpus is correct, the migration is untouched, and the plan is
// still *named* an Index Only Scan — it just reports `Heap Fetches: <every row>`.
// Both instances found so far were discovered by accident, and the first was
// initially misread as a function-body regression in a file nobody had edited.
//
// Requires the Postgres store. Auto-skips when it is unreachable or the table has
// not been loaded, exactly like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

// One entry per table a loader rebuilds with the single-transaction TRUNCATE
// shape, naming the loader that must call `vacuumAfterReload` for it. Add a row
// here when a new loader joins the pattern — that is the whole point of the file.
//
// `contracts` is deliberately ABSENT: it is stage-MERGEd rather than truncated
// (load_pg.ts, RowExclusiveLock so readers never block), and its map survives a
// reload intact. It is the counter-example that shows the defect belongs to the
// reload SHAPE and not to bulk loading.
const RELOADED: ReadonlyArray<{ table: string; loader: string }> = [
  { table: "fund_projects", loader: "db:load:funds:pg" },
  { table: "fund_beneficiaries", loader: "db:load:funds:pg" },
  { table: "tenders", loader: "db:load:tenders:pg" },
  { table: "tender_normalcy_cache", loader: "db:load:tenders:pg" },
  { table: "procurement_normalcy_cache", loader: "db:load:pg" },
  { table: "procurement_annexes", loader: "db:load:annexes:pg" },
  { table: "nzok_activities", loader: "db:load:nzok-activities:pg" },
  {
    table: "nzok_activity_facility_periods",
    loader: "db:load:nzok-activities:pg",
  },
];

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

for (const { table, loader } of RELOADED) {
  test.skipIf(skip)(`${table} keeps its visibility map`, async () => {
    const [vm] = await allRows<{ relpages: number; relallvisible: number }>(
      `SELECT relpages, relallvisible FROM pg_class WHERE relname = $1`,
      [table],
    );
    // Not loaded on this checkout — a gitignored-input loader that skipped, or a
    // partial refresh. Absent is that loader's problem, not this file's.
    if (!vm || vm.relpages === 0) return;
    assert.ok(
      vm.relallvisible >= vm.relpages * 0.9,
      `${table} has visibility-map coverage on ${vm.relallvisible} of ${vm.relpages} pages, ` +
        `so no index-only scan can be planned against it. ${loader} rebuilds it with ` +
        `TRUNCATE + insert inside one transaction and must call vacuumAfterReload ` +
        `(scripts/db/lib/pg.ts) after its COMMIT. To repair an already-loaded database: ` +
        `\`VACUUM (ANALYZE) ${table};\``,
    );
  });
}

// The one member of that list whose empty map was COSTING something, asserted as
// the property rather than as a page count.
//
// Migration 113 exists to make the /procurement/tenders browser's count+sum and
// its two facet GROUP BYs Index-Only Scans over idx_tenders_order — it grew that
// index an INCLUDE payload for exactly these columns, and functions/db_table.js
// routes the aggregate at the base `tenders` table rather than the tenders_list
// view (whose LEFT JOINs block index-only scans) as the other half of the same
// fix. 113's measured target was 4,357 buffers → 75.
//
// With relallvisible = 0 that plan survives in NAME only. Measured 2026-08-11 on
// the default (this-parliament) scope: 5,047 buffers and `Heap Fetches: 6088`,
// restored to 87 and `Heap Fetches: 0`. Neither 113 nor the corpus had changed.
// A buffer ceiling alone would not say why, so assert Heap Fetches directly —
// that number is 0 or it is the row count, with nothing in between.
test.skipIf(skip)(
  "the tenders browser aggregate is index-only in fact, not just in name",
  async () => {
    const [t] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM tenders",
    );
    if (!t || t.n === 0) return; // tenders not loaded on this checkout

    // The browser's own aggregate, windowed the way its default scope windows it.
    const plan = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT count(*) AS n, sum(estimated_value_eur) AS s
       FROM tenders WHERE publication_date >= $1`,
      ["2026-04-19"],
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");

    const fetches = /Heap Fetches: (\d+)/.exec(text);
    assert.ok(
      fetches,
      `the tenders count+sum is no longer an Index Only Scan at all — migration 113's ` +
        `idx_tenders_order INCLUDE payload or db_table.js's aggBase routing has been lost:\n${text}`,
    );
    assert.equal(
      Number(fetches[1]),
      0,
      `the tenders count+sum reports Heap Fetches: ${fetches[1]} — the plan is named an ` +
        `Index Only Scan but reads every tuple from the heap, which is what an empty ` +
        `visibility map does to it. db:load:tenders:pg must VACUUM after its reload; to ` +
        `repair now run \`VACUUM (ANALYZE) tenders;\`\n${text}`,
    );
  },
);
