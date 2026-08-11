// The cold-bootstrap gate — the only check that distinguishes "the bootstrap works" from
// "the bootstrap works on a machine that already has the role and the extensions".
//
// It builds a VIRGIN database (no pg_trgm, no app_readonly grants, nothing) and applies
// roles_readonly.sql the way bootstrap_roles.ts does. Every part of that matters:
//
//   * A warm database hides the defect this file was written for. `exec()` preflights
//     `SELECT similarity('','')`, and pg_trgm is created by 000_search_fns.sql — applied
//     FOUR STEPS LATER by db:load:pg. So the first draft of the bootstrap failed with 42883
//     on the only case it exists for, and passed on every developer machine.
//   * Roles are CLUSTER-wide, so this test cannot create a virgin ROLE — only a virgin
//     DATABASE. It therefore asserts the applier reaches the end, which is what 42883 broke,
//     rather than asserting the role did not previously exist.
//
// Auto-skips when Postgres is down, like every other .data.test.ts. The pure-parser half of
// this file's contract lives in ../bootstrap_roles.test.ts, which runs without a database.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { allRows, dbReachable, end, exec, LOCAL_DATABASE_URL } from "../lib/pg";

const haveDb = await dbReachable();
const VIRGIN = "zz_bootstrap_roles_probe";
const SCHEMA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../schema/pg/roles_readonly.sql",
);

const virginUrl = (): string =>
  LOCAL_DATABASE_URL.replace(/\/[^/]*$/, `/${VIRGIN}`);

/** CREATE/DROP DATABASE cannot run inside a transaction or against the database being
 *  dropped, so this uses its own client on `postgres`. */
const onMaintenance = async (sql: string): Promise<void> => {
  const c = new Client({
    connectionString: LOCAL_DATABASE_URL.replace(/\/[^/]*$/, "/postgres"),
  });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
};

afterAll(async () => {
  if (haveDb) {
    await onMaintenance(`DROP DATABASE IF EXISTS ${VIRGIN}`).catch(() => {});
    await end();
  }
});

test("roles_readonly.sql applies to a VIRGIN database (no extensions)", async (t) => {
  if (!haveDb) return t.skip();

  await onMaintenance(`DROP DATABASE IF EXISTS ${VIRGIN}`);
  await onMaintenance(`CREATE DATABASE ${VIRGIN}`);

  const sql = readFileSync(SCHEMA, "utf8").replace(
    /GRANT CONNECT ON DATABASE \w+/,
    `GRANT CONNECT ON DATABASE ${VIRGIN}`,
  );

  const c = new Client({ connectionString: virginUrl() });
  await c.connect();
  try {
    // Guard against a vacuous pass: if pg_trgm were somehow present, this test would prove
    // nothing about the cold case it exists for.
    const { rows: ext } = await c.query(
      `SELECT count(*)::int n FROM pg_extension WHERE extname = 'pg_trgm'`,
    );
    assert.equal(
      ext[0].n,
      0,
      "the probe database already has pg_trgm — this test is not exercising a cold start",
    );

    // The applier's own shape: a raw query, NOT exec(). If someone "tidies" bootstrap_roles.ts
    // back to exec(), this is the line whose equivalent there starts failing.
    await c.query(sql);

    const { rows } = await c.query(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') AS ok`,
    );
    assert.ok(
      rows[0].ok,
      "app_readonly does not exist after applying roles_readonly.sql",
    );
  } finally {
    await c.end();
  }
});

test("exec() is NOT usable here — the reason bootstrap_roles.ts uses a raw query", async (t) => {
  if (!haveDb) return t.skip();
  // Non-vacuity for the test above. Without this, a future change making exec() safe on a
  // cold database would leave the comment in bootstrap_roles.ts stating a constraint that no
  // longer exists, and nobody would know. If THIS test starts failing, exec() has become
  // safe and that comment (and possibly the raw-query workaround) should be revisited.
  await onMaintenance(`DROP DATABASE IF EXISTS ${VIRGIN}`);
  await onMaintenance(`CREATE DATABASE ${VIRGIN}`);

  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = virginUrl();
  try {
    // exec() reads the module-level DATABASE_URL captured at import, so drive a fresh client
    // through the same preflight instead of relying on the env change landing.
    const c = new Client({ connectionString: virginUrl() });
    await c.connect();
    try {
      await assert.rejects(
        () => c.query("SELECT similarity('', '')"),
        /similarity/,
        "similarity() resolved on a virgin database — exec()'s preflight is no longer a " +
          "cold-start hazard, so bootstrap_roles.ts's raw-query comment is now stale",
      );
    } finally {
      await c.end();
    }
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("the bootstrap grants what the loaders actually need", async (t) => {
  if (!haveDb) return t.skip();
  // TEST-003: "the role exists" is not the property that matters — db:load:pg's bare GRANTs
  // need it to exist, and every /api/db endpoint needs it to be able to READ. Asserted
  // against the real database, where the loaders have run.
  const [row] = await allRows<{ can_connect: boolean; usage: boolean }>(
    `SELECT has_database_privilege('app_readonly', current_database(), 'CONNECT') AS can_connect,
            has_schema_privilege('app_readonly', 'public', 'USAGE')               AS usage`,
  );
  assert.ok(
    row.can_connect,
    "app_readonly cannot CONNECT — /api/db would fail to log in",
  );
  assert.ok(
    row.usage,
    "app_readonly has no USAGE on public — every query would 42501",
  );

  // Re-applying must stay idempotent: db:refresh runs this on every invocation, not just the
  // first, so a second run has to be a no-op rather than an error.
  await exec(readFileSync(SCHEMA, "utf8"));
});
