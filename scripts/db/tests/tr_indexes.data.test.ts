// A loaded database must carry every index `db:load:tr:pg` builds.
//
// The state this exists to name: **the TR tables populated but UNINDEXED.** The loader drops
// its eleven secondary indexes so each is built once over the finished table, and until
// 2026-08-10 those drops ran through `exec()` — autocommit, outside every transaction — before
// the COPY phase, with the rebuild at the very end. Any failure in between (a killed process,
// a dropped Cloud SQL proxy connection on a 35-minute `db:load:tr:pg:cloud`) committed the
// drops and never reached the creates. Because each `replaceTable` commits on its own, the
// result is ~1M rows present and correct with no secondary indexes — a state every row-count
// check in this repo reports as healthy.
//
// Observed for real: person queries joining `tr_officers.name_fold` went from sub-second to
// >10 minutes, the next load's TRUNCATE queued behind them, and every reader of all three
// tables then queued behind the pending AccessExclusive. Recorded as F21 in
// docs/plans/cloud-deploy-speed-v1.md.
//
// The drops now live inside each table's own `replaceTable` transaction, so an aborted load
// rolls them back — but that only protects databases loaded by the fixed code. This gate is
// what turns "person queries are mysteriously slow" into a named failure on any database,
// however it got there. Recovery needs no reload: re-run LOAD_INDEXES + ANALYZE.
//
// LOAD_INDEXES is imported from the loader rather than restated, so a new index is covered the
// day it is added.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { LOAD_INDEXES } from "../load_tr_pg";

const haveDb = await dbReachable();

// EXISTS, never count(*). The full count reads ~1M rows and holds AccessShare for as long as
// it runs, which conflicts with the ACCESS EXCLUSIVE that migration_drop_dependents' DDL
// probes take on these same tables — and vitest runs test FILES in parallel, so a scan here
// made that file's bounded lock wait time out. The question is only "is there a corpus", and
// EXISTS answers it after one row.
const loaded =
  haveDb &&
  Boolean(
    (
      await allRows<{ ok: string | null }>(
        "SELECT to_regclass('public.tr_companies')::text AS ok",
      )
    )[0]?.ok,
  ) &&
  Boolean(
    (
      await allRows<{ any: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM tr_companies) AS any",
      )
    )[0]?.any,
  );

// Skips on a database with no TR corpus — the loader is a documented db:refresh EXCLUSION, so
// a fresh clone legitimately has none, and asserting there would fail every CI run. It does
// NOT skip merely because indexes are missing: that is the finding.
const skip = !haveDb
  ? "Postgres unreachable"
  : !loaded
    ? "no TR corpus — run npm run db:load:tr:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "every LOAD_INDEXES index exists on a loaded database",
  async () => {
    const present = new Set(
      (
        await allRows<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename IN ('tr_companies','tr_officers','tr_person_roles','ngo_details')`,
        )
      ).map((r) => r.indexname),
    );

    // Sanity: an empty catalogue read would make the assertion below vacuous in the one
    // direction that matters.
    assert.ok(
      present.size > 0,
      "read no indexes at all for the TR tables (query drift?)",
    );

    const missing = LOAD_INDEXES.filter((i) => !present.has(i.name)).map(
      (i) => `${i.name} (on ${i.table})`,
    );

    assert.deepStrictEqual(
      missing,
      [],
      "the TR tables are populated but missing indexes the loader builds. An interrupted " +
        "db:load:tr:pg used to commit its up-front DROP INDEX and never reach the rebuild, " +
        "leaving ~1M correct rows that every row count reports as healthy and every person " +
        "query seq-scans (cloud-deploy-speed-v1.md F21). Recovery needs NO reload — re-run the " +
        "LOAD_INDEXES statements from scripts/db/load_tr_pg.ts, then ANALYZE. Missing:\n  " +
        missing.join("\n  "),
    );
  },
);
