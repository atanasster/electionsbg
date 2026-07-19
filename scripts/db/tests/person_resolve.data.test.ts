// Tier-3 (Postgres-native) invariants over the resolved person tables — the §7d
// migration-safety gate for the person resolver (scripts/person/resolve_persons.ts).
// Asserts the data-version-independent rules that must hold no matter which sources
// were resolved, most importantly the zero-false-public-merge invariant.
//
//   npm run test:data
//
// Requires the Postgres store + a resolver run (`npx tsx scripts/person/resolve_persons.ts`);
// auto-skips when Postgres is unreachable or the person table is absent/empty — so CI
// (no container) skips it, exactly like the other *.data.test.ts gates.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>("SELECT count(*) n FROM person");
    return Number(c.n) > 0; // resolver has run
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / person table empty";

afterAll(async () => {
  await end();
});

// The headline invariant: a person that merges roles from DIFFERENT sources on a common
// name (namesake_risk > 1) must carry a GOLD KEY (some role confidence='exact_id', i.e. a
// shared parliament MP id). A cross-source merge is the defamation-critical one — it
// claims "this donor IS this magistrate", "this candidate IS this official" — so on a
// common name only a hard id may license it; a name-based corroborant (party+place) never
// crosses facets on a colliding fold. (A SAME-source common-name merge — one candidate
// with several candidacies for the same party+oblast, patronymic-consistent — is allowed:
// it only asserts "ran more than once", and the patronymic-conflict veto keeps genuinely
// different people apart. See scripts/person/cluster.ts.)
test.skipIf(skip)(
  "no cross-source merge on a common name without a gold key",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad
         FROM (SELECT person_id FROM person_role GROUP BY 1
                HAVING count(DISTINCT source) > 1) m
         JOIN person p USING (person_id)
        WHERE p.namesake_risk > 1
          AND NOT EXISTS (
            SELECT 1 FROM person_role r
             WHERE r.person_id = p.person_id AND r.confidence = 'exact_id')`,
    );
    assert.equal(
      Number(r.bad),
      0,
      "found a cross-source common-name merge with no gold key (potential namesake collapse)",
    );
  },
);

test.skipIf(skip)(
  "every person has a non-null fold and a blocking key",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad FROM person
      WHERE name_fold IS NULL OR given_fold IS NULL OR family_fold IS NULL
         OR given_fold = '' OR family_fold = ''`,
    );
    assert.equal(Number(r.bad), 0);
  },
);

test.skipIf(skip)("every person has at least one role", async () => {
  const [r] = await allRows<{ bad: string }>(
    `SELECT count(*) bad FROM person p
      WHERE NOT EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = p.person_id)`,
  );
  assert.equal(Number(r.bad), 0);
});

test.skipIf(skip)(
  "every active person's roles carry a public-safe confidence",
  async () => {
    const [r] = await allRows<{ bad: string }>(
      `SELECT count(*) bad
         FROM person p JOIN person_role r USING (person_id)
        WHERE p.status = 'active'
          AND r.confidence NOT IN ('exact_id', 'high', 'manual')`,
    );
    assert.equal(Number(r.bad), 0);
  },
);
