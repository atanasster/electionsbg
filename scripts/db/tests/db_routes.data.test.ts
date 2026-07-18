// Locks the SECURITY invariant on the only two /api/db routes that splice
// identifiers into SQL (company-counterparties, watch-signature): whatever a
// client sends as ?side= / ?kind=, the `me`/`other` slots must collapse to
// the fixed awarder/contractor pair and client text must never reach the SQL
// string — only the bound-parameter array. Pure JS over a mock dbRows; no
// Postgres needed, so it always runs (unlike the PG-probed suites).

import { test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../../functions/db_routes.js") as {
  DB_ROUTES: Record<
    string,
    (
      dbRows: (sql: string, params: unknown[]) => Promise<unknown[]>,
      q: Record<string, string>,
    ) => Promise<{ status?: number; body: unknown }>
  >;
};

const HOSTILE = [
  "awarder_eik = '1'; DROP TABLE contracts; --",
  "contractor); DELETE FROM contracts; --",
  "1 OR 1=1",
  "aWaRdEr", // case variant must not widen the ternary either
];

// Captures every SQL string + params the route issues.
const capture = () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dbRows = async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return [];
  };
  return { calls, dbRows };
};

const assertOnlyFixedIdentifiers = (
  calls: Array<{ sql: string; params: unknown[] }>,
  hostile: string,
) => {
  assert.ok(calls.length > 0, "route issued no SQL");
  for (const { sql, params } of calls) {
    // Client text never appears in the SQL string itself…
    assert.ok(
      !sql.includes(hostile),
      `client text leaked into SQL: ${sql.slice(0, 120)}`,
    );
    assert.ok(!/DROP|DELETE/i.test(sql), "destructive keyword reached SQL");
    // …and every *_eik identifier is one of the two fixed columns.
    // ([a-z0-9_]+) stops at the alias dot, so "c2.awarder_eik" → "awarder".
    for (const m of sql.matchAll(/([a-z0-9_]+)_eik/g)) {
      assert.ok(
        m[1] === "awarder" || m[1] === "contractor",
        `unexpected identifier ${m[0]} in: ${sql.slice(0, 120)}`,
      );
    }
    // Values travel as bound parameters only.
    assert.ok(Array.isArray(params));
  }
};

test("company-counterparties collapses hostile ?side= to the fixed ternary", async () => {
  for (const hostile of HOSTILE) {
    const { calls, dbRows } = capture();
    await DB_ROUTES["company-counterparties"](dbRows, {
      eik: "123456789",
      side: hostile,
    });
    assertOnlyFixedIdentifiers(calls, hostile);
    // A non-"awarder" side must resolve to the contractor branch exactly.
    assert.ok(
      calls[0].sql.includes("contractor_eik = $1"),
      "hostile side did not collapse to the contractor branch",
    );
  }
});

test("watch-signature rejects or collapses hostile ?kind=", async () => {
  for (const hostile of HOSTILE) {
    const { calls, dbRows } = capture();
    const res = await DB_ROUTES["watch-signature"](dbRows, {
      id: "123456789",
      kind: hostile,
    });
    // Unknown kinds are rejected outright (400) with zero SQL issued.
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  }
});

test("watch-signature company/awarder kinds use only the fixed identifiers", async () => {
  for (const kind of ["company", "awarder"]) {
    const { calls, dbRows } = capture();
    await DB_ROUTES["watch-signature"](dbRows, { id: "123456789", kind });
    assert.ok(calls.length > 0);
    for (const { sql } of calls) {
      assert.ok(
        /(contractor|awarder)_eik = \$1/.test(sql),
        `scope column not parameter-bound: ${sql.slice(0, 120)}`,
      );
    }
  }
});
