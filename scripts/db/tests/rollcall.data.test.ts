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
import { readFileSync } from "node:fs";
import { allRows, dbReachable, end } from "../lib/pg";

interface AttendanceEntry {
  mpId: number;
  totalItems: number;
  presentCount: number;
}
interface CohesionEntry {
  partyShort: string;
  meanCohesion: number;
}
interface DissentJsonEntry {
  mpId: number;
  dissentCount: number;
}
interface SimilarityJsonEntry {
  mpId: number;
  topK: Array<{ mpId: number; score: number; overlap: number }>;
}

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

test("mp_attendance reproduces attendance.json, except where the source double-counts", async (t) => {
  if (!haveDb || !(await tableExists("mp_attendance"))) return t.skip();
  const att = JSON.parse(
    readFileSync("data/parliament/votes/derived/attendance.json", "utf8"),
  ) as { byNs: Record<string, { entries: AttendanceEntry[] }> };
  const rows = await allRows<{ ns: number; mp_id: number; items: string; present: string }>(
    "SELECT ns, mp_id, items, present FROM mp_attendance",
  );
  const pg = new Map(
    rows.map((r) => [`${r.ns}|${r.mp_id}`, { items: Number(r.items), present: Number(r.present) }]),
  );

  // THE MIGRATION'S CORRECTNESS PROOF, and it must run while both layers exist.
  //
  // 2,356 of 2,366 seats agree exactly. The 10 that do not are precisely the members whose
  // casts the source lists twice (§3.3's 84 duplicates), and they disagree in ONE direction:
  // the JSON is higher, by 84 in total. The JSON is the side that is wrong — it credits
  // those members with 1,207 items in a parliament that held 1,198, which is impossible on
  // its face. So this asserts the disagreement rather than tolerating it: an exact match
  // everywhere else, a known direction and a known magnitude here.
  let agree = 0;
  let overCountTotal = 0;
  const wrongDirection: string[] = [];
  const mismatched: string[] = [];
  for (const [ns, slice] of Object.entries(att.byNs)) {
    for (const e of slice.entries) {
      const p = pg.get(`${ns}|${e.mpId}`);
      assert.ok(p, `${ns}:${e.mpId} is in attendance.json but not in mp_attendance`);
      if (p.items === e.totalItems && p.present === e.presentCount) {
        agree++;
        continue;
      }
      mismatched.push(`${ns}:${e.mpId}`);
      if (e.totalItems <= p.items) wrongDirection.push(`${ns}:${e.mpId}`);
      overCountTotal += e.totalItems - p.items;
    }
  }
  assert.deepEqual(
    wrongDirection,
    [],
    "Postgres counted MORE items than the JSON somewhere — the dedupe filter is the first thing to check",
  );
  assert.equal(mismatched.length, 10, `seats disagreeing: ${mismatched.join(", ")}`);
  assert.equal(
    overCountTotal,
    84,
    "the JSON's excess no longer equals the 84 duplicate casts that explain it",
  );
  assert.equal(agree, 2356);
});

test("mp_similarity reproduces similarity.json's cosine", async (t) => {
  if (!haveDb || !(await tableExists("mp_similarity"))) return t.skip();
  const sim = (
    JSON.parse(
      readFileSync("data/parliament/votes/derived/similarity.json", "utf8"),
    ) as { byNs: Record<string, { entries: SimilarityJsonEntry[] }> }
  ).byNs["52"];
  const norms = await allRows<{ mp_id: number; norm_sq: string }>(
    "SELECT mp_id, norm_sq FROM mp_vote_norm WHERE ns = 52",
  );
  const n = new Map(norms.map((r) => [Number(r.mp_id), Math.sqrt(Number(r.norm_sq))]));

  // The score is a COSINE over ±1 vote vectors, not an agreement rate — the two are on
  // different scales and similarityClass.ts's twin thresholds are calibrated on the cosine.
  // Storing dot + overlap and dividing by the two FULL-vector norms reproduces it to 1e-9
  // on every pair except the ones touching a double-counted cast, where Postgres has the
  // lower overlap for the same reason attendance does.
  let checked = 0;
  let exact = 0;
  const off: string[] = [];
  for (const e of sim.entries.slice(0, 60)) {
    for (const peer of e.topK.slice(0, 2)) {
      const [a, b] = e.mpId < peer.mpId ? [e.mpId, peer.mpId] : [peer.mpId, e.mpId];
      const rows = await allRows<{ overlap: string; dot: string }>(
        `SELECT overlap, dot FROM mp_similarity WHERE ns = 52 AND a_mp = ${a} AND b_mp = ${b}`,
      );
      if (!rows.length) {
        off.push(`${a}-${b} missing`);
        continue;
      }
      checked++;
      const na = n.get(e.mpId);
      const nb = n.get(peer.mpId);
      if (!na || !nb) continue;
      const score = Number(rows[0].dot) / (na * nb);
      if (Math.abs(score - peer.score) < 1e-9 && Number(rows[0].overlap) === peer.overlap) {
        exact++;
      }
    }
  }
  assert.deepEqual(off, [], "pairs present in similarity.json but absent from the matview");
  assert.ok(checked > 80, `only ${checked} pairs compared`);
  // Not 100%: the pairs touching a double-counted cast legitimately differ, and there are
  // few enough of them that a floor rather than an exact count is the honest assertion.
  assert.ok(
    exact / checked > 0.9,
    `only ${exact}/${checked} pairs reproduced the JSON cosine exactly`,
  );
});

test("mp_dissent groups on the CAST-time party, not the seat's last-seen one", async (t) => {
  if (!haveDb || !(await tableExists("mp_dissent"))) return t.skip();
  // The 179 switchers are the whole reason vote_cast carries its own party_id. If
  // mp_dissent ever joined mp_seat instead, those members would be compared against a group
  // they had already left — and the symptom is that defectors read as unusually LOYAL,
  // which is the opposite of what the view is for. This catches it by finding dissent rows
  // whose party differs from the seat's: they must exist.
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM mp_dissent d
       JOIN mp_seat s ON s.ns = d.ns AND s.mp_id = d.mp_id
      WHERE s.party_id IS DISTINCT FROM d.party_id`,
  );
  assert.ok(
    Number(r.n) > 0,
    "no dissent row disagrees with mp_seat.party_id — the view has started grouping on the seat",
  );
});

test("every matview filters the superseded re-votes", async (t) => {
  if (!haveDb || !(await tableExists("mp_attendance"))) return t.skip();
  // Rule 1 of 135, asserted rather than trusted. A matview that forgets
  // `WHERE superseded_by IS NULL` over-counts by 9.8% and returns a 200 while doing it, so
  // the cheapest reliable check is that no aggregate exceeds the STANDING item count.
  const bad = await allRows<{ ns: number; items: string; standing: string }>(
    `SELECT a.ns, max(a.items)::text items,
            (SELECT count(*)::text FROM vote_item i
              WHERE i.ns = a.ns AND i.superseded_by IS NULL) standing
       FROM mp_attendance a GROUP BY a.ns
      HAVING max(a.items) > (SELECT count(*) FROM vote_item i
                              WHERE i.ns = a.ns AND i.superseded_by IS NULL)`,
  );
  assert.deepEqual(
    bad,
    [],
    "a member voted on more items than their parliament held — the dedupe filter is missing",
  );
});

test("party_cohesion reproduces cohesion.json, item-weighted", async (t) => {
  if (!haveDb || !(await tableExists("party_cohesion"))) return t.skip();
  const coh = (
    JSON.parse(
      readFileSync("data/parliament/votes/derived/cohesion.json", "utf8"),
    ) as { byNs: Record<string, { entries: CohesionEntry[] }> }
  ).byNs["52"];
  const parties = await allRows<{ party_id: number; short: string }>(
    "SELECT party_id, short FROM party_dim WHERE ns = 52",
  );
  const shortOf = new Map(parties.map((p) => [Number(p.party_id), p.short]));
  // ITEM-weighted, because cohesion.json means over items and the matview stores a
  // per-DAY mean. Comparing the day-means unweighted looks like a 0.015 error and is not.
  const rows = await allRows<{ party_id: number; c: string }>(
    "SELECT party_id, sum(cohesion * items) / sum(items) c FROM party_cohesion WHERE ns = 52 GROUP BY party_id",
  );
  let worst = 0;
  for (const e of coh.entries) {
    const r = rows.find((x) => shortOf.get(Number(x.party_id)) === e.partyShort);
    assert.ok(r, `${e.partyShort} missing from party_cohesion`);
    worst = Math.max(worst, Math.abs(Number(r.c) - e.meanCohesion));
  }
  // The residual is the double-counted casts again. The first version of this matview used
  // a correlated LATERAL that returned one row per distinct vote value and multiplied the
  // denominator — it read 0.9227 against 0.9704 for ГЕРБ - СДС, and was exact only on
  // unanimous items, which is exactly why a spot check passed it.
  assert.ok(
    worst < 0.001,
    `cohesion diverges from the JSON by ${worst.toFixed(5)} — check the denominator`,
  );
});

test("mp_dissent reproduces dissents.json per member", async (t) => {
  if (!haveDb || !(await tableExists("mp_dissent"))) return t.skip();
  const dj = (
    JSON.parse(
      readFileSync("data/parliament/votes/derived/dissents.json", "utf8"),
    ) as { byNs: Record<string, { entries: DissentJsonEntry[] }> }
  ).byNs["52"];
  const rows = await allRows<{ mp_id: number; n: string }>(
    "SELECT mp_id, count(*) n FROM mp_dissent WHERE ns = 52 GROUP BY mp_id",
  );
  const pg = new Map(rows.map((r) => [Number(r.mp_id), Number(r.n)]));
  let exact = 0;
  for (const e of dj.entries) {
    if ((pg.get(e.mpId) ?? 0) === e.dissentCount) exact++;
  }
  // PER MEMBER, not in total. The tie-break on a split party decides which side dissents,
  // and getting it backwards flips 4,976 rows while leaving the CORPUS TOTAL correct to
  // within 1 — so a totals gate passes a view in which only 105 of 268 members are right.
  assert.ok(
    exact >= dj.entries.length - 2,
    `only ${exact}/${dj.entries.length} members reproduce dissents.json — check the mode() tie-break`,
  );
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
