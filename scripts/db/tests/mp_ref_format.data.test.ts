// mp-party-affiliation-v1 gates 5.5 + 5.6 — the widened `ref` did not silently
// empty anything.
//
// T3 changed `person_role.ref` for source='mp' from '<mpId>' to '<mpId>:<ns>'
// (one row per parliament). EVERY consumer that turned that ref into a number
// was guarded by `ref ~ '^[0-9]+$'`, so the widening breaks them SILENTLY —
// not one throws.
//
// THE DAMAGE IS PARTIAL, NOT TOTAL, and every floor below is sized for that.
// The plan's §2b table said "the view goes EMPTY" and "all 2,120 MP photos"; it
// was wrong, and the first draft of this file inherited the error and was
// therefore GREEN against the bug. The guards still match the 1,559 MPs whose
// ref stays bare (no roll-call coverage), so only the 1,522 per-NS rows are
// lost — a ~36% cut concentrated in the SITTING and recent members, i.e. the
// ones anybody looks at. Measured with the fix reverted:
//
//   surface                     broken   correct
//   105 mp_person_link           1,559     2,122
//   120 photo CTE (MP photos)    1,558     2,120
//   120 bridge_a (MP arm)           35       155
//   082 person search mpId      partial    2,122
//
// The plan's designated tripwire — `mp_serving.data.test.ts` asserting
// `rows.length > 500` — returns 506 when broken, so it would have passed too.
// A floor only guards if it sits ABOVE the broken value; these do.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();

const tableExists = async (name: string) =>
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM pg_class WHERE relname = $1`,
        [name],
      )
    )[0]?.n,
  ) > 0;

const haveRoles = await tableExists("person_role");

afterAll(async () => {
  await end();
});

test("the ref format is exactly one of the two documented shapes", async (t) => {
  if (!haveDb || !haveRoles) return t.skip();

  // '<mpId>' for an MP with no roll-call coverage, '<mpId>:<ns>' for one with
  // it. Anything else means a writer invented a third shape, and every consumer
  // below reads the id with split_part on the assumption there are only two.
  const bad = await allRows<{ ref: string }>(
    `SELECT ref FROM person_role
      WHERE source = 'mp' AND ref !~ '^[0-9]+(:[0-9]+)?$'
      LIMIT 20`,
  );
  assert.deepEqual(
    bad.map((r) => r.ref),
    [],
    "unexpected mp ref shape",
  );

  // …and the widening actually happened: at least some rows carry an NS.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_role WHERE source = 'mp' AND ref LIKE '%:%'`,
  );
  assert.ok(
    Number(n) >= 1_450,
    `only ${n} per-NS mp ref(s) — expected ~1,522 (measured 2026-08-09)`,
  );
});

test("5.6 — mp_person_link is not empty", async (t) => {
  if (!haveDb || !(await tableExists("mp_person_link"))) return t.skip();

  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM mp_person_link`,
  );
  // 2,122 correct / 1,559 broken — the floor must sit between them.
  assert.ok(
    Number(n) >= 2_000,
    `mp_person_link has ${n} rows, expected ~2,122 — the ref cast is matching ` +
      `only the bare-ref MPs (1,559 when broken), and three serving functions ` +
      `join through this view`,
  );

  // One row per mp id, not per seat: the view DISTINCTs on the id, so the
  // widening must not multiply it.
  const [{ dupes }] = await allRows<{ dupes: string }>(
    `SELECT count(*) dupes FROM (
       SELECT mp_id FROM mp_person_link GROUP BY 1 HAVING count(*) > 1) q`,
  );
  assert.equal(Number(dupes), 0, "mp_person_link has duplicate mp_id rows");
});

test("5.6 — every MP still has a photo on /persons", async (t) => {
  if (!haveDb || !(await tableExists("person_browse_table"))) return t.skip();
  if (!(await tableExists("mp_profile"))) return t.skip();

  // 120's photo CTE joins mp_profile on the ref. Measured 2,174 people with a
  // photo before T3; the MP arm is almost all of it.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_browse_table WHERE is_mp AND photo_url IS NOT NULL`,
  );
  // 2,120 correct / 1,558 broken.
  assert.ok(
    Number(n) >= 2_000,
    `only ${n} MPs carry a photo, expected ~2,120 — 120's photo join is matching ` +
      `only the bare-ref MPs (1,558 when broken)`,
  );
});

test("5.6 — the MP arm of the company bridge still resolves", async (t) => {
  if (!haveDb || !(await tableExists("company_politicians"))) return t.skip();

  // 120's bridge_a joins `pr.ref = replace(cp.ref, '/candidate/mp-', '')`.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n
       FROM company_politicians cp
       JOIN person_role pr
         ON cp.kind = 'mp' AND pr.source = 'mp'
        AND split_part(pr.ref, ':', 1) = replace(cp.ref, '/candidate/mp-', '')`,
  );
  // 155 correct / 35 broken — `> 0` passed with the bug present.
  assert.ok(
    Number(n) >= 100,
    `the MP arm of the company bridge matches ${n} rows, expected ~155 (35 when ` +
      `the ref join is broken) — MP company links are dropping out of /persons`,
  );
});

test("5.5 — parties_n and roles_n stay consistent with their padded sets", async (t) => {
  if (!haveDb || !(await tableExists("person_browse_table"))) return t.skip();

  // T3 multiplies an MP's rows, so `roles_n` (a count(*) over roles) rises for
  // every multi-term member — a visible column on /persons. It must still agree
  // with `role_codes`, which is DISTINCT, so the two legitimately differ; what
  // must hold is that neither is empty while the other is populated.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person_browse_table
      WHERE (role_codes IS NULL) <> (roles_n IS NULL OR roles_n = 0)`,
  );
  assert.equal(Number(n), 0, "roles_n and role_codes disagree about emptiness");

  const [{ p }] = await allRows<{ p: string }>(
    `SELECT count(*) p FROM person_browse_table
      WHERE party_codes IS NOT NULL
        AND parties_n <> array_length(string_to_array(btrim(party_codes), ' '), 1)`,
  );
  assert.equal(Number(p), 0, "parties_n disagrees with party_codes");
});

test("5.5 — start_date is filled and orders MP careers correctly", async (t) => {
  if (!haveDb || !haveRoles) return t.skip();

  // The dead tiebreaker (§0c-4): `top_party` orders by `start_date DESC` over a
  // column that was 100% NULL, so it was really ordering lexicographically on an
  // opaque ref. Per-NS rows only produce the RIGHT representative party if the
  // dates are real.
  const [row] = await allRows<{ withns: string; dated: string }>(
    `SELECT count(*) FILTER (WHERE ref LIKE '%:%')::text AS withns,
            count(*) FILTER (WHERE ref LIKE '%:%' AND start_date IS NOT NULL)::text AS dated
       FROM person_role WHERE source = 'mp'`,
  );
  assert.equal(
    row.dated,
    row.withns,
    "a per-NS MP row has no start_date — top_party would fall back to ref order",
  );

  // And the dates come from the ELECTION CALENDAR, not the votes. NS 44's first
  // roll-call is 2020-10-28 but the 44th convened 2017-03-26; deriving from
  // `vote_item` would date every NS-44 seat three years late.
  // NOTE the ref is '<mpId>:<ns>', so the NS is the SECOND field — `split_part`,
  // not a `LIKE '44:%'` that would match mp id 44 instead.
  const [row2] = await allRows<{ n44: string; bad: string }>(
    `SELECT count(*)::text AS n44,
            count(*) FILTER (WHERE start_date <> DATE '2017-03-26')::text AS bad
       FROM person_role
      WHERE source = 'mp' AND split_part(ref, ':', 2) = '44'`,
  );
  assert.ok(Number(row2.n44) > 0, "no NS-44 rows — nothing to check");
  assert.equal(
    Number(row2.bad),
    0,
    "NS-44 rows are not dated from the 2017-03-26 election — start_date came from the votes",
  );
});
