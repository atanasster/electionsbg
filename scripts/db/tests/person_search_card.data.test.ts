// `person_browse_card` + the office/place pair `person_search(text,int)` prints under a name
// (082_person_api.sql) — the line that tells two same-named people apart in the header search.
//
// WHAT IT PINS, and every one of these fails SILENTLY without a gate:
//
//   1. THE PAIR IS READ, NEVER RE-DERIVED. 120_person_browse.sql already picks the
//      representative role and composes the place label, and its own comment says the
//      expression is "COPIED VERBATIM from 082_person_api.sql … a different one here means
//      the browser and the profile print different place names for the same seat". A third
//      copy would render one office in the header and another in the home finder, both at a
//      200. The parity arm below compares the served value against the producer row by row.
//   2. NO pg_depend EDGE. 120 is `DROP MATERIALIZED VIEW person_browse_table` + `CREATE`, so
//      a body that records a dependency turns every `db:load:declarations:pg -- --resolve`
//      into either a 2BP01 abort or — with CASCADE — a silent deletion of this function.
//      That is why it is plpgsql (a string body records no edge) and why converting it to
//      `BEGIN ATOMIC` would quietly reintroduce the hazard. `migration_drop_dependents`
//      covers the class; this pins the specific function, because the generic gate reads
//      DROPs in schema files and would not name this one.
//   3. IT DEGRADES, IT DOES NOT RAISE — on BOTH of its null paths, which are different code
//      and are tested separately. The EXCEPTION arm covers the relation being absent or
//      unreadable; `SELECT … INTO` finding no row covers a person the matview does not carry.
//      The first matters because `db:resolve:persons` applies 082 BEFORE anything creates
//      120's matview, so a `LANGUAGE sql` body would have failed the apply outright and taken
//      the WHOLE person API with it (exec() sends a file as one transaction) — and because
//      the route's `missingMigrationEmpty` degrades only 42883/42P01, so anything escaping
//      this function 500s the header search on every page and every keystroke.
//
// NON-VACUITY MATTERS HERE more than the equalities do. "Every served label equals its
// producer" is trivially true of a function that returns NULL for everybody, which is
// exactly the state this change exists to end — so each arm asserts it saw real values.
//
//   npx vitest run scripts/db/tests/person_search_card.data.test.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase, withClient } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

// Pinned local for the reason person_identity_duplicates.data.test.ts states: a
// `DATABASE_URL=…:5434 npx vitest` run must not report LOCAL numbers under a cloud URL. The
// degrade arm is a second, harder reason — it takes ACCESS EXCLUSIVE on person_browse_table
// (inside a rolled-back transaction), which has no business running against a database
// serving live traffic.
pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/082_person_api.sql");

/** Query terms with enough same-fold namesakes to exercise the pair on real rows. */
const PROBES = ["иванов", "георгиев", "димитров"] as const;

/** The three keys the card contributes to every search row. */
const CARD_KEYS = ["primaryRole", "placeLabel", "placeLabelEn"] as const;

// ⚠️ `no-fn` is NOT folded into `missing`, and that distinction is the point of splitting
// this enum. "person_browse_table absent" is a legitimate skip — it is this gate's own
// degrade premise. "person_browse_card absent" means 082 was never APPLIED here, which is
// the "applied, never loaded" staleness CLAUDE.md has a section about, and is exactly the
// database on which this feature is silently missing. Skipping there would make the gate
// green on the one state it exists to catch, so it is an assertion instead.
type State = "ok" | "no-server" | "no-fn" | "missing" | "empty";

const probeState = async (): Promise<State> => {
  let up = false;
  try {
    await allRows("SELECT 1");
    up = true;
    const [t] = await allRows<{ fn: boolean; rel: boolean }>(
      `SELECT to_regprocedure('public.person_browse_card(text)') IS NOT NULL AS fn,
              to_regclass('public.person_browse_table')          IS NOT NULL AS rel`,
    );
    if (!t?.fn) return "no-fn";
    if (!t.rel) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_browse_table",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    // A throw AFTER the first query means a reachable-but-broken install; both read as
    // "cannot measure" for this gate, and the static arm below still runs either way.
    return up ? "missing" : "no-server";
  }
};

const dbState = await probeState();
const skip =
  dbState === "ok" || dbState === "no-fn"
    ? false
    : dbState === "no-server"
      ? "Postgres unreachable"
      : "person_browse_table not built — run npm run db:load:declarations:pg -- --resolve";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// Bounded exactly like migration_drop_dependents.data.test.ts's `boundedDdlTx`, and for the
// reason its header gives: this probe needs ACCESS EXCLUSIVE on person_browse_table, vitest
// runs test FILES in parallel against this one database, and a PENDING AccessExclusive blocks
// every LATER AccessShare — so unbounded it head-of-line blocks every sibling reader until
// vitest's 120 s timeout, then fails with nothing naming the cause. 40P01 is the same
// contention arriving by the other door (Postgres kills one side of the cycle before
// lock_timeout can fire), which is why both codes are translated.
const DDL_LOCK_TIMEOUT = "20s";

const boundedDdlTx = async <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
      return await fn(c);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "55P03" || code === "40P01")
        throw new Error(
          `database busy — this probe needs ACCESS EXCLUSIVE on person_browse_table and ` +
            `${code === "40P01" ? "deadlocked against a concurrent reader" : `gave up after ${DDL_LOCK_TIMEOUT}`} ` +
            `rather than head-of-line blocking every other reader. This is the known ` +
            `"test:data flaky under load" shape and does NOT mean the degrade guard ` +
            `regressed: re-run this file alone against an idle database before believing ` +
            `it. Original: ${(e as Error)?.message ?? String(e)}`,
        );
      throw e;
    } finally {
      // Guarded: if the connection was destroyed, an unguarded ROLLBACK throws from the
      // `finally` and REPLACES the original error — the one diagnostic this arm exists for.
      await c.query("ROLLBACK").catch(() => {});
    }
  });

// The served triple, unnested per row, joined to the producer. One expression, reused by the
// parity arm and its non-vacuity counterpart, so the two cannot measure different sets.
const SERVED = `
  SELECT r->>'slug'          AS slug,
         r->>'primaryRole'   AS served_role,
         r->>'placeLabel'    AS served_place,
         r->>'placeLabelEn'  AS served_place_en,
         b.primary_role      AS producer_role,
         b.place_label       AS producer_place,
         b.place_label_en    AS producer_place_en
    FROM jsonb_array_elements(person_search($1, 50)) r
    LEFT JOIN person_browse_table b ON b.slug = r->>'slug'
`;

test.skipIf(skip)("person_browse_card is applied to this database", () => {
  assert.notEqual(
    dbState,
    "no-fn",
    "person_browse_card(text) is missing — 082 has not been applied here, so every header " +
      "search row is rendering without its office/place line. Run: " +
      "DATABASE_URL=… npx tsx scripts/db/apply_functions.ts 082_person_api.sql",
  );
});

test.skipIf(skip || dbState === "no-fn")(
  "all three card keys are present on every returned row",
  async () => {
    for (const q of PROBES) {
      const [row] = await allRows<{ rows: string; missing: string }>(
        `SELECT count(*) AS rows,
                count(*) FILTER (
                  WHERE NOT (r ?& ARRAY['primaryRole','placeLabel','placeLabelEn'])) AS missing
           FROM jsonb_array_elements(person_search($1, 50)) r`,
        [q],
      );
      assert.ok(
        Number(row.rows) > 0,
        `"${q}" returned no rows — the probe cannot see the keys it is testing`,
      );
      // The keys are emitted unconditionally (null when the card is missing) so a consumer
      // never has to tell "no place" from "this build predates the field" by key absence.
      assert.equal(
        Number(row.missing),
        0,
        `"${q}": ${row.missing} of ${row.rows} rows omit one of ${CARD_KEYS.join("/")}`,
      );
    }
  },
);

test.skipIf(skip || dbState === "no-fn")(
  "the served office+place EQUALS person_browse_table, row by row",
  async () => {
    let roled = 0;
    let labelled = 0;
    for (const q of PROBES) {
      const [row] = await allRows<{
        drift: string;
        roled: string;
        labelled: string;
      }>(
        `SELECT count(*) FILTER (
                  WHERE s.served_role     IS DISTINCT FROM s.producer_role
                     OR s.served_place    IS DISTINCT FROM s.producer_place
                     OR s.served_place_en IS DISTINCT FROM s.producer_place_en) AS drift,
                count(*) FILTER (WHERE s.served_role  IS NOT NULL)              AS roled,
                count(*) FILTER (WHERE s.served_place IS NOT NULL)              AS labelled
           FROM (${SERVED}) s`,
        [q],
      );
      assert.equal(
        Number(row.drift),
        0,
        `"${q}": ${row.drift} rows where the search row and person_browse_table disagree — ` +
          `the pair is being re-derived somewhere instead of read from its producer`,
      );
      roled += Number(row.roled);
      labelled += Number(row.labelled);
    }
    // Without these the arm above is satisfied by a function returning NULL for everyone —
    // which is the pre-change behaviour, i.e. the defect. BOTH halves are asserted: a corpus
    // whose producer column went NULL would agree at NULL on that half and pass on the other.
    // (placeLabelEn is deliberately NOT floored — it is place_dim-only in 120, so a corpus of
    // purely judicial seats would legitimately carry none.)
    assert.ok(
      roled > 0,
      "no returned row carried a primary role; the equality above is vacuous",
    );
    assert.ok(
      labelled > 0,
      "no returned row carried a place label; the equality above is vacuous",
    );
  },
);

test.skipIf(skip || dbState === "no-fn")(
  "person_browse_card is plpgsql and records NO dependency on person_browse_table",
  async () => {
    const [lang] = await allRows<{ lanname: string }>(
      `SELECT l.lanname FROM pg_proc p
         JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = 'public.person_browse_card(text)'::regprocedure`,
    );
    assert.equal(
      lang?.lanname,
      "plpgsql",
      "person_browse_card must stay plpgsql: a LANGUAGE sql body is validated at CREATE " +
        "(082 is applied before 120 exists on a cold database) and records a pg_depend edge " +
        "that 120's DROP MATERIALIZED VIEW would abort on or CASCADE away",
    );
    const [edge] = await allRows<{ n: string }>(
      `SELECT count(*) n
         FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = 'public.person_browse_card(text)'::regprocedure
          AND d.refclassid = 'pg_class'::regclass
          AND d.refobjid = 'public.person_browse_table'::regclass`,
    );
    assert.equal(
      Number(edge.n),
      0,
      "person_browse_card records a pg_depend edge on person_browse_table — 120's DROP " +
        "would take it with the matview (see migration_drop_dependents.data.test.ts)",
    );
  },
);

test.skipIf(skip || dbState === "no-fn")(
  "the LATERAL is fenced: one person_browse_card call per returned row, not one per key",
  async () => {
    // A LATERAL with an empty FROM is a pull-up candidate, so without the `OFFSET 0` fence
    // the planner substitutes the call at EVERY reference site — three keys, three calls per
    // row, each an index lookup and a plpgsql subtransaction. It is invisible in the result
    // and invisible in review, which is why it is counted here rather than reasoned about.
    //
    // ⚠️ A DELTA, AND NEVER `pg_stat_reset()`. The obvious form — reset, run, read — is a
    // write to a DATABASE-WIDE shared resource: it clears `n_dead_tup` and
    // `n_ins_since_vacuum` for every table, which is autovacuum's own bookkeeping and the
    // input to the thresholds CLAUDE.md's visibility-map section is about. `test:data` runs
    // ~16 workers against this one database, so a reset here perturbs whatever else is
    // running and can defer an autovacuum that was about to fire. Reading the counter either
    // side needs no reset and measures the same thing.
    //
    // ⚠️ `SET LOCAL`, not `SET`: this connection goes back to a POOL that does not reset
    // GUCs, so a plain SET would leave track_functions on for every later borrower of it.
    // Function stats are flushed at transaction end, which is why the COMMIT is explicit.
    const out = await withClient(async (c) => {
      const calls = async (): Promise<number> => {
        const { rows } = await c.query<{ calls: string }>(
          "SELECT calls FROM pg_stat_user_functions WHERE funcname = 'person_browse_card'",
        );
        return Number(rows[0]?.calls ?? 0);
      };
      const before = await calls();
      await c.query("BEGIN");
      let n: number;
      try {
        await c.query("SET LOCAL track_functions = 'all'");
        const {
          rows: [r],
        } = await c.query<{ n: number }>(
          "SELECT jsonb_array_length(person_search($1, 10)) AS n",
          [PROBES[0]],
        );
        n = Number(r.n);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
      // The stats collector is asynchronous; give it a moment to publish the counters.
      await c.query("SELECT pg_sleep(0.6)");
      return { rows: n, calls: (await calls()) - before };
    });
    assert.ok(
      out.rows > 0,
      "the probe query returned no rows to count calls against",
    );
    assert.equal(
      out.calls,
      out.rows,
      `person_browse_card ran ${out.calls} times for ${out.rows} rows — the OFFSET 0 ` +
        `optimization fence on the LATERAL in person_search() is gone, so the call is being ` +
        `substituted once per key`,
    );
  },
);

test.skipIf(skip || dbState === "no-fn")(
  "a person absent from person_browse_table yields present-but-null keys, not an error",
  async () => {
    // The SECOND null path — `SELECT … INTO` finding no row — which is different code from
    // the EXCEPTION arm below and is otherwise unreachable: 0 of the ~63.8k active public
    // figures are missing from the matview today, and a matview cannot be DELETEd from
    // ("cannot change materialized view"), so the row cannot be hidden for one person.
    // Driving the function directly is the faithful probe.
    //
    // It is reachable in a real, documented window: `db:resolve:persons` rebuilds `person`
    // and `db:load:declarations:pg -- --resolve` rebuilds the matview one step LATER, so
    // between them a newly resolved person is searchable with no card.
    const [row] = await allRows<{
      card_null: boolean;
      keys: number;
      role: string | null;
      place: string | null;
    }>(
      `WITH c AS (SELECT person_browse_card('zz-no-such-person-probe') AS v)
       SELECT c.v IS NULL AS card_null,
              (SELECT count(*) FROM jsonb_object_keys(o.j)) AS keys,
              o.j->>'primaryRole' AS role,
              o.j->>'placeLabel'  AS place
         FROM c,
              LATERAL (SELECT jsonb_build_object(
                                'primaryRole',  c.v -> 'primaryRole',
                                'placeLabel',   c.v -> 'placeLabel',
                                'placeLabelEn', c.v -> 'placeLabelEn') AS j) o`,
    );
    assert.equal(
      row.card_null,
      true,
      "an unknown slug must return NULL, not an object of nulls — the projection below " +
        "relies on it and a consumer would otherwise see a card that does not exist",
    );
    // The keys survive a NULL card: `NULL -> 'k'` is SQL NULL, and jsonb_build_object keeps
    // the key with a json null. That is what lets a consumer read the value instead of
    // testing for the key's absence.
    assert.equal(Number(row.keys), CARD_KEYS.length);
    assert.equal(row.role, null);
    assert.equal(row.place, null);
  },
);

test.skipIf(skip || dbState === "no-fn")(
  "a missing person_browse_table degrades to null labels, it does not raise",
  async () => {
    const out = await boundedDdlTx(async (c) => {
      // Renaming rather than dropping: it needs no CASCADE decision and reproduces the exact
      // SQLSTATE (42P01) a cold database raises. The whole probe is rolled back.
      await c.query(
        "ALTER MATERIALIZED VIEW person_browse_table RENAME TO person_browse_table_absent_probe",
      );
      const { rows } = await c.query<{ n: string; labelled: string }>(
        `SELECT count(*) AS n,
                count(*) FILTER (
                  WHERE r->>'primaryRole' IS NOT NULL
                     OR r->>'placeLabel'  IS NOT NULL) AS labelled
           FROM jsonb_array_elements(person_search($1, 20)) r`,
        [PROBES[0]],
      );
      return rows[0];
    });
    // Rows still come back — the person rows themselves do not live in the matview — and the
    // labels are simply absent. With the EXCEPTION arm removed this throws 42P01.
    assert.ok(
      Number(out.n) > 0,
      "the lookup returned nothing without person_browse_table; it must degrade, not empty out",
    );
    assert.equal(
      Number(out.labelled),
      0,
      "labels survived the matview's absence — the probe did not actually hide it",
    );
  },
);

// Static, so it runs on a checkout with no Postgres — the properties above that a reviewer is
// most likely to "clean up" are all visible in the source.
//
// ⚠️ Each property is asserted SEPARATELY, and the SQLSTATE list is checked by membership
// rather than by matching the whole clause. A regex pinning the exact list punishes the one
// change that strengthens what it guards: adding a condition to the EXCEPTION arm is always
// safe, removing one never is.
test("082 declares person_browse_card plpgsql, with the undefined/privilege guards", () => {
  const sql = readFileSync(SCHEMA, "utf8");
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION person_browse_card");
  assert.notEqual(
    at,
    -1,
    "person_browse_card is not declared in 082_person_api.sql",
  );
  const decl = sql.slice(at, sql.indexOf("$$;", at) + 3);

  assert.match(
    decl,
    /LANGUAGE\s+plpgsql/,
    "person_browse_card must be LANGUAGE plpgsql — see the pg_depend arm above",
  );
  assert.match(decl, /\bSTABLE\b/, "the card is a read; it must stay STABLE");
  assert.ok(
    !/BEGIN ATOMIC/.test(decl),
    "BEGIN ATOMIC records a pg_depend edge through pg_proc; keep the string body",
  );
  assert.match(
    decl,
    /\bEXCEPTION\b/,
    "the degrade guard is gone: a database without 120 would 500 the whole person lookup",
  );
  // 42501 is here for a reason that is not symmetry: 120 carries no GRANT of its own, so a
  // matview built before app_readonly existed is readable by nobody, and the route's
  // missingMigrationEmpty degrades only 42883/42P01 — an uncaught 42501 is a 500 on every
  // header keystroke sitewide.
  for (const cond of [
    "undefined_table",
    "undefined_column",
    "insufficient_privilege",
  ])
    assert.ok(
      new RegExp(`\\b${cond}\\b`).test(decl),
      `the degrade guard no longer catches ${cond}`,
    );
  // Resolved at EXECUTION time (the one plpgsql body in this file), so the relation must be
  // schema-qualified or the caller's search_path decides which table it reads.
  assert.match(
    decl,
    /FROM\s+public\.person_browse_table\b/,
    "schema-qualify the relation: plpgsql resolves it at execution against the caller's " +
      "search_path, unlike every LANGUAGE sql sibling in this file",
  );
});

test("082 fences the card LATERAL so the call is not substituted per key", () => {
  const sql = readFileSync(SCHEMA, "utf8");
  assert.match(
    sql,
    /LEFT JOIN LATERAL \(SELECT person_browse_card\(s\.slug\) AS c OFFSET 0\) card ON true/,
    "the OFFSET 0 optimization fence is gone — without it the planner flattens the empty-FROM " +
      "LATERAL and substitutes person_browse_card() at every reference site",
  );
});
