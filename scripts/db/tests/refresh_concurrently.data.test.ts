// The non-blocking matview refresh (scripts/db/lib/pg.ts refreshMatviewConcurrently).
//
// What this protects is a LOCK, and a lock defect is invisible to every row count: the corpus
// is identical either way, and the only symptom is that readers of a served matview stall — or,
// past the pool's statement_timeout, 500 — for the length of the rebuild. Migration 096 cost
// 4 h 41 m of exactly that on production before it was cancelled, so the class is not
// hypothetical.
//
// Three properties, each with a failure mode of its own:
//   • CONCURRENTLY when the matview is populated — the whole point;
//   • a PLAIN refresh when it is not, because CONCURRENTLY raises 55000 on a matview created
//     WITH NO DATA, which is every first-ever run on a cold database;
//   • a skip, not a throw, when the matview does not exist — callers refresh objects owned by
//     other loaders' migrations.
//
// Auto-skips when Postgres is down.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, exec, end, refreshMatviewConcurrently } from "../lib/pg";

const reachable = await allRows<{ ok: number }>("SELECT 1 AS ok")
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : "Postgres unreachable";

afterAll(async () => {
  await exec("DROP MATERIALIZED VIEW IF EXISTS rmc_probe").catch(() => {});
  await end();
});

test.skipIf(skip)("a missing matview is skipped, not an error", async () => {
  await exec("DROP MATERIALIZED VIEW IF EXISTS rmc_probe");
  const did = await refreshMatviewConcurrently("rmc_probe");
  assert.equal(
    did,
    false,
    "a nonexistent matview must report that it did nothing",
  );
});

test.skipIf(skip)(
  "an UNPOPULATED matview is refreshed plainly rather than raising 55000",
  async () => {
    // The first-ever run on a cold database. CONCURRENTLY does not return zero rows here —
    // it raises object_not_in_prerequisite_state — so a caller that assumed populated would
    // abort the whole load on the one run that cannot possibly be interrupting a reader.
    await exec("DROP MATERIALIZED VIEW IF EXISTS rmc_probe");
    await exec(
      `CREATE MATERIALIZED VIEW rmc_probe AS SELECT g AS id FROM generate_series(1, 5) g
       WITH NO DATA`,
    );
    await exec("CREATE UNIQUE INDEX rmc_probe_pk ON rmc_probe (id)");
    const [before] = await allRows<{ populated: boolean }>(
      "SELECT relispopulated AS populated FROM pg_class WHERE oid = 'rmc_probe'::regclass",
    );
    assert.equal(before.populated, false, "fixture should start unpopulated");

    // Would throw 55000 if the helper hard-coded CONCURRENTLY.
    const did = await refreshMatviewConcurrently("rmc_probe");
    assert.equal(did, true);
    const [{ n }] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM rmc_probe",
    );
    assert.equal(Number(n), 5, "the plain refresh must have populated it");
  },
);

test.skipIf(skip)(
  "a POPULATED matview does not block a reader while it refreshes",
  async () => {
    // The property that matters is a LOCK, so it is asserted as one: a SECOND connection must
    // be able to read the matview WHILE the refresh is running. A plain REFRESH holds an
    // AccessExclusiveLock and that reader waits for the whole rebuild; CONCURRENTLY holds an
    // ExclusiveLock and the reader goes straight through.
    //
    // The fixture is deliberately SLOW — pg_sleep in the body, ~1.2 s to rebuild — because a
    // 5-row matview refreshes faster than the race can be observed, and a test that cannot
    // observe the difference is not testing the lock. Measured against a 400 ms ceiling, so
    // the margin is 3x.
    await exec("DROP MATERIALIZED VIEW IF EXISTS rmc_probe");
    await exec(
      `CREATE MATERIALIZED VIEW rmc_probe AS
         SELECT g AS id, pg_sleep(0.4) IS NULL AS slow FROM generate_series(1, 3) g`,
    );
    await exec("CREATE UNIQUE INDEX rmc_probe_pk ON rmc_probe (id)");

    // Start the refresh, and race a reader against it on its own connection.
    const refreshing = refreshMatviewConcurrently("rmc_probe");
    await new Promise((r) => setTimeout(r, 250)); // let the refresh take its lock first
    const t0 = Date.now();
    const [{ n }] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM rmc_probe",
    );
    const readMs = Date.now() - t0;
    assert.equal(await refreshing, true);
    assert.equal(Number(n), 3, "the reader saw the pre-refresh snapshot");
    assert.ok(
      readMs < 400,
      `the reader waited ${readMs} ms for the refresh — it was blocked, so the ` +
        "refresh took an AccessExclusiveLock rather than running CONCURRENTLY",
    );
  },
);

// EVERY CALLER, checked against the loaders' own text — the rule is only worth having if
// nothing routes around it. A plain `REFRESH MATERIALIZED VIEW <name>` on a matview that has a
// UNIQUE index and is read by a serving function is the exact shape this helper replaced, and
// it was live in load_magistrates_pg while load_tr_pg refreshed the SAME matview concurrently.
test("no loader refreshes a served matview with a blocking REFRESH", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const SERVED = ["company_officer_counts", "declaration_stake_company"];
  const offenders: string[] = [];
  for (const f of ["load_tr_pg.ts", "load_magistrates_pg.ts"]) {
    const src = readFileSync(join(__dirname, "..", f), "utf-8");
    for (const mv of SERVED)
      if (
        new RegExp(`REFRESH MATERIALIZED VIEW (?!CONCURRENTLY)\\s*${mv}`).test(
          src,
        )
      )
        offenders.push(`${f}: plain REFRESH of ${mv}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "a served matview is being refreshed with a lock that blocks its readers",
  );
});
