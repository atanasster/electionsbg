// The three search arms behind /procurement/contractors, measured against the real
// contractor_rank — that an EIK is findable, that шльокавица adds rows, and that neither
// cost the name search its trigram index.
//
// WHAT THIS PINS, AND WHY A UNIT TEST CANNOT. functions/db_table.test.js asserts the SQL
// TEXT the engine emits. It cannot see the only thing that matters here: which INDEX
// Postgres picks for it. Every regression this file exists to catch produces correct rows
// at a 200 and merely stops using an index —
//
//   · OR-ing the identifier arm into the name search instead of routing it: the planner
//     abandons idx_contractor_rank_fold for the WHOLE predicate;
//   · a parameterized `eik LIKE $n || '%'` instead of `=`, because prefix_quals needs a
//     Const pattern and a bound parameter is not one;
//   · a шльокавица arm on a column whose fold is not gin-indexed: a per-row regexp chain
//     over the whole relation. ⚠️ The BUFFER ceilings are blind to that third one — the
//     engine's own comment records it as "buffers unchanged, ~10% more CPU" on tenders.
//     The `foldScans === 2` assertion is what closes it, so do not drop that as redundant
//     with the ceiling; it is the only check for the failure mode above it.
//
// ⚠️ EVERY MEASUREMENT HERE RUNS UNDER `plan_cache_mode = force_generic_plan` + PREPARE.
// A psql/EXPLAIN test with a LITERAL term constant-folds, the planner estimates through
// pg_trgm, picks the good plan and reports a healthy number for a broken query. That trap
// is what the OFFSET-0 search fence in db_table.js was written for, and it applies to
// every assertion below. Do not "simplify" these to inline literals.
//
// ⚠️ THE SQL IS TAKEN FROM THE ENGINE, NEVER RESTATED. runDbTable is called with a query
// fn that CAPTURES instead of executing, and the captured page SQL is what gets EXPLAINed.
// A hand-copied query would drift from the served one and this file would then measure a
// query nobody runs — the failure mode that makes a green performance gate worthless.
//
// ⚠️ EVERY TERM IS PROVED TO MATCH SOMETHING BEFORE ITS PLAN IS JUDGED. A needle that hits
// zero rows satisfies every structural and buffer assertion here while measuring nothing:
// `eik = '999999999'` is a perfectly good index seek at 28 buffers and finds no
// contractor. So each test establishes findability first, from the corpus rather than from
// a hardcoded value that a reload would turn back into a hardcoded lie.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { allRows, dbReachable, end, withClient } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

const require_ = createRequire(import.meta.url);
const { runDbTable, SEARCH_MIN_CHARS } = require_(
  "../../../functions/db_table.js",
) as {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
    req: unknown,
  ) => Promise<unknown>;
  SEARCH_MIN_CHARS: number;
};

/** The slice the browser always asks for — `defaultScope` + the `division` defaultFilter. */
const SCOPE = { col: "scope_key", val: "all" } as const;

const hasServedSlice = async (): Promise<boolean> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contractor_rank WHERE scope_key = 'all' AND division = 'ALL'`,
  );
  return Number(r.n) > 0;
};

// A GRADED reason, not a bare boolean: "Postgres is down" and "the matview was never
// refreshed" are different states, and collapsing them lets "the corpus has no data yet"
// read as "the rule is enforced" — the skip-reason rule CLAUDE.md repeats across these
// gates. The relation being ABSENT is a third state and is reported as such rather than
// swallowed by a catch, because 122 having never been applied has a different fix from an
// unrefreshed matview.
const haveDb = await dbReachable();
let skip: string | false = false;
if (!haveDb) skip = "Postgres unreachable";
else
  try {
    if (!(await hasServedSlice()))
      skip =
        "contractor_rank has no scope_key='all' / division='ALL' rows — " +
        "run npm run db:load:procurement-scopes:pg";
  } catch (e) {
    skip = `contractor_rank is unreadable (${(e as Error).message}) — apply migration 122`;
  }

afterAll(async () => {
  await end();
});

/** The page SQL + params the engine would actually send for this search term. */
const pageQuery = async (
  global: string,
): Promise<{ sql: string; params: unknown[] }> => {
  const seen: { sql: string; params: unknown[] }[] = [];
  const capture = async (sql: string, params: unknown[]) => {
    seen.push({ sql, params });
    return /count\(\*\)/.test(sql) ? [{ _count: 0 }] : [];
  };
  await runDbTable(capture, {
    resource: "contractor_rankings",
    scope: SCOPE,
    pageSize: 25,
    filters: { global },
  });
  // The page query is the one carrying ORDER BY + LIMIT — the one the OFFSET-0 fence
  // protects and the only one whose plan the sort can distort. The other is the
  // count+aggregate, which has no ORDER BY and is therefore never the interesting plan.
  const page = seen.find((s) => /ORDER BY/.test(s.sql));
  assert.ok(page, `no page query captured for ${JSON.stringify(global)}`);
  return page;
};

/** How many rows the served slice holds for a predicate — the findability precondition. */
const rowsFor = async (
  whereSql: string,
  params: unknown[],
): Promise<number> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM contractor_rank
      WHERE scope_key = 'all' AND division = 'ALL' AND ${whereSql}`,
    params,
  );
  return Number(r.n);
};

let armSeq = 0;

/** Execution buffers for `sql`, planned as the deployed (parameterized) query is. */
const execBuffers = async (
  sql: string,
  params: unknown[],
): Promise<{ buffers: number; plan: string }> => {
  // Every param these tests produce is a string; a numeric one (contractor_rankings also
  // exposes total_eur / contract_count as `filter: "range"`) declared as `text` would give
  // a plan that either fails or differs from the deployed one — precisely the "measuring a
  // query nobody runs" failure this file's header warns about. Refuse rather than mistype.
  assert.ok(
    params.every((p) => typeof p === "string"),
    `execBuffers types every parameter as text; got ${JSON.stringify(params)} — ` +
      `derive the type before adding a non-text filter to these tests`,
  );
  // `PREPARE name() AS …` is a syntax error, so a zero-parameter query needs no list at
  // all. Unreachable while contractor_rankings declares both a defaultScope and a
  // defaultFilter (every captured query carries $1 and $2), reachable the moment this
  // helper is pointed at a resource without them.
  const decl = params.length ? `(${params.map(() => "text").join(",")})` : "";
  // ⚠️ THE EXECUTE ARGS ARE LITERALS, AND THAT IS NOT THE CONSTANT-FOLDING TRAP. `EXECUTE`
  // takes expressions, not bind parameters, so `EXECUTE _arm($1)` binds nothing. It is safe
  // because the plan is GENERIC: force_generic_plan makes the planner build a plan that
  // does not consult parameter values at all (built at the first EXECUTE, inside this same
  // SET LOCAL scope), so EXECUTE only supplies values to a plan they cannot re-shape. The
  // trap this file warns about is a literal in the PREPARED TEXT, where the planner sees
  // the pattern and estimates through pg_trgm. The `$n` assertion below proves the
  // distinction held.
  const args = params
    .map((v) => `'${String(v).replace(/'/g, "''")}'`)
    .join(",");
  // ONE pooled client, statements issued separately: a multi-statement string cannot carry
  // the PREPARE at all.
  //
  // ⚠️ A PREPARE SURVIVES ROLLBACK. It is SESSION state, not transaction state, and this
  // client comes from a POOL — so a fixed name collides with "prepared statement already
  // exists" the moment a second call lands on the same connection. Measured, not reasoned:
  // that is exactly how this first ran. Hence a unique name per call AND an explicit
  // DEALLOCATE, so nothing is left on a connection the rest of the suite will reuse.
  const name = `_arm_${armSeq++}`;
  const plan = await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL plan_cache_mode = force_generic_plan");
      await c.query(`PREPARE ${name}${decl} AS ${sql}`);
      const r = await c.query(
        `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE ${name}(${args})`,
      );
      return (r.rows as { "QUERY PLAN": string }[])
        .map((x) => x["QUERY PLAN"])
        .join("\n");
    } finally {
      // Nothing here writes, so the ROLLBACK is only for the SET; the DEALLOCATE is what
      // actually cleans up, and neither may mask a real failure.
      await c.query("ROLLBACK").catch(() => {});
      await c.query(`DEALLOCATE ${name}`).catch(() => {});
    }
  });
  // The plan must actually BE generic. If the values were ever folded in, every ceiling
  // below would be measuring the plan production does not get — a green gate over a query
  // nobody runs, which is worse than no gate. A folded plan prints `'%sofarma%'::text`
  // where a generic one prints `$3`.
  assert.match(
    plan,
    /\$\d/,
    `the plan carries no $n placeholder, so it was NOT planned generically and these ` +
      `numbers do not describe the deployed query:\n${plan}`,
  );
  // sumExecutionBuffers is the repo's ONE buffer metric (scripts/db/lib/explain_buffers.ts,
  // shared by eight gates and unit-tested). Its three subtleties — `shared` prefixes the
  // group once, zero-valued counters are omitted, and the `Planning:` section is not
  // execution — each produced a wrong number in a shipped gate, which is the argument for
  // one implementation with one test. A local copy here would be a fourth, and its numbers
  // would silently differ: summing every node is ~6x a per-node max, so the two are not
  // interchangeable and every ceiling below is calibrated to THIS one.
  return { buffers: sumExecutionBuffers([{ "QUERY PLAN": plan }]), plan };
};

test.skipIf(skip)(
  "shlyo_query_fold is present — the шльокавица arm calls it unconditionally",
  async () => {
    // Its own named failure, because the symptom is otherwise a 500 on
    // /procurement/contractors?q=6ipka and nothing else: badRequest() rethrows a
    // non-DbRequestError, so a 42883 from a missing migration 141 is a 500 for terms
    // carrying a trigger character while every other search keeps working.
    const [r] = await allRows<{ fn: string | null }>(
      `SELECT to_regprocedure('shlyo_query_fold(text)')::text AS fn`,
    );
    assert.ok(
      r.fn,
      "shlyo_query_fold(text) is missing — apply it, do not reload:\n" +
        "  npx tsx scripts/db/apply_functions.ts 141_shlyo_query_fold.sql",
    );
  },
);

test.skipIf(skip)("a pasted EIK is an index seek, not a scan", async () => {
  // The page PRINTS this identifier beside every contractor and could not find it before
  // routing shipped. Taken from the corpus, not hardcoded: `eik = '999999999'` is an
  // equally good index seek and finds nobody, so it would satisfy every assertion below
  // while measuring nothing.
  const [row] = await allRows<{ eik: string }>(
    `SELECT eik FROM contractor_rank
      WHERE scope_key = 'all' AND division = 'ALL' AND eik ~ '^[0-9]{9}$'
      ORDER BY total_eur DESC LIMIT 1`,
  );
  assert.ok(row, "no plain-EIK contractor in the corpus to test with");

  const { sql, params } = await pageQuery(row.eik);
  assert.match(sql, /eik = \$\d+/, "the engine routed to the equality arm");
  assert.doesNotMatch(
    sql,
    /name_fold/,
    "and emitted no name arm to OR against it",
  );
  assert.equal(
    await rowsFor("eik = $1", [row.eik]),
    1,
    `${row.eik} must be findable, or this test measures an empty seek`,
  );

  const { buffers, plan } = await execBuffers(sql, params);
  assert.match(
    plan,
    /Index (Only )?Scan using idx_contractor_rank_key/,
    `the identifier lookup stopped using the key index:\n${plan}`,
  );
  // Measured 2026-08-19: 28, identical across warm and cold runs. The ceiling leaves ~5x
  // headroom; a jump into the thousands means the arm became a LIKE prefix or was OR-ed
  // into the name search.
  assert.ok(
    buffers <= 150,
    `a pasted EIK touched ${buffers} execution buffers (measured: 28):\n${plan}`,
  );
});

test.skipIf(skip)(
  "a synthetic supplier key is findable on the same arm",
  async () => {
    // 1,803 of the corpus's contractor keys are obed-/ph-/np- carriers minted by
    // supplier_identity.ts, and the table prints them exactly like an EIK — including
    // obed-f58039ac056a at €337.7M. A searchWhen admitting only 9|13 digits would leave
    // every one of them unfindable while looking correct.
    const [row] = await allRows<{ eik: string }>(
      `SELECT eik FROM contractor_rank
        WHERE scope_key = 'all' AND division = 'ALL' AND eik LIKE 'obed-%'
        ORDER BY total_eur DESC LIMIT 1`,
    );
    assert.ok(row, "no obed- carrier in the corpus to test with");

    const { sql, params } = await pageQuery(row.eik);
    assert.match(sql, /eik = \$\d+/, "routed to the equality arm");
    assert.equal(await rowsFor("eik = $1", [row.eik]), 1, "and is findable");

    const { buffers, plan } = await execBuffers(sql, params);
    assert.ok(
      buffers <= 150,
      `synthetic key touched ${buffers} buffers (measured: 16):\n${plan}`,
    );
  },
);

test.skipIf(skip)(
  "a selective name search keeps its trigram index",
  async () => {
    const term = "софарма";
    const hits = await rowsFor(
      "name_fold ILIKE '%' || translit_bg_latin($1) || '%'",
      [term],
    );
    assert.ok(
      hits > 0,
      `'${term}' matches nothing — a needle that finds no rows satisfies every ` +
        `assertion below while measuring nothing`,
    );

    const { sql, params } = await pageQuery(term);
    assert.match(sql, /name_fold ILIKE/, "the fold arm is emitted");
    const { buffers, plan } = await execBuffers(sql, params);
    assert.match(
      plan,
      /Bitmap Index Scan on idx_contractor_rank_fold/,
      `the name search stopped using its trigram index — this is what OR-ing an ` +
        `identifier arm into it does:\n${plan}`,
    );
    // Measured 2026-08-19: 1,554, identical across four runs. The OR-ed form (the mutation
    // test below) is 2,967, so this ceiling sits between the two with ~40% headroom on the
    // good side and ~26% margin on the bad.
    assert.ok(
      buffers <= 2200,
      `a selective name search touched ${buffers} execution buffers (measured: 1,554). ` +
        `~2,970 means the gin index was abandoned:\n${plan}`,
    );
  },
);

test.skipIf(skip)(
  "the шльокавица arm rides the same index, and ADDS rows",
  async () => {
    // NON-VACUITY, and note what it has to assert: not that the rewrite matches SOMETHING,
    // but that it matches rows the PLAIN needle does not. A rules change that made the
    // rewrite textually different yet semantically overlapping would keep a `n > 0` check
    // green while the arm contributed nothing — and `foldScans === 2` would also still
    // pass, because a second gin scan returning a subset is still a second gin scan.
    const [probe] = await allRows<{
      plain: string;
      shlyo: string;
      n: string;
      plain_n: string;
    }>(
      `SELECT translit_bg_latin('6ipka') AS plain,
              shlyo_query_fold(translit_bg_latin('6ipka')) AS shlyo,
              count(*) FILTER (
                WHERE name_fold ILIKE '%' || shlyo_query_fold(translit_bg_latin('6ipka')) || '%'
              )::text AS n,
              count(*) FILTER (
                WHERE name_fold ILIKE '%' || translit_bg_latin('6ipka') || '%'
              )::text AS plain_n
         FROM contractor_rank
        WHERE scope_key = 'all' AND division = 'ALL'`,
    );
    assert.notEqual(
      probe.plain,
      probe.shlyo,
      "the rewrite is a no-op on this term — the rule table changed",
    );
    assert.ok(
      Number(probe.n) > Number(probe.plain_n),
      `the rewritten needle '${probe.shlyo}' finds ${probe.n} rows and the plain ` +
        `'${probe.plain}' finds ${probe.plain_n} — the arm ADDS nothing, so this test ` +
        `no longer measures the feature it is named for`,
    );

    const { sql, params } = await pageQuery("6ipka");
    assert.match(sql, /shlyo_query_fold\(translit_bg_latin\(\$\d+\)\)/);
    const { buffers, plan } = await execBuffers(sql, params);
    // BOTH arms must be index scans. Two gin scans on the same column join as a BitmapOr;
    // an arm that fell off its index becomes a per-row regexp chain instead — which the
    // buffer ceiling CANNOT see (buffers unchanged, CPU up), so this assertion is the only
    // check for that failure mode. Do not drop it as redundant with the ceiling.
    const foldScans = (
      plan.match(/Bitmap Index Scan on idx_contractor_rank_fold/g) ?? []
    ).length;
    assert.equal(
      foldScans,
      2,
      `expected both needles to ride idx_contractor_rank_fold:\n${plan}`,
    );
    // Measured 2026-08-19: 1,872 — one extra gin scan over the 1,554 of the single-arm
    // search, which is the whole point of both arms sharing a column.
    assert.ok(
      buffers <= 2600,
      `the шльокавица search touched ${buffers} execution buffers (measured: 1,872):\n${plan}`,
    );
  },
);

test.skipIf(skip)(
  "MUTATION: the OR-ed identifier arm breaks the ceiling this file enforces",
  async () => {
    // Without this, the ceilings above are satisfiable by an implementation that never had
    // the problem AND by one that does — a green number proves nothing unless the bad shape
    // is shown to be red. This reconstructs the pre-routing predicate (the obvious way to
    // "just make EIK searchable") and asserts it fails.
    //
    // Read-only: an EXPLAIN of a SELECT, nothing is written.
    const { sql, params } = await pageQuery("софарма");
    const bad = sql.replace(
      /\(name_fold ILIKE/,
      `(eik LIKE $${params.length + 1} OR name_fold ILIKE`,
    );
    assert.notEqual(
      bad,
      sql,
      "the mutation did not apply — the SQL shape moved",
    );
    const { buffers, plan } = await execBuffers(bad, [...params, "софарма%"]);
    assert.ok(
      buffers > 2200,
      `the OR-ed form touched only ${buffers} buffers (measured: 2,967), so the 2,200 ` +
        `ceiling above no longer discriminates between routing and OR-ing — re-measure ` +
        `before trusting any assertion in this file:\n${plan}`,
    );
    assert.doesNotMatch(
      plan,
      /Bitmap Index Scan on idx_contractor_rank_fold/,
      `the OR-ed form kept the trigram index, so the whole premise of routing needs ` +
        `re-measuring on this Postgres version:\n${plan}`,
    );
  },
);

test.skipIf(skip)(
  "the length floor is not silently bypassable through the engine",
  async () => {
    // The floor exists because a 1-2 character pattern makes the gin scan return EVERY row
    // (432,959 measured). Asserted here rather than only as SQL text because the COST is
    // what matters: if a refactor let a short term through, this is the file that notices.
    //
    // Both the sample and the matcher are DERIVED from the exported constant — restating
    // "3" would fail this test for the wrong reason if the floor ever moved, pointing at
    // this file when nothing here had broken. That is what the export exists to prevent.
    await assert.rejects(
      pageQuery("с".repeat(SEARCH_MIN_CHARS - 1)),
      (e: Error) => new RegExp(`at least ${SEARCH_MIN_CHARS}`).test(e.message),
      `a ${SEARCH_MIN_CHARS - 1}-character term must be refused before any SQL is built`,
    );
  },
);
