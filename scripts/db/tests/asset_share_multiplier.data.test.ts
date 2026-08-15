// Lockstep gate for the ideal-part (идеална част) weighting rule.
//
// THE RULE. Сметна палата filing instructions, table 1 column 11: „Посочва се цената на
// придобиване на имота/правото В ЦЯЛОСТ, както е по съответния документ, БЕЗ ДА СЕ ДЕЛИ
// МЕЖДУ СЪСОБСТВЕНИЦИТЕ." Column 8 then requires each co-owner's part on its own row,
// repeating that same whole-property price. So a bare SUM(value_eur) counts a jointly-held
// property once PER CO-OWNER, and every wealth total weights by the declarant's fraction.
//
// WHY THIS TEST. The rule exists TWICE — assetShareMultiplier() in src/lib/declarations.ts
// (the JSON builders behind /officials/assets and the MP rollups) and
// asset_share_multiplier() in 090_person_wealth.sql (person_wealth_year and everything
// derived from it). A route cannot import TS, so the duplication is structural. If the two
// drift, the same human gets two different net worths on two pages — which is the exact
// class of contradiction the ceiling rule (ASSET_ROW_CEILING_EUR / asset_row_ceiling_eur)
// already carries a matching gate for.
//
// The corpus arm is the one that matters: the column is free text with ~3,200 distinct
// literals, so agreement on a handful of hand-picked strings proves very little.
//
// Auto-skips when Postgres is down or the corpus is empty, like the other *.data.test.ts
// gates, so CI (no container) skips it.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { assetShareMultiplier } from "../../../src/lib/declarations";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / declaration_asset empty";

afterAll(async () => {
  await end();
});

// Every DISTINCT (share, category) literal the corpus actually contains, run through both
// implementations. This is the assertion that keeps them honest — a new spelling of an
// ideal part reaches it automatically the next time declarations load.
test.skipIf(skip)(
  "SQL and TS agree on every (share, category) in the corpus",
  async () => {
    const rows = await allRows<{
      share: string | null;
      category: string;
      sql_m: string;
    }>(
      `SELECT share, category, asset_share_multiplier(share, category)::text AS sql_m
       FROM (SELECT DISTINCT share, category FROM declaration_asset) d`,
    );
    assert.ok(
      rows.length > 0,
      "no (share, category) pairs — corpus not loaded?",
    );

    const disagreements: string[] = [];
    for (const r of rows) {
      const ts = assetShareMultiplier({ category: r.category, share: r.share });
      const sql = Number(r.sql_m);
      // Both sides are exact rationals over small integers; a float epsilon is enough.
      if (Math.abs(ts - sql) > 1e-9) {
        disagreements.push(
          `${r.category} ${JSON.stringify(r.share)}: TS ${ts} vs SQL ${sql}`,
        );
      }
    }
    assert.deepEqual(
      disagreements,
      [],
      `assetShareMultiplier() and asset_share_multiplier() disagree on ${disagreements.length} of ${rows.length} corpus literals:\n  ${disagreements.slice(0, 20).join("\n  ")}`,
    );
  },
);

// The rule has to actually FIRE, or the test above passes vacuously against two
// implementations that both return 1 for everything.
test.skipIf(skip)(
  "weighting is live: the corpus contains fractional rows",
  async () => {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_asset
      WHERE asset_share_multiplier(share, category) <> 1`,
    );
    assert.ok(
      Number(c.n) > 1000,
      `expected many fractionally-held rows, got ${c.n} — has the parser stopped emitting share?`,
    );
  },
);

// `security` must never be weighted: on the table-9/10 forms that column is a COUNT of
// дялове ("369 476"), not a fraction. Weighting it would multiply a shareholding by its
// own share count.
test.skipIf(skip)("security rows are never weighted", async () => {
  const [c] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM declaration_asset
      WHERE category = 'security'
        AND asset_share_multiplier(share, category) <> 1`,
  );
  assert.equal(Number(c.n), 0, "a security row was share-weighted");

  assert.equal(
    assetShareMultiplier({ category: "security", share: "1/2" }),
    1,
    "TS weighted a security row",
  );
});

// A multiplier outside (0, 1] is never right, and 0 would silently zero a real asset.
test.skipIf(skip)("multiplier stays within (0, 1]", async () => {
  const rows = await allRows<{ share: string | null; m: string }>(
    `SELECT DISTINCT share, asset_share_multiplier(share, category)::text AS m
       FROM declaration_asset
      WHERE asset_share_multiplier(share, category) <= 0
         OR asset_share_multiplier(share, category) > 1`,
  );
  assert.deepEqual(
    rows.map((r) => `${JSON.stringify(r.share)} -> ${r.m}`),
    [],
    "multiplier left the (0, 1] range",
  );
});
