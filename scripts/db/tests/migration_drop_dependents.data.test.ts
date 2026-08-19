// The general form of one structural rule: A MIGRATION MAY NOT DROP AN OBJECT THAT ANOTHER
// MIGRATION READS IN A STORED DEFINITION.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS. Every schema file here is applied idempotently by some loader, most
// of them on every run. So when file A drops relation X and file B's view / matview /
// definition-time-parsed function reads X, applying A has exactly two outcomes and BOTH are
// defects:
//
//   • without CASCADE → `ERROR: cannot drop … because other objects depend on it` (2BP01).
//     LOUD. The loader aborts, usually in the apply phase before any COPY, so its table
//     silently keeps the previous vintage while the ingest reports success. This is what
//     077's `dual_corpus_rankings_cache` did to every `db:load:pg` for a day
//     (dual_corpus_dependents.data.test.ts holds that case in detail).
//
//   • with CASCADE → the dependent is DELETED and the loader exits 0. SILENT. Nothing in the
//     loader output reports it and no row count moves, because the row counts that would
//     move belong to a relation that no longer exists.
//
// The second is the more dangerous of the two and is what this file was created for.
// `003_tr_search.sql` opened with `DROP TABLE IF EXISTS tr_companies CASCADE` (and the same
// for tr_officers / tr_person_roles) and `load_tr_pg.ts` applies it on every run, so every
// `db:load:tr:pg` deleted three matviews owned by other migrations — person_browse_table
// (120, the ENTIRE /persons browser), declaration_stake_company (096) and
// company_officer_counts (071) — and said nothing. Reproduced 2026-08-10: relation count
// 177 → 174, the next loader in the chain dying on `relation "person_browse_table" does not
// exist`. `db:refresh` sequences db:load:persons-browse:pg after db:load:tr:pg, so a full
// local refresh self-healed and hid it; a standalone `db:load:tr:pg:cloud` — the documented
// routine TR publish — would have dropped it on Cloud SQL with nothing there to recreate it.
//
// WHY A GENERIC GATE RATHER THAN THREE NAMED ONES. A gate naming today's offenders is a gate
// that passes on tomorrow's. The rule is a property of the schema, and the sweep that found
// this defect over the whole of scripts/db/schema/pg/ returned only SIX relations — small
// enough that the generic form is cheap, and precise enough that the three sanctioned
// exceptions can be written down with their reasons rather than guessed at.
// ═══════════════════════════════════════════════════════════════════════════════════════

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { allRows, withClient, dbReachable, end } from "../lib/pg";
import { REPO_ROOT } from "../lib/paths";

const SCHEMA_DIR = path.join(REPO_ROOT, "scripts/db/schema/pg");

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

// ── The four sanctioned DROP-with-foreign-dependent pairs ─────────────────────────────────
//
// The first three are cases where the recreate demonstrably rides the SAME path as the
// drop, which is what the rule actually asks for. The fourth satisfies the rule's PURPOSE
// by a different route and says so rather than being filed under the same heading. Keyed by
// dropped relation and listing the dependents by name, so a NEW dependent appearing on one
// of these still fails.
const SANCTIONED: Record<string, { dependents: string[]; why: string }> = {
  person_wealth_year: {
    dependents: [
      "officials_rankings_table",
      "mp_assets_rankings_table",
      "person_browse_table",
      "person_cohort_wealth",
      "person_crypto_table",
      "person_abroad_table",
    ],
    why:
      "090's DROP … CASCADE takes all six, and load_declarations_pg.ts — the only applier " +
      "of 090 — applies 097/100/105/120/159/169 AFTER it on the same path. Each of those six " +
      "constants carries a comment saying that is why it is applied there. This is the " +
      "shape 003 lacked.",
  },
  appealed_ocids: {
    dependents: ["contracts_list"],
    why:
      "042 calls rebuild_contracts_list() (000_search_fns.sql) in the same file, a few " +
      "statements below the DROP, and that function DROP-and-recreates contracts_list by " +
      "design (SELECT c.* freezes the column list, so it cannot be CREATE OR REPLACEd).",
  },
  upheld_ocids: {
    dependents: ["contracts_list", "risk_upheld_ocid"],
    why:
      "contracts_list as for appealed_ocids. risk_upheld_ocid is (re)created by " +
      "rebuild_contract_risk_cache() (112) at rebuild time PRECISELY because 042's CASCADE " +
      "removes it — 112's body documents this at length, including the second reader " +
      "(risk_parity.harness.ts) that reads upheld_ocids directly and must not be routed " +
      "through the view.",
  },
  municipal_officials_table: {
    dependents: ["municipal_officials_current"],
    why:
      "THE ODD ONE OUT — sanctioned on the rule's purpose, not on same-path recreate, so " +
      "read this before adding a fifth. 115 applies from resolve_persons.ts while 102 " +
      "applies from load_declarations_pg.ts, so the two are NOT one applier the way 090/097 " +
      "or 042/000 are. What makes it safe is that the dependent cannot be lost INDEPENDENTLY " +
      "of its own base: municipal_officials_current is a bare `SELECT * … WHERE is_sitting` " +
      "over the very matview being dropped, so 115's CASCADE destroys both and 102 recreates " +
      "both, always together. The silent half-state this gate exists to catch — the loader " +
      "exits 0 and a surface quietly serves nothing — has no room to happen here: with the " +
      "view gone the matview is gone too, and the roster is equally dead either way. " +
      "Two further limits keep it small. 115's DROP is wrapped in an existence check on the " +
      "legacy person_role.place column, so it is one-time per database and a no-op on every " +
      "migrated one; and the follow-up that repairs it is the one 115's own RAISE NOTICE " +
      "names (`db:load:declarations:pg -- --resolve`), which both db:refresh and the cloud " +
      "person sequence already run AFTER db:resolve:persons. The view is therefore in " +
      "exactly the position the matview was already in, with the same remedy and no new one.",
  },
};

/** `DROP TABLE|VIEW|MATERIALIZED VIEW <rel>` targets per file, comments stripped. */
const dropsByFile = (): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith(".sql"))) {
    const code = readFileSync(path.join(SCHEMA_DIR, f), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const m of code.matchAll(
      /^\s*DROP\s+(?:MATERIALIZED\s+VIEW|TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gim,
    )) {
      if (!out.has(f)) out.set(f, new Set());
      out.get(f)?.add(m[1] as string);
    }
  }
  return out;
};

/** Relations each file CREATEs — a drop-and-recreate inside ONE file is not the defect. */
const createsByFile = (): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith(".sql"))) {
    const code = readFileSync(path.join(SCHEMA_DIR, f), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const m of code.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+VIEW|TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi,
    )) {
      if (!out.has(f)) out.set(f, new Set());
      out.get(f)?.add(m[1] as string);
    }
  }
  return out;
};

/**
 * Everything whose STORED definition reads `rel` — i.e. exactly what a DROP either fails on
 * or destroys. TWO dependency classes, and the second is easy to miss: a view/matview records
 * its edge through `pg_rewrite`, while a `LANGUAGE sql … BEGIN ATOMIC` function (PG14+;
 * docker-compose pins postgres:16) is parsed at definition time and records its edge through
 * `pg_proc`. The sanctioned wrapper shapes — plpgsql, and a string-bodied `LANGUAGE sql` —
 * record neither and correctly never appear. Same probe as
 * dual_corpus_dependents.data.test.ts, which proves both arms still discriminate.
 */
// `refclassid` is pinned on both arms because OIDs come from ONE cluster-wide
// counter and are not unique ACROSS catalogs: without it, a dependency on a
// pg_type or pg_proc object that happens to share the relation's OID reports as a
// dependent of the relation. Vanishingly unlikely and it fails safe (a false
// positive, not a miss) — but this file is written to be the general rule.
const dependentsSql = (rel: string): string => `
  SELECT DISTINCT dep.relname AS name, dep.relkind::text AS kind
  FROM pg_depend d
  JOIN pg_rewrite r  ON r.oid = d.objid
  JOIN pg_class  dep ON dep.oid = r.ev_class
  WHERE d.classid    = 'pg_rewrite'::regclass
    AND d.refclassid = 'pg_class'::regclass
    AND d.refobjid   = 'public.${rel}'::regclass
    AND dep.oid     <> 'public.${rel}'::regclass
  UNION ALL
  SELECT DISTINCT p.proname, 'function'
  FROM pg_depend d
  JOIN pg_proc p ON p.oid = d.objid
  WHERE d.classid    = 'pg_proc'::regclass
    AND d.refclassid = 'pg_class'::regclass
    AND d.refobjid   = 'public.${rel}'::regclass`;

/**
 * A rolled-back transaction for the two DDL probes below, with a BOUNDED lock wait.
 *
 * Both need ACCESS EXCLUSIVE on the largest tables in the database — applying 003 takes it
 * 33 times (an `ADD COLUMN IF NOT EXISTS` no-op still locks), and the CASCADE probe drops
 * tr_officers. Unbounded, that is not merely slow: a PENDING AccessExclusive blocks every
 * LATER AccessShare, so on a busy database these two stall every other reader of the TR
 * tables behind them for as long as they queue, and then die at vitest's 120 s timeout with
 * nothing naming the cause. Observed 2026-08-10 while another vitest run held the person
 * tables.
 *
 * `test:data` is the LAST step of db:refresh — i.e. it runs against the database a 57-step
 * chain has just finished writing — so the busy case is the normal one, not the exception.
 */
// Long enough to outlast an ordinary sibling read (vitest runs test FILES in parallel against
// this same database), short enough that a genuinely stuck queue reports rather than
// head-of-line blocking every other reader until vitest's 120 s timeout. ONE constant, so the
// message below cannot quote a number the SET no longer uses.
const DDL_LOCK_TIMEOUT = "20s";

const boundedDdlTx = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
      return await fn(c);
    } catch (e) {
      // 55P03 is the lock_timeout above firing; 40P01 is the SAME contention arriving by
      // the other door, and it was missing until 2026-08-13. A probe that takes ACCESS
      // EXCLUSIVE on 33 tables in one transaction, while sibling files read those tables in
      // theirs, is a textbook deadlock cycle — and Postgres resolves it by killing one side
      // BEFORE the lock_timeout can fire, so the friendly message below was unreachable in
      // exactly the case it was written for. Observed: a full `npm run test:data` failed
      // here with a bare "deadlock detected" and no hint, while the file passed alone.
      const code = (e as { code?: string })?.code;
      if (code === "55P03" || code === "40P01")
        throw new Error(
          `database busy — this probe needs ACCESS EXCLUSIVE on the TR tables and ` +
            `${code === "40P01" ? "deadlocked against a concurrent reader" : `gave up after ${DDL_LOCK_TIMEOUT}`} ` +
            `rather than head-of-line blocking every other reader. ` +
            `This is the known "test:data flaky under load" shape and does NOT mean 003 has ` +
            `regressed: re-run this file alone (npx vitest run ` +
            `scripts/db/tests/migration_drop_dependents.data.test.ts) against an idle ` +
            `database before believing it. Original: ${(e as Error)?.message ?? String(e)}`,
        );
      throw e;
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });

const exists = async (rel: string): Promise<boolean> =>
  Boolean(
    (
      await allRows<{ ok: string | null }>(
        `SELECT to_regclass('public.${rel}')::text AS ok`,
      )
    )[0]?.ok,
  );

test.skipIf(skip)(
  "no migration DROPs a relation another migration reads in a stored definition",
  async () => {
    const creates = createsByFile();
    const offences: string[] = [];

    for (const [file, dropped] of dropsByFile())
      for (const rel of dropped) {
        // Only a relation that EXISTS can be asked about. That makes the gate as complete as
        // the database it runs against — which is why db:refresh's own database is the one to
        // run it on, and why a fresh checkout gets a weaker (never a wrong) answer.
        if (!(await exists(rel))) continue;

        const deps = await allRows<{ name: string; kind: string }>(
          dependentsSql(rel),
        );
        for (const d of deps) {
          if (creates.get(file)?.has(d.name)) continue; // dropped and recreated in one file
          if (SANCTIONED[rel]?.dependents.includes(d.name)) continue;
          const owner =
            [...creates].find(([, set]) => set.has(d.name))?.[0] ??
            "an unknown file";
          offences.push(
            `${file} DROPs ${rel}, which ${d.name} (${d.kind}, from ${owner}) reads`,
          );
        }
      }

    assert.deepStrictEqual(
      offences,
      [],
      "A loader-applied migration destroys an object another migration owns. With CASCADE " +
        "this DELETES the dependent and the loader still exits 0 — nothing in its output " +
        "and no row count reports the loss. Without CASCADE it aborts that loader with " +
        "2BP01, leaving its own table on the previous vintage. Neither is survivable, and " +
        "CASCADE is not the way out of the other: fix it by not dropping (replace the " +
        "contents — see load_tr_pg.ts's replaceTable and 003's header), by reading the " +
        "object through a plpgsql wrapper (see 077/145), or — if the recreate genuinely " +
        "rides the same path as the drop — by adding it to SANCTIONED here WITH its " +
        "reason.\n  " +
        offences.join("\n  "),
    );
  },
);

test.skipIf(skip)(
  "003 re-applies without taking its three dependent matviews with it",
  async () => {
    // The end-to-end form, against the REAL file text so it cannot drift from what
    // load_tr_pg.ts applies. The three are asserted PRESENT first rather than skipped on: a
    // database that has already lost them is exactly the one this gate exists for, and
    // silently passing there is how the defect returns.
    const VICTIMS = [
      "person_browse_table",
      "declaration_stake_company",
      "company_officer_counts",
    ] as const;

    for (const v of VICTIMS)
      assert.ok(
        await exists(v),
        `${v} is absent. If this is a fresh database, build it (npm run db:refresh). If it ` +
          `is not, a db:load:tr:pg has already eaten it — recovery order is in ` +
          `docs/plans/tr-loader-cascade-v1.md.`,
      );

    const sql = readFileSync(
      path.join(SCHEMA_DIR, "003_tr_search.sql"),
      "utf8",
    );
    const survived = await boundedDdlTx(async (c) => {
      await c.query(sql);
      const { rows } = await c.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
        [[...VICTIMS]],
      );
      return rows.map((r) => r.name).sort();
    });

    assert.deepStrictEqual(
      survived,
      [...VICTIMS].sort(),
      "applying 003_tr_search.sql destroyed a matview owned by another migration — the " +
        "exact defect this file documents. load_tr_pg.ts applies 003 on every run.",
    );
  },
);

test.skipIf(skip)(
  "the probe detects the silent CASCADE class, not just the loud one",
  async () => {
    // Without this, "zero offences" above is satisfied by any probe that has stopped matching.
    // Both halves are asserted because the two failure modes are genuinely different and only
    // one of them announces itself:
    //
    //   1. the dependents probe REPORTS a fresh reader of tr_officers  → the gate can see it;
    //   2. `DROP … CASCADE` then removes that reader and raises NOTHING → why the gate is needed.
    //
    // Rolled back either way, so the live matviews are never at risk.
    const { reported, afterCascade } = await boundedDdlTx(async (c) => {
      await c.query(
        `CREATE MATERIALIZED VIEW t_tr_reader AS
         SELECT uic FROM tr_officers WHERE false WITH NO DATA`,
      );
      const reported = (
        await c.query<{ name: string }>(dependentsSql("tr_officers"))
      ).rows
        .map((r) => r.name)
        .includes("t_tr_reader");

      // The silent half — no error, no notice, no row count anywhere reflects the deletion.
      await c.query("DROP TABLE tr_officers CASCADE");
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname = 't_tr_reader'`,
      );
      return { reported, afterCascade: Number(rows[0]?.n ?? -1) };
    });

    assert.equal(
      reported,
      true,
      "the dependents probe no longer reports a fresh matview over tr_officers — the gate " +
        "above has gone vacuous",
    );
    assert.equal(
      afterCascade,
      0,
      "DROP TABLE … CASCADE no longer removes the dependent, so the premise of this whole " +
        "file has changed and its reasoning needs rereading",
    );
  },
);
