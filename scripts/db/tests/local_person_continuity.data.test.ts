// §A3 of docs/plans/local-person-links-v2.md — the local-continuity merge (`sameLocalSeat`
// in scripts/person/cluster.ts), which re-unites a local officeholder re-elected across
// election cycles.
//
// WHY. Before it, a кмет/кмет на кметство/общински съветник got ONE person record PER TERM.
// The cause was not a policy but a gap: `shareCorroborant`'s `weakBoth` branch needs party
// AND place, and an ИК-elected officeholder has NO party at all, so the only path open to
// them was Tier 2's globally-unique-name test. Measured before the fix: 640 (name, obshtina,
// role) groups spanning 1,402 person records — five-term mayors on five separate /person
// pages, 498 of the groups touching the sitting mandate.
//
// The assertions below pull in OPPOSITE directions on purpose: the first fails if the rule
// starts over-merging, the next two if it stops merging, and the last if a merge left a URL
// behind. A gate in only one of those directions would be satisfied by disabling the rule.
//
// Auto-skips when Postgres is down or the local walk has not run, like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// The seat key, restated in SQL. It deliberately MIRRORS `localSeatKey`
// (scripts/parsers_local/localPersonRefs.ts) rather than importing it — the point of a data
// gate is to check the shipped rows against an independently written expectation, so a bug
// that lives inside the key builder cannot also define what "correct" means here. Keep the
// two in step by hand; `localPersonRefs.test.ts` is what pins the builder itself.
const SEAT_SQL = `
  CASE WHEN r.role IN ('mayor','councillor') THEN r.role || '|' || split_part(r.ref, ':', 2)
       WHEN r.role = 'village_mayor' AND r.place_kind = 'settlement'
         THEN 'village_mayor|' || r.place_code
       ELSE NULL END`;

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = 'local'",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no local person roles";

// A person may legitimately hold two roles that share a seat AND a cycle — but only when
// some OTHER corroborant merged them, since `sameLocalSeat` refuses any mention whose
// seat-term is contested. The database does not record WHICH corroborant formed a merge, so
// this cannot be asserted as a zero; it is a measured bound instead.
//
// The one row at the bound is Валери Иванов Василев (`valeri-ivanov-vasilev-81374a`),
// elected from two different lists on the ОбС Видин in 2023. He merged via TIER 2 — his
// full name is globally unique (`namesake_risk` 1) — which is the pre-existing
// unique-name policy and nothing §A3 changed. `sameLocalSeat` correctly abstained.
//
// Raising this number means a same-cycle collision started merging. Before touching it,
// establish which tier did it: if the new rows carry `namesake_risk > 1` they cannot have
// come from Tier 2, and the block-level contest exclusion has regressed.
const SAME_CYCLE_SEAT_SHARERS_MAX = 1;

test.skipIf(skip)(
  "A3 — a same-cycle seat collision is not merged by the continuity rule",
  async () => {
    const rows = await allRows<{
      display_name: string;
      slug: string;
      namesake_risk: number;
      seat: string;
      cycle: string;
    }>(
      `WITH k AS (
         SELECT r.person_id, split_part(r.ref, ':', 1) AS cycle, ${SEAT_SQL} AS seat
           FROM person_role r
          WHERE r.source = 'local'
       )
       SELECT p.display_name, p.slug, p.namesake_risk, k.seat, k.cycle
         FROM (SELECT person_id, seat, cycle
                 FROM k WHERE seat IS NOT NULL
                GROUP BY 1, 2, 3 HAVING count(*) > 1) k
         JOIN person p USING (person_id)
        ORDER BY p.slug`,
    );
    assert.ok(
      rows.length <= SAME_CYCLE_SEAT_SHARERS_MAX,
      `${rows.length} person(s) hold two local roles of the SAME seat in the SAME cycle ` +
        `(bound ${SAME_CYCLE_SEAT_SHARERS_MAX}). One seat has one holder per cycle, so each ` +
        `extra row is either a wrong merge or a duplicated role. ` +
        rows
          .slice(0, 5)
          .map(
            (r) =>
              `${r.display_name} (${r.slug}, namesake_risk ${r.namesake_risk}) ${r.seat} @ ${r.cycle}`,
          )
          .join("; "),
    );
  },
);

// The other direction. `sameLocalSeat` is easy to disable by accident — a null seat key, a
// dropped corroborant in the Raw→Mention mapping, a stricter guard — and NOTHING else in
// the suite notices: every role still exists, every page still serves, the officeholder
// simply has several of them again. So pin the collapse itself.
//
// Measured after the §A3 resolve with the exclusive-seat carve-out: 59 groups over 126
// person records, down from 640 / 1,402. The residue is real and expected — a two-part name,
// an ambiguous 4+ token name, a patronymic that differs between cycles, a village mayor
// whose кметство name §T2 could not resolve to a settlement, or a COUNCILLOR above the
// namesake cap (councils keep the cap because their seat is not exclusive). The ceiling has
// room above the measurement so ordinary source churn does not trip it, while staying far
// below the 640 that would mean the rule stopped firing.
const SPLIT_GROUPS_MAX = 110;

test.skipIf(skip)(
  "A3 — the cross-cycle continuity merge actually collapsed the split officeholders",
  async () => {
    const [c] = await allRows<{ groups: string; person_records: string }>(
      `WITH lr AS (
         SELECT r.person_id, p.name_fold, r.role, split_part(r.ref, ':', 2) AS obshtina
           FROM person_role r JOIN person p USING (person_id)
          WHERE r.source = 'local'
       )
       SELECT count(*) AS groups, COALESCE(sum(n), 0) AS person_records
         FROM (SELECT name_fold, role, obshtina, count(DISTINCT person_id) AS n
                 FROM lr GROUP BY 1, 2, 3 HAVING count(DISTINCT person_id) > 1) g`,
    );
    assert.ok(
      Number(c.groups) <= SPLIT_GROUPS_MAX,
      `${c.groups} (name, obshtina, role) groups are still split across ${c.person_records} ` +
        `person records (bound ${SPLIT_GROUPS_MAX}, was 640/1402 before §A3). That is close ` +
        `to the pre-fix level: sameLocalSeat has probably stopped firing — check that ` +
        `localSeatKey still returns a key for mayor/councillor/village_mayor and that ` +
        `resolve_persons still passes localSeat/localCycle into the corroborants.`,
    );
  },
);

// The exclusive-seat carve-out, asserted as a ZERO rather than a bound — because on a seat
// held by one person per cycle there is no honest reason for the same full name to sit on
// two person records. `sameLocalSeat` drops the namesake cap there precisely so this can be
// zero; before the carve-out it was 53 groups over 121 person records, every one of them
// blocked by the cap alone and nothing else.
//
// The qualifiers mirror the rule's own guards, so a group EXCLUDED here is one the rule is
// entitled to refuse: a 3-part name with a patronymic (`name_parts`/`patronymic_fold`), and
// one term per cycle (`count(DISTINCT cycle) = count(*)`) — a same-cycle contest must stay
// split, so counting it would assert the opposite of what the rule promises.
test.skipIf(skip)(
  "A3 — nobody is still split across cycles on a seat only one person can hold",
  async () => {
    const rows = await allRows<{
      display_name: string;
      seat: string;
      records: number;
      cycles: string;
    }>(
      `WITH k AS (
         SELECT r.person_id, p.display_name, p.name_fold, p.patronymic_fold, p.name_parts,
                split_part(r.ref, ':', 1) AS cycle,
                CASE WHEN r.role = 'mayor'
                       THEN 'mayor|' || split_part(r.ref, ':', 2)
                     WHEN r.role = 'village_mayor' AND r.place_kind = 'settlement'
                       THEN 'village_mayor|' || r.place_code END AS seat
           FROM person_role r JOIN person p USING (person_id)
          WHERE r.source = 'local'
       )
       SELECT max(display_name) AS display_name, seat,
              count(DISTINCT person_id)::int AS records,
              string_agg(DISTINCT cycle, ',' ORDER BY cycle) AS cycles
         FROM k
        WHERE seat IS NOT NULL AND name_parts = 3 AND patronymic_fold IS NOT NULL
        GROUP BY seat, name_fold, patronymic_fold
       HAVING count(DISTINCT person_id) > 1 AND count(DISTINCT cycle) = count(*)
        ORDER BY records DESC LIMIT 5`,
    );
    assert.deepEqual(
      rows,
      [],
      `an exclusive seat (кмет на община / кмет на кметство) holds one person per cycle, yet ` +
        `the same full name sits on several person records across cycles: ` +
        rows
          .map(
            (r) =>
              `${r.display_name} ${r.seat} ${r.records} records (${r.cycles})`,
          )
          .join("; ") +
        `. sameLocalSeat should have merged these — check EXCLUSIVE_SEAT still matches the ` +
        `role prefixes localSeatKey writes.`,
    );
  },
);

// Every person the merge dissolved must 301, not 404. resolve_persons derives this itself
// (the lock diff at the `retired` map), so the §A3 collapse needed no hand-built map — but
// that derivation only reaches mentions still present in `built`, which is precisely the
// assumption worth holding. `person_slug_retired.data.test.ts` covers the chain-flattening
// and the shape of the slugs; this asserts the COVERAGE for local officeholders.
test.skipIf(skip)(
  "A3 — no local officeholder slug is dead without a redirect",
  async () => {
    const rows = await allRows<{ slug: string }>(
      `SELECT DISTINCT l.slug
         FROM person_slug_lock l
        WHERE l.mention_id LIKE 'local:%'
          AND NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = l.slug)
          AND NOT EXISTS (SELECT 1 FROM person_slug_retired r WHERE r.slug = l.slug)
        ORDER BY 1`,
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} /person slug(s) once served by a local officeholder now 404 with no ` +
        `redirect: ${rows
          .slice(0, 5)
          .map((r) => r.slug)
          .join(", ")}. ` +
        `db:resolve:persons derives these from the slug-lock diff; a gap here means the ` +
        `mention id changed shape, so the diff could not pair the old slug with its successor.`,
    );
  },
);

afterAll(async () => {
  await end();
});
