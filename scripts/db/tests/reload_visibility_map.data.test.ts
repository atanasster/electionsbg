// Tier 3 (Postgres-native) — the visibility map every single-transaction
// TRUNCATE+reload silently discards.
//
//   npm run test:data
//
// A loader that rebuilds a table with `TRUNCATE` + `INSERT`/`COPY` inside ONE
// transaction leaves `relallvisible = 0` PERMANENTLY, not transiently: TRUNCATE
// mints a new relfilenode with an empty map, every page is then written by a
// transaction that has not committed (so nothing can be marked all-visible), and
// the insert-threshold autovacuum that fires afterwards runs mid-`db:refresh`
// where a concurrent step holds back the xmin horizon — it marks nothing, resets
// `n_ins_since_vacuum` to 0, and with `n_dead_tup` also 0 never revisits the
// table. Postgres then cannot plan an index-only scan on it, ever.
//
// This is a gate on the CAUSE, and it is generic on purpose. The cost of the
// empty map is invisible in every direction a reviewer normally looks: row counts
// reconcile, the corpus is correct, the migration is untouched, and the plan is
// still *named* an Index Only Scan — it just reports `Heap Fetches: <every row>`.
// Both instances found so far were discovered by accident, and the first was
// initially misread as a function-body regression in a file nobody had edited.
//
// The threshold itself lives in `visibilityMapShort` (scripts/db/lib/pg.ts), shared
// with the loader's own post-vacuum read-back so the two cannot disagree about what
// healthy looks like, and unit-tested in lib/pg.test.ts — without that, every green
// run here would prove only that the check never fires.
//
// Requires the Postgres store. Auto-skips when it is unreachable or the table has
// not been loaded, exactly like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  dbReachable,
  end,
  vacuumRepairSql,
  visibilityMapShort,
} from "../lib/pg";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// One entry per table a loader rebuilds with the single-transaction TRUNCATE
// shape, naming the loader that must call `vacuumAfterReload` for it. This list is
// checked against the loaders' actual calls below, so it cannot quietly fall behind
// them — it did once already, missing `nzok_activity_monthly`.
//
// `contracts` is deliberately ABSENT: it is stage-MERGEd rather than truncated
// (load_pg.ts, RowExclusiveLock so readers never block), and its map survives a
// reload intact. It is the counter-example that shows the defect belongs to the
// reload SHAPE and not to bulk loading.
const RELOADED: ReadonlyArray<{ table: string; loader: string }> = [
  { table: "obshtina_population", loader: "db:load:municipal-fiscal:pg" },
  { table: "fund_projects", loader: "db:load:funds:pg" },
  { table: "fund_beneficiaries", loader: "db:load:funds:pg" },
  { table: "tenders", loader: "db:load:tenders:pg" },
  { table: "tender_normalcy_cache", loader: "db:load:tenders:pg" },
  { table: "procurement_normalcy_cache", loader: "db:load:pg" },
  { table: "procurement_annexes", loader: "db:load:annexes:pg" },
  { table: "nzok_activities", loader: "db:load:nzok-activities:pg" },
  {
    table: "nzok_activity_facility_periods",
    loader: "db:load:nzok-activities:pg",
  },
  { table: "nzok_activity_monthly", loader: "db:load:nzok-activities:pg" },
  // The state-budget corpus. Only `budget_personnel` is DELETE + COPY — the
  // shape that actually loses the map; the rest are stage-merged and keep it.
  // They carry the call anyway, for the reason the municipal-fiscal loader
  // states: a future switch to TRUNCATE must not silently give back
  // index-only scans.
  { table: "budget_fiscal_year", loader: "db:load:budget:pg" },
  { table: "budget_fiscal_year_figure", loader: "db:load:budget:pg" },
  { table: "budget_kfp_observation", loader: "db:load:budget:pg" },
  { table: "budget_kfp_snapshot_section", loader: "db:load:budget:pg" },
  { table: "budget_kfp_snapshot_line", loader: "db:load:budget:pg" },
  { table: "budget_personnel", loader: "db:load:budget:pg" },
  // TRUNCATE + INSERT inside the rebuild's own transaction (157), which is the
  // shape that loses the map for good — unlike the stage-merged rows above, this
  // one genuinely needs the call rather than carrying it defensively.
  {
    table: "budget_admin_procurement",
    loader:
      "db:load:budget:pg (also db:load:pg + db:load:tr:pg — all three rebuild it)",
  },
  // The municipal corpus — all four stage-merged, carrying the call for the
  // same reason as the state ones above.
  { table: "budget_muni_transfer", loader: "db:load:budget-muni:pg" },
  { table: "budget_muni_ipop_project", loader: "db:load:budget-muni:pg" },
  { table: "budget_muni_capital_project", loader: "db:load:budget-muni:pg" },
  { table: "budget_muni_execution", loader: "db:load:budget-muni:pg" },
  // Stage-merged, and the map still went short — see the block comment at the
  // vacuum call in load_interreg_pg.ts. Measured 2026-08-15: interreg_partners at
  // 130/474 pages with both vacuum timestamps NULL, which failed funds_fit's live
  // buffer ceiling (6,251 against 6,000) on a reload where the corpus SHRANK.
  { table: "interreg_operations", loader: "db:load:interreg:pg" },
  { table: "interreg_partners", loader: "db:load:interreg:pg" },
  { table: "interreg_programmes", loader: "db:load:interreg:pg" },
  // Both TRUNCATE + COPY in one transaction — the canonical shape. They were
  // already vacuumed correctly and already carried the explanation at their call
  // site; they are here because deriving LOADER_FILES is what first let this file
  // SEE those call sites, and an unlisted vacuum is one nothing verifies took.
  { table: "budget_peer_band", loader: "db:load:budget-hub:pg" },
  { table: "tr_name_fold_people", loader: "db:load:tr-name-fold-people:pg" },
  // Stage-merged, like the Interreg three. The loader ran a bare ANALYZE here for
  // its stats, which stamps last_analyze and leaves the map untouched — so
  // graph_company_node sat at 20/1174 pages (1.7%) while looking freshly maintained,
  // and its two siblings were healthy only because autovacuum had reached them.
  { table: "graph_edge", loader: "db:load:graph:pg" },
  { table: "graph_company_node", loader: "db:load:graph:pg" },
  { table: "graph_person_node", loader: "db:load:graph:pg" },
  { table: "graph_payloads", loader: "db:load:graph:pg" },
  // Upsert-only — a council resolution is a permanent public record, so this
  // loader never truncates. Listed for the same reason as the Interreg and
  // graph entries above: the merge still leaves dead tuples that neither
  // autovacuum threshold reaches, and a future switch to TRUNCATE must not
  // silently give back the index-only scans the serving functions plan on.
  { table: "council_muni", loader: "db:load:council:pg" },
  { table: "council_muni_code", loader: "db:load:council:pg" },
  { table: "council_resolution", loader: "db:load:council:pg" },
  { table: "council_vote", loader: "db:load:council:pg" },
];

// Every loader, DERIVED rather than hand-listed, so the static check below reads
// all of their call sites. It used to be an allowlist of eight filenames, which
// made a loader invisible to the check until somebody added it — a hole in the
// check itself, not in the loader. It bit twice: `load_municipal_fiscal_pg.ts`
// had a RELOADED entry and no entry here, so nothing was reading its call site;
// and `load_interreg_pg.ts` vacuumed nothing at all while being absent from both
// lists, so there was no direction from which this file could see it.
//
// Deriving it closes only ONE of the two directions, and the remaining gap is
// worth stating plainly: this still checks "every table a loader vacuums is
// listed", so a loader that vacuums NOTHING contributes no names and stays
// invisible. Asserting the converse needs an independent source of "this table
// is bulk-reloaded" — a whole-database sweep for short maps reports 22 tables
// today, most of them a few pages where no index-only scan is worth planning,
// so it is not yet a gate that could be green.
const LOADER_FILES = readdirSync(path.join(REPO, "db"))
  .filter((f) => /^load_.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
  .sort();

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

// Runs WITHOUT a database — a divergence between the loaders and this list is a
// source-level fact, and the list is what CLAUDE.md's runbook and table count point at.
test("every table a loader vacuums is listed here", () => {
  const declared = new Set(RELOADED.map((r) => r.table));
  const called = new Set<string>();
  for (const f of LOADER_FILES) {
    const src = readFileSync(path.join(REPO, "db", f), "utf8");
    // `vacuumAfterReload("a", "b")`, including the multi-line prettier form.
    for (const m of src.matchAll(/vacuumAfterReload\(([^)]*)\)/g))
      for (const q of m[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)) called.add(q[1]);
  }
  assert.ok(called.size > 0, "found no vacuumAfterReload call sites to check");
  const missing = [...called].filter((t) => !declared.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `these tables are vacuumed by a loader but not listed in RELOADED, so nothing ` +
      `verifies the vacuum actually took: ${missing.join(", ")}. Add them here (and to ` +
      `the repair command in CLAUDE.md).`,
  );
});

for (const { table, loader } of RELOADED) {
  test.skipIf(skip)(`${table} keeps its visibility map`, async () => {
    // Namespace- and relkind-qualified: `relname` alone is unique only per schema.
    const [vm] = await allRows<{ relpages: number; relallvisible: number }>(
      `SELECT c.relpages, c.relallvisible
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(current_schemas(false))
          AND c.relkind IN ('r', 'm') AND c.relname = $1`,
      [table],
    );
    // Not loaded on this checkout — a gitignored-input loader that skipped, or a
    // partial refresh. Absent is that loader's problem, not this file's.
    if (!vm || vm.relpages === 0) return;
    assert.ok(
      !visibilityMapShort(vm.relpages, vm.relallvisible),
      `${table} has visibility-map coverage on ${vm.relallvisible} of ${vm.relpages} pages, ` +
        `so no index-only scan can be planned against it. ${loader} rebuilds it with ` +
        `TRUNCATE + insert inside one transaction and must call vacuumAfterReload ` +
        `(scripts/db/lib/pg.ts) after its COMMIT. To repair an already-loaded database: ` +
        `\`${vacuumRepairSql(table)}\``,
    );
  });
}

/** The parliament window the /procurement/tenders browser defaults to, read from the
 *  table that DEFINES it (`procurement_scopes`, maintained by db:load:procurement-scopes:pg)
 *  rather than pinned. A hardcoded date keeps passing after the next election — a narrower
 *  window is still index-only — it just stops testing the scope its comment claims, which is
 *  the same silent drift CLAUDE.md already warns about for the January year rollover.
 *  The current parliament is the open-ended `ns:` row. Null when the scopes loader has not
 *  run, in which case the caller falls back rather than inventing a date. */
const defaultScopeStart = async (): Promise<string | null> => {
  const [row] = await allRows<{ date_from: string }>(
    `SELECT date_from FROM procurement_scopes
      WHERE scope_key LIKE 'ns:%' AND date_to IS NULL AND date_from IS NOT NULL
      ORDER BY date_from DESC LIMIT 1`,
  ).catch(() => []);
  return row?.date_from ?? null;
};

// The one member of that list whose empty map was COSTING something, asserted as
// the property rather than as a page count.
//
// Migration 113 exists to make the /procurement/tenders browser's count+sum and
// its two facet GROUP BYs Index-Only Scans over idx_tenders_order — it grew that
// index an INCLUDE payload for exactly these columns, and functions/db_table.js
// routes the aggregate at the base `tenders` table rather than the tenders_list
// view (whose LEFT JOINs block index-only scans) as the other half of the same
// fix. 113's measured target was 4,357 buffers → 75.
//
// With relallvisible = 0 that plan survives in NAME only. Measured 2026-08-11 on
// the default (this-parliament) scope: 5,047 buffers and `Heap Fetches: 6088`,
// restored to 87 and `Heap Fetches: 0`. Neither 113 nor the corpus had changed.
// A buffer ceiling alone would not say why, so assert Heap Fetches directly.
test.skipIf(skip)(
  "the tenders browser aggregate is index-only in fact, not just in name",
  async () => {
    const [t] = await allRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM tenders",
    );
    if (!t || t.n === 0) return; // tenders not loaded on this checkout
    const from = await defaultScopeStart();
    if (!from) return; // procurement_scopes not loaded — no default window to test

    const plan = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT count(*) AS n, sum(estimated_value_eur) AS s
       FROM tenders WHERE publication_date >= $1`,
      [from],
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");

    const fetches = /Heap Fetches: (\d+)/.exec(text);
    if (!fetches) {
      // Read the map BEFORE blaming 113. An empty map is itself a leading cause of
      // this plan disappearing entirely — the planner costs an index-only scan from
      // the relallvisible/relpages fraction, so at 0 the estimate collapses toward a
      // plain index scan and can lose to a Seq Scan outright. That is exactly what
      // happened to fund_projects in fdbdca7869. Sending the reader to an untouched
      // migration and an untouched route file first would reproduce the very
      // misdiagnosis this file exists to prevent.
      const [vm] = await allRows<{ relpages: number; relallvisible: number }>(
        `SELECT relpages, relallvisible FROM pg_class WHERE relname = 'tenders'`,
      );
      const why =
        vm && visibilityMapShort(vm.relpages, vm.relallvisible)
          ? `tenders' visibility map covers only ${vm.relallvisible}/${vm.relpages} pages, ` +
            `which on its own can cost the planner the index-only scan — fix that first: ` +
            `\`${vacuumRepairSql("tenders")}\``
          : `tenders' visibility map is intact, so this is migration 113's ` +
            `idx_tenders_order INCLUDE payload or db_table.js's aggBase routing`;
      assert.fail(
        `the tenders count+sum is no longer an Index Only Scan at all — ${why}:\n${text}`,
      );
    }

    // Not `=== 0`, though the distinction it drew is real ("0 or the row count, with
    // nothing in between"). tenders measures 42,071/42,072 — one trailing page short,
    // exactly the effect visibilityMapShort tolerates — and this window selects the
    // NEWEST rows, which after a COPY reload sit at the end of the heap, i.e. on that
    // page. So the honest bound is "nowhere near the row count": 50 is two orders of
    // magnitude under the 6,088 regression value and cannot be reached by an empty map.
    assert.ok(
      Number(fetches[1]) < 50,
      `the tenders count+sum reports Heap Fetches: ${fetches[1]} — the plan is named an ` +
        `Index Only Scan but reads its tuples from the heap, which is what an empty ` +
        `visibility map does to it. db:load:tenders:pg must VACUUM after its reload; to ` +
        `repair now run \`${vacuumRepairSql("tenders")}\`\n${text}`,
    );
  },
);
