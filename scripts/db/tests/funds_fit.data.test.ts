// Postgres gates for the fit resolver (migration 143).
//
// WHAT MAKES THIS FILE DIFFERENT FROM ITS SIBLINGS. The resolver answers a question nobody else
// here answers — „has anything like mine been funded" — and a wrong answer is not a wrong number
// on a dashboard: it is somebody deciding not to apply. Two failure shapes matter, and neither is
// visible to a row count:
//
//   1. THE ANSWER IS „NO" WHEN IT SHOULD BE „YES". A resolver that finds nothing looks exactly
//      like a corpus that contains nothing. Every search gate below asserts a KNOWN answer, not
//      merely a non-empty result.
//   2. THE INTERREG ARM SILENTLY DISAPPEARS. Interreg is cross-border, so its money is almost all
//      on border municipalities — the readers an ИСУН-only answer would tell „нищо наблизо" while
//      their neighbours hold grants (funds-module-v2 §2.3). An empty arm is a green test unless
//      something asserts it is populated.
//
// An empty `fund_fit` and an absent Interreg corpus are therefore ASSERTIONS, not green skips.
// Postgres being unreachable IS a skip — that is a missing tool, not a missing corpus.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import {
  allRows,
  dbReachable,
  withClient,
  end,
  // The threshold and the repair command, IMPORTED rather than re-typed. Both were hand-copied
  // here once and both had already drifted from the loader that owns them: the local bar was
  // stricter (0.9) than `visibilityMapShort`, and the local repair string omitted `PARALLEL 0`,
  // which pg.ts documents as required on the docker Postgres.
  visibilityMapShort,
  vacuumRepairSql,
} from "../lib/pg";
// The SHARED buffer parser. A hand-rolled /shared (?:hit|read)=(\d+)/ is the exact defect
// explain_buffers.ts exists to retire — it matches „shared hit=" but not the bare „read=", so it
// scores only what was already CACHED. Measured here before the fix: 914 against a true 2,617.
import { sumExecutionBuffers } from "../lib/explain_buffers";
// The canonical oblast namespace, imported rather than re-typed — the whole point of the gate
// below is that the two namespaces must not drift.
import { OBLAST_NAME } from "../../../src/lib/regionalOblast";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  if (haveDb) await end();
});

interface FitRow {
  procedure_code: string;
  project_count: number;
  grant_median: number | null;
  local_count: number;
  procedure_name: string | null;
  sample_title: string | null;
  org_kinds: { label: string; n: number }[];
  oblasti: Record<string, number>;
  paid_project_count: number;
  total_eur: number;
}

const search = (q: string, oblast: string | null = null, lim = 6) =>
  allRows<FitRow>(`SELECT * FROM funds_fit_isun($1, $2, $3)`, [q, oblast, lim]);

test.skipIf(skip)("fund_fit is built and covers the corpus", async () => {
  const [row] = await allRows<{
    rows: number;
    named: number;
    with_median: number;
    with_place: number;
    projects: number;
  }>(
    `SELECT (SELECT count(*)::int FROM fund_fit) AS rows,
            (SELECT count(*) FILTER (WHERE procedure_name IS NOT NULL)::int FROM fund_fit) AS named,
            (SELECT count(*) FILTER (WHERE grant_median IS NOT NULL)::int FROM fund_fit) AS with_median,
            (SELECT count(*) FILTER (WHERE oblasti <> '{}'::jsonb)::int FROM fund_fit) AS with_place,
            (SELECT count(*)::int FROM fund_projects) AS projects`,
  );
  assert.ok(
    row.rows > 1500,
    `fund_fit has ${row.rows} procedures — run db:load:funds-fit:pg. An unbuilt matview makes the ` +
      "resolver answer „nothing like that has been funded" +
      '" to every question, at a 200.',
  );
  assert.ok(
    row.projects > 50_000,
    `fund_projects has only ${row.projects} rows`,
  );
  // Named is ~41% by construction (ИСУН's export carries no procedure-name column); the point of
  // the assertion is that the LATERAL onto fund_payloads still resolves at all.
  assert.ok(row.named > 500, `only ${row.named} procedures resolved a name`);
  assert.ok(
    row.with_median > row.rows * 0.8,
    "most procedures should have a median grant",
  );
  assert.ok(
    row.with_place > row.rows * 0.6,
    "most procedures should have an oblast breakdown",
  );
});

test.skipIf(skip)(
  "every procedure's project_count reconciles with fund_projects",
  async () => {
    // The procedure code is DERIVED (strip the trailing ordinal from contract_number). A regex
    // that lost a code family would silently drop those contracts out of every answer while the
    // matview still looked healthy.
    const [row] = await allRows<{ fit: number; src: number }>(
      `SELECT (SELECT sum(project_count)::int FROM fund_fit) AS fit,
              (SELECT count(*)::int FROM fund_projects)      AS src`,
    );
    assert.equal(
      row.fit,
      row.src,
      "the rollup and the corpus disagree — the procedure-code derivation is dropping contracts",
    );
  },
);

test.skipIf(skip)(
  "the resolver finds the answer the corpus actually holds",
  async () => {
    // „къща за гости" is the single most-repeated question in the measured demand (Appendix A),
    // and the corpus's best answer to it is „Подкрепа за семейно предприятие" — 1,869 projects.
    // Asserted BY NAME rather than as „some rows", because the failure that matters is finding
    // the wrong thing, not finding nothing: an earlier fold of the haystack (the 25 largest titles
    // per procedure) returned six results and lost this one.
    const rows = await search("къща за гости", null, 8);
    assert.ok(rows.length > 0, "„къща за гости" + '" returned nothing at all');
    const codes = rows.map((r) => r.procedure_code);
    assert.ok(
      codes.includes("BG16RFPR001-1.004"),
      `expected „Подкрепа за семейно предприятие" (BG16RFPR001-1.004) among ${codes.join(", ")}`,
    );
    const family = rows.find((r) => r.procedure_code === "BG16RFPR001-1.004")!;
    assert.ok(
      family.project_count > 1000,
      "that procedure should carry >1000 projects",
    );
    assert.ok((family.grant_median ?? 0) > 1000, "and a real median grant");
  },
);

test.skipIf(skip)(
  "a query with no plausible match returns nothing",
  async () => {
    // The gate above only proves the resolver finds things. This proves it can also NOT find them —
    // without it, a predicate that matched everything would pass every other test in this file.
    const rows = await search("зззз няма такова нещо ъъъ", null, 6);
    assert.equal(rows.length, 0, `expected no match, got ${rows.length}`);
  },
);

test.skipIf(skip)("place RANKS and never filters", async () => {
  // The single most important behaviour here. „Нищо подобно не е финансирано" is a far worse
  // answer than „в твоята област няма, но в страната има 340" — and for a resolver whose whole
  // job is to tell someone whether to bother applying, the false negative is the expensive error.
  // VID (Видин) deliberately, not SFO. Sofia appears in almost every procedure, so a filtering
  // implementation would return the same six rows and the assertion below would pass anyway — the
  // needle has to be an oblast most procedures do NOT reach.
  const nationwide = await search("енергийна ефективност", null, 6);
  const scoped = await search("енергийна ефективност", "VID", 6);
  assert.ok(
    nationwide.length > 0,
    "the nationwide query should find something",
  );
  assert.equal(
    scoped.length,
    nationwide.length,
    "asking with an oblast returned FEWER rows — the place is filtering, not ranking",
  );
  // …and the local ones come first.
  const firstLocal = scoped.findIndex((r) => r.local_count > 0);
  const firstNonLocal = scoped.findIndex((r) => r.local_count === 0);
  if (firstLocal >= 0 && firstNonLocal >= 0)
    assert.ok(
      firstLocal < firstNonLocal,
      "a procedure with local projects should outrank one without",
    );
});

test.skipIf(skip)(
  "local_count agrees with the stored oblast breakdown",
  async () => {
    const rows = await search("иновации", "PDV", 6);
    for (const r of rows)
      assert.equal(
        r.local_count,
        r.oblasti.PDV ?? 0,
        `${r.procedure_code}: local_count ${r.local_count} but oblasti.PDV is ${r.oblasti.PDV}`,
      );
  },
);

test.skipIf(skip)("the oblast breakdown is COMPLETE, not a top-N", async () => {
  // Truncating it would make `local_count` silently zero for a reader in the 9th-largest oblast
  // — „нищо наблизо" when there are twelve. Compared against the source rather than a constant.
  // `jsonb_object_keys` in a scalar subquery, because there is no key-count function. Counted
  // against the SOURCE rather than a constant, so it stays true as the corpus moves — and the
  // source expression is FOLDED like the matview's, because comparing the raw column would count
  // the capital's four S2x shards as four oblasti against the one folded key and fail on 52
  // procedures for entirely the wrong reason.
  const [row] = await allRows<{ bad: number }>(
    `WITH src AS (
         SELECT regexp_replace(contract_number, '-[0-9]+$', '') AS pc,
                count(DISTINCT canon_oblast(oblast))::int AS n
           FROM fund_projects WHERE oblast IS NOT NULL GROUP BY 1
       ), fit AS (
         SELECT procedure_code AS pc,
                (SELECT count(*)::int FROM jsonb_object_keys(oblasti)) AS n
           FROM fund_fit
       )
       SELECT count(*)::int AS bad
         FROM src JOIN fit USING (pc) WHERE src.n IS DISTINCT FROM fit.n`,
  );
  assert.equal(
    row.bad,
    0,
    `${row.bad} procedures have a truncated oblast breakdown`,
  );
});

test.skipIf(skip)(
  "paid_project_count is the paid SUBSET, computed from the same population",
  async () => {
    // „Never exceeds" alone could not fail: a constant 0 satisfies it. This compares both figures
    // against the corpus, so a count taken over a different population — the failure that would
    // render „2,300 of 1,869 paid" — shows up.
    const [row] = await allRows<{ bad: number; nonzero: number }>(
      `WITH src AS (
         SELECT regexp_replace(contract_number, '-[0-9]+$', '') AS pc,
                count(*) FILTER (WHERE COALESCE(paid_eur, 0) > 0)::int AS paid
           FROM fund_projects GROUP BY 1
       )
       SELECT count(*) FILTER (WHERE ff.paid_project_count IS DISTINCT FROM src.paid)::int AS bad,
              count(*) FILTER (WHERE ff.paid_project_count > 0)::int AS nonzero
         FROM src JOIN fund_fit ff ON ff.procedure_code = src.pc`,
    );
    assert.equal(
      row.bad,
      0,
      `${row.bad} procedures disagree with the corpus on paid projects`,
    );
    assert.ok(
      row.nonzero > 100,
      "a constant zero would satisfy the subset relation alone",
    );
  },
);

test.skipIf(skip)("the quartiles are ordered", async () => {
  const [row] = await allRows<{ bad: number }>(
    `SELECT count(*)::int AS bad FROM fund_fit
      WHERE grant_median IS NOT NULL
        AND (grant_p25 > grant_median OR grant_median > grant_p75)`,
  );
  assert.equal(row.bad, 0, "p25 ≤ median ≤ p75 must hold on every row");
});

test.skipIf(skip)(
  "the oblast breakdown speaks the CANONICAL namespace the picker uses",
  async () => {
    // THE GATE THAT WAS MISSING. `fund_projects.oblast` keys the capital as the raw shards
    // S22/S23/S24/S25; the picker, `place_dim` and `interreg_partners` all use the folded
    // `SOFIA_CITY`. Storing the raw form made „near me" permanently empty for 19.2% of the corpus
    // — the largest single place in the country — while the Interreg arm's local chip kept
    // working on the same input. Every earlier place gate used VID/PDV/SFO, codes that are
    // identical in both namespaces, so none of them could see it.
    const keys = await allRows<{ k: string }>(
      `SELECT DISTINCT jsonb_object_keys(oblasti) AS k FROM fund_fit`,
    );
    const known = new Set(Object.keys(OBLAST_NAME));
    const strays = keys.map((r) => r.k).filter((k) => !known.has(k));
    assert.deepEqual(
      strays,
      [],
      `fund_fit.oblasti holds codes the UI picker cannot produce: ${strays.join(", ")}`,
    );
    assert.ok(
      keys.some((r) => r.k === "SOFIA_CITY"),
      "SOFIA_CITY is absent — the S2x shards are not being folded, so the capital can never be local",
    );
  },
);

test.skipIf(skip)(
  "asking as the CAPITAL returns real local counts",
  async () => {
    // The end-to-end form of the gate above: it is the answer a Sofia reader gets that matters,
    // not only the stored keys.
    const rows = await search("иновации", "SOFIA_CITY", 6);
    assert.ok(rows.length > 0, "the query itself should match");
    assert.ok(
      rows.some((r) => r.local_count > 0),
      "no procedure reported a project in SOFIA_CITY, though 15,748 of the corpus are there",
    );
  },
);

test.skipIf(skip)(
  "arm 2 reaches EVERY matching procedure, not a value-biased sample",
  async () => {
    // The row cap this replaced dropped 78% of matching procedures on a common query (185 → 41)
    // and chose the survivors partly by `total_eur` — the same big-project bias the migration's
    // header rejects another design for. Compared against the trigram predicate itself.
    const [src] = await allRows<{ n: number }>(
      `SELECT count(DISTINCT regexp_replace(contract_number, '-[0-9]+$', ''))::int AS n
         FROM fund_projects f
        WHERE f.title IS NOT NULL AND f.title <> ''
          AND word_similarity($1, f.title) >= 0.45`,
      ["енергийна ефективност"],
    );
    // The serving function caps at 50 by design; ask for that and require it to be reached
    // whenever the corpus has at least that many.
    const rows = await search("енергийна ефективност", null, 50);
    assert.ok(
      src.n > 50,
      `only ${src.n} procedures match — pick a broader probe`,
    );
    assert.equal(
      rows.length,
      50,
      `the corpus holds ${src.n} matching procedures but the resolver reached only ${rows.length}`,
    );
  },
);

// ── The Interreg arm ───────────────────────────────────────────────────────────────────────

test.skipIf(skip)(
  "the Interreg arm is POPULATED — an empty one silently reintroduces the border bias",
  async () => {
    const [b] = await allRows<{
      interreg_operations: number;
      interreg_partners: number;
      interreg_with_eik: number;
    }>(`SELECT * FROM funds_fit_basis()`);
    assert.ok(
      b.interreg_operations > 1000,
      `funds_fit_basis reports ${b.interreg_operations} Interreg operations — run ` +
        "db:load:interreg:pg. Without them the resolver tells border municipalities that " +
        "nothing near them was ever funded.",
    );
    assert.ok(
      b.interreg_partners > 1000,
      "placed Bulgarian partners should be present",
    );
    // The Tier-L caveat the caption states as a percentage. If this ever reached parity the
    // caption would be wrong in the other direction, so it is bounded on both sides.
    assert.ok(
      b.interreg_with_eik > 0 && b.interreg_with_eik < b.interreg_partners,
      "pre-2021 Interreg carries no EIK, so the with-EIK share must be a real fraction",
    );
  },
);

test.skipIf(skip)(
  "the Interreg arm returns the BULGARIAN partner's budget, not the project total",
  async () => {
    // BSB00963 is the worked example: €1,419,208 cross-border against Малко Търново's €357,183.
    // Quoting the project total would overstate what a Bulgarian applicant received fourfold.
    const rows = await allRows<{ keep_id: number; bg_budget_eur: number }>(
      `SELECT keep_id, bg_budget_eur FROM funds_fit_interreg('tourism', NULL, 10)`,
    );
    assert.ok(
      rows.length > 0,
      "„tourism" + '" should match Interreg operations',
    );
    for (const r of rows) {
      const [cmp] = await allRows<{ bg: number; total: number }>(
        `SELECT (SELECT COALESCE(sum(budget_eur), 0) FROM interreg_partners
                  WHERE keep_id = $1 AND obshtina IS NOT NULL) AS bg,
                (SELECT COALESCE(total_budget_eur, 0) FROM interreg_operations
                  WHERE keep_id = $1) AS total`,
        [r.keep_id],
      );
      assert.ok(
        Math.abs((r.bg_budget_eur ?? 0) - cmp.bg) < 1,
        `keep_id ${r.keep_id}: returned ${r.bg_budget_eur} but the BG partner sum is ${cmp.bg}`,
      );
      if (cmp.total > 0)
        assert.ok(
          (r.bg_budget_eur ?? 0) <= cmp.total + 1,
          `keep_id ${r.keep_id}: the BG share exceeds the whole cross-border project`,
        );
    }
  },
);

test.skipIf(skip)(
  "the Interreg arm flags English titles rather than hiding them",
  async () => {
    const rows = await allRows<{ title: string; title_is_english: boolean }>(
      `SELECT title, title_is_english FROM funds_fit_interreg('tourism', NULL, 6)`,
    );
    assert.ok(rows.length > 0);
    // 86% of the corpus is English-only, so at least one must be flagged — and the flag must
    // actually track the source rather than being hard-coded either way.
    assert.ok(
      rows.some((r) => r.title_is_english),
      "no row was flagged as English, though 1,682 of 1,954 operations have no Bulgarian title",
    );
  },
);

// ── Cost ───────────────────────────────────────────────────────────────────────────────────

/** Execution buffers for one statement, via the SHARED parser. */
const buffersFor = async (sql: string, params: unknown[]): Promise<number> =>
  withClient(async (c) => {
    const { rows } = await c.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
      params,
    );
    return sumExecutionBuffers(rows);
  });

test.skipIf(skip)(
  "fund_projects keeps the visibility map its cheap plan depends on",
  async () => {
    // Runs BEFORE the buffer ceiling below because it is the same defect stated in the
    // language of its CAUSE. `funds_fit_basis()` counts `fund_projects` on every /funds view,
    // and that count is only cheap as an INDEX-ONLY scan — which Postgres will not plan at all
    // unless the visibility map is populated. The loader rebuilds the table with TRUNCATE +
    // insert inside one transaction, which leaves `relallvisible = 0` permanently (autovacuum
    // fires mid-`db:refresh`, marks nothing because a concurrent step holds the xmin horizon,
    // resets its own counter and never revisits) — so the plan silently degrades to a Seq Scan
    // over the whole table.
    //
    // Measured 2026-08-11: the ceiling test failed at 31,934 buffers against 6,000, of which
    // 29,423 were this one arm. Nothing about that number says "visibility map", so the first
    // reading was a function-body regression in 143 — which was untouched. This assertion
    // names the cause and the fix instead.
    // Qualified by namespace and relkind. `relname` is unique only PER SCHEMA, and this repo's
    // loaders routinely create stage twins, so a bare `WHERE relname = …` can measure a different
    // relation than the one being served and report a shortfall on a table that is fine — sending
    // the next reader to the wrong file, which is the exact failure this gate exists to prevent.
    const [vm] = await allRows<{
      relpages: number;
      relallvisible: number;
      has_rows: boolean;
    }>(
      `SELECT c.relpages, c.relallvisible,
              EXISTS (SELECT 1 FROM fund_projects) AS has_rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(current_schemas(false))
          AND c.relkind = 'r' AND c.relname = 'fund_projects'`,
    );
    assert.ok(vm, "fund_projects is missing");
    // BOTH columns are planner estimates maintained by VACUUM/ANALYZE, and TRUNCATE resets
    // `relpages` to 0 — so on a database loaded WITHOUT the fix, before auto-analyze fires, the
    // row reads 0/0 and every coverage predicate is vacuously satisfied. Measured: a probe table
    // holding 20,000 rows with a wholly empty map reads `relpages = 0`, and the bar this gate
    // used to carry (`relallvisible >= relpages * 0.9`) returned TRUE on it — green on precisely
    // the defect it was written for. Assert the table is MEASURED before asserting its coverage,
    // so "never analyzed" is its own loud state rather than a pass.
    assert.ok(
      !vm.has_rows || vm.relpages > 0,
      "fund_projects holds rows but pg_class reports relpages = 0 — nothing has ANALYZEd it " +
        "since its TRUNCATE+insert, so the planner is flying blind AND no index-only scan is " +
        "possible. This gate cannot measure coverage in that state; it is the defect, not an " +
        `excuse to skip. Run \`${vacuumRepairSql("fund_projects")}\``,
    );
    assert.ok(
      !visibilityMapShort(vm.relpages, vm.relallvisible),
      `fund_projects has visibility-map coverage on ${vm.relallvisible} of ${vm.relpages} pages — ` +
        "count(*) cannot use an index-only scan, so funds_fit_basis() seq-scans the whole table " +
        "on every /funds view. The loader must VACUUM after its single-transaction TRUNCATE+insert " +
        "(scripts/db/lib/pg.ts vacuumAfterReload); to repair an already-loaded database run " +
        `\`${vacuumRepairSql("fund_projects")}\`. The generic, table-driven form of this check ` +
        "is reload_visibility_map.data.test.ts — this one stays because it names the SERVING cost.",
    );
  },
);

test.skipIf(skip)("the resolver stays cheap enough to serve live", async () => {
  // ALL THREE QUERIES the route issues, not just one. A per-request figure that counted the ИСУН
  // arm alone described about half the real cost, and the point of a ceiling is that it bounds
  // what a request actually does.
  //
  // reference_pg_query_performance puts the live-serving ceiling near 2,000 buffers PER STATEMENT.
  // The ИСУН arm sits just above it and the number is stated rather than hidden, because the
  // cheaper designs were measured and are worse: folding every project title into the matview is
  // correct but 4x slower (418–616 ms against 19–162 ms), and folding only the 25 largest loses
  // the best answer the corpus holds for the most-asked question.
  const worst = "иновации"; // the shortest common word — the widest trigram candidate set
  const isun = await buffersFor(
    `SELECT * FROM funds_fit_isun($1, 'SOFIA_CITY', 6)`,
    [worst],
  );
  const interreg = await buffersFor(
    `SELECT * FROM funds_fit_interreg($1, 'SOFIA_CITY', 4)`,
    ["innovation"],
  );
  const basis = await buffersFor(`SELECT * FROM funds_fit_basis()`, []);
  const total = isun + interreg + basis;
  assert.ok(
    isun < 3_500,
    `funds_fit_isun('${worst}') touched ${isun} buffers (ceiling 3500)`,
  );
  assert.ok(
    total < 6_000,
    `one whole request touched ${total} buffers — isun ${isun} + interreg ${interreg} + basis ${basis} (ceiling 6000)`,
  );
});

test.skipIf(skip)(
  "the buffer gate's instrument actually discriminates",
  async () => {
    // A ceiling is only a gate if the thing measuring it can produce a big number. The previous
    // version could not: its regex scored 914 where the truth was 2,617, so a genuine regression
    // to a whole-corpus scan could have sailed under it. This proves the instrument responds by
    // measuring a deliberate seq scan over the same table.
    const cheap = await buffersFor(
      `SELECT * FROM funds_fit_isun($1, NULL, 6)`,
      ["млад фермер"],
    );
    const expensive = await withClient(async (c) => {
      await c.query("SET LOCAL enable_indexscan = off");
      await c.query("SET LOCAL enable_bitmapscan = off");
      const { rows } = await c.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
           SELECT count(*) FROM fund_projects WHERE title IS NOT NULL`,
      );
      return sumExecutionBuffers(rows);
    });
    assert.ok(
      expensive > cheap * 3,
      `a full seq scan scored ${expensive} against ${cheap} for the resolver — the parser is not ` +
        "responding to real work, so every ceiling built on it is decorative",
    );
  },
);

// ── The per-procedure base rates (the /funds/procedure/:code card) ─────────────────────────

test.skipIf(skip)(
  "funds_fit_procedure is a PK seek and agrees with the rollup",
  async () => {
    // The whole reason `fund_fit` is materialised. If this ever stopped being an index seek the
    // card would be a full scan on a page with 2,206 URLs.
    const [row] = await allRows<{
      procedure_code: string;
      project_count: number;
      grant_median: number | null;
      paid_project_count: number;
    }>(`SELECT * FROM funds_fit_procedure($1)`, ["BG16RFPR001-1.004"]);
    assert.ok(row, "no row for a procedure that certainly exists");
    const [ff] = await allRows<{
      project_count: number;
      grant_median: number | null;
      paid_project_count: number;
    }>(
      `SELECT project_count, grant_median, paid_project_count
         FROM fund_fit WHERE procedure_code = $1`,
      ["BG16RFPR001-1.004"],
    );
    assert.equal(row.project_count, ff.project_count);
    assert.equal(row.grant_median, ff.grant_median);
    assert.equal(row.paid_project_count, ff.paid_project_count);

    const plan = await withClient(async (c) => {
      const { rows } = await c.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
           SELECT * FROM funds_fit_procedure('BG16RFPR001-1.004')`,
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(
      plan,
      /ux_fund_fit_code/,
      "the base-rate card is not using the unique index — it is scanning the matview",
    );
  },
);

test.skipIf(skip)("an unknown procedure code returns no row", async () => {
  // The route turns this into `null`, which is what stops the page rendering a card of zeroes.
  const rows = await allRows(`SELECT * FROM funds_fit_procedure($1)`, [
    "NO-SUCH-PROCEDURE-9.999",
  ]);
  assert.equal(rows.length, 0);
});

test.skipIf(skip)(
  "the median a reader divides is a real median of REAL grants",
  async () => {
    // The reference price is arithmetic on this number, so it has to be the thing it claims: the
    // 50th percentile of grants that actually exist, not of a set padded with zeroes and NULLs.
    const [row] = await allRows<{ bad: number }>(
      `WITH src AS (
         SELECT regexp_replace(contract_number, '-[0-9]+$', '') AS pc,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY grant_eur)
                  FILTER (WHERE grant_eur > 0) AS med
           FROM fund_projects GROUP BY 1
       )
       SELECT count(*)::int AS bad
         FROM src JOIN fund_fit ff ON ff.procedure_code = src.pc
        WHERE ff.grant_median IS DISTINCT FROM src.med`,
    );
    assert.equal(
      row.bad,
      0,
      `${row.bad} procedures disagree with the corpus on the median`,
    );
  },
);
