// The two routes behind /votes/:date, checked against the session files they replace.
//
// This page family is the module's highest-traffic half and its most expensive fetch: the
// screen currently downloads the whole day file — 482 KB on an average day, 4.97 MB on
// 2025-06-19 — because that file carries every MP's vote on every item. The split is
// day-level agenda + tallies (one call) and per-MP votes for the item a reader actually
// opens (another). These gates check the two halves reproduce the file, and that neither
// can be planned into the seq scan that costs 21,904 buffers.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const DAY = "2026-07-30";
const FILE = `data/parliament/votes/sessions/${DAY}.json`;

afterAll(async () => {
  if (haveDb) await end();
});

interface FileItem {
  item: number;
  tallies: { yes: number; no: number; abstain: number; absent: number };
  votes: Array<{ mpId: number; vote: string }>;
}

const readDay = () =>
  JSON.parse(readFileSync(FILE, "utf8")) as {
    sessions: FileItem[];
    itemTitles?: Record<string, string>;
  };

test("the day route reproduces the session file's agenda and tallies", async (t) => {
  if (!haveDb || !existsSync(FILE)) return t.skip();
  const rows = await allRows<{
    item_no: number;
    title: string | null;
    yes: number;
    no: number;
    abstain: number;
    absent: number;
  }>(
    `SELECT item_no, title, yes, no, abstain, absent
       FROM vote_item WHERE date = '${DAY}' ORDER BY item_no`,
  );
  if (rows.length === 0) return t.skip();

  const file = readDay();
  // EVERY item, including the re-voted ones. This route is the day's RECORD rather than a
  // statistic over it, so unlike the matviews it does not filter superseded_by — a motion
  // put to the floor twice is a fact about the day.
  assert.equal(rows.length, file.sessions.length, "item count differs");

  const byNo = new Map(file.sessions.map((i) => [i.item, i]));
  const wrong: string[] = [];
  for (const r of rows) {
    const f = byNo.get(Number(r.item_no));
    if (!f) {
      wrong.push(`item ${r.item_no} absent from the file`);
      continue;
    }
    if (
      Number(r.yes) !== f.tallies.yes ||
      Number(r.no) !== f.tallies.no ||
      Number(r.abstain) !== f.tallies.abstain ||
      Number(r.absent) !== f.tallies.absent
    ) {
      wrong.push(`item ${r.item_no} tally differs`);
    }
    const title = file.itemTitles?.[String(r.item_no)] ?? null;
    if ((r.title ?? null) !== title) wrong.push(`item ${r.item_no} title differs`);
  }
  assert.deepEqual(wrong.slice(0, 10), []);
});

test("one item's per-MP votes reproduce the file, modulo the duplicate casts", async (t) => {
  if (!haveDb || !existsSync(FILE)) return t.skip();
  const file = readDay();
  const first = file.sessions.find((i) => i.votes.length > 0);
  if (!first) return t.skip();

  const ids = await allRows<{ item_id: number }>(
    `SELECT item_id FROM vote_item WHERE date = '${DAY}' AND item_no = ${first.item}`,
  );
  if (!ids.length) return t.skip();

  const rows = await allRows<{ mp_id: number; vote: string }>(
    `SELECT mp_id, vote FROM vote_cast WHERE item_id = ${ids[0].item_id}`,
  );
  const pg = new Map(rows.map((r) => [Number(r.mp_id), r.vote]));
  const WORD: Record<string, string> = { y: "yes", n: "no", a: "abstain", x: "absent" };

  // DISTINCT, because the source lists 84 (item, MP) pairs twice and the primary key keeps
  // one. Comparing raw lengths would fail on exactly the days that carry them.
  const distinct = new Set(first.votes.map((v) => v.mpId));
  assert.equal(pg.size, distinct.size, "per-MP vote count differs");

  const wrong: string[] = [];
  for (const v of first.votes) {
    const got = pg.get(v.mpId);
    // `if (got && …)` would SKIP an MP the file has and Postgres does not, and the size
    // assertion above can be satisfied by a compensating extra row — so the pair of them
    // would pass on a genuinely lossy load. Missing is a failure, not a skip.
    if (got === undefined) {
      wrong.push(`mp ${v.mpId}: in the file, absent from Postgres`);
      continue;
    }
    if (WORD[got] !== v.vote) wrong.push(`mp ${v.mpId}: ${WORD[got]} vs ${v.vote}`);
  }
  // And the other direction, which the size check also cannot see on its own.
  for (const mpId of pg.keys()) {
    if (!distinct.has(mpId)) wrong.push(`mp ${mpId}: in Postgres, absent from the file`);
  }
  assert.deepEqual(wrong.slice(0, 10), []);
});

test("neither route can be planned into the seq scan", async (t) => {
  if (!haveDb) return t.skip();
  // The 21x trap: the planner picks a Parallel Seq Scan over the 4M-row fact table for the
  // day-join shape at the default random_page_cost, costing 21,904 buffers against 1,023
  // for the nested loop. Driving from an explicit item_id removes the choice — a single
  // PK lookup has no seq-scan plan — and the day query touches only vote_item.
  for (const [label, sql] of [
    ["day", `SELECT * FROM vote_item WHERE date = '${DAY}' ORDER BY item_no`],
    [
      "item",
      `SELECT c.mp_id, c.vote FROM vote_cast c
        WHERE c.item_id = (SELECT item_id FROM vote_item WHERE date = '${DAY}' LIMIT 1)`,
    ],
  ] as const) {
    const plan = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
    );
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(
      !/Seq Scan on vote_cast/i.test(text),
      `${label}: planned a seq scan over vote_cast`,
    );
    const buffers = [...text.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].reduce(
      (n, m) => n + Number(m[1]) + Number(m[2] ?? 0),
      0,
    );
    assert.ok(
      buffers < 2000,
      `${label}: ${buffers} buffers, over the 2,000 live ceiling`,
    );
  }
});
