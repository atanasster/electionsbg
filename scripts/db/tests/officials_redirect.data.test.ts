// officials_person_slug() (106) — the lookup behind the /officials/<slug> -> /person/<slug>
// 301. Plan: docs/plans/persons-pg-retirement-v1.md (T1.1).
//
// What this pins, and why each one is a real failure mode rather than a shape check:
//
//   1. COVERAGE. Every officials ref in person_role must resolve, or that official's URL
//      404s the moment OfficialProfileScreen is deleted (T1.3). The refs are the whole
//      inventory of URLs the old page served, so anything less than 100% is a list of
//      pages we are about to break.
//   2. THE RETIRED PATH. A slug the officials ingest re-slugged (T1.0, 18,428 of them) is
//      gone from person_role entirely and can only resolve through person_slug_redirect().
//      If the COALESCE order or the fallback ever breaks, coverage of CURRENT officials
//      stays at 100% and only the historical URLs die — silently, and invisibly to (1).
//   3. THE §6 GATE. A redirect to a person we refuse to serve is a 404 with an extra hop.
//   4. NO SELF-REDIRECT LOOP. /officials/<x> -> /person/<x> is fine (different sections),
//      but the target must be a slug /person actually serves.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
// The Cloud Function's slug pattern — compared against the corpus below.
import { OFFICIALS_SLUG } from "../../../functions/officials_redirect.js";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_role') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source = ANY(person_officials_sources())",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / no officials roles";

afterAll(async () => {
  await end();
});

// Migration 106 must actually be applied. With PG proven up, a missing function is a
// failure, not a reason to skip — otherwise a never-applied migration is indistinguishable
// from a database being down and every assertion below passes green.
test.skipIf(skip)("migration 106 is applied", async () => {
  const [t] = await allRows<{ ok: boolean }>(
    "SELECT to_regproc('officials_person_slug') IS NOT NULL AS ok",
  );
  assert.ok(
    t?.ok,
    "officials_person_slug() does not exist — migration 106 was never applied",
  );
});

// (1) Every officials ref resolves. These refs ARE the URL inventory of the page being
// retired; one that does not resolve is a page about to 404.
test.skipIf(skip)(
  "every current officials ref resolves to a person",
  async () => {
    const unresolved = await allRows<{ ref: string; source: string }>(
      `SELECT DISTINCT r.ref, r.source
       FROM person_role r
       JOIN person p ON p.person_id = r.person_id
                    AND p.status = 'active' AND p.is_public_figure
      WHERE r.source = ANY(person_officials_sources())
        AND officials_person_slug(r.ref) IS NULL
      LIMIT 5`,
    );
    assert.deepEqual(
      unresolved,
      [],
      "officials refs that resolve to nothing — those /officials URLs will 404 once " +
        "OfficialProfileScreen is deleted",
    );
  },
);

// (2) The retired path. A re-slugged official is absent from person_role, so only the
// person_slug_redirect() arm of the COALESCE can answer for them. Sampled rather than
// exhaustive: 20k function calls is a slow test, and the invariant is uniform.
test.skipIf(skip)(
  "a retired officials slug resolves through the redirect table",
  async () => {
    const rows = await allRows<{ slug: string; resolved: string | null }>(
      `SELECT r.slug, officials_person_slug(r.slug) AS resolved
       FROM person_slug_retired r
      WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = r.slug)
        AND NOT EXISTS (SELECT 1 FROM person_role pr WHERE pr.ref = r.slug)
      ORDER BY r.slug
      LIMIT 200`,
    );
    // A floor, not a corpus size: the T1.0 backfill contributes ~20.7k of these, so
    // anything near zero means the redirect table lost its backfill rather than that the
    // corpus is small. Named so a future reader does not have to guess which it is.
    assert.ok(
      rows.length > 50,
      `only ${rows.length} purely-retired slugs to sample — person_slug_retired should ` +
        `hold ~20.7k of them from the T1.0 backfill, so this means the backfill is ` +
        `missing, not that the corpus is small. Restore it with:\n` +
        `  npm run person:slug-redirects -- raw_data/person/officials_reslug_2026_07_24.json`,
    );
    const dead = rows.filter((r) => !r.resolved);
    assert.deepEqual(
      dead.slice(0, 5),
      [],
      `${dead.length}/${rows.length} retired officials slugs resolve to nothing — the ` +
        `person_slug_redirect() arm of officials_person_slug() is not being reached`,
    );
  },
);

// (3) The §6 gate. Redirecting to a person the site refuses to render is a 404 with an
// extra hop, and it leaks the existence of a profile we chose not to publish.
test.skipIf(skip)(
  "never resolves to a non-public or non-active person",
  async () => {
    const leaked = await allRows<{ ref: string; slug: string }>(
      `SELECT r.ref, p.slug
       FROM person_role r
       JOIN person p ON p.person_id = r.person_id
      WHERE r.source = ANY(person_officials_sources())
        AND (p.status <> 'active' OR NOT p.is_public_figure)
        AND officials_person_slug(r.ref) = p.slug
      LIMIT 5`,
    );
    assert.deepEqual(
      leaked,
      [],
      "the redirect resolves to a person outside the §6 gate",
    );
  },
);

// (4) Every target is a slug /person actually serves. A target that is not in `person` is a
// redirect into a 404 — the exact "404 with extra steps" the design refuses.
test.skipIf(skip)("every resolved target is a live person slug", async () => {
  const [r] = await allRows<{ bad: string }>(
    `WITH sample AS (
       SELECT DISTINCT officials_person_slug(pr.ref) AS target
         FROM person_role pr
        WHERE pr.source = ANY(person_officials_sources())
        LIMIT 2000
     )
     SELECT count(*) bad
       FROM sample s
      WHERE s.target IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = s.target)`,
  );
  assert.equal(
    Number(r.bad),
    0,
    "the redirect points at slugs that no live person carries",
  );
});

// An unknown slug must return NULL so the function can 404 honestly rather than bouncing
// the reader to a plausible-looking wrong page.
test.skipIf(skip)("an unknown slug resolves to NULL", async () => {
  const [r] = await allRows<{ slug: string | null }>(
    "SELECT officials_person_slug('definitely-not-a-real-slug-ffffff') AS slug",
  );
  assert.equal(r.slug, null);
});

// The JS parser and the corpus must agree on what a slug looks like. The Cloud Function
// rejects anything OFFICIALS_SLUG does not match BEFORE it reaches the database, so a ref
// the corpus contains but the regex refuses is a URL the redirect can never serve — it
// would 404 while officials_person_slug() would happily have resolved it. The two are
// written in different languages and cannot be shared, so they are compared instead.
test.skipIf(skip)(
  "the JS slug regex accepts every officials ref in the corpus",
  async () => {
    const rows = await allRows<{ ref: string }>(
      `SELECT DISTINCT ref FROM person_role
      WHERE source = ANY(person_officials_sources())`,
    );
    assert.ok(
      rows.length > 10000,
      `only ${rows.length} officials refs — corpus too small`,
    );
    const rejected = rows
      .map((r) => r.ref)
      .filter((ref) => !OFFICIALS_SLUG.test(ref));
    assert.deepEqual(
      rejected.slice(0, 5),
      [],
      `${rejected.length}/${rows.length} officials refs are rejected by the Cloud Function's ` +
        `OFFICIALS_SLUG pattern — those URLs would 404 before the lookup ran`,
    );
  },
);
