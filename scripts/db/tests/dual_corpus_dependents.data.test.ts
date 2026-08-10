// Postgres gates for the ONE structural rule a loader-applied migration imposes on the rest of
// the schema: nothing may read a matview that migration DROPs in a STORED QUERY. Guarded here
// for both such caches — 077's `dual_corpus_rankings_cache` and 145's `funds_hub_stats_cache`.
//
// The GENERAL form of that rule — every DROP in scripts/db/schema/pg/, not just these two —
// lives in migration_drop_dependents.data.test.ts, written after 003_tr_search.sql was found
// doing the CASCADE variant of the same thing to three matviews for its whole life. This file
// keeps what is specific to 077/145: the plpgsql-wrapper contract below, and the assertion
// that 077's file text carries no DROP at all.
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

/**
 * Everything whose STORED definition reads `rel` — i.e. exactly what makes a `DROP` on it fail.
 *
 * TWO dependency classes, and the second is the one that is easy to miss. A view or matview
 * records its dependency through `pg_rewrite`; a `LANGUAGE sql … BEGIN ATOMIC` function
 * (PG14+, and docker-compose pins postgres:16) is parsed at definition time and records its
 * dependency through `pg_proc` instead. It blocks the DROP just as hard, with the same 2BP01,
 * and a `pg_rewrite`-only probe reports zero. Measured on the live database: a BEGIN ATOMIC
 * reader → rewrite arm returns nothing, and `DROP MATERIALIZED VIEW` still fails with
 * "function t_atomic_reader() depends on materialized view dual_corpus_rankings_cache".
 *
 * That matters here more than anywhere else, because BEGIN ATOMIC is the precise vector 077's
 * header, 145's header, this file's header and CLAUDE.md all name as the way this silently
 * comes back — so a probe blind to it would leave the gate green on the one regression every
 * comment in the set warns about.
 *
 * The sanctioned shapes — plpgsql, and a string-bodied `LANGUAGE sql` — record nothing in
 * either class and correctly never appear. The discrimination proof below asserts all three.
 */
const dependentsSql = (rel: string): string => `
  SELECT DISTINCT dep.relname AS name, dep.relkind::text AS kind
  FROM pg_depend d
  JOIN pg_rewrite r  ON r.oid = d.objid
  JOIN pg_class  dep ON dep.oid = r.ev_class
  WHERE d.classid  = 'pg_rewrite'::regclass
    AND d.refobjid = 'public.${rel}'::regclass
    AND dep.oid   <> 'public.${rel}'::regclass
  UNION ALL
  SELECT DISTINCT p.proname, 'function'
  FROM pg_depend d
  JOIN pg_proc p ON p.oid = d.objid
  WHERE d.classid  = 'pg_proc'::regclass
    AND d.refobjid = 'public.${rel}'::regclass`;

const dependentsOf = (rel: string): Promise<{ name: string; kind: string }[]> =>
  allRows<{ name: string; kind: string }>(dependentsSql(rel));

// BOTH matviews a loader-applied migration DROPs on every run, not just the one that has
// already been burned. 145 DROPs `funds_hub_stats_cache` on every `db:load:funds-fit:pg`, so it
// carries the identical rule for the identical reason — and until 2026-08-10 it did so with
// CASCADE, where the failure is not a loud 2BP01 but a SILENT deletion of the dependent on
// every load. Presence is asserted rather than skipped on, for the reason given in the second
// test: the database where this gate is vacuous is exactly the one the defect hid on.
const GUARDED = [
  "dual_corpus_rankings_cache",
  "funds_hub_stats_cache",
] as const;

test.skipIf(skip)(
  "no migration-DROPped cache has a stored-query dependent",
  async () => {
    for (const rel of GUARDED) {
      assert.ok(
        await present(rel),
        `${rel} is absent — run npm run db:load:pg / db:load:funds-fit:pg`,
      );
      const rows = await dependentsOf(rel);
      assert.deepStrictEqual(
        rows,
        [],
        `${rows.length} object(s) read ${rel} in a stored definition — the migration that ` +
          `DROPs it runs on every load, so this either aborts that loader with 2BP01 (leaving ` +
          `its table on the previous vintage) or, under CASCADE, silently deletes the ` +
          `dependent. Read it through a plpgsql wrapper instead. Offender(s): ` +
          rows.map((r) => `${r.name} (${r.kind})`).join(", "),
      );
    }

    // Prove the probe still discriminates — one fixture per class, plus the two sanctioned
    // shapes which must stay invisible. Without the BEGIN ATOMIC fixture the pg_proc arm is
    // untested in exactly the way this file's header warns about. Rolled back either way.
    const detected = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // pg_rewrite class — 145's original direct read.
        await c.query(
          `CREATE MATERIALIZED VIEW t_direct_reader AS
             SELECT (r->>'companyCount')::int AS n FROM dual_corpus_rankings_cache
             WITH NO DATA`,
        );
        // pg_proc class — the SQL-standard body form that parses at definition time.
        await c.query(
          `CREATE FUNCTION t_atomic_reader() RETURNS int LANGUAGE sql STABLE
             BEGIN ATOMIC
               SELECT (r->>'companyCount')::int FROM dual_corpus_rankings_cache;
             END`,
        );
        // The two sanctioned shapes: neither records an edge, so neither may be reported.
        await c.query(
          `CREATE FUNCTION t_plpgsql_reader() RETURNS int LANGUAGE plpgsql STABLE AS $b$
             BEGIN RETURN (SELECT (r->>'companyCount')::int FROM dual_corpus_rankings_cache);
             END $b$`,
        );
        await c.query(
          `CREATE FUNCTION t_sqlstring_reader() RETURNS int LANGUAGE sql STABLE AS $b$
             SELECT (r->>'companyCount')::int FROM dual_corpus_rankings_cache
           $b$`,
        );
        return (await c.query(dependentsSql("dual_corpus_rankings_cache")))
          .rows as { name: string }[];
      } finally {
        await c.query("ROLLBACK").catch(() => {});
      }
    });
    assert.deepStrictEqual(
      detected.map((r) => r.name).sort(),
      ["t_atomic_reader", "t_direct_reader"],
      "the dependents probe no longer reports exactly the two blocking shapes (and only " +
        "those) — either an arm has stopped matching, making the gate above vacuous, or a " +
        "sanctioned wrapper has started recording an edge",
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

    // Half 1 of the fix, asserted DIRECTLY: 077 must contain no DROP outside its comments.
    // The apply below is the end-to-end form, but on its own it is weaker than it looks — it
    // can only fail on the CONJUNCTION of a restored DROP *and* a live dependent, so it would
    // pass vacuously if 145's cache were ever removed. This line fails on the restored DROP
    // alone, which is the thing `load_pg.ts` runs on every contracts load.
    assert.deepStrictEqual(
      sql.split("\n").filter((l) => /^\s*DROP\b/i.test(l)),
      [],
      "077 has regained a DROP. See its header block: db:load:pg applies this file on every " +
        "contracts load, so a DROP here is fatal the moment anything reads the cache in a " +
        "stored definition — and CASCADE is not the way out.",
    );

    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        // The end-to-end form: with a DROP restored AND funds_hub_stats_cache present, this is
        // where db:load:pg's 2BP01 surfaces. Green today because half 1 holds, not because the
        // dependent is gone — which is why the assertion above exists as well.
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
