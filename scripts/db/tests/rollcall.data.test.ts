// Gates for the roll-call corpus in Postgres (docs/plans/parliament-hub-v1.md §11).
// Auto-skips when Postgres is down.
//
//   npm run test:data
//
// The two that carry the most weight are the ones about IDENTITY, because both describe
// source defects that no row count reveals and that the JSON layer has been absorbing
// silently: an mp_id that names two different people, and a seat whose party changes
// mid-term. Each is enumerated as DATA here rather than asserted as a bound, so a 27th
// recycled id or a 180th switcher fails loudly instead of widening a tolerance.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();

afterAll(async () => {
  if (haveDb) await end();
});

const one = async <T = Record<string, unknown>>(sql: string): Promise<T> =>
  (await allRows<T>(sql))[0];

const tableExists = async (name: string): Promise<boolean> =>
  (
    await one<{ ok: boolean }>(
      `SELECT to_regclass('public.${name}') IS NOT NULL AS ok`,
    )
  ).ok;

test("the corpus is loaded, and the dedupe left the right split", async (t) => {
  if (!haveDb || !(await tableExists("vote_item"))) return t.skip();
  const r = await one<{ total: string; stand: string; superseded: string }>(
    `SELECT count(*) total,
            count(*) FILTER (WHERE superseded_by IS NULL) stand,
            count(*) FILTER (WHERE superseded_by IS NOT NULL) superseded
       FROM vote_item`,
  );
  // Every raw item is a row; the re-voted ones point at the cast that stands. Derivations
  // filter superseded_by IS NULL and so see the 15,096 the JSON artifacts were computed
  // from. If `stand` ever equals `total`, dedupeRevotes stopped being applied and every
  // per-MP metric is about to over-weight whatever was voted twice.
  assert.equal(Number(r.total), 16741, "raw item count moved");
  assert.equal(
    Number(r.stand),
    15096,
    "the standing set is not the deduped set",
  );
  assert.equal(Number(r.superseded), 1645);
});

test("every superseded item points at a survivor on its own day", async (t) => {
  if (!haveDb || !(await tableExists("vote_item"))) return t.skip();
  const bad = await allRows<{ item_id: number }>(
    `SELECT a.item_id
       FROM vote_item a JOIN vote_item b ON b.item_id = a.superseded_by
      WHERE a.superseded_by IS NOT NULL
        AND (b.date <> a.date OR b.ns <> a.ns OR b.superseded_by IS NOT NULL)
      LIMIT 5`,
  );
  // A pointer to another day, another parliament, or to a row that is itself superseded
  // would mean the survivor rule drifted from dedupeRevotes'.
  assert.deepEqual(bad, [], "superseded_by points somewhere it should not");
});

test("no orphan casts", async (t) => {
  if (!haveDb || !(await tableExists("vote_cast"))) return t.skip();
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM vote_cast c
      WHERE NOT EXISTS (SELECT 1 FROM vote_item i WHERE i.item_id = c.item_id)
         OR NOT EXISTS (SELECT 1 FROM mp_seat s WHERE s.ns = c.ns AND s.mp_id = c.mp_id)`,
  );
  assert.equal(Number(r.n), 0);
});

test("the 26 recycled mp_ids are exactly these, and (ns, mp_id) keeps them apart", async (t) => {
  if (!haveDb || !(await tableExists("mp_seat"))) return t.skip();
  const rows = await allRows<{ mp_id: number }>(
    `SELECT mp_id FROM (
       SELECT mp_id, count(DISTINCT upper(regexp_replace(name, '[.[:space:]-]+', ' ', 'g'))) n
         FROM mp_seat GROUP BY mp_id) q
      WHERE n > 1 ORDER BY mp_id`,
  );
  // parliament.bg reuses member ids across parliaments, so 26 of them name two genuinely
  // different people (3103 is both Димитър Бойчев Петров and Деница Димитрова Симеонова).
  // A 27th is not automatically a bug — but it IS a new person whose votes could be
  // attributed to someone else by anything keying on mp_id alone, which person_role
  // currently does.
  assert.equal(
    rows.length,
    26,
    `${rows.length} recycled mp_id(s) — the list moved; check the person→votes bridge`,
  );
  // And the composite key does its job: no (ns, mp_id) resolves to two names.
  const split = await one<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT ns, mp_id FROM mp_seat GROUP BY ns, mp_id HAVING count(DISTINCT name) > 1) q`,
  );
  assert.equal(Number(split.n), 0);
});

test("party is recorded per CAST, and 179 seats change it mid-term", async (t) => {
  if (!haveDb || !(await tableExists("vote_cast"))) return t.skip();
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT ns, mp_id FROM vote_cast WHERE party_id IS NOT NULL
        GROUP BY ns, mp_id HAVING count(DISTINCT party_id) > 1) q`,
  );
  // If this ever reads 0, party stopped being captured per cast and started being copied
  // from the seat — which would silently compare 179 members against a group they had
  // already left, every time a derivation groups by party. mp_dissent is exactly that
  // shape, so the failure would look like "these members are unusually loyal".
  assert.equal(
    Number(r.n),
    179,
    "the per-cast party affiliation changed shape — mp_seat.party_id may have leaked in",
  );
});

test("the standing set matches index.json, per parliament", async (t) => {
  if (!haveDb || !(await tableExists("vote_item"))) return t.skip();
  const rows = await allRows<{ ns: number; days: string }>(
    `SELECT ns, count(DISTINCT date) days FROM vote_item GROUP BY ns ORDER BY ns`,
  );
  // The nine parliaments that have roll-call data at all. 40-43 must NOT appear: the
  // 2005/2009/2013/2014 elections published none, and a row for them would mean the
  // loader invented an NS.
  assert.deepEqual(
    rows.map((r) => Number(r.ns)),
    [44, 45, 46, 47, 48, 49, 50, 51, 52],
  );
  const total = rows.reduce((n, r) => n + Number(r.days), 0);
  assert.equal(total, 613, "plenary-day count moved");
});

test("the live-served shapes stay under the Cloud SQL buffer budget", async (t) => {
  if (!haveDb || !(await tableExists("vote_cast"))) return t.skip();

  // Prod is a db-g1-small with a 10 s statement_timeout and a pool of 4. Local timings do
  // not transfer, so the budget is expressed in BUFFERS, which do: §6.2 sets the live
  // ceiling at ~2,000, and everything above it is a precompute. The worst parliament is
  // the 51st (4,687 items, 1.12M casts) — measuring anywhere else would flatter the plan.
  const worst = await one<{ mp_id: number }>(
    `SELECT mp_id FROM vote_cast WHERE ns = 51 GROUP BY mp_id ORDER BY count(*) DESC LIMIT 1`,
  );
  const plan = await allRows<{ "QUERY PLAN": string }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
     SELECT i.date, i.item_no, i.title, c.vote
       FROM vote_cast c JOIN vote_item i USING (item_id)
      WHERE c.mp_id = ${worst.mp_id} AND i.ns = 51
      ORDER BY i.date DESC, i.item_no LIMIT 50`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  const hits = [...text.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].reduce(
    (n, m) => n + Number(m[1]) + Number(m[2] ?? 0),
    0,
  );
  assert.ok(
    hits < 2000,
    `one MP's voting record touched ${hits} buffers on the worst parliament; the live ceiling is 2,000`,
  );
});
