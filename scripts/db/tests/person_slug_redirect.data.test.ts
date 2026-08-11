// The /person retired-slug 301 resolves against real data (functions/person_redirect.js).
//
// WHY A PG GATE: the redirect's whole correctness lives in one SQL string, and the
// functions/ unit tests exercise the handler against a FAKE resolve — they can prove the
// 301 shape and never touch the predicate that decides whether to issue one at all.
//
// The two predicates guard opposite ends and fail in opposite directions:
//   * TARGET servable — else a bad URL 301s to another bad URL (a redirect into the
//     noindex fallback), which is worse than the 200 it replaced.
//   * SOURCE dead — else a live, prerendered, indexable page 301s away to somebody else.
//     Being listed in person_slug_retired is NOT proof a slug is dead: the map and the
//     person table are written by different runs and slug locks accumulate per database.
//     Measured 2026-08-07: 10 slugs the LOCAL database lists as retired resolve to live
//     people on prod. That divergence is the reason the guard exists.
//
// Both cases below are built INSIDE a rolled-back transaction, because neither can be
// produced from the committed rows on any one database.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import {
  RETIRED_TARGET_SQL,
  personPath,
} from "../../../functions/person_redirect.js";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** A slug that person_by_slug() would serve — the same predicate the redirect re-applies. */
const SERVABLE = `
  SELECT slug FROM person
   WHERE status = 'active'
     AND (is_public_figure OR identity_confidence = 'verified')
   LIMIT 1`;

test.skipIf(skip)(
  "a genuinely retired slug resolves to its live target",
  async () => {
    const [row] = await allRows<{ slug: string; target_slug: string }>(
      `SELECT r.slug, r.target_slug FROM person_slug_retired r
       JOIN person p ON p.slug = r.target_slug
      WHERE p.status = 'active'
        AND (p.is_public_figure OR p.identity_confidence = 'verified')
        AND NOT EXISTS (SELECT 1 FROM person o WHERE o.slug = r.slug)
      LIMIT 1`,
    );
    if (!row) return; // an empty retired map is covered by the invariant test below
    const got = await allRows<{ slug: string }>(RETIRED_TARGET_SQL, [row.slug]);
    assert.equal(
      got[0]?.slug,
      row.target_slug,
      `${row.slug} is retired with a live target but the redirect query returned nothing`,
    );
  },
);

test.skipIf(skip)(
  "a slug that still SERVES is refused, never redirected",
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const live = (await c.query(SERVABLE)).rows[0]?.slug;
        assert.ok(live, "no servable person to build the case from");
        // Same shape as the prod-vs-local divergence: listed as retired, still serving.
        const target = (await c.query(`${SERVABLE} OFFSET 1`)).rows[0]?.slug;
        assert.ok(target && target !== live, "need a second servable person");
        await c.query(
          "INSERT INTO person_slug_retired (slug, target_slug) VALUES ($1, $2) " +
            "ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug",
          [live, target],
        );
        const { rows } = await c.query(RETIRED_TARGET_SQL, [live]);
        assert.equal(
          rows.length,
          0,
          `${live} still serves a person page, so it must NOT 301 — got a redirect to ${rows[0]?.slug}`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

test.skipIf(skip)(
  "an unservable target is refused, so no 301 lands on the noindex fallback",
  async () => {
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const dead = (
          await c.query(
            `SELECT slug FROM person
              WHERE NOT (status = 'active'
                    AND (is_public_figure OR identity_confidence = 'verified'))
              LIMIT 1`,
          )
        ).rows[0]?.slug;
        if (!dead) return; // no non-servable person on this database
        await c.query(
          "INSERT INTO person_slug_retired (slug, target_slug) VALUES ($1, $2) " +
            "ON CONFLICT (slug) DO UPDATE SET target_slug = EXCLUDED.target_slug",
          ["zz-synthetic-retired-000000", dead],
        );
        const { rows } = await c.query(RETIRED_TARGET_SQL, [
          "zz-synthetic-retired-000000",
        ]);
        assert.equal(
          rows.length,
          0,
          `target ${dead} is not servable, so the redirect must be refused`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);

/** Every retired slug that WOULD resolve: dead source, servable target. The set that must
 *  reach the database, and the set the URL parser is not allowed to filter. */
const RESOLVABLE = `
  SELECT r.slug FROM person_slug_retired r
    JOIN person p ON p.slug = r.target_slug
   WHERE p.status = 'active'
     AND (p.is_public_figure OR p.identity_confidence = 'verified')
     AND NOT EXISTS (SELECT 1 FROM person o WHERE o.slug = r.slug)`;

test.skipIf(skip)(
  "personPath filters NOTHING out of the resolvable retired corpus",
  async () => {
    // The regression this replaces. personPath used to pre-filter on a shape test
    // (`kebab + 6-char base36 [+ -N]`), which was not a description of the slug space — the
    // mp-<id>[-n] family has no disambiguator. It refused 14 of these, each with a live
    // target, and a refused slug is served the shell and noindexes itself: the exact defect
    // the redirect exists to remove. The pre-filter is gone; this gate is what keeps any
    // future one honest, and it is deliberately regex-free so it still holds if one returns.
    //
    // Precedent: officials_redirect.data.test.ts's "the JS slug regex accepts every officials
    // ref in the corpus".
    const rows = await allRows<{ slug: string }>(RESOLVABLE);
    assert.ok(
      rows.length > 10000,
      `only ${rows.length} resolvable retired slugs — the corpus looks unloaded`,
    );
    const refused = rows
      .map((r) => r.slug)
      .filter(
        (s) => personPath(`/person/${encodeURIComponent(s)}`)?.slug !== s,
      );
    assert.deepEqual(
      refused.slice(0, 5),
      [],
      `${refused.length}/${rows.length} resolvable retired slugs never reach the lookup — ` +
        `each one serves the shell and noindexes itself`,
    );
  },
);

test.skipIf(skip)(
  "the inline SQL and 103's person_slug_redirect() agree on every row",
  async () => {
    // The repo holds two definitions of this rule (see RETIRED_TARGET_SQL's docblock). They
    // differ deliberately — this one applies 082's real servability predicate, 103's applies
    // is_public_figure alone and follows chains — and 103 is ALSO what officials_person_slug()
    // calls, so they cannot simply be merged from this side. Keeping the divergence measured
    // is the price of keeping both: at 0 it is latent, and a non-zero count means a re-resolve
    // has made the /person and /officials redirects answer differently for the same slug.
    //
    // $1 is substituted rather than re-typed so the comparison can never drift from the
    // string the Cloud Function actually runs. The inline query's aliases (r/p/old) do not
    // collide with q.
    // `zz-%` is excluded because collapse_slug_chains.data.test.ts seeds its fixtures
    // (`zz-collapse-a` → `zz-collapse-b` → …) with a COMMITTED insert rather than a
    // rolled-back transaction — it has to, since collapseSlugRedirectChains() runs on its
    // own pool connections and would not see an uncommitted row. Those rows are therefore
    // globally visible for the length of that file's run, and this is the one assertion
    // here that scans the WHOLE table, so a concurrent run saw them and failed on
    // `zz-collapse-a`: a deliberately dangling target, which 103 (chain-following,
    // is_public_figure) and the inline query (082's servability) are SUPPOSED to disagree
    // about. That is the fixture doing its job, not a corpus defect — measured 2026-08-11,
    // and it is why this file passes when run alone and fails inside `npm run test:data`.
    //
    // Scoped to the fixture namespace rather than fixed by serialising the two files: the
    // assertion is about the agreement of the two implementations over the REAL retired
    // corpus, and no corpus slug can begin `zz-` (every one is a name transliteration or
    // `mp-<id>`, per SLUG_SHAPE in person_slug_retired.data.test.ts).
    const [r] = await allRows<{ n: string; sample: string | null }>(
      `SELECT count(*)::text AS n,
              min(q.slug) AS sample
         FROM person_slug_retired q
         LEFT JOIN LATERAL (${RETIRED_TARGET_SQL.replace("$1", "q.slug")}) inline ON true
        WHERE q.slug NOT LIKE 'zz-%'
          AND person_slug_redirect(q.slug) IS DISTINCT FROM inline.slug`,
    );
    assert.equal(
      r.n,
      "0",
      `${r.n} slugs resolve differently through the two implementations (e.g. ${r.sample}) — ` +
        `/person and /officials would redirect the same slug to different people`,
    );
  },
);

test.skipIf(skip)(
  "no retired slug is also a live person — the invariant the guard backstops",
  async () => {
    // Informational rather than fatal on its own: the NOT EXISTS clause makes a violation
    // harmless at request time. It is asserted so a re-resolve that starts producing them
    // is noticed here rather than as a mystery redirect.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM person_slug_retired r
         JOIN person p ON p.slug = r.slug
        WHERE p.status = 'active'
          AND (p.is_public_figure OR p.identity_confidence = 'verified')`,
    );
    assert.equal(
      r.n,
      "0",
      `${r.n} retired slugs still serve a live person on THIS database — harmless (the ` +
        `redirect refuses them) but it means the retired map and the person table disagree`,
    );
  },
);
