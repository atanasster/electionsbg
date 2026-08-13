// Gate for the state-budget corpus (migrations 152 + 153).
//
// This asserts Postgres against `scripts/budget/hub_ledger.ts` — an INDEPENDENT
// re-derivation from the shard files that shares no code path with the loader.
// That independence is the point (dashboard-hub skill §8): a gate that re-runs
// the loader's own reading of the shards proves only that the loader is
// deterministic, and inherits every misunderstanding it was meant to catch.
//
// ── THE SKIP RULE, WHICH IS DIFFERENT FROM EVERY OTHER data.test HERE ──────
//
// `municipal_fiscal.data.test.ts` treats an empty table as a FAILURE, because
// its loader is unconditional in db:refresh and reads a committed input. This
// corpus is the opposite: `db:load:budget:pg` is in REFRESH_EXCLUSIONS because
// the admin and programme grain lives in two GITIGNORED trees, so CI and a
// fresh clone legitimately have neither the shards nor the rows.
//
// So the admin gates SKIP when the shards are absent — and they skip LOUDLY,
// naming the reason, rather than passing over an empty table. A count-zero
// assertion an empty table satisfies trivially is exactly the vacuous-gate
// failure this whole tier exists to avoid; silently green on CI while checking
// nothing is worse than red.
//
// The KFP half has no such exemption: kfp.json and index.json are COMMITTED, so
// an empty budget_fiscal_year means the loader broke.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";
import {
  loadBudgetCorpus,
  measureHubLedger,
  ledgerYears,
} from "../../budget/hub_ledger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../../..");

const haveDb = await dbReachable();

/** Whether 152/153 have been applied here AT ALL.
 *
 *  This guard is the difference between a skip and a stack trace, and it exists
 *  because `db:load:budget:pg` is the ONLY applier and it is in
 *  REFRESH_EXCLUSIONS. On a fresh clone `db:refresh` starts Postgres — so
 *  `dbReachable()` is true — and never applies these migrations, so the first
 *  `SELECT … FROM budget_fiscal_year` raises 42P01 and the test ERRORS rather
 *  than skipping, failing the chain at its final step. That is the migration-144
 *  defect class. (T4's `db:load:budget-hub:pg` will apply the DDL in-chain; this
 *  guard stays correct either way.) */
const tablesApplied = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          `SELECT count(*)::text n FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname = 'budget_fiscal_year'`,
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !tablesApplied
    ? "152/153 not applied here — their only applier (db:load:budget:pg) is in " +
      "REFRESH_EXCLUSIONS, so a fresh clone legitimately has no budget tables"
    : false;

/**
 * APPLIED is not LOADED, and T3 is the change that decoupled them.
 *
 * The header above says an empty budget_fiscal_year means the loader broke,
 * because its inputs are committed. That was true when the ONLY applier was the
 * loader itself. T3 made the in-chain municipal loader apply 152/153's DDL so
 * migration 155's bodies compile — so a fresh clone and CI now have the tables,
 * empty, with no defect at all. Skipping on the DATA rather than on the schema
 * is what keeps db:refresh green there.
 */
const stateSkip =
  skip ||
  (Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*)::text n FROM budget_fiscal_year",
      )
    )[0]?.n ?? 0,
  ) === 0
    ? "the state corpus is empty — db:load:budget:pg is in REFRESH_EXCLUSIONS, so " +
      "a fresh clone has the tables (applied by db:load:budget-muni:pg) and no rows"
    : false);

/** The gitignored half. Absent on CI and on a fresh clone, by design. */
const haveShards = existsSync(resolve(REPO, "data/budget/reconciliation"));
const shardSkip =
  stateSkip ||
  (!haveShards
    ? "data/budget/reconciliation/ absent — GITIGNORED (bucket-shipped only), " +
      "so this machine has no admin grain to compare against. Run " +
      "`npm run data -- --all` to regenerate it."
    : false);

afterAll(async () => {
  await end();
});

const corpus = loadBudgetCorpus();

test.skipIf(stateSkip)(
  "budget_fiscal_year matches the shard summary",
  async () => {
    const years = (corpus.index?.fiscalYears ?? []).map((y) => y.fiscalYear);
    const rows = await allRows<{ fiscal_year: number }>(
      "SELECT fiscal_year FROM budget_fiscal_year ORDER BY fiscal_year",
    );
    assert.deepEqual(
      rows.map((r) => r.fiscal_year),
      [...years].sort((a, b) => a - b),
    );
  },
);

test.skipIf(stateSkip)(
  "every headline figure equals the ledger's independent derivation",
  async () => {
    let compared = 0;
    for (const fy of (corpus.index?.fiscalYears ?? []).map(
      (y) => y.fiscalYear,
    )) {
      const ledger = measureHubLedger(fy, corpus);
      const rows = await allRows<{ series: string; amount_eur: number }>(
        `SELECT series, amount_eur FROM budget_fiscal_year_figure
          WHERE fiscal_year = $1 AND basis = 'actual'`,
        [fy],
      );
      const byName = new Map(rows.map((r) => [r.series, r.amount_eur]));
      for (const series of [
        "revenue",
        "expenditure",
        "euContribution",
        "balance",
      ]) {
        const want = ledger.find((f) => f.key === `${series}ExecutedEur`);
        if (want?.value == null) continue;
        assert.equal(
          byName.get(series),
          want.value,
          `FY${fy} ${series}: Postgres ${byName.get(series)} vs ledger ${want.value}`,
        );
        compared += 1;
      }
    }
    // A loop that compares nothing passes. Twenty-four is 6 years × 4 series;
    // anything materially under that means the ledger or the table went quiet.
    assert.ok(
      compared >= 20,
      `only ${compared} figures compared — the gate is not exercising the corpus`,
    );
  },
);

test.skipIf(stateSkip)(
  "budget_kfp_observation is a lossless capture of the shard feed",
  async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_kfp_observation",
    );
    assert.equal(Number(r.n), corpus.kfp?.observations.length ?? -1);
  },
);

test.skipIf(skip)(
  "no money column is numeric — node-postgres would serialise it as a string",
  async () => {
    // A `numeric` column returns a STRING through node-postgres, which blanks
    // every money cell on the page while the number is present in the payload.
    // Invisible to a row count and to any assertion made through SQL, so it is
    // asserted on the catalogue instead. Migrations 120 and 142 both shipped it.
    const bad = await allRows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name LIKE 'budget\\_%'
          AND data_type = 'numeric'`,
    );
    assert.deepEqual(bad, []);
  },
);

test.skipIf(shardSkip)(
  "budget_admin_fact covers every reconciliation year, not just the KFP ones",
  async () => {
    // The narrow-enumerator regression. `index.fiscalYears` is KFP-derived and
    // starts at 2021 while the shards reach 2018, so looping the summary set
    // drops three years — 551 facts instead of 873, with nothing failing.
    const rows = await allRows<{ fiscal_year: number }>(
      "SELECT DISTINCT fiscal_year FROM budget_admin_fact ORDER BY fiscal_year",
    );
    const loaded = rows.map((r) => r.fiscal_year);
    assert.ok(
      loaded.length > 0,
      "budget_admin_fact is empty on a machine that HAS the shards",
    );
    for (const fy of ledgerYears(corpus)) {
      if (!existsSync(resolve(REPO, `data/budget/reconciliation/${fy}`)))
        continue;
      assert.ok(
        loaded.includes(fy),
        `FY${fy} has a shard dir but no admin facts`,
      );
    }
  },
);

test.skipIf(shardSkip)(
  "the deviations coverage pair matches the ledger, in UNITS not rows",
  async () => {
    // The §2.1 error this corpus produces most readily: by-admin rows are
    // (nodeId × kind), so a row count read as a number of ministries over-states
    // by 1.8x-2.9x. Both numbers are asserted so a swap cannot pass.
    //
    // Only 2022-2024 have any executed rows at all, and `continue` on a null
    // ledger value means a loop over the wrong years passes having compared
    // NOTHING — so the comparisons are counted and the count is asserted.
    let compared = 0;
    for (const fy of [2022, 2023, 2024]) {
      const ledger = measureHubLedger(fy, corpus);
      const units = ledger.find((f) => f.key === "deviationsCoveredNodes");
      const rows = ledger.find((f) => f.key === "deviationsExecutedRows");
      if (units?.value == null) continue;

      const [pg] = await allRows<{ units: string; rows: string }>(
        `SELECT count(DISTINCT node_id)::text units, count(*)::text rows
           FROM budget_admin_fact
          WHERE fiscal_year = $1 AND executed_eur IS NOT NULL`,
        [fy],
      );
      assert.equal(Number(pg.units), units.value, `FY${fy} covered UNITS`);
      assert.equal(Number(pg.rows), rows?.value, `FY${fy} executed ROWS`);
      assert.notEqual(
        Number(pg.units),
        Number(pg.rows),
        `FY${fy}: units and rows are equal, so this gate cannot tell them apart`,
      );
      compared += 1;
    }
    assert.ok(
      compared >= 3,
      `only ${compared} year(s) compared — 2022-2024 all carry executed rows, so a ` +
        "lower count means the ledger or the table went quiet rather than that the " +
        "years are empty",
    );
  },
);

test.skipIf(stateSkip)(
  "the snapshot SECTION frame survives, including what kind cannot express",
  async () => {
    // Sections II and III are BOTH kind = 'expenditure' and III is the EU
    // contribution, so `series` is the only thing that separates them; and
    // sections III and IV publish a total with ZERO lines, so a line-only
    // capture makes the EU contribution and the deficit vanish entirely.
    const rows = await allRows<{ section_code: string; series: string }>(
      `SELECT section_code, series FROM budget_kfp_snapshot_section
        WHERE fiscal_year = (SELECT max(fiscal_year) FROM budget_kfp_snapshot_section)
        ORDER BY section_code`,
    );
    assert.equal(rows.length, 5, "expected five sections I..V");
    const expenditure = rows.filter(
      (r) => r.series === "expenditure" || r.series === "euContribution",
    );
    assert.equal(expenditure.length, 2);
    assert.notEqual(
      expenditure[0].series,
      expenditure[1].series,
      "the two expenditure-kind sections must be distinguishable by series",
    );
    // The two that publish no lines must still exist as sections.
    const codes = rows.map((r) => r.section_code);
    for (const c of ["III", "IV"]) assert.ok(codes.includes(c), `section ${c}`);
  },
);

test.skipIf(shardSkip)(
  "every programme resolves to its owning spending unit",
  async () => {
    // `by-program.json` keys on a PROGRAMME slug and names no owner; the first
    // cut wrote that slug into node_id as well, so 0 of 86 joined
    // budget_admin_node and „which programmes does МФ run" was unanswerable.
    const [r] = await allRows<{ total: string; owned: string; joined: string }>(
      `SELECT count(*)::text total,
              count(f.node_id)::text owned,
              count(n.node_id)::text joined
         FROM budget_program_fact f
         LEFT JOIN budget_admin_node n ON n.node_id = f.node_id`,
    );
    assert.ok(Number(r.total) > 0, "budget_program_fact is empty");
    // The mapping is total on this corpus: 727/727, 124 programmes, 0 ambiguous.
    assert.equal(r.owned, r.total, "some programme has no owning unit");
    assert.equal(
      r.joined,
      r.total,
      "some owner does not exist in budget_admin_node",
    );
    // …and the owner must NOT be the programme itself.
    const [self] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_program_fact WHERE node_id = program_code",
    );
    assert.equal(Number(self.n), 0);
  },
);

test.skipIf(stateSkip)("a withheld headcount is NULL, never 0", async () => {
  // NSI publishes nothing before 2021 and the shard renders that as an empty
  // breakdown summed to 0. Storing the 0 draws the series falling off a cliff
  // beside 130k budgeted positions — the plan's §2.2 withheld-≠-zero trap.
  const zeros = await allRows<{ fiscal_year: number }>(
    "SELECT fiscal_year FROM budget_personnel WHERE nsi_headcount = 0",
  );
  assert.deepEqual(zeros, []);
  // And the gate must not be vacuous: the column has to carry real values too.
  const [r] = await allRows<{ n: string }>(
    "SELECT count(nsi_headcount)::text n FROM budget_personnel",
  );
  assert.ok(
    Number(r.n) >= 4,
    "no NSI headcounts at all — nothing to discriminate",
  );
});

test.skipIf(shardSkip)(
  "every admin fact resolves to a node, and the node set is the shards'",
  async () => {
    const orphans = await allRows<{ node_id: string }>(
      `SELECT DISTINCT f.node_id FROM budget_admin_fact f
         LEFT JOIN budget_admin_node n ON n.node_id = f.node_id
        WHERE n.node_id IS NULL`,
    );
    assert.deepEqual(orphans, []);

    const [n] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_admin_node",
    );
    // 55 is the union of admin nodeIds across all nine years, which is also the
    // number of per-ministry shard files — they reconcile exactly.
    assert.equal(Number(n.n), corpus.ministryFileCount);
  },
);

test.skipIf(stateSkip)(
  "budget_document maps every kind onto the OGP frame or explicitly onto none",
  async () => {
    const rows = await allRows<{ kind: string; obs_category: string | null }>(
      "SELECT DISTINCT kind, obs_category FROM budget_document ORDER BY kind",
    );
    assert.ok(rows.length > 0, "budget_document is empty");
    // The claim /budget/law makes is „България публикува N от 8". Bulgaria does
    // NOT publish a citizens budget, so nothing may map to it — if a future
    // mapping does, the page's one editorial claim silently becomes false.
    for (const r of rows) {
      assert.notEqual(
        r.obs_category,
        "citizens-budget",
        `${r.kind} claims to be a citizens budget — Bulgaria publishes none, and ` +
          "that absence is what /budget/law asserts",
      );
    }
  },
);

test.skipIf(stateSkip)(
  "adopted_by_item_id is never inferred — it is NULL until T6.6 resolves it",
  async () => {
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM budget_document WHERE adopted_by_item_id IS NOT NULL",
    );
    // A title regex cannot tell a second-reading adoption from a procedural
    // mention (`bill`'s stem split is TypeScript for that reason), so any value
    // here before the resolver ships is a guess presented as a fact.
    assert.equal(Number(r.n), 0);
  },
);
