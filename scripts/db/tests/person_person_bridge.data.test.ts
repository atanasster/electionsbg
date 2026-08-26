// Gate for person_person_bridge (192) — the SECOND-DEGREE half of the person page's
// „Проверка на връзка": the people who bridge two names that share no company.
//
//   npm run test:data
//
// WHAT THIS EXISTS TO CATCH. A second-degree connection is an inference, so every defect
// class here publishes a claim about two NAMED individuals that nobody made:
//
//   1. THE HUB CAP GOING AWAY. Uncapped, the hub x hub pair below returns 5,216 bridge rows
//      instead of 5 — at which point the feature says "everyone is connected", which is both
//      useless and defamatory.
//   2. THE PROFESSIONAL-APPOINTMENT GUARD GOING AWAY. ⚠️ This is the one that looks like a
//      finding and is not: uncapped, ALL FIVE of that pair's chains are
//      liquidator -> liquidator -> liquidator — синдици in each other's court-assigned
//      caseload, where nobody chose anyone.
//   3. A DIRECT HIT RESTATED AS AN INDIRECT ONE, with a person spliced into the middle.
//   4. THE COALESCE ARM GOING AWAY. 43,761 tr_officers rows carry a fold ABSENT from
//      officer_name_counts (008's exit-only shareholders). A bare join silently drops all of
//      them from ever bridging.
//   5. „Заличено обстоятелство." — the register's deleted-fact placeholder, the largest fold
//      in the corpus at 4,383 companies — becoming a "bridge person".
//
// ⚠️ EVERY ASSERTION THAT CAN BE SATISFIED BY A FUNCTION THAT RETURNS NOTHING CARRIES A
// MUTATION CHECK. "The hub x hub pair returns 0 chains" is true of the correct body AND of a
// body that has stopped returning rows at all, so the guards are re-tested with the rule
// removed — inside a rolled-back transaction, against the SHIPPED body read back out of
// pg_get_functiondef, so the control cannot drift from the implementation the way a
// hand-rolled copy would.
//
// Requires Postgres + a loaded TR corpus (db:load:tr:pg). ⚠️ IT SKIPS ON THE SOURCE, NEVER
// ON THE TARGET — an absent person_person_bridge is one of the states this file exists to
// catch (192 is applied by the TR loader and by nothing else), so its existence is ASSERTED.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";
import { reportSkip } from "../../lib/report_skip";

/** The reader's report that opened docs/plans/person-connection-second-degree-v1.md. The two
 *  share no company; ИВАН ДИМИТРОВ НЕДЕЛЧЕВ is entered alongside both. */
const REF_A = "Георги Винков Фърцов";
const REF_B = "БЛАГОЙ АНГЕЛОВ АНГЕЛОВ";
const REF_BRIDGE = "ИВАН ДИМИТРОВ НЕДЕЛЧЕВ";
const REF_A_EIK = "112028994"; // РАДИО СОТ
const REF_B_EIK = "112610279"; // СДРУЖЕНИЕ НА ЧАСТНИТЕ ПРЕДПРИЕМАЧИ И РАБОТОДАТЕЛИ В ПАЗАРДЖИК

/** The two largest NON-placeholder folds in the corpus (292 and 285 companies) — the
 *  worst case for both guards, and the pair whose uncapped answer is 5,216 rows of noise. */
const HUB_A = "Биляна Пламенова Михайлова";
const HUB_B = "Снежина Минчева Маджарова";

/** ⚠️ NOT a page count — `sumExecutionBuffers` sums every node's `Buffers:` line, and
 *  Postgres reports them CUMULATIVELY up the tree, so the figure scales with plan depth as
 *  well as with work. That is the convention every sibling gate is calibrated in
 *  (person_connections, person_by_name), so this one stays in it rather than forking the
 *  shared instrument. What makes it mean something is the discrimination check below:
 *  measured through the pool, the shipped body scores 144,792 on the hub x hub pair and the
 *  same call with index scans disabled scores an order of magnitude more. The ceiling sits
 *  between them, and the second half of the test re-measures that every run. */
const BUFFER_CEILING = 400_000;

const num = (v: unknown): number => Number(v);

// SOURCE-side probe only. The TARGET (person_person_bridge) is deliberately NOT in this
// predicate — see the header.
const haveDb = await dbReachable();
const officerRows = haveDb
  ? num(
      (
        await allRows<{ n: string }>(
          "SELECT count(*) n FROM tr_officers WHERE name_fold <> ''",
        ).catch(() => [{ n: "0" }])
      )[0]?.n ?? 0,
    )
  : 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : officerRows === 0
    ? "TR corpus not loaded (tr_officers is empty)"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

interface BridgeRow {
  bridge_name: string;
  bridge_companies: number;
  a_eik: string;
  a_company: string | null;
  a_subject_roles: string | null;
  a_bridge_roles: string | null;
  a_body: number;
  b_eik: string;
  b_company: string | null;
  b_subject_roles: string | null;
  b_bridge_roles: string | null;
  b_body: number;
}

const bridges = (a: string, b: string) =>
  allRows<BridgeRow>("SELECT * FROM person_person_bridge($1, $2, 100)", [a, b]);

type Mutation = [fn: string, mutate: (def: string) => string];

/** Lift the hub cap from person_person_bridge's own body. Targets the `bridge` CTE, which is
 *  where exclusion 1 is stated — ONCE, against the count `a_side` carries forward. */
const NO_HUB_CAP: Mutation = [
  "person_person_bridge",
  (def) =>
    def.replace(
      "WHERE s.company_count <= 12",
      "WHERE s.company_count <= 1000000",
    ),
];
/** Neuter the deleted-fact-placeholder predicate — the guard that keeps „Заличено
 *  обстоятелство." out of both the bridge set and the published officer-body counts. */
const NO_PLACEHOLDER_GUARD: Mutation = [
  "tr_fold_is_placeholder",
  (def) =>
    def.replace(
      /AS \$function\$[\s\S]*?\$function\$/,
      "AS $function$ SELECT false $function$",
    ),
];
/** Neuter the professional-appointment predicate. Mutating the PREDICATE rather than its
 *  four call sites is deliberate: one edit covers every leg, and a leg that has quietly
 *  stopped consulting it shows up as a smaller-than-expected difference. */
const NO_ROLE_GUARD: Mutation = [
  "tr_role_is_professional_only",
  (def) =>
    def.replace(
      /AS \$function\$[\s\S]*?\$function\$/,
      "AS $function$ SELECT false $function$",
    ),
];

/**
 * Re-run a query with one or more rules textually removed from the SHIPPED function bodies,
 * inside a transaction that is always rolled back.
 *
 * ⚠️ It reads each body back out of pg_get_functiondef rather than restating it. A
 * hand-written control is a second implementation that can agree with a regressed first one
 * — which is precisely how the tr_owner_share defect survived for years.
 */
const without = async <T>(
  mutations: Mutation[],
  run: (
    q: (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>,
  ) => Promise<T>,
): Promise<T> =>
  withClient(async (c) => {
    await c.query("BEGIN");
    try {
      for (const [fn, mutate] of mutations) {
        const [{ def }] = (
          await c.query<{ def: string }>(
            `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = $1 AND n.nspname = 'public'`,
            [fn],
          )
        ).rows;
        const mutated = mutate(def);
        assert.notEqual(
          mutated,
          def,
          `the mutation did not change ${fn}'s body — the rule it targets has been renamed or removed`,
        );
        await c.query(mutated);
      }
      return await run(
        async (sql, params) => (await c.query(sql, params)).rows,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  });

// ── The target exists ────────────────────────────────────────────────────────

test.skipIf(skip)(
  "person_person_bridge and its role predicate exist",
  async () => {
    // Asserted, not skipped on: 192 is applied ONLY by load_tr_pg.ts, so a database that has
    // never run the TR loader has the corpus and none of this — the exact state that makes
    // /api/db/connection degrade to a permanently empty second degree.
    const [t] = await allRows<{ f: boolean; g: boolean }>(
      `SELECT to_regprocedure('person_person_bridge(text,text,int)') IS NOT NULL AS f,
            to_regprocedure('tr_role_is_professional_only(text)')  IS NOT NULL AS g`,
    );
    assert.ok(
      t.f,
      "person_person_bridge is missing — apply 192_person_bridge.sql",
    );
    assert.ok(
      t.g,
      "tr_role_is_professional_only is missing — apply 192_person_bridge.sql",
    );
  },
);

// ── The reference chain ──────────────────────────────────────────────────────

test.skipIf(skip)(
  "publishes the reference chain, with all four role legs",
  async () => {
    const rows = await bridges(REF_A, REF_B);
    assert.equal(
      rows.length,
      1,
      "expected exactly one bridge for the reference pair",
    );
    const r = rows[0]!;
    assert.equal(r.bridge_name, REF_BRIDGE);
    assert.equal(r.a_eik, REF_A_EIK);
    assert.equal(r.b_eik, REF_B_EIK);
    // Each leg carries its own role — this is what the recursive BFS in company_person_path
    // structurally cannot return, and the reason 192 is a fixed 2-hop join instead.
    assert.equal(r.a_subject_roles, "partner");
    assert.equal(r.a_bridge_roles, "manager");
    assert.equal(r.b_bridge_roles, "ngo_board");
    assert.equal(r.b_subject_roles, "ngo_board");
  },
);

test.skipIf(skip)(
  "the reference chain runs through two bodies the CURATED graph refuses",
  async () => {
    // Both companies carry 7 officer folds, over person_connections()'s MAX_CO_OFFICERS (6).
    // If these ever drop to <= 6 the chain stops being evidence that this block is WIDER than
    // /connections, and the whole justification in 192's header needs re-reading.
    const rows = await bridges(REF_A, REF_B);
    const r = rows[0]!;
    assert.ok(
      num(r.a_body) > 6 && num(r.b_body) > 6,
      `bodies ${r.a_body}/${r.b_body}`,
    );
  },
);

// ── Guard 1: the hub cap ─────────────────────────────────────────────────────

test.skipIf(skip)("the hub cap still discriminates", async () => {
  // ⚠️ BOTH arms lift the ROLE guard, so the cap is the only difference between them. With
  // the role guard on, this pair returns 0 either way — every one of its chains is a
  // court appointment — and a 0-vs-0 comparison would look like a passing cap test while
  // measuring nothing at all. (That is not a hypothetical: it is what the first draft did.)
  const count = (m: Mutation[]) =>
    without(m, (q) =>
      q("SELECT count(*) n FROM person_person_bridge($1, $2, 1000000)", [
        HUB_A,
        HUB_B,
      ]),
    ).then((r) => num((r[0] as { n: string }).n));
  const capped = await count([NO_ROLE_GUARD]);
  const uncapped = await count([NO_ROLE_GUARD, NO_HUB_CAP]);
  // Measured 5 vs 5,216 — the uncapped side SATURATES at the function's own 100-row clamp,
  // so the assertion is deliberately well under the true ratio.
  assert.ok(
    uncapped > capped * 10,
    `the hub cap has stopped discriminating: ${capped} capped vs ${uncapped} uncapped`,
  );
});

test.skipIf(skip)(
  "„Заличено обстоятелство.“ is never published as a bridge person",
  async () => {
    // The largest fold in the corpus (4,383 companies) and not a person. The hub cap already
    // removes it; the explicit exclusion is what keeps that true if the cap is ever loosened.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM tr_officers o
      WHERE o.name_fold = 'zalicheno obstoyatelstvo.'`,
    );
    assert.ok(
      num(r.n) > 100,
      "the placeholder fold has vanished — this test is now vacuous",
    );
    // Both guards lifted, so the placeholder has every chance to appear and only its OWN
    // exclusion can be what stops it.
    const rows = await without([NO_ROLE_GUARD, NO_HUB_CAP], (q) =>
      q(
        `SELECT count(*) n FROM person_person_bridge($1, $2, 1000000) x
        WHERE translit_bg_latin(x.bridge_name) = 'zalicheno obstoyatelstvo.'`,
        [HUB_A, HUB_B],
      ),
    );
    assert.equal(
      num((rows[0] as { n: string }).n),
      0,
      "the placeholder bridged once the hub cap was lifted — the by-fold exclusion is gone",
    );
  },
);

// ── Guard 2: court-appointed professionals ───────────────────────────────────

test.skipIf(skip)(
  "the professional-appointment guard still discriminates",
  async () => {
    const guarded = await bridges(HUB_A, HUB_B);
    const unguarded = await without([NO_ROLE_GUARD], (q) =>
      q("SELECT * FROM person_person_bridge($1, $2, 1000000)", [HUB_A, HUB_B]),
    );
    assert.ok(
      unguarded.length > guarded.length,
      `the professional guard has stopped discriminating: ${guarded.length} guarded vs ${unguarded.length} unguarded`,
    );
    // And what it removes really is court-appointment noise rather than ordinary ties.
    const professional = (unguarded as unknown as BridgeRow[]).filter(
      (r) =>
        /liquidator|trustee|verifier/.test(r.a_bridge_roles ?? "") ||
        /liquidator|trustee|verifier/.test(r.b_bridge_roles ?? ""),
    );
    assert.ok(
      professional.length > 0,
      "no professional-role chain in the unguarded result — the reference pair no longer exercises this class",
    );
  },
);

test.skipIf(skip)(
  "the predicate reads the WHOLE role set, not any one role",
  async () => {
    // A liquidator who is ALSO a partner chose that second relationship, so the chain is real.
    // Matching "contains liquidator" instead of "is nothing but appointments" would delete it.
    const [r] = await allRows<{ only: boolean; mixed: boolean; nul: boolean }>(
      `SELECT tr_role_is_professional_only('liquidator,trustee') AS only,
            tr_role_is_professional_only('liquidator,partner') AS mixed,
            tr_role_is_professional_only(NULL)                 AS nul`,
    );
    assert.equal(r.only, true);
    assert.equal(
      r.mixed,
      false,
      "a mixed role set is a chosen relationship and must survive",
    );
    // NOT STRICT, deliberately: an unknown role set must be admitted, not excluded.
    assert.equal(r.nul, false);
  },
);

// ── Guard 3: a direct hit is never restated as an indirect one ───────────────

test.skipIf(skip)(
  "no chain passes through a company BOTH subjects already sit in",
  async () => {
    // Both ends need the test. Without the second arm a chain can END at a company the first
    // subject is also entered in — the direct hit, with a person spliced into the middle.
    const [r] = await allRows<{ pairs: string; leaks: string }>(`
    WITH cand AS (   -- pairs that share a company AND have bridges elsewhere
      SELECT oa.name AS a, ob.name AS b
        FROM tr_officers oa
        JOIN tr_officers ob ON ob.uic = oa.uic AND ob.name_fold > oa.name_fold
        JOIN officer_name_counts ca ON ca.name_fold = oa.name_fold AND ca.company_count BETWEEN 3 AND 8
        JOIN officer_name_counts cb ON cb.name_fold = ob.name_fold AND cb.company_count BETWEEN 3 AND 8
       WHERE oa.name_fold <> '' AND ob.name_fold <> ''
       LIMIT 300),
    checked AS (
      SELECT c.a, c.b, br.a_eik, br.b_eik,
             (SELECT array_agg(s.uic) FROM connection_between(c.a, c.b) s) AS direct
        FROM cand c, LATERAL person_person_bridge(c.a, c.b, 100) br)
    SELECT count(*) AS pairs,
           count(*) FILTER (WHERE a_eik = ANY(direct) OR b_eik = ANY(direct)) AS leaks
      FROM checked`);
    assert.ok(
      num(r.pairs) > 20,
      `only ${r.pairs} bridged rows sampled — too few to discriminate`,
    );
    assert.equal(
      num(r.leaks),
      0,
      "a directly-shared company was published as a second-degree step",
    );
  },
);

// ── Guard 4: one chain per relationship ──────────────────────────────────────

test.skipIf(skip)(
  "a company recorded under several spellings yields ONE chain, not a product",
  async () => {
    // tr_officers is deduped per (uic, NAME), not per (uic, name_fold): 31,647 pairs carry
    // more than one spelling. Joined raw, a chain is emitted once per spelling on each of its
    // four legs — duplicates identical but for the role string, which read to a reader as
    // several independent pieces of evidence for one relationship.
    const [d] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
         SELECT uic, name_fold FROM tr_officers WHERE name_fold <> ''
          GROUP BY 1, 2 HAVING count(*) > 1) x`,
    );
    assert.ok(
      num(d.n) > 1000,
      `only ${d.n} multi-spelling pairs — this test no longer exercises the fold`,
    );
    // ⚠️ BRIDGE-FIRST, and DISTINCT. Two co-officers of one multi-spelling company are a
    // DIRECT hit and are excluded from the second degree entirely, so the obvious sample
    // returns 0 rows and the assertion passes on nothing (measured: it did). The duplicating
    // shape has to sit on the BRIDGE. And the pair list must be deduped: the same (a, b) can
    // be reached through two different folds, which repeats the LATERAL call and shows up as
    // duplication the function did not produce (measured: 1,989 candidate rows over 1,888
    // distinct pairs, which is the whole of an apparent 2,261-vs-2,110 "leak").
    //
    // ⚠️ AND THE COMPARISON IS PER PAIR, NOT POOLED. Two different (a, b) questions can
    // legitimately share a (bridge, company, company) answer — measured, that alone accounts
    // for a 2,125-vs-2,110 "leak" in which the function had duplicated nothing. Pooling the
    // counts turns an ordinary overlap between two answers into a phantom defect.
    const [r] = await allRows<{
      rows: string;
      triples: string;
      multi: string;
    }>(`
      WITH dupfold AS (
        SELECT uic, name_fold FROM tr_officers WHERE name_fold <> ''
         GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 4000),
      two AS (
        SELECT d.name_fold, d.uic AS u1,
               (SELECT o.uic FROM tr_officers o
                 WHERE o.name_fold = d.name_fold AND o.uic <> d.uic LIMIT 1) AS u2
          FROM dupfold d),
      cand AS (
        SELECT DISTINCT
               (SELECT p.name FROM tr_officers p
                 WHERE p.uic = t.u1 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 LIMIT 1) AS a,
               (SELECT p.name FROM tr_officers p
                 WHERE p.uic = t.u2 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 LIMIT 1) AS b
          FROM two t WHERE t.u2 IS NOT NULL),
      hit AS (
        SELECT c.a, c.b, r.bridge_name, r.a_eik, r.b_eik,
               (SELECT count(*) FROM tr_officers o
                 WHERE o.uic IN (r.a_eik, r.b_eik)
                   AND o.name_fold = translit_bg_latin(r.bridge_name)) AS spellings
          FROM cand c, LATERAL person_person_bridge(c.a, c.b, 100) r
         WHERE c.a IS NOT NULL AND c.b IS NOT NULL),
      per AS (
        SELECT count(*) AS rows,
               count(DISTINCT (bridge_name, a_eik, b_eik)) AS triples,
               count(*) FILTER (WHERE spellings > 1) AS multi
          FROM hit GROUP BY a, b)
      SELECT sum(rows) AS rows, sum(triples) AS triples, sum(multi) AS multi FROM per`);
    // Non-vacuity FIRST: "0 rows equals 0 triples" is the shape this gate is most likely to
    // decay into, and it passes silently.
    assert.ok(
      num(r.rows) > 100,
      `only ${r.rows} chains sampled — the gate is measuring nothing`,
    );
    // …and every sampled chain must actually SIT on the duplicating shape, or "rows equals
    // triples" is true of a fold that was never exercised. Measured: 2,125 of 2,125.
    assert.equal(
      num(r.multi),
      num(r.rows),
      `only ${r.multi} of ${r.rows} sampled chains have a multi-spelling bridge leg — the ` +
        `sample has drifted off the shape it exists to exercise`,
    );
    assert.equal(
      num(r.rows),
      num(r.triples),
      `${r.rows} rows over ${r.triples} distinct (bridge, company, company) triples — the ` +
        `per-(company, fold) fold is gone and chains are being multiplied by spelling count`,
    );
  },
);

test.skipIf(skip)(
  "tr_role_union merges, dedupes and sorts a role set",
  async () => {
    // The fold is what makes a duplicated leg collapse WITHOUT losing a role. Sorted output is
    // what makes two calls with the same roles in a different order compare equal.
    const [r] = await allRows<{
      merged: string | null;
      empty: string | null;
      nul: string | null;
    }>(
      `SELECT tr_role_union(ARRAY['manager,partner','partner,sole_owner']) AS merged,
            tr_role_union(ARRAY['', ' '])                                AS empty,
            tr_role_union(ARRAY[NULL]::text[])                           AS nul`,
    );
    assert.equal(r.merged, "manager,partner,sole_owner");
    // An empty role set must be NULL, not an empty string that renders as a role.
    assert.equal(r.empty, null);
    assert.equal(r.nul, null);
  },
);

// ── Guard 5: the COALESCE arm ────────────────────────────────────────────────

test.skipIf(skip)(
  "a fold ABSENT from officer_name_counts can still bridge",
  async () => {
    // 43,761 tr_officers rows carry one — 008's exit-only shareholders, whose stake predates
    // the 2021 feed window. A bare join drops every one of them, silently and corpus-wide, and
    // no row count anywhere would move.
    const [r] = await allRows<{ missing: string; bridged: string }>(`
    WITH miss AS (
      SELECT o.name_fold, count(DISTINCT o.uic) n
        FROM tr_officers o LEFT JOIN officer_name_counts c ON c.name_fold = o.name_fold
       WHERE c.name_fold IS NULL AND o.name_fold <> ''
       GROUP BY o.name_fold HAVING count(DISTINCT o.uic) >= 2
       LIMIT 120),
    two AS (
      SELECT m.name_fold,
             (array_agg(DISTINCT o.uic))[1] AS u1, (array_agg(DISTINCT o.uic))[2] AS u2
        FROM miss m JOIN tr_officers o ON o.name_fold = m.name_fold GROUP BY 1),
    peers AS (
      SELECT t.name_fold,
             (SELECT p.name FROM tr_officers p
               WHERE p.uic = t.u1 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 AND NOT tr_role_is_professional_only(p.roles) LIMIT 1) AS a,
             (SELECT p.name FROM tr_officers p
               WHERE p.uic = t.u2 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 AND NOT tr_role_is_professional_only(p.roles) LIMIT 1) AS b
        FROM two t)
    SELECT count(*) AS missing,
           count(*) FILTER (WHERE (SELECT count(*) FROM person_person_bridge(p.a, p.b, 100) r
                                    WHERE translit_bg_latin(r.bridge_name) = p.name_fold) > 0)
             AS bridged
      FROM peers p WHERE p.a IS NOT NULL AND p.b IS NOT NULL`);
    assert.ok(
      num(r.missing) > 20,
      `only ${r.missing} candidates — too few to discriminate`,
    );
    assert.ok(
      num(r.bridged) > 0,
      "not one fold missing from officer_name_counts bridged — the COALESCE default is gone",
    );
  },
);

// ── Cost ─────────────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "the worst pair in the corpus stays far under a whole-table scan",
  async () => {
    // ⚠️ Measured LOCAL. tr_* is the family where a local timing has been wrong by four and a
    // half hours; this ceiling catches a plan REGRESSION, it does not predict Cloud SQL.
    const plan = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM person_person_bridge($1, $2, 100)`,
      [HUB_A, HUB_B],
    );
    const buffers = sumExecutionBuffers(plan);
    assert.ok(
      buffers < BUFFER_CEILING,
      `person_person_bridge scored ${buffers} (ceiling ${BUFFER_CEILING}) on the hub x hub pair`,
    );

    // …AND THE CEILING STILL REJECTS THE SHAPE IT EXISTS TO REJECT. Without this half a
    // ceiling calibrated in a cumulative-nested convention is a number nobody can interpret,
    // and it would keep passing over a body that had stopped riding its indexes.
    //
    // ⚠️ THE CONTROL IS `enable_indexscan = off`, NOT `DROP INDEX`. Both produce the regressed
    // plan; only one of them takes an AccessExclusiveLock on tr_officers while ~16 vitest
    // workers are querying the same database. A planner GUC is transaction-local, lock-free
    // and rolled back with everything else.
    //
    // ⚠️ And the control is NOT "lift the hub cap": measured, that scores 144,768 — IDENTICAL
    // to the shipped body — because the extra bridges it admits are pruned by the role guard
    // before they cost anything. The cap is guarded by the ROW-COUNT test above; what this
    // ceiling guards is the PLAN.
    const regressed = await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SET LOCAL enable_indexscan = off");
        await c.query("SET LOCAL enable_bitmapscan = off");
        await c.query("SET LOCAL enable_indexonlyscan = off");
        return (
          await c.query<{ "QUERY PLAN": string }>(
            `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM person_person_bridge($1, $2, 100)`,
            [HUB_A, HUB_B],
          )
        ).rows;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    const regressedCost = sumExecutionBuffers(regressed);
    assert.ok(
      regressedCost >= BUFFER_CEILING,
      `the ceiling no longer discriminates: the index-less plan scored only ${regressedCost}, ` +
        `under the ${BUFFER_CEILING} ceiling. This test has stopped measuring anything.`,
    );
  },
);

test.skipIf(skip)(
  "the clamp holds at BOTH ends, not just the top",
  async () => {
    // ⚠️ GREATEST(1, …) as well as LEAST. A caller passing 0 or a negative must get a bounded
    // answer, not `LIMIT must not be negative` — through /api/db/connection that is a 500, and
    // because the route asks both degrees in one Promise.all it would cost the FIRST degree its
    // answer too. Measured before the fix: p_limit = -1 raised. The function is GRANTed to
    // app_readonly and reachable from /api/sql, so the route's constant is not the caller set.
    for (const lim of [-1, 0, 1]) {
      const [r] = await allRows<{ n: string }>(
        `SELECT count(*) n FROM person_person_bridge($1, $2, $3)`,
        [REF_A, REF_B, lim],
      );
      assert.ok(
        num(r.n) >= 1,
        `p_limit=${lim} returned nothing or raised — the lower clamp is gone`,
      );
    }
  },
);

test.skipIf(skip)(
  "the published officer-body size counts only people",
  async () => {
    // „Заличено обстоятелство." is the register's deleted-fact placeholder, excluded from
    // bridging by exclusion 2 — and it was counted as a вписано лице in a_body/b_body until
    // 2026-08-26. That number carries the row's whole interpretive weight in the UI („N
    // вписани лица") AND is the primary ORDER BY key, so inflating it also reorders results.
    //
    // Sampled bridge-first over companies that actually carry the placeholder; 4,383 do and
    // 724 of them can bridge. The sample is capped at 300 seed companies — measured ~11 s and
    // 208 chains, 191 of them at a placeholder-bearing company, which is what the non-vacuity
    // assertion below needs; 3,000 seeds runs for minutes and buys nothing.
    const [r] = await allRows<{
      chains: string;
      withph: string;
      agree: string;
    }>(`
      WITH ph AS (
        SELECT DISTINCT uic FROM tr_officers
         WHERE tr_fold_is_placeholder(name_fold) LIMIT 300),
      two AS (
        SELECT o.name_fold, o.uic AS u1,
               (SELECT x.uic FROM tr_officers x
                 WHERE x.name_fold = o.name_fold AND x.uic <> o.uic LIMIT 1) AS u2
          FROM tr_officers o JOIN ph ON ph.uic = o.uic
         WHERE o.name_fold <> '' AND NOT tr_fold_is_placeholder(o.name_fold)),
      cand AS (
        SELECT DISTINCT
               (SELECT p.name FROM tr_officers p
                 WHERE p.uic = t.u1 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 LIMIT 1) AS a,
               (SELECT p.name FROM tr_officers p
                 WHERE p.uic = t.u2 AND p.name_fold <> t.name_fold AND p.name_fold <> ''
                 LIMIT 1) AS b
          FROM two t WHERE t.u2 IS NOT NULL),
      hit AS (
        SELECT r.a_eik, r.a_body,
               (SELECT count(DISTINCT x.name_fold) FROM tr_officers x
                 WHERE x.uic = r.a_eik AND x.name_fold <> ''
                   AND NOT tr_fold_is_placeholder(x.name_fold)) AS true_body,
               EXISTS (SELECT 1 FROM tr_officers x
                        WHERE x.uic = r.a_eik AND tr_fold_is_placeholder(x.name_fold)) AS ph
          FROM cand c, LATERAL person_person_bridge(c.a, c.b, 100) r
         WHERE c.a IS NOT NULL AND c.b IS NOT NULL)
      SELECT count(*) AS chains,
             count(*) FILTER (WHERE ph) AS withph,
             count(*) FILTER (WHERE a_body = true_body) AS agree
        FROM hit`);
    assert.ok(
      num(r.chains) > 0,
      `no chains sampled (${r.chains}) — the gate is measuring nothing`,
    );
    // ⚠️ NON-VACUITY FIRST, in this file's style: „every body count agrees" is trivially true
    // of a sample in which no company carries the placeholder at all.
    assert.ok(
      num(r.withph) > 0,
      "no sampled bridge company carries the placeholder — the sample has drifted off the shape this gate exists to exercise",
    );
    assert.equal(
      num(r.agree),
      num(r.chains),
      "a published officer-body size counts „Заличено обстоятелство.“ as a person",
    );
  },
);

test.skipIf(skip)("the placeholder guard still discriminates", async () => {
  // The mutation half of the two assertions above: with tr_fold_is_placeholder neutered,
  // the corpus must actually change — otherwise both tests are satisfied by a body that
  // never consulted the predicate.
  const [before] = await allRows<{ n: string }>(
    `SELECT count(DISTINCT name_fold) n FROM tr_officers
        WHERE uic IN (SELECT uic FROM tr_officers WHERE tr_fold_is_placeholder(name_fold) LIMIT 200)
          AND name_fold <> '' AND NOT tr_fold_is_placeholder(name_fold)`,
  );
  const after = await without([NO_PLACEHOLDER_GUARD], (q) =>
    q(
      `SELECT count(DISTINCT name_fold) n FROM tr_officers
          WHERE uic IN (SELECT uic FROM tr_officers WHERE name_fold = 'zalicheno obstoyatelstvo.' LIMIT 200)
            AND name_fold <> '' AND NOT tr_fold_is_placeholder(name_fold)`,
      [],
    ),
  );
  assert.ok(
    num((after[0] as { n: string }).n) > num(before.n),
    `the placeholder predicate has stopped discriminating: ${before.n} guarded vs ${(after[0] as { n: string }).n} unguarded`,
  );
});

test.skipIf(skip)(
  "the row cap is enforced in SQL, not left to the caller",
  async () => {
    // The route asks for 25; the function clamps to 100 whatever it is handed. A caller that
    // passed a large number — or none — must not be able to fan a hub out unboundedly.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_person_bridge($1, $2, 100000)`,
      [HUB_A, HUB_B],
    );
    assert.ok(num(r.n) <= 100, `clamp broken: ${r.n} rows`);
  },
);
