// recent_updates() must bound its index scans, not walk them.
//
// THIS GATE IS ABOUT THE PLAN, NOT THE CLOCK. A wall-time assertion on this repo's data
// tests is flaky under load (they run in parallel against one local Postgres), and it would
// also have PASSED for months while the defect was latent: the cost only appears when the
// recent window is quiet, so a busy fixture hides it.
//
// The defect, measured 2026-08-08: `cutoff` is a CTE referenced by five branches, and
// Postgres 12+ MATERIALISES a CTE referenced more than once. A materialised value is opaque
// at plan time, so `changed_at >= cutoff.ts` could not become an Index Cond on any branch —
// each walked its whole index backwards and applied the cutoff afterwards. At the route
// default (1, 200), which matched 2 rows, ingest_first_seen emitted 17,795,799 rows for zero
// output; 23.8 s locally, 166.9 s on Cloud SQL, against a 10 s statement_timeout. The fix is
// `NOT MATERIALIZED`; isolated, it is 175 ms → 0.060 ms on the same rows and indexes.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const planFor = async (days: number, lim: number): Promise<string[]> =>
  (
    await allRows<{ ["QUERY PLAN"]: string }>(
      `EXPLAIN (ANALYZE) SELECT * FROM recent_updates($1, $2)`,
      [days, lim] as never[],
    )
  ).map((r) => r["QUERY PLAN"]);

test("the deployed body carries NOT MATERIALIZED", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const [row] = await allRows<{ def: string }>(
    `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'recent_updates'`,
  );
  assert.ok(row, "recent_updates is absent — apply 007_query_builders.sql");
  assert.match(
    row.def,
    /WITH cutoff AS NOT MATERIALIZED/,
    "the cutoff CTE is materialised again — every branch will walk its whole index",
  );
});

test("no branch reads more rows than its recent window holds", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // The route's own default, and the shape that was a hard 500.
  const plan = await planFor(1, 200);

  // Actual rows emitted by each index scan in the plan. A bounded scan emits at most the
  // window's rows (plus the limit); an unbounded one emits the whole table.
  const scanned = plan
    .filter((l) => /Index Scan|Seq Scan|Bitmap Heap Scan/.test(l))
    .map((l) =>
      Number(l.match(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/)?.[1] ?? 0),
    );
  const worst = Math.max(0, ...scanned);

  // 200,000 is far above any legitimate one-day window (measured: 1,372 rows in
  // ingest_first_seen) and far below a full index walk (17.8M). Anything between is a
  // planner change worth looking at rather than a threshold to raise.
  assert.ok(
    worst < 200_000,
    `a scan emitted ${worst.toLocaleString()} rows for a one-day window — the cutoff is not ` +
      `bounding the index. Check that cutoff is NOT MATERIALIZED and that each branch's ` +
      `ordering column is still indexed.`,
  );
});

test("the cutoff reaches the index as a condition, on every ordering column", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const plan = await planFor(1, 200);
  const conds = plan.filter((l) => /Index Cond/.test(l)).join("\n");
  // Every branch whose ordering column is a timestamp with its own index — the ones that
  // walked 17.8M / 1.0M / 0.8M rows when the cutoff could not be pushed down. The TR
  // companies column is `last_updated`, NOT `updated_at`: a first draft of this test
  // asserted the latter and failed against a perfectly bounded plan.
  for (const col of [
    "first_seen_at",
    "last_updated",
    "changed_at",
    "last_loaded_at",
  ])
    assert.match(
      conds,
      new RegExp(`${col} >=`),
      `no Index Cond bounds ${col}; that branch is walking its whole index`,
    );
});

test("the ceiling shape stays inside the 10 s statement_timeout budget", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // The route clamps limit to 1–1000, so (3650, 1000) is the most expensive call it can
  // make. Asserted on ROWS READ rather than time, for the reason in the header.
  const plan = await planFor(3650, 1000);
  const rows = plan
    .filter((l) => /Index Scan|Seq Scan|Bitmap Heap Scan/.test(l))
    .map((l) =>
      Number(l.match(/actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/)?.[1] ?? 0),
    )
    .reduce((a, b) => a + b, 0);
  assert.ok(
    rows < 2_000_000,
    `the ceiling shape read ${rows.toLocaleString()} rows; it used to materialise 1,688,150 ` +
      `into a top-N heapsort and take 14 s`,
  );
});
