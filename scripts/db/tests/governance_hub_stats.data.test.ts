// Gate for the /governance hub blob's BUDGET tile — the one figure it folds whose basis is a
// choice rather than a fact.
//
// ⚠️⚠️ `budget_fiscal_year_figure.basis` has three values and two of them are not the law:
// `planned` is МФ's own budget-law column, `projected` is OUR seasonal extrapolation. The
// generator read the second and stamped `planned_expenditure` on it, so /governance published
// „€29,6 млрд. · разходи · план 2026" for a fiscal year that carries no planned row at all —
// a claim about what the National Assembly appropriated, made out of arithmetic we did.
//
// ⚠️ WHY THIS FILE EXISTS RATHER THAN AN ARM OF `hubHead.gates.test.ts`. That gate runs in
// jsdom and can only read the COMMITTED BLOB, so everything it can check is internal
// consistency — and the defect is internally consistent. Measured: reverting the generator's
// pick to the old always-`planned` stamp also drops `basisYear` (the anchor is written only on
// the forecast arm), producing a blob that looks perfectly coherent and passes every clause
// there. Only the SOURCE can settle which of the two bases the number came from, and only
// Postgres has it.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const BLOB = join(process.cwd(), "data/governance/hub_stats.json");

const haveDb = await dbReachable();
const haveFn = haveDb
  ? (
      await allRows<{ n: string }>(
        `SELECT count(*)::text n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'public' AND p.proname = 'budget_hub_stats'`,
      )
    )[0]?.n !== "0"
  : false;

const skip = !haveDb
  ? "Postgres unreachable"
  : !haveFn
    ? "budget_hub_stats() absent — run npm run db:load:budget-hub:pg"
    : false;
reportSkip(import.meta.url, skip);
afterAll(async () => {
  await end();
});

/** The committed blob the /governance head renders. */
const blob = (): {
  tiles: Record<
    string,
    { value: number; basis: string; year?: number; basisYear?: number }
  >;
} => JSON.parse(readFileSync(BLOB, "utf8"));

test.skipIf(skip)(
  "the budget tile's basis is the one its figure actually came from",
  async () => {
    const [r] = await allRows<{
      p: string | null;
      j: string | null;
      y: string | null;
      b: string | null;
    }>(
      `SELECT (budget_hub_stats()->>'expenditurePlannedEur')   AS p,
              (budget_hub_stats()->>'expenditureProjectedEur') AS j,
              (budget_hub_stats()->>'fiscalYear')              AS y,
              (budget_hub_stats()->>'projectionBasisYear')     AS b`,
    );
    const tile = blob().tiles.budget;
    if (!tile) {
      // A database with no budget corpus writes no tile at all, and the generator says so via
      // `note("budget", false, …)`. Assert the SOURCE agrees, so „no tile" cannot mean „the
      // generator silently dropped a figure Postgres was holding".
      assert.ok(
        r?.p == null && r?.j == null,
        "the blob has no budget tile while budget_hub_stats() carries an expenditure",
      );
      return;
    }

    // The law first wherever it exists — the same pick `budgetHubFigures.ts` makes, so the two
    // hubs cannot caption the identical number differently.
    const planned = r?.p == null ? null : Number(r.p);
    const projected = r?.j == null ? null : Number(r.j);
    const expected =
      planned != null
        ? { value: planned, basis: "planned_expenditure" }
        : { value: Number(projected), basis: "projected_expenditure" };

    assert.ok(
      planned != null || projected != null,
      "budget_hub_stats() carries neither a plan nor a forecast",
    );
    assert.equal(
      tile.basis,
      expected.basis,
      `the blob stamps ${tile.basis} on a figure the corpus holds as ${expected.basis}`,
    );
    assert.equal(tile.value, Math.round(expected.value));
    assert.equal(tile.year, r?.y == null ? undefined : Number(r.y));

    // The seasonal anchor rides ONLY on the forecast, and must be the corpus's own — an
    // anchor invented here would caption a real forecast with a profile it was not scaled
    // through, which reads more authoritative than saying nothing.
    if (expected.basis === "projected_expenditure")
      assert.equal(tile.basisYear, r?.b == null ? undefined : Number(r.b));
    else assert.equal(tile.basisYear, undefined);
  },
);

test.skipIf(skip)(
  "the two hubs publish the same expenditure figure",
  async () => {
    // /governance's whole reason for folding rather than re-aggregating is that „two hubs one
    // click apart" must not disagree. This is that claim, asserted rather than commented.
    const [r] = await allRows<{ v: string | null }>(
      `SELECT coalesce(budget_hub_stats()->>'expenditurePlannedEur',
                       budget_hub_stats()->>'expenditureProjectedEur') AS v`,
    );
    const tile = blob().tiles.budget;
    if (!tile || r?.v == null) return;
    assert.equal(
      tile.value,
      Math.round(Number(r.v)),
      "/governance's budget tile is a different number from /budget's own headline",
    );
  },
);
