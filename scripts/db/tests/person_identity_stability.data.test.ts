// mp-party-affiliation-v1 gates 5.4 + 5.9 — populating a DISPLAY column must
// not move WHO IS WHO.
//
// This is the most dangerous interaction in the plan and the least obvious:
// nothing about the ПАРТИЯ column points at it. `cParty` already feeds
// `corroborants.party`, which cluster.ts uses for its weak (party AND place)
// merge signal. Today an MP's raw Cyrillic group short can never equal a
// candidacy's canonical id, so between those two sources the corroborant is
// inert. T2 translates the group to a canonical id AT THE WRITE precisely so it
// stays inert — doing it at the mention (`resolve_persons.ts:674`) would switch
// it on and start merging people as a side effect of a display fix.
//
// So these gates assert the ABSENCE of change. Both directions matter: a DROP
// in the person count means the crosswalk leaked into the corroborant and
// merged strangers; a RISE means something split.
//
// The baselines are the measured 2026-08-07/09 figures and are FLOORS-and-
// ceilings rather than equalities, because the corpus legitimately grows. What
// they cannot tolerate is a step change.
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

const haveIdentity = await tableExists("person");

afterAll(async () => {
  await end();
});

test("5.9 — the active-person count did not step", async (t) => {
  if (!haveDb || !haveIdentity) return t.skip();

  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM person WHERE status = 'active'`,
  );
  const persons = Number(n);
  // 127,288 measured either side of the T2 resolve — unchanged, which is the
  // point. NOTE the resolver's own log line says "63340 persons": that is the
  // count BEFORE it mints 63,948 tier-V private owners, and the table holds
  // both. Reading the log number here is the mistake this comment exists to
  // prevent; it made the first draft of this gate fail on a healthy database.
  //
  // SIZING THE BAND. The hazard is bounded: `weakBoth` needs party AND place,
  // and an MP mention's `cPlace` is `currentRegion`, populated for only the 240
  // sitting members. So the worst case this gate must catch is a few hundred
  // people merging — a first draft used ±6% (~7,600), which is ~30× too loose
  // to see it. ±0.4% still absorbs a TR re-ingest moving the tier-V half by a
  // few hundred, and catches the failure mode.
  // RE-BASELINED 2026-08-11, deliberately, per the instruction in this gate's own failure
  // message. The ShareTransfers recovery (person-enrichment-v1) added 96,078 exit-only
  // shareholder rows to the TR corpus, and the resolver mints a tier-V private-owner row
  // per newly-seen owner: 63,948 → 68,796, i.e. +4,848 genuinely NEW people rather than a
  // merge/split of existing ones.
  //
  // The RESOLVED half is the control, and it did not move: 63,340 persons and 3,425 review
  // groups both before and after, which is what says the identity layer itself is unchanged
  // and only the private-owner tail grew. (An earlier run of this change DID move both —
  // 63,750 / 3,673 — because the recovered rows were inflating officer_name_counts and
  // splitting people apart. That was a defect; see 008's header. This baseline is the
  // corpus AFTER that fix, so it must not be raised again to accommodate a resolved-count
  // drift.)
  const BASELINE = 132_136;
  const TOLERANCE = 500;
  assert.ok(
    Math.abs(persons - BASELINE) <= TOLERANCE,
    `active persons = ${persons}, more than ${TOLERANCE} from the ${BASELINE} baseline — ` +
      `if this DROPPED, check that groupShortToCanonical is applied at the WRITE and ` +
      `NOT where the MP mention sets cParty (§8c). If the corpus genuinely grew, ` +
      `re-baseline deliberately rather than widening the tolerance.`,
  );
});

test("5.9b — name-fold fragmentation did not step", async (t) => {
  if (!haveDb || !haveIdentity) return t.skip();

  // The sharper signal. 3,459 folds / 9,826 rows measured 2026-08-07. Merging
  // strangers shows up here first and much more clearly than in the total,
  // because it collapses exactly the multi-person folds.
  const [row] = await allRows<{ folds: string; rows: string }>(
    `SELECT count(*)::text AS folds, COALESCE(sum(n), 0)::text AS rows
       FROM (SELECT name_fold, count(*) n
               FROM person WHERE status = 'active'
              GROUP BY 1 HAVING count(*) > 1) q`,
  );
  const folds = Number(row.folds);
  const FOLD_BASELINE = 3_458;
  const FOLD_TOLERANCE = 40;
  assert.ok(
    Math.abs(folds - FOLD_BASELINE) <= FOLD_TOLERANCE,
    `${folds} multi-person name folds, more than ${FOLD_TOLERANCE} from the ` +
      `${FOLD_BASELINE} baseline (measured either side of the T2 resolve) — a DROP ` +
      `means people were merged. This is the SHARPEST signal available: a merge ` +
      `collapses exactly the multi-person folds, so it moves this number far more ` +
      `than the total.`,
  );
});

test("5.4 — the party-office merge licence did not widen", async (t) => {
  if (!haveDb || !haveIdentity) return t.skip();

  // person_resolve.data.test.ts licenses a cross-source merge when a person
  // holds a `party_leader` role and another role from a different source with
  // the SAME party. Populating MP party adds rows to that join's right side, so
  // a person who is both a party leader and an MP could newly acquire a licence
  // they did not have.
  //
  // 108 party_leader roles exist (all official_exec) and 61 of those people also
  // hold an mp role — so the exposure is the normal case for a party leader,
  // not an edge case. This counts the licence directly.
  // SELF-COMPUTING, not a magic number. A first draft asserted `<= 61` — the
  // size of the *exposed* set (people holding both a party_leader and an mp
  // role). That is a different population from the metric, whose structural
  // maximum is only 58, so the assertion could not fail and proved nothing.
  //
  // Instead: compute the licence WITH every source, and again with `mp`
  // excluded from the right-hand side. If populating MP party widened the
  // licence, the two differ — and that difference is exactly the set of people
  // who newly became mergeable. No baseline to maintain, and it fails for the
  // right reason.
  const [row] = await allRows<{ withmp: string; without: string }>(
    `SELECT (SELECT count(DISTINCT office.person_id)
               FROM person_role office
               JOIN person_role other
                 ON other.person_id = office.person_id
                AND other.source <> office.source
                AND other.party = office.party
              WHERE office.role = 'party_leader'
                AND office.party IS NOT NULL)::text AS withmp,
            (SELECT count(DISTINCT office.person_id)
               FROM person_role office
               JOIN person_role other
                 ON other.person_id = office.person_id
                AND other.source <> office.source
                AND other.party = office.party
                AND other.source <> 'mp'
              WHERE office.role = 'party_leader'
                AND office.party IS NOT NULL)::text AS without`,
  );

  assert.equal(
    row.withmp,
    row.without,
    `the party-office merge licence widened by ${Number(row.withmp) - Number(row.without)} ` +
      `person(s) once MP party was populated — that is an IDENTITY change, not a ` +
      `display one. person_resolve.data.test.ts uses this licence to justify a ` +
      `cross-source merge, so a person who newly qualifies can be merged with a namesake.`,
  );

  // Floor: the metric must be measuring something.
  assert.ok(
    Number(row.withmp) > 10,
    `only ${row.withmp} licensed merges — the join stopped matching, so this gate is vacuous`,
  );
});

test("5.4b — the exposed set is what we think it is", async (t) => {
  if (!haveDb || !haveIdentity) return t.skip();

  // Floors the gate above: if party_leader roles vanished, 5.4 would pass
  // vacuously while proving nothing.
  const [row] = await allRows<{ leaders: string; both: string }>(
    `SELECT (SELECT count(*) FROM person_role WHERE role = 'party_leader')::text AS leaders,
            (SELECT count(*) FROM (
               SELECT person_id FROM person_role WHERE role = 'party_leader'
               INTERSECT
               SELECT person_id FROM person_role WHERE role = 'mp') q)::text AS both`,
  );
  assert.ok(
    Number(row.leaders) > 50,
    `only ${row.leaders} party_leader role(s) — gate 5.4 has nothing to guard`,
  );
  assert.ok(
    Number(row.both) > 30,
    `only ${row.both} people hold both party_leader and mp — the exposure moved`,
  );
});
