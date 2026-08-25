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
import { reportSkip } from "../../lib/report_skip";

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
reportSkip(import.meta.url, skip);

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

// Reported only when it differs from `skip` — the file-level call above already
// said that one, and repeating it would read as two separate gates standing down.
reportSkip(
  import.meta.url,
  stateSkip !== skip && stateSkip ? `state-corpus arm — ${stateSkip}` : false,
);
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
    //
    // This is the ONLY place that budget can be asserted, so two things about
    // its basis matter (T7.3 — tests/perf.spec.ts counts and names the hub's
    // requests but cannot weigh them: the data bucket sends no
    // `Timing-Allow-Origin`, so every `decodedBodySize` there is 0).
    //
    //   * NO `fy` — `useBudgetHubStats` omits the parameter unless a caller
    //     asks for a year, so the payload the hub actually downloads is the
    //     NEWEST one. Measured 2026-08-14: FY2024 is 1,875 bytes and the
    //     newest (2026) is 1,895, so pinning 2024 would have been ~neutral
    //     today and silently the wrong year the moment a fiscal year lands
    //     with more content in it.
    //   * `octet_length`, not `length` — `length()` counts CHARACTERS. They
    //     agree today because the payload is all-ASCII, but the moment any
    //     Cyrillic label enters it (a unit name, an МФ caption) a byte budget
    //     asserted in characters under-counts by ~2x on exactly the part that
    //     grew.
    const [r] = await allRows<{ bytes: number }>(
      "SELECT octet_length(budget_hub_stats(NULL)::text) AS bytes",
    );
    assert.ok(
      r.bytes < 6144,
      `the stat payload is ${r.bytes} bytes — over the 6 KB budget, which is how it ` +
        "regrows into the artifact it replaced",
    );
  },
);

test.skipIf(stateSkip)(
  "the two GDP shares are DERIVED, each from its own numerator",
  async () => {
    // ⚠️⚠️ The point is not that a percentage is plausible — it is WHICH numerator produced
    // it. A share computed off `expenditureExecutedEur` is also a plausible percentage
    // (11.0 at six months of FY2026 against 23.1), and it would satisfy any range assertion
    // while captioning half a year's spending as the year's envelope.
    //
    // The division lives in 156 because `budgetBasis.test.ts` §7.1 keeps basis changes off
    // the client. This is the other half of that rule: a server-side basis change nobody
    // checks is the same defect one layer down.
    const [r] = await allRows<{
      pctPlanned: number | null;
      pctProjected: number | null;
      planned: number | null;
      projected: number | null;
      executed: number | null;
      gdp: number | null;
    }>(`
      WITH s AS (SELECT budget_hub_stats(NULL) AS j)
      SELECT (j ->> 'expenditurePlannedPctGdp')::numeric   AS "pctPlanned",
             (j ->> 'expenditureProjectedPctGdp')::numeric AS "pctProjected",
             (j ->> 'expenditurePlannedEur')::numeric      AS planned,
             (j ->> 'expenditureProjectedEur')::numeric    AS projected,
             (j ->> 'expenditureExecutedEur')::numeric     AS executed,
             (j ->> 'gdpEur')::numeric                     AS gdp
        FROM s`);

    assert.ok(
      r.gdp,
      "no GDP on the newest year — the shares cannot be checked",
    );
    const share = (n: number | null) =>
      n == null ? null : Math.round(((100 * n) / Number(r.gdp)) * 10) / 10;

    assert.equal(Number(r.pctPlanned ?? NaN) || null, share(r.planned));
    assert.equal(Number(r.pctProjected ?? NaN) || null, share(r.projected));

    // At least one of the two must exist, or the head's third cell never renders.
    assert.ok(
      r.pctPlanned != null || r.pctProjected != null,
      "neither GDP share is populated on the newest year",
    );

    // The mutation check: whichever share exists is NOT the executed one.
    const executedShare = share(r.executed);
    for (const pct of [r.pctPlanned, r.pctProjected])
      if (pct != null && executedShare != null)
        assert.notEqual(
          Number(pct),
          executedShare,
          "a GDP share equals the EXECUTED-so-far share — the year is being " +
            "published at the fraction of itself that has elapsed",
        );
  },
);

test.skipIf(stateSkip)(
  "`planned` and `projected` are kept apart, and the anchor year travels with the forecast",
  async () => {
    // ⚠️⚠️ `basis='planned'` is МФ's budget-law column; `basis='projected'` is OUR seasonal
    // extrapolation (kfp.ts projectFigures). The /budget head published the second under the
    // first's name for one review cycle — a claim about what the National Assembly voted,
    // made out of arithmetic we did ourselves. 156 must expose both so a consumer can pick
    // knowingly rather than receive one column and guess.
    const rows = await allRows<{
      fy: number;
      complete: boolean;
      planned: number | null;
      projected: number | null;
      basisYear: number | null;
    }>(`
      SELECT (j ->> 'fiscalYear')::int              AS fy,
             (j ->> 'complete')::boolean            AS complete,
             (j ->> 'expenditurePlannedEur')::numeric   AS planned,
             (j ->> 'expenditureProjectedEur')::numeric AS projected,
             (j ->> 'projectionBasisYear')::int      AS "basisYear"
        FROM budget_hub_stats_cache c,
             LATERAL budget_hub_stats(c.fiscal_year) AS j`);

    assert.ok(rows.length > 0, "no fiscal years in the cache");

    for (const r of rows) {
      // A forecast without its anchor is a forecast from nowhere — the caption on the head
      // names the anchor year, so the wire has to carry it.
      if (r.projected != null)
        assert.ok(
          r.basisYear != null && r.basisYear < r.fy,
          `FY${r.fy} carries a projection with no prior anchor year`,
        );
      // And nothing is projected once the year is closed, which is why exposing `planned`
      // is what stops the band emptying itself the day a fiscal year ends.
      if (r.complete)
        assert.equal(
          r.projected,
          null,
          `FY${r.fy} is complete and still projected`,
        );
      assert.ok(
        r.planned != null || r.projected != null || !r.complete,
        `FY${r.fy} has neither a plan nor a projection — the head would show no money`,
      );
    }

    // Non-vacuity, in both directions: an assertion set that never sees a plan, or never
    // sees a forecast, is satisfied by a payload that dropped one of the two columns.
    assert.ok(
      rows.some((r) => r.planned != null),
      "no fiscal year carries a budget-law plan",
    );
    assert.ok(
      rows.some((r) => r.projected != null),
      "no fiscal year carries a projection",
    );
  },
);
