// person_search.has_declaration agrees with the register the destination filters on.
//
// The /governance/declarations hub shows filers first and everyone else below (scope ranks,
// never filters), and both groups land on /persons — which applies `?decl=1` against
// person_browse_table. If the two disagree, the hub's first group and the page it opens
// describe different people, with nothing failing.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

test("the P tier's flag matches person_browse_table exactly", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const [row] = await allRows<Record<string, string>>(`
    SELECT (SELECT count(*) FROM person_search WHERE tier = 'P' AND has_declaration) AS search,
           (SELECT count(*) FROM person_browse_table
             WHERE tier LIKE '%P%' AND has_declaration)                              AS browse,
           (SELECT count(*) FROM person_search WHERE tier = 'P')                     AS p_total`);
  assert.equal(
    Number(row.search),
    Number(row.browse),
    "has_declaration drifted from person_browse_table — re-run db:load:person-search:pg",
  );
  // Not all of them, or the flag is not discriminating and both groups would be identical.
  assert.ok(Number(row.search) > 0);
  assert.ok(Number(row.search) < Number(row.p_total));
});

test("the private tiers are FALSE, never null — they are not in the register at all", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const rows = await allRows<{ tier: string; declared: string }>(
    `SELECT tier, count(*) FILTER (WHERE has_declaration)::text AS declared
       FROM person_search WHERE tier <> 'P' GROUP BY tier`,
  );
  for (const r of rows)
    assert.equal(
      Number(r.declared),
      0,
      `tier ${r.tier} claims filings; those rows are name-fold private owners, who have none`,
    );
  const [nulls] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM person_search WHERE has_declaration IS NULL`,
  );
  // NULL would read as "unknown", which would make the hub's second group
  // ("no declaration on record") a claim it cannot support.
  assert.equal(Number(nulls.n), 0);
});

test("the partial index exists — the hub's declared group is a ranked scan", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const rows = await allRows<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename = 'person_search' AND indexname = 'idx_person_search_declared'`,
  );
  assert.equal(
    rows.length,
    1,
    "idx_person_search_declared is missing — apply 126",
  );
  assert.match(rows[0].indexdef, /WHERE has_declaration/);
});
