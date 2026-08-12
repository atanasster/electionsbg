// The registry people-count guard (148 + resolve_persons). Plan:
// docs/plans/tr-attribution-basis-v1.md §5.
//
//   npm run test:data
//
// This is the gate on the one thing standing between a public figure and a stranger's
// companies. The assertions are ORDERED, and the order is load-bearing: assertion 2 is
// satisfied vacuously by an all-NULL column, so the population floor has to come first.
//
// Requires Postgres + the person layer + a loaded tr_name_fold_people; auto-skips only when
// Postgres is unreachable. It does NOT skip on an empty guard table — that is one of the
// states it exists to catch.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const one = async <T extends Record<string, unknown>>(
  sql: string,
): Promise<T> => (await allRows<T>(sql))[0];

const reachable = await allRows("SELECT 1")
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the guard table is loaded and discriminating", async () => {
  const r = await one<{ n: string; shared: string }>(
    `SELECT count(*) n, count(*) FILTER (WHERE people_n > 1) shared
       FROM tr_name_fold_people`,
  );
  assert.ok(
    Number(r.n) > 100_000,
    `tr_name_fold_people holds ${r.n} folds — run db:load:tr-name-fold-people:pg. With it ` +
      `empty, Bridge B has no positive evidence for ANY fold and mints no companies at all.`,
  );
  // A table of all-1s would satisfy every other assertion here while disarming the guard.
  assert.ok(
    Number(r.shared) > 1_000,
    `only ${r.shared} folds are shared by 2+ people — the count has collapsed, which reads ` +
      `as "every name is one person" and re-opens Bridge B on every namesake.`,
  );
});

test.skipIf(skip)(
  "fold_people_n is populated — assertion 2 is vacuous without this",
  async () => {
    // `person` is DELETEd and rebuilt every resolve, so this column arrives only if the
    // resolver's stamping UPDATE ran. Dropped, every row comes back NULL, no person has
    // fold_people_n > 1, and the shared_name assertion below passes over an EMPTY SET while
    // the guard has silently reverted to "everything is unmeasured". That is the date_basis
    // failure class 081 documents, applied to the column this whole plan turns on.
    const r = await one<{ missing: string; expected: string }>(
      `SELECT count(*) FILTER (WHERE p.fold_people_n IS NULL) AS missing,
              count(*)                                       AS expected
         FROM person p JOIN tr_name_fold_people f ON f.name_fold = p.name_fold`,
    );
    assert.ok(
      Number(r.expected) > 1_000,
      "nothing joined — nothing was checked",
    );
    assert.equal(
      Number(r.missing),
      0,
      `${r.missing} of ${r.expected} people sit on a MEASURED fold and carry a NULL ` +
        `fold_people_n — the resolver is not stamping the column, so every guard and every ` +
        `caveat built on it has quietly failed open.`,
    );
  },
);

test.skipIf(skip)(
  "Bridge B minted nothing on a shared or unmeasured fold",
  async () => {
    // The guard itself. Bridge-A links are EXEMPT and must stay exempt: a curated register
    // (declared interests / ИВСС чл.175а) placing a company on a person is evidence about
    // that COMPANY, and it does not stop being evidence because the person's name is common.
    // Measured after the first guarded resolve: 16 such pairs, all in person_company_bridge_a.
    const rows = await allRows<{ slug: string; ref: string; n: string }>(
      `SELECT p.slug, r.ref, coalesce(f.people_n::text, 'unmeasured') AS n
         FROM person p
         JOIN person_role r ON r.person_id = p.person_id AND r.source = 'tr'
         LEFT JOIN tr_name_fold_people f ON f.name_fold = p.name_fold
         LEFT JOIN person_company_bridge_a b
                ON b.person_id = p.person_id AND b.uic = r.ref
        WHERE p.is_public_figure
          AND b.uic IS NULL
          AND (f.people_n IS NULL OR f.people_n > 1)
        LIMIT 20`,
    );
    assert.deepEqual(
      rows,
      [],
      `${rows.length}+ name-derived company links on public figures whose fold the registry ` +
        `says is several people (or has never seen). Bridge B must require positive evidence ` +
        `— EXISTS (… people_n = 1), never NOT EXISTS (… people_n > 1), which admits the ` +
        `unmeasured folds.`,
    );
  },
);

test.skipIf(skip)(
  "a Tier-V mint on a shared fold is LABELLED, not deleted",
  async () => {
    // Deleting them would orphan ~4.5k /person URLs with no valid redirect target — the
    // magistrate-roster 404 class. So they stay, and say so.
    const r = await one<{ mislabelled: string; labelled: string }>(
      `SELECT count(*) FILTER (WHERE identity_confidence = 'verified')     AS mislabelled,
            count(*) FILTER (WHERE identity_confidence = 'shared_name')  AS labelled
       FROM person
      WHERE NOT is_public_figure AND fold_people_n > 1
        AND identity_confidence IN ('verified', 'shared_name')`,
    );
    assert.ok(
      Number(r.labelled) > 100,
      `only ${r.labelled} Tier-V people carry 'shared_name' — the label is not being applied`,
    );
    assert.equal(
      Number(r.mislabelled),
      0,
      `${r.mislabelled} people sit on a fold the registry says is several people and are still ` +
        `published as 'verified' — the data model calling "verified" a name it knows is shared.`,
    );
  },
);

test.skipIf(skip)(
  "measured coverage has not decayed past its floor",
  async () => {
    // §6 of the plan: coverage FALLS as the CR-Deeds arm widens, because that source publishes
    // no identity key at all. This must fail rather than warn — a guard nobody can see decaying
    // is how it ends up covering nothing.
    // Measured over the folds the guard ACTUALLY GATES — public, 3-part, people-unique, with
    // a TR footprint — not over every fold in tr_person_roles. The global figure is 78.5% and
    // is the wrong instrument: it is dominated by folds no public figure has (officer rows
    // whose "name" is a company, sentence-shaped names), so it would fall for reasons that
    // never touch a person page and hold steady while the folds that matter went dark.
    // Measured 2026-08-12: 17,861 candidates, 97.2% measured.
    const r = await one<{ pct: string; n: string }>(
      `WITH cand AS (
         SELECT p.name_fold FROM person p
          WHERE p.name_parts = 3 AND p.is_public_figure
            AND NOT EXISTS (SELECT 1 FROM person p2
                             WHERE p2.name_fold = p.name_fold
                               AND p2.person_id <> p.person_id)
            AND EXISTS (SELECT 1 FROM tr_person_roles t
                         WHERE t.name_fold = p.name_fold)
       )
       SELECT count(*) AS n,
              round(100.0 * count(*) FILTER (WHERE f.name_fold IS NOT NULL) /
                    nullif(count(*), 0), 1) AS pct
         FROM cand LEFT JOIN tr_name_fold_people f USING (name_fold)`,
    );
    assert.ok(
      Number(r.n) > 1_000,
      "no Bridge-B candidates — nothing was measured",
    );
    assert.ok(
      Number(r.pct) >= 90,
      `only ${r.pct}% of the ${r.n} folds Bridge B gates are measured (was 97.2%). Every ` +
        `unmeasured fold is REFUSED, so this decaying means the guard is silently withholding ` +
        `companies from real people. Re-mint with npm run tr:count-people; if the feed no ` +
        `longer covers the corpus, the floor needs a deliberate decision.`,
    );
  },
);
