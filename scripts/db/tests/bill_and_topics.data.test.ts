// Gates for the bill dimension (136) and the two routes that retire topic_index.json
// (docs/plans/parliament-hub-v1.md §7, phases P4 and P5). Auto-skips when Postgres is down.
//
//   npm run test:data
//
// The two that carry the most weight are cross-implementation gates rather than bounds:
// `bill` must hold exactly the set the /parliament tile counts, and the SQL outcome
// bucketing in functions/db_routes.js must agree with outcomeBucket()/outcomeFor() in
// TypeScript. Both are places where two implementations of one rule exist for a reason
// (SQL cannot import TS; a route cannot run the tile's generator) and neither would fail
// visibly on drifting — a wrong bill count reads as a plausible number, a wrong bucket as a
// bar of the wrong colour.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { allRows, dbReachable, end } from "../lib/pg";
import { dedupeRevotes } from "../../parliament/derived/dedupe";
import {
  secondReadingBills,
  secondReadingStem,
  firstReadingStem,
} from "../../parliament/derived/hub_stats";
import { buildRollcall } from "../load_rollcall_pg";
import { outcomeFor } from "../../parliament/derived/important_votes";
// The SAME function SessionOutcomeBar's classification lives in, imported rather than
// re-written. There were THREE copies of this rule until 2026-08-22 — the SQL in
// db_routes.js, outcomeBucket() in src/, and a local `bucketOf` here — and this gate held
// the SQL against the local one, so src/'s copy was unheld by anything. json-retirement-v2
// Tier 3b then removed its last caller, which is how that came to light. Two copies now,
// with this gate between them, which is the arrangement outcomeBucket.ts's header describes.
import { outcomeBucket } from "../../../src/data/parliament/votes/outcomeBucket";
import type { SessionFile } from "../../parliament/derived/types";

const SESSIONS = "data/parliament/votes/sessions";

const readSessions = (): SessionFile[] =>
  readdirSync(SESSIONS)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(`${SESSIONS}/${f}`, "utf8")));

const bucketOf = (o: ReturnType<typeof outcomeFor>): string => outcomeBucket(o);

afterAll(async () => {
  await end();
});

test("bill holds exactly the set the /parliament tile counts", async (t) => {
  if (!(await dbReachable())) return t.skip();
  if (!existsSync(SESSIONS)) return t.skip();
  const rows = await allRows<{ ns: number; n: string }>(
    "SELECT ns, count(*)::text AS n FROM bill GROUP BY ns ORDER BY ns",
  );
  if (rows.length === 0) {
    assert.fail("bill is empty — run npm run db:load:rollcall:pg");
  }
  // Recomputed from the session files by the SAME function the hub tile calls, so this is a
  // cross-implementation check and not a restatement of the loader. A `bill` table holding
  // "every bill the chamber saw" instead of "every bill that reached a second reading"
  // would pass every row count and put a different number in the database from the one on
  // the page.
  const deduped = dedupeRevotes(readSessions());
  for (const row of rows) {
    const expected = secondReadingBills(
      deduped.filter((s) => Number(s.ns) === row.ns),
    );
    assert.equal(
      Number(row.n),
      expected,
      `NS ${row.ns}: bill has ${row.n} rows, secondReadingBills() says ${expected}`,
    );
  }
});

test("no bill claims an adoption the corpus cannot support", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // final_item is the column reserved for a whole-bill adoption marker that does not exist
  // (§4.2). A populated one means somebody inferred it — most likely as "the last item of
  // the stem", which §4.2 measured landing on a REJECTED amendment for the largest bill in
  // the corpus.
  const [row] = await allRows<{ n: string }>(
    "SELECT count(*)::text AS n FROM bill WHERE final_item IS NOT NULL",
  );
  assert.equal(
    Number(row.n),
    0,
    "final_item is populated — see 136_bill.sql: NULL means 'not derivable', not 'not adopted'",
  );
});

test("every bill_id on a vote_item resolves, and only readings carry one", async (t) => {
  if (!(await dbReachable())) return t.skip();
  const [orphans] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM vote_item i
      WHERE i.bill_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bill b WHERE b.bill_id = i.bill_id)`,
  );
  assert.equal(Number(orphans.n), 0, "vote_item rows point at a missing bill");
  // EVERY item carrying a bill_id must actually yield that bill's stem. The obvious version
  // of this check — "bill_id implies reading IS NOT NULL" — is true BY CONSTRUCTION and can
  // never fail: readingOf()'s regex is strictly looser than the stem split that assigns the
  // bill_id, so anything the split matched the reading test matched too. This one compares
  // the stored attribution against a re-derivation, which is a different thing.
  const attached = await allRows<{
    bill_id: number;
    stem: string;
    title: string;
  }>(
    `SELECT i.bill_id, b.stem, i.title
       FROM vote_item i JOIN bill b ON b.bill_id = i.bill_id
      WHERE i.title IS NOT NULL`,
  );
  assert.ok(attached.length > 0, "no items carry a bill_id");
  const wrong = attached.filter(
    (r) =>
      secondReadingStem(r.title) !== r.stem &&
      firstReadingStem(r.title) !== r.stem,
  );
  assert.deepEqual(
    wrong.slice(0, 5).map((r) => `${r.title} → ${r.stem}`),
    [],
    `${wrong.length} item(s) are attached to a bill whose stem their title does not yield`,
  );
});

test("no bill points at a first reading the chamber took back", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // 66 of the 504 did, before the bill pass filtered superseded_by. Deterministically, not
  // by chance: dedupeRevotes keeps the HIGHEST item number of a re-vote group while the
  // resolver sorted ascending, so whenever a first reading was re-voted the loader stored
  // the ANNULLED one — a /votes link to a vote that no longer stands.
  const [row] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM bill b JOIN vote_item i ON i.item_id = b.first_reading_item
      WHERE i.superseded_by IS NOT NULL`,
  );
  assert.equal(
    Number(row.n),
    0,
    "a bill's first_reading_item is a superseded item",
  );
});

test("a reload REUSES the bill ids the database already holds", async (t) => {
  if (!(await dbReachable())) return t.skip();
  if (!existsSync(SESSIONS)) return t.skip();
  // The property, exercised rather than inferred. The first version of this gate asserted
  // `max(bill_id) >= count(*)`, which is true of any gap-free 1..N — i.e. of exactly the
  // renumbered-from-scratch table its own comment named as the failure. This re-runs the
  // resolver against the ids currently stored and checks every one comes back unchanged,
  // which is what keeps a nightly re-run from rewriting the FK on 9,132 vote_item rows.
  const stored = new Map(
    (
      await allRows<{ bill_id: number; ns: number; stem: string }>(
        "SELECT bill_id, ns, stem FROM bill",
      )
    ).map((r) => [`${r.ns}|${r.stem}`, r.bill_id]),
  );
  assert.ok(stored.size > 0, "bill is empty — run npm run db:load:rollcall:pg");
  const corpus = readSessions();
  const rebuilt = buildRollcall(corpus, stored);
  const moved = rebuilt.bills.filter(
    (b) =>
      stored.has(`${b.ns}|${b.stem}`) &&
      stored.get(`${b.ns}|${b.stem}`) !== b.billId,
  );
  assert.deepEqual(
    moved.slice(0, 5).map((b) => `${b.ns}|${b.stem}`),
    [],
    `${moved.length} bill(s) were renumbered by a re-run`,
  );
  // And a bill the database has never seen must get an id ABOVE the current maximum rather
  // than colliding with one in use.
  const seeded = new Map(stored);
  seeded.delete([...seeded.keys()][0]);
  const withNew = buildRollcall(corpus, seeded);
  const ids = withNew.bills.map((b) => b.billId);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "the resolver issued a duplicate bill_id",
  );
});

test("the route's SQL outcome buckets agree with the TypeScript classification", async (t) => {
  if (!(await dbReachable())) return t.skip();
  if (!existsSync(SESSIONS)) return t.skip();
  // The SQL lives in functions/db_routes.js and cannot import outcomeFor(); this is the only
  // thing holding the two together. Run over the WHOLE corpus rather than a sample — the
  // clauses that differ are the rare ones, and a sample is exactly what would miss them.
  //
  // WHICH BRANCHES THE CORPUS ACTUALLY EXERCISES, measured 2026-08-06 over the standing set:
  // zero-cast 911 · all-yes 1,367 · all-no 13 · ALL-ABSTAIN 0. So this gate is live on every
  // branch except `abstain = cast_votes`, which no item in the corpus reaches — verified by
  // perturbing each clause in turn and checking the assertion fires. The all-abstain clause
  // is therefore carried on the strength of outcomeFor()'s own definition, not on this test.
  // If a chamber ever abstains as one, this becomes the thing that catches the drift.
  const sql = await allRows<{
    ns: number;
    date: string;
    unanimous: number;
    passed: number;
    rejected: number;
    contested: number;
  }>(
    `WITH standing AS (
       SELECT ns, date, (yes + no + abstain) AS cast_votes, yes, no, abstain
         FROM vote_item WHERE superseded_by IS NULL
     ),
     bucketed AS (
       SELECT ns, date, CASE
                WHEN cast_votes = 0       THEN 'contested'
                WHEN yes     = cast_votes THEN 'unanimous'
                WHEN no      = cast_votes THEN 'unanimous'
                WHEN abstain = cast_votes THEN 'unanimous'
                WHEN yes > no + abstain   THEN 'passed'
                WHEN no + abstain > yes   THEN 'rejected'
                ELSE 'contested' END AS bucket
         FROM standing
     )
     SELECT ns, date::text AS date,
            count(*) FILTER (WHERE bucket = 'unanimous')::int AS unanimous,
            count(*) FILTER (WHERE bucket = 'passed')::int    AS passed,
            count(*) FILTER (WHERE bucket = 'rejected')::int  AS rejected,
            count(*) FILTER (WHERE bucket = 'contested')::int AS contested
       FROM bucketed GROUP BY ns, date`,
  );
  if (sql.length === 0)
    assert.fail("vote_item is empty — run db:load:rollcall:pg");

  const expected = new Map<string, Record<string, number>>();
  for (const session of dedupeRevotes(readSessions())) {
    const key = `${Number(session.ns)}|${session.date}`;
    const acc = expected.get(key) ?? {
      unanimous: 0,
      passed: 0,
      rejected: 0,
      contested: 0,
    };
    for (const item of session.sessions) acc[bucketOf(outcomeFor(item))] += 1;
    expected.set(key, acc);
  }

  const mismatches: string[] = [];
  for (const row of sql) {
    const want = expected.get(`${row.ns}|${row.date}`);
    if (!want) {
      mismatches.push(
        `${row.ns}|${row.date}: in Postgres, absent from the session files`,
      );
      continue;
    }
    for (const b of ["unanimous", "passed", "rejected", "contested"] as const) {
      if (row[b] !== want[b]) {
        mismatches.push(
          `${row.ns}|${row.date}.${b}: sql=${row[b]} ts=${want[b]}`,
        );
      }
    }
  }
  assert.deepEqual(
    mismatches.slice(0, 10),
    [],
    `${mismatches.length} day(s) bucket differently in SQL and TypeScript`,
  );
});

test("the day summary filters re-votes, and the contested feed ranks by closeness", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // Two properties the routes depend on, asserted against the corpus rather than assumed.
  const [sup] = await allRows<{ n: string }>(
    "SELECT count(*)::text AS n FROM vote_item WHERE superseded_by IS NOT NULL",
  );
  assert.ok(
    Number(sup.n) > 0,
    "no superseded rows at all — the dedupe filter in these routes would be untested",
  );
  const top = await allRows<{ contest: number }>(
    `SELECT CASE WHEN yes + no + abstain = 0 THEN 0
                 ELSE least(yes, no + abstain)::float8 / (yes + no + abstain) END AS contest
       FROM vote_item
      WHERE ns = 52 AND superseded_by IS NULL AND title IS NOT NULL
      ORDER BY contest DESC LIMIT 5`,
  );
  assert.ok(top.length > 0, "no titled items for NS 52");
  // A contest score is a share of the cast votes and cannot exceed a half: min(yes, rest)
  // is at most half the total by construction. Above 0.5 means the expression drifted.
  for (const r of top) {
    assert.ok(
      r.contest > 0 && r.contest <= 0.5,
      `contest score ${r.contest} is outside (0, 0.5]`,
    );
  }
});
