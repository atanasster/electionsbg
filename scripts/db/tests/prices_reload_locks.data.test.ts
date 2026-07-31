// The price writers must never take a lock that blocks a serving read.
//
// WHAT REGRESSED. `TRUNCATE t; INSERT INTO t …` in one transaction holds an
// AccessExclusiveLock on `t` for the WHOLE rebuild, and AccessExclusive
// conflicts with the AccessShare every SELECT needs. Three price writers did
// exactly that on three tables the /api/db price routes read, so on prod:
//
//   price_product_days  (build_product_days) → /api/db/price-history 500'd in
//                        ~26-minute clusters (2026-07-28: 97, 07-30: 64)
//   price_current       (load_day)           → /api/db/price-product 500'd in
//                        1-2 minute bursts on every daily ingest
//   price_payloads      (build_payloads)     → /api/db/price-payload 504'd
//                        (2026-07-26, before the pool had a lock_timeout)
//
// Every failure landed at ~2.0 s: the serving pool's `lock_timeout: 2000`
// (functions/index.js) converting an unbounded stall into a fast 55P03. The
// timeout is the guard working; the defect was the writer. All three now build
// into a stage twin and MERGE (scripts/db/lib/stage_merge.ts), taking only
// RowExclusiveLock — the same fix the contracts corpus already uses.
//
// TWO GATES, because the failure has two independent shapes:
//   1. the helper itself must not escalate past RowExclusive on the live table;
//   2. no writer may TRUNCATE a table the price routes read — which is how this
//      would come back, since a new derived table is a natural place to reach
//      for TRUNCATE again. The served set is READ OUT OF db_routes.js rather
//      than hardcoded, so a route that starts reading a TRUNCATEd table trips
//      this too.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTx, dbReachable, end } from "../lib/pg";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "../lib/stage_merge";

afterAll(async () => {
  await end();
});

const haveDb = await dbReachable();
const skip = !haveDb;

// Locks that block a plain SELECT (AccessShareLock). ShareUpdateExclusive and
// below do not; AccessExclusive is the one TRUNCATE/DROP/plain-REFRESH take.
const BLOCKS_READS = new Set(["AccessExclusiveLock"]);

test.skipIf(skip)(
  "the stage merge never takes a read-blocking lock on the live table",
  async () => {
    const spec: StageMergeSpec = {
      table: "zz_merge_lock_probe",
      source: "zz_merge_lock_probe_stage",
      keys: ["k"],
      cols: ["k", "v"],
    };
    // Set the live table up in its OWN committed transaction. Creating it
    // alongside the merge would put the CREATE's own AccessExclusiveLock in the
    // measurement — pg_locks is cumulative per transaction, so the probe would
    // fail on its own scaffolding rather than on the merge.
    await withTx(async (c) => {
      await c.query(`DROP TABLE IF EXISTS ${spec.source}`);
      await c.query(`DROP TABLE IF EXISTS ${spec.table}`);
      await c.query(
        `CREATE TABLE ${spec.table} (k int PRIMARY KEY, v text NOT NULL)`,
      );
      // Rows the merge must update, keep and delete respectively.
      await c.query(
        `INSERT INTO ${spec.table} VALUES (1,'old'), (2,'same'), (3,'gone')`,
      );
    });

    await withTx(async (c) => {
      await createStageTable(c, spec);
      await c.query(
        `INSERT INTO ${spec.source} VALUES (1,'new'), (2,'same'), (4,'added')`,
      );
      await addStagePrimaryKey(c, spec);

      // The lock set is only meaningful once, taken together with the writes —
      // pg_locks is cumulative within the transaction, so anything the merge
      // escalated to is still listed here.
      await mergeFromStage(c, spec);
      const { rows: locks } = await c.query<{ mode: string }>(
        `SELECT l.mode FROM pg_locks l
          WHERE l.pid = pg_backend_pid()
            AND l.locktype = 'relation'
            AND l.relation = $1::regclass`,
        [spec.table],
      );
      assert.ok(locks.length > 0, "expected the merge to lock the live table");
      const blocking = locks
        .map((l) => l.mode)
        .filter((m) => BLOCKS_READS.has(m));
      assert.deepEqual(
        blocking,
        [],
        `stage merge took a read-blocking lock on ${spec.table}: ${blocking.join(", ")}`,
      );

      // And it is actually a merge, not a no-op: 1 updated, 2 kept, 3 deleted,
      // 4 inserted. (mergeFromStage's own parity guard already caught a
      // wrong-shape result, but that only proves the counts matched.)
      const { rows } = await c.query<{ k: number; v: string }>(
        `SELECT k, v FROM ${spec.table} ORDER BY k`,
      );
      assert.deepEqual(rows, [
        { k: 1, v: "new" },
        { k: 2, v: "same" },
        { k: 4, v: "added" },
      ]);
    });

    await withTx(async (c) => {
      await c.query(`DROP TABLE IF EXISTS ${spec.source}`);
      await c.query(`DROP TABLE IF EXISTS ${spec.table}`);
    });
  },
);

const REPO = path.resolve(import.meta.dirname, "../../..");

/** Tables the /api/db price-* routes SELECT from — the serving path. */
const servedByPriceRoutes = (): Set<string> => {
  const src = fs.readFileSync(
    path.join(REPO, "functions/db_routes.js"),
    "utf8",
  );
  // Each route is `"price-xxx": async (…) => { … }` up to the next route key.
  const out = new Set<string>();
  const routes = src.matchAll(
    /"(price-[a-z-]+)":\s*async[\s\S]*?(?=\n {2}\/\/ |\n {2}"[a-z][a-z0-9-]*":)/g,
  );
  for (const [body] of routes)
    for (const [, t] of body.matchAll(/\b(?:FROM|JOIN)\s+(price_[a-z_]+)/gi))
      out.add(t.toLowerCase());
  return out;
};

test.skipIf(skip)("no price writer TRUNCATEs a table the routes serve", () => {
  const served = servedByPriceRoutes();
  // Sanity: the extraction found the three tables this test exists for. A regex
  // that silently matched nothing would make the gate below vacuously pass.
  for (const t of ["price_product_days", "price_current", "price_payloads"])
    assert.ok(served.has(t), `expected ${t} in the served set (regex drift?)`);

  const dir = path.join(REPO, "scripts/prices");
  const files = fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"));
  const offences: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const line of src.split("\n")) {
      // Only real statements — the word also appears in explanatory comments.
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const [, t] of line.matchAll(/TRUNCATE\s+(?:TABLE\s+)?([a-z_]+)/gi))
        if (served.has(t.toLowerCase())) offences.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    `TRUNCATE on a served price table blocks every reader for the rest of the ` +
      `transaction — build into a stage twin and merge instead ` +
      `(scripts/db/lib/stage_merge.ts):\n${offences.join("\n")}`,
  );
});
