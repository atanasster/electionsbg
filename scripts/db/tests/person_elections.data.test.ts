// Migration-safety gate for the electoral re-key (scripts/db/load_person_elections_pg.ts,
// person-candidate-merge). Asserts the data-version-independent invariants that must hold no
// matter which shards were loaded — most importantly that the namesake collision was SPLIT by
// party, not conflated (the whole point of the migration).
//
//   npm run test:data
//
// Requires Postgres + a run of `npm run db:load:person-elections:pg`; auto-skips when
// Postgres is unreachable or person_election_stats is absent/empty (CI has no container).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_election_stats') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_election_stats",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / person_election_stats empty";

afterAll(async () => {
  await end();
});

// THE headline invariant: a person's per-election regions must all carry ONE party. The name
// folders hold every namesake's rows (21/cycle collide), so if the loader's party filter
// regressed, a colliding person's `regions` would mix parties — the exact conflation the
// migration exists to fix. Zero mixed-party rows == collisions were split correctly.
test.skipIf(skip)(
  "no person_election_stats row mixes parties (namesakes stay split)",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad FROM person_election_stats e
        WHERE (SELECT count(DISTINCT (x->>'partyNum'))
                 FROM jsonb_array_elements(e.regions) x
                WHERE x ? 'partyNum') > 1`,
    );
    assert.equal(Number(r.bad), 0, "found rows whose regions mix >1 party");
  },
);

// The denormalized total_votes must equal Σ regions[].totalVotes — proves the headline number
// is computed off the SAME party-filtered rows, not a stale/global sum.
test.skipIf(skip)("total_votes reconciles with the regions jsonb", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM person_election_stats e
        WHERE e.total_votes <> (
          SELECT COALESCE(sum((x->>'totalVotes')::int), 0)
            FROM jsonb_array_elements(e.regions) x)`,
  );
  assert.equal(Number(r.bad), 0, "total_votes disagrees with Σ regions");
});

// (person_id, election_date) is the PK, so dups are impossible at the table level — assert it
// anyway so a schema regression (adding party_num back to the PK) is caught here, not in prod.
test.skipIf(skip)("one electoral row per (person, election)", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM (
         SELECT person_id, election_date FROM person_election_stats
          GROUP BY 1, 2 HAVING count(*) > 1) d`,
  );
  assert.equal(Number(r.bad), 0, "duplicate (person, election) rows");
});

// Every candidate_person lookup row must point to a real person (no dangling slug) so
// /candidate/:id resolution can't 404 on a valid historical slug.
test.skipIf(skip)(
  "candidate_person maps only to existing persons",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad FROM candidate_person cp
         LEFT JOIN person p ON p.slug = cp.person_slug
        WHERE p.slug IS NULL`,
    );
    assert.equal(Number(r.bad), 0, "candidate_person rows with no person");
  },
);
