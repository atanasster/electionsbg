// The global header-search index of municipal officials, served by the
// `municipal-officials-search-index` route (functions/db_routes.js) off
// municipal_officials_table. It reproduces the retired scripts/officials/build_municipal_
// search.ts: resolve each name to EXACTLY ONE active public person by folded name
// (namesake-safe), DROP rows whose person is also a candidate/mp (dedup), stamp survivors
// with personSlug. Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).
//
// These pin the two invariants a future edit to the fold CTE / dedup could silently break:
// (1) no kept row links to a candidate/mp person (the dedup), (2) every emitted personSlug is
// namesake-unique. Both were parity-checked manually against the retired JSON; this captures
// them in the suite. Mirrors the route's fold+matched CTE rather than importing the inline
// SQL — the same discipline as the sibling roster gate.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

// The route's fold + matched CTE, verbatim, exposed as a reusable prefix so each assertion
// queries the same resolution the route serves.
const MATCHED_CTE = `
  WITH fold AS (
    SELECT p.name_fold,
           count(*) AS n,
           min(p.slug) AS slug,
           bool_or(EXISTS(
             SELECT 1 FROM person_role r
              WHERE r.person_id = p.person_id
                AND r.source IN ('candidate','mp'))) AS is_candidate
    FROM person p
    WHERE p.status = 'active' AND p.is_public_figure
    GROUP BY p.name_fold
  ),
  matched AS (
    SELECT m.official_slug, m.name, f.slug AS person_slug,
           COALESCE(f.is_candidate, false) AS is_candidate
    FROM municipal_officials_table m
    LEFT JOIN fold f
      ON f.name_fold = translit_bg_latin(m.name) AND f.n = 1
  )`;

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.municipal_officials_table') IS NOT NULL AS ok",
    );
    return Boolean(t?.ok);
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / matview absent";

afterAll(async () => {
  await end();
});

// The kept set must be populated AND the dedup must actually drop rows — otherwise a broken
// FILTER (dropping nothing, or everything) would pass a mere "non-empty" check.
test.skipIf(skip)(
  "kept set is populated and the dedup drops a real slice",
  async () => {
    const [c] = await allRows<{ kept: string; dropped: string }>(
      `${MATCHED_CTE}
     SELECT count(*) FILTER (WHERE NOT is_candidate) kept,
            count(*) FILTER (WHERE is_candidate) dropped
     FROM matched`,
    );
    assert.ok(Number(c.kept) > 4_000, `only ${c.kept} kept entries`);
    assert.ok(
      Number(c.dropped) > 0,
      "dedup dropped 0 rows — the candidate/mp FILTER is a no-op",
    );
  },
);

// The dedup guarantee: no entry the search index KEEPS is a person who also appears as a
// candidate/mp (they are listed there instead — keeping both is the duplicate this drops).
test.skipIf(skip)("no kept entry links to a candidate/mp person", async () => {
  const [bad] = await allRows<{ n: string }>(
    `${MATCHED_CTE}
     SELECT count(*) n FROM matched WHERE NOT is_candidate AND is_candidate IS TRUE`,
  );
  // Tautology by construction, but also assert the stronger cross-check: a kept row's person
  // (when linked) must not carry a candidate/mp role.
  assert.equal(Number(bad.n), 0);
  const [leak] = await allRows<{ n: string }>(
    `${MATCHED_CTE}
     SELECT count(*) n
     FROM matched m
     WHERE NOT m.is_candidate
       AND m.person_slug IS NOT NULL
       AND EXISTS(
         SELECT 1 FROM person p
         JOIN person_role r ON r.person_id = p.person_id
         WHERE p.slug = m.person_slug AND r.source IN ('candidate','mp'))`,
  );
  assert.equal(
    Number(leak.n),
    0,
    `${leak.n} kept entr(y/ies) link to a candidate/mp person — dedup regressed`,
  );
});

// Namesake safety: every emitted personSlug comes from a folded name that maps to EXACTLY ONE
// active public figure. A slug from an ambiguous name would mislink a namesake to /person.
test.skipIf(skip)("every emitted personSlug is namesake-unique", async () => {
  const [bad] = await allRows<{ n: string }>(
    `${MATCHED_CTE}
     SELECT count(*) n
     FROM matched m
     WHERE m.person_slug IS NOT NULL
       AND (SELECT count(*) FROM person p
             WHERE p.name_fold = translit_bg_latin(m.name)
               AND p.status = 'active' AND p.is_public_figure) <> 1`,
  );
  assert.equal(
    Number(bad.n),
    0,
    `${bad.n} personSlug(s) resolved from a non-unique folded name`,
  );
});
