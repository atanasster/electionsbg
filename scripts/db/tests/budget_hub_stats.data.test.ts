// Gate for the /budget hub stat call (migration 156).
//
// This is where T1's deferred TEST-002 lands: the ledger's key set is asserted
// against the matview's fields. `scripts/budget/hub_ledger.ts` derives every
// figure INDEPENDENTLY from the shard files, so a disagreement means one of the
// two is wrong — which is the whole reason the ledger exists (skill §8: a gate
// that re-runs the generator's own SQL proves only that it was freshly
// refreshed).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { loadBudgetCorpus, measureHubLedger } from "../../budget/hub_ledger";

const haveDb = await dbReachable();
const applied = haveDb
  ? Number(
      (
        await allRows<{ n: string }>(
          `SELECT count(*)::text n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relname = 'budget_hub_stats_cache'`,
        )
      )[0]?.n ?? 0,
    ) > 0
  : false;
const skip = !haveDb
  ? "Postgres unreachable"
  : !applied
    ? "156 not applied here — run npm run db:load:budget-hub:pg"
    : false;

// APPLIED is not LOADED: the state corpus's filler is in REFRESH_EXCLUSIONS, so
// a fresh clone has the matview with zero rows and no defect at all.
const stateSkip =
  skip ||
  (Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*)::text n FROM budget_hub_stats_cache",
      )
    )[0]?.n ?? 0,
  ) === 0
    ? "the cache is empty — db:load:budget:pg is in REFRESH_EXCLUSIONS"
    : false);

afterAll(async () => {
  await end();
});

const corpus = loadBudgetCorpus();

test.skipIf(stateSkip)(
  "the matview agrees with the ledger's independent derivation",
  async () => {
    // T1's TEST-002. The pairing is by NAME on purpose — the ledger's docstring
    // promises the keys agree so a gate needs no lookup table — and the
    // intersection is asserted non-empty, because a gate comparing zero pairs
    // passes while both sides are renamed.
    const PAIRS: Array<[string, string]> = [
      ["revenueExecutedEur", "revenue_executed_eur"],
      ["expenditureExecutedEur", "expenditure_executed_eur"],
      ["euContributionExecutedEur", "eu_contribution_executed_eur"],
      ["balanceExecutedEur", "balance_executed_eur"],
      ["gdpEur", "gdp_eur"],
      ["monthsAvailable", "months_available"],
      ["spendingUnitCount", "spending_unit_count"],
      ["deviationsCoveredNodes", "variance_covered_units"],
    ];
    let compared = 0;
    for (const fy of [2023, 2024]) {
      const ledger = measureHubLedger(fy, corpus);
      const [row] = await allRows<Record<string, unknown>>(
        "SELECT * FROM budget_hub_stats_cache WHERE fiscal_year = $1",
        [fy],
      );
      if (!row) continue;
      for (const [key, col] of PAIRS) {
        const want = ledger.find((f) => f.key === key)?.value;
        if (want == null) continue;
        assert.equal(
          Number(row[col]),
          Number(want),
          `FY${fy} ${key}: matview ${row[col]} vs ledger ${want}`,
        );
        compared += 1;
      }
    }
    assert.ok(
      compared >= 10,
      `only ${compared} field(s) compared — the ledger and the matview no longer ` +
        "share a key name, so this gate is checking nothing",
    );
  },
);

test.skipIf(skip)("the matview can be refreshed CONCURRENTLY", async () => {
  // The 145 regression: a unique index on an EXPRESSION does not qualify a
  // matview, so REFRESH … CONCURRENTLY raises and the loader's catch silently
  // takes the locking path for ever. Asserted on the catalogue rather than by
  // running it, so the gate is cheap and still exact.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
        WHERE c.relname = 'budget_hub_stats_cache' AND i.indisunique
          AND i.indexprs IS NULL AND i.indpred IS NULL`,
  );
  assert.ok(
    Number(r.n) >= 1,
    "no plain-column unique index — REFRESH … CONCURRENTLY cannot succeed",
  );
});

test.skipIf(skip)("every peer band is present, or none is", async () => {
  // A partial comparison renders as a missing chip, which reads as „no EU
  // comparison exists" rather than „this one did not load".
  const rows = await allRows<{ na_item: string }>(
    "SELECT na_item FROM budget_peer_band ORDER BY na_item",
  );
  assert.deepEqual(
    rows.map((r) => r.na_item),
    ["B9", "TE", "TR"],
  );
});

test.skipIf(stateSkip)(
  "the stat call names a basis on every money key",
  async () => {
    // `expenditureEur` would let a consumer pick executed or projected by
    // accident. Asserted on the payload's own keys so a future field cannot
    // quietly omit it.
    const [r] = await allRows<{ keys: string[] }>(
      "SELECT array(SELECT jsonb_object_keys(budget_hub_stats(2024))) AS keys",
    );
    const money = r.keys.filter((k) => k.endsWith("Eur"));
    assert.ok(money.length >= 5, `only ${money.length} money keys`);
    for (const k of money) {
      if (k === "gdpEur") continue;
      assert.match(
        k,
        /(Executed|Projected|Planned)Eur$/,
        `${k} names no basis — a consumer cannot tell which figure it is`,
      );
    }
  },
);

test.skipIf(skip)("no count in a per-year row is a corpus total", async () => {
  // The skill's first trap. Unscoped, FY2026 published 3,492 ИПОП projects
  // (all 2025) and 26 capital municipalities where it has 1.
  for (const [col, src, extra] of [
    ["ipop_project_count", "budget_muni_ipop_project", ""],
    ["ipop_stalled_count", "budget_muni_ipop_project", "AND stalled"],
  ] as const) {
    const rows = await allRows<{
      fiscal_year: number;
      cached: number;
      truth: number;
    }>(
      `SELECT c.fiscal_year, c.${col}::int cached,
                (SELECT count(*)::int FROM ${src} t
                  WHERE t.fiscal_year = c.fiscal_year ${extra}) truth
           FROM budget_hub_stats_cache c`,
    );
    for (const r of rows)
      assert.equal(r.cached, r.truth, `FY${r.fiscal_year} ${col}`);
  }
  const caps = await allRows<{
    fiscal_year: number;
    cached: number;
    truth: number;
  }>(
    `SELECT c.fiscal_year, c.capital_municipality_count::int cached,
              (SELECT count(DISTINCT obshtina)::int FROM budget_muni_capital_project t
                WHERE t.fiscal_year = c.fiscal_year) truth
         FROM budget_hub_stats_cache c`,
  );
  for (const r of caps)
    assert.equal(
      r.cached,
      r.truth,
      `FY${r.fiscal_year} capital municipalities`,
    );
  // …and the gate must discriminate: the years must NOT all carry the same
  // number, or a corpus total would satisfy it.
  assert.ok(
    new Set(caps.map((r) => r.cached)).size > 1,
    "every year has the same capital count — this gate cannot tell a corpus total apart",
  );
});

test.skipIf(stateSkip)(
  "the coverage denominator travels with its numerator",
  async () => {
    const [r] = await allRows<{ covered: number; total: number }>(
      `SELECT (budget_hub_stats(2024) ->> 'varianceCoveredUnits')::int covered,
              (budget_hub_stats(2024) ->> 'spendingUnitCount')::int    total`,
    );
    assert.ok(r.covered != null && r.total != null);
    assert.ok(
      r.covered < r.total,
      "coverage equals the population — suspicious",
    );
  },
);

test.skipIf(stateSkip)(
  "the payload is small enough to be the hub's only fetch",
  async () => {
    // The whole point of T4: 1,202 KB across four eager requests becomes this.
    // The plan budgets ~6 KB.
    const [r] = await allRows<{ bytes: number }>(
      "SELECT length(budget_hub_stats(2024)::text) AS bytes",
    );
    assert.ok(
      r.bytes < 6144,
      `the stat payload is ${r.bytes} bytes — over the 6 KB budget, which is how it ` +
        "regrows into the artifact it replaced",
    );
  },
);
