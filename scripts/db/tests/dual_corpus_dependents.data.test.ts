// Postgres gates for the ONE structural rule migration 077 imposes on the rest of the
// schema: nothing outside 077 may read `dual_corpus_rankings_cache` in a STORED QUERY.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS. 077 used to open with an unconditional, CASCADE-free
// `DROP MATERIALIZED VIEW IF EXISTS dual_corpus_rankings_cache` (there only so the following
// `DROP FUNCTION` could run), and `load_pg.ts` applies 077 on EVERY contracts load. So a view
// or matview selecting from that cache turned every `db:load:pg` into:
//
//   ERROR: cannot drop materialized view dual_corpus_rankings_cache because other objects
//          depend on it  (SQLSTATE 2BP01)
//
// aborting in the APPLY phase, BEFORE the COPY — so `contracts` silently kept serving the
// previous vintage while the ingest that produced the new shards reported success. Not a
// hypothetical: migration 145's `funds_hub_stats_cache` read the cache directly from
// 2026-08-09 (900e50dd4b) to 2026-08-10, blocking every procurement publish in that window on
// prod as well as locally, with nothing red anywhere.
//
// The fix has two halves and this file gates both, because either alone leaves the trap armed:
//
//   1. 077 no longer DROPs anything — neither statement was ever needed (the matview is a
//      fixed one-column wrapper over the function, and `CREATE OR REPLACE` handles the body).
//      Gated by the second test, which applies the REAL file text.
//   2. Callers read the cache through the plpgsql `dual_corpus_company_count()`, whose body
//      records no pg_depend edge — so the DROP coming back, or the one-time manual DROP that
//      077's header documents for a return-type change, cannot be fatal. Gated by the first
//      test, which asserts the PROPERTY rather than 145's one call site: the next migration
//      that wants this number will reach for the direct select too.
//
// The first gate PROVES IT DISCRIMINATES by reintroducing the defect in a rolled-back
// transaction — the pattern person_connections.data.test.ts uses for its buffer ceiling.
// Without that, "zero dependents" is satisfied by any query that has stopped matching.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, withClient, dbReachable, end } from "../lib/pg";
import { REPO_ROOT } from "../lib/paths";

const SCHEMA_077 = path.join(
  REPO_ROOT,
  "scripts/db/schema/pg/077_dual_corpus_rankings.sql",
);

const haveDb = await dbReachable();
const present = async (relname: string): Promise<boolean> =>
  haveDb &&
  Boolean(
    (
      await allRows<{ ok: string | null }>(
        `SELECT to_regclass('public.${relname}')::text AS ok`,
      )
    )[0]?.ok,
  );

// Skips only on an unreachable Postgres or a database with no contracts corpus (where 077 has
// never been applied and the rule is vacuous). It does NOT skip on a missing
// `funds_hub_stats_cache` — see the precondition assert in the second test.
const skip = !haveDb
  ? "Postgres unreachable"
  : !(await present("dual_corpus_rankings_cache"))
    ? "dual_corpus_rankings_cache absent — run npm run db:load:pg"
    : false;

afterAll(async () => {
  await end();
});

/** Views/matviews whose stored query reads `rel` — exactly what blocks a DROP. */
const STORED_QUERY_DEPENDENTS = `
  SELECT DISTINCT dep.relname AS name, dep.relkind AS kind
  FROM pg_depend d
  JOIN pg_rewrite r  ON r.oid = d.objid
  JOIN pg_class  dep ON dep.oid = r.ev_class
  WHERE d.classid  = 'pg_rewrite'::regclass
    AND d.refobjid = 'public.dual_corpus_rankings_cache'::regclass
    AND dep.oid   <> 'public.dual_corpus_rankings_cache'::regclass`;

test.skipIf(skip)(
  "dual_corpus_rankings_cache has no stored-query dependents",
  async () => {
    const rows = await allRows<{ name: string; kind: string }>(
      STORED_QUERY_DEPENDENTS,
    );
    assert.deepStrictEqual(
      rows,
      [],
      `${rows.length} object(s) read dual_corpus_rankings_cache in a stored query — ` +
        `every db:load:pg will now abort 2BP01 in its apply phase and leave the contracts ` +
        `table on the previous vintage. Read it through dual_corpus_company_count() instead ` +
        `(a plpgsql body records no dependency). Offender(s): ` +
        rows.map((r) => `${r.name} (relkind ${r.kind})`).join(", "),
    );

    // Prove the probe still discriminates: reintroduce 145's original direct read as a
    // throwaway matview and assert it is reported. Rolled back either way.
    const detected = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `CREATE MATERIALIZED VIEW t_direct_reader AS
             SELECT (r->>'companyCount')::int AS n FROM dual_corpus_rankings_cache
             WITH NO DATA`,
        );
        return (await c.query(STORED_QUERY_DEPENDENTS)).rows as {
          name: string;
        }[];
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
    assert.deepStrictEqual(
      detected.map((r) => r.name),
      ["t_direct_reader"],
      "the dependents probe no longer detects a direct reader — the gate above is vacuous",
    );
  },
);

test.skipIf(skip)(
  "077 re-applies against a database where funds_hub_stats_cache exists",
  async () => {
    // The end-to-end form of the rule, run against the REAL file text so it cannot drift from
    // what `load_pg.ts` applies. The precondition is asserted rather than skipped on: a
    // database without 145's cache is exactly the one on which the original defect was
    // invisible, so silently passing there is how this regresses.
    assert.ok(
      await present("funds_hub_stats_cache"),
      "funds_hub_stats_cache is absent — run npm run db:load:funds-fit:pg. This gate is " +
        "meaningless without the dependent that broke db:load:pg in the first place.",
    );

    const sql = readFileSync(SCHEMA_077, "utf8");
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // Throws 2BP01 here if any dependent has crept back — the exact failure db:load:pg hits.
        await c.query(sql);
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
  },
);

test.skipIf(skip)(
  "dual_corpus_company_count() degrades to NULL instead of raising",
  async () => {
    // Both states this cache can legitimately be in. A direct `SELECT … FROM` an unpopulated
    // matview RAISES 55000 rather than returning zero rows, and the cache is created WITH NO
    // DATA on a cold database (and again after the manual DROP 077's header documents for a
    // return-type change) — so with the direct read, a `db:load:funds-fit:pg` reaching it before
    // any `db:load:pg` REFRESH failed outright instead of rendering one tile without a figure.
    for (const [label, setup] of [
      [
        "unpopulated",
        "REFRESH MATERIALIZED VIEW dual_corpus_rankings_cache WITH NO DATA",
      ],
      ["absent", "DROP MATERIALIZED VIEW dual_corpus_rankings_cache"],
    ] as const) {
      const v = await withClient(async (c) => {
        await c.query("BEGIN");
        try {
          await c.query(setup);
          return (await c.query("SELECT dual_corpus_company_count() AS n"))
            .rows[0] as { n: number | null };
        } finally {
          await c.query("ROLLBACK").catch(() => {});
        }
      });
      assert.equal(
        v.n,
        null,
        `dual_corpus_company_count() should return NULL on an ${label} cache, got ${v.n}`,
      );
    }

    // …and still returns the real figure in the normal case, so "degrades" is not "always NULL".
    const [live] = await allRows<{ n: number | null; expected: number | null }>(
      `SELECT dual_corpus_company_count() AS n,
              (SELECT (r->>'companyCount')::int FROM dual_corpus_rankings_cache) AS expected`,
    );
    assert.equal(
      live?.n,
      live?.expected,
      "the wrapper disagrees with the cache it wraps",
    );
    assert.notEqual(
      live?.n,
      null,
      "populated cache yielded NULL — the wrapper is swallowing a real error",
    );
  },
);
