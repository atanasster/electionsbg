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
import { reportSkip } from "../../lib/report_skip";

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
reportSkip(import.meta.url, skip);

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

// ── candidate URL → person resolution (person-candidate-display-unification-v1 Tier 1) ──
//
// The bare-name form is the PRERENDERED, indexed candidate family, and it resolves through
// `candidate_person_by_name`. Every name the function refuses falls through to the legacy
// candidate body, which reads the name-folder shards — so two namesakes' preference history
// is published as one person's, at a 200. These gates exist because the FIRST cut of the
// three-argument form made that population 4x LARGER while every other assertion in this
// file stayed green: it applied the election as a filter, and the election a page supplies
// by default is the newest cycle, which most candidates never stood in.

// One representative name per PUBLIC fold — the population every bare-name candidate URL
// draws from. `DISTINCT ON` picks an arbitrary row per fold; only `display_name` is read, and
// it is constant per fold by construction (the fold IS its transliteration).
const PUBLIC_FOLDS_CTE = `
  WITH folds AS (
    SELECT DISTINCT ON (cp.candidate_name_fold)
           cp.candidate_name_fold, p.display_name
      FROM candidate_person cp
      JOIN person p ON p.slug = cp.person_slug
     WHERE p.status = 'active' AND p.is_public_figure
     ORDER BY cp.candidate_name_fold
  )`;

// THE gate the first cut lacked. Runs the real resolver over EVERY public fold, three ways,
// and requires the election to be a tie-breaker rather than a filter: passing one may only
// ever resolve MORE names than passing none. Measured 2026-09-04 on the shipped body —
// 27,103 folds, 25,621 with no election, 26,006 at the newest cycle, 26,081 at 2024_10_27.
// The first cut scored 6,357 at the newest cycle and this assertion fails on it outright.
test.skipIf(skip)(
  "the election NARROWS a candidate name without ever excluding one",
  async () => {
    const [r] = await allRows<{
      folds: string;
      no_election: string;
      newest: string;
      older: string;
    }>(`${PUBLIC_FOLDS_CTE}
      SELECT count(*) AS folds,
             count(*) FILTER (
               WHERE candidate_person_by_name(display_name, NULL, NULL) IS NOT NULL
             ) AS no_election,
             count(*) FILTER (
               WHERE candidate_person_by_name(display_name, NULL,
                       (SELECT max(election_date) FROM candidate_person)) IS NOT NULL
             ) AS newest,
             count(*) FILTER (
               WHERE candidate_person_by_name(display_name, NULL,
                       (SELECT min(election_date) FROM candidate_person)) IS NOT NULL
             ) AS older
        FROM folds`);
    const folds = Number(r.folds);
    const none = Number(r.no_election);
    const newest = Number(r.newest);
    const older = Number(r.older);

    assert.ok(
      folds > 10_000,
      `only ${folds} public folds — nothing to assert on`,
    );
    // The load-bearing direction. An election may not cost a name its resolution, whichever
    // cycle it names — the NEWEST is what an arrival with no `?elections=` gets, and the
    // OLDEST is the worst case for a filter (almost nobody stood in it).
    assert.ok(
      newest >= none,
      `the newest cycle LOST resolutions: ${newest} with it vs ${none} without — the election is filtering, not narrowing`,
    );
    assert.ok(
      older >= none,
      `the oldest cycle LOST resolutions: ${older} with it vs ${none} without`,
    );
    // And it must actually gain: a body that ignored `p_election` would pass the two
    // inequalities above with equality on both.
    assert.ok(
      newest > none,
      `the election narrowed nothing: ${newest} resolved with it, ${none} without`,
    );
    // Non-vacuity on the base rate — a corpus whose folds had stopped resolving at all
    // would satisfy every inequality above at 0.
    assert.ok(
      none / folds > 0.9,
      `only ${((100 * none) / folds).toFixed(1)}% of folds resolve without an election`,
    );
  },
);

// A CORPUS-SHAPE check, not a resolver check — it reads table statistics only, and is named
// for what it measures. Its job is to keep the shared-name population big enough for the
// gates above and below to mean something, and to catch an identity layer that has stopped
// merging (which would show up as ambiguous folds overtaking unique ones).
test.skipIf(skip)(
  "SHAPE: shared candidate names are a real but small minority of the corpus",
  async () => {
    const [r] = await allRows<{
      unique_folds: string;
      ambiguous_folds: string;
      fold_election_pairs: string;
      fold_election_ambiguous: string;
      fold_election_party_ambiguous: string;
    }>(`
      WITH f AS (
        SELECT candidate_name_fold, count(DISTINCT person_id) n
          FROM candidate_person GROUP BY 1
      ),
      amb AS (SELECT candidate_name_fold FROM f WHERE n > 1),
      fe AS (
        SELECT cp.candidate_name_fold, cp.election_date, count(DISTINCT cp.person_id) n
          FROM candidate_person cp JOIN amb USING (candidate_name_fold)
         GROUP BY 1, 2
      ),
      fep AS (
        SELECT cp.candidate_name_fold, cp.election_date, cp.party_num,
               count(DISTINCT cp.person_id) n
          FROM candidate_person cp JOIN amb USING (candidate_name_fold)
         GROUP BY 1, 2, 3
      )
      SELECT (SELECT count(*) FROM f WHERE n = 1)  AS unique_folds,
             (SELECT count(*) FROM f WHERE n > 1)  AS ambiguous_folds,
             (SELECT count(*) FROM fe)             AS fold_election_pairs,
             (SELECT count(*) FROM fe WHERE n > 1) AS fold_election_ambiguous,
             (SELECT count(*) FROM fep WHERE n > 1) AS fold_election_party_ambiguous`);
    const ambiguousFolds = Number(r.ambiguous_folds);
    const pairs = Number(r.fold_election_pairs);
    const stillAmbiguous = Number(r.fold_election_ambiguous);

    // Non-vacuity in both directions: there ARE shared names (or the gates above assert
    // nothing), and most names are NOT shared (or the person layer stopped merging).
    assert.ok(ambiguousFolds > 100, `only ${ambiguousFolds} ambiguous folds`);
    assert.ok(
      Number(r.unique_folds) > 10 * ambiguousFolds,
      "unique folds should dominate — a collapse here means the person layer stopped merging",
    );
    // Measured 2026-09-03: 230 of 5,393 (fold, election) pairs stay ambiguous within their
    // own cycle, i.e. 95.7% of them name one person. This is a property of the CORPUS; what
    // the resolver does with it is the gate above.
    const oneOwnerPct = (100 * (pairs - stillAmbiguous)) / pairs;
    assert.ok(
      oneOwnerPct >= 90,
      `only ${oneOwnerPct.toFixed(1)}% of (fold, election) pairs name one person`,
    );
    // The party narrows further but is NOT free to the caller (it needs the candidate
    // index), so it is documented rather than relied on. Assert only the ordering — a strict
    // refinement can never be worse.
    assert.ok(
      Number(r.fold_election_party_ambiguous) <= stillAmbiguous,
      "adding the party cannot make a resolution ambiguous",
    );
  },
);

test.skipIf(skip)(
  "a refused name comes back as a CHOICE, never as an empty answer",
  async () => {
    // What the page renders instead of the conflating legacy body. Every name the resolver
    // refuses must yield at least two distinct people, each with at least one candidacy —
    // an empty or single-entry set sends the reader to the fall-through render.
    //
    // Sampled by HASH rather than alphabetically: an `ORDER BY fold LIMIT 200` prefix of
    // 1,480 names only ever exercises А-Б, and a defect that depends on a name's shape
    // (a two-part name, a hyphen, a Latin homoglyph) would sit outside it forever.
    const [r] = await allRows<{
      probed: string;
      bad: string;
      sample: string | null;
    }>(`
      WITH f AS (
        SELECT candidate_name_fold, count(DISTINCT person_id) n
          FROM candidate_person GROUP BY 1
      ),
      probe AS (
        SELECT DISTINCT ON (cp.candidate_name_fold)
               cp.candidate_name_fold, p.display_name
          FROM candidate_person cp
          JOIN person p ON p.slug = cp.person_slug
          JOIN f ON f.candidate_name_fold = cp.candidate_name_fold AND f.n > 1
         WHERE p.status = 'active' AND p.is_public_figure
         ORDER BY cp.candidate_name_fold, cp.election_date DESC
      ),
      spread AS (
        SELECT * FROM probe ORDER BY md5(candidate_name_fold) LIMIT 200
      ),
      refused AS (
        SELECT display_name,
               candidate_person_namesakes(display_name) AS ns
          FROM spread
         WHERE candidate_person_by_name(display_name, NULL, NULL) IS NULL
      )
      SELECT count(*) AS probed,
             count(*) FILTER (
               WHERE jsonb_array_length(ns) < 2
                  OR EXISTS (
                       SELECT 1 FROM jsonb_array_elements(ns) x
                        WHERE jsonb_array_length(COALESCE(x->'candidacies', '[]'::jsonb)) < 1
                          OR (x->>'personSlug') IS NULL
                          OR (x->>'displayName') IS NULL)
             ) AS bad,
             min(display_name) FILTER (WHERE jsonb_array_length(ns) < 2) AS sample
        FROM refused`);
    assert.ok(
      Number(r.probed) > 50,
      `only ${r.probed} refused names to check — the probe found nothing to assert on`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `refused names with an unusable namesake set (e.g. ${r.sample})`,
    );
  },
);

test.skipIf(skip)("the chooser's row order is fully determined", async () => {
  // 75 refused folds have two people tied on their newest candidacy, so ordering by that
  // alone lets the head of the chooser change between two requests for the SAME URL. This
  // repo already treats tie order in an ordered jsonb_agg as load-bearing
  // (person_role_date_basis.data.test.ts exists for it).
  const [r] = await allRows<{ bad: string; sample: string | null }>(`
      WITH f AS (
        SELECT candidate_name_fold, count(DISTINCT person_id) n
          FROM candidate_person GROUP BY 1
      ),
      probe AS (
        SELECT DISTINCT ON (cp.candidate_name_fold) p.display_name
          FROM candidate_person cp
          JOIN person p ON p.slug = cp.person_slug
          JOIN f ON f.candidate_name_fold = cp.candidate_name_fold AND f.n > 1
         WHERE p.status = 'active' AND p.is_public_figure
         ORDER BY cp.candidate_name_fold, cp.election_date DESC
      ),
      spread AS (SELECT * FROM probe ORDER BY md5(display_name) LIMIT 150),
      pairs AS (
        SELECT display_name,
               candidate_person_namesakes(display_name) AS a,
               candidate_person_namesakes(display_name) AS b
          FROM spread
      )
      SELECT count(*) FILTER (WHERE a::text <> b::text) AS bad,
             min(display_name) FILTER (WHERE a::text <> b::text) AS sample
        FROM pairs`);
  assert.equal(
    Number(r.bad),
    0,
    `two calls disagreed on the namesake payload (e.g. ${r.sample})`,
  );
});

test.skipIf(skip)(
  "the fold lookup both resolvers rest on is index-served, and they stay fast on the worst fold",
  async () => {
    // Both functions are on the serving path of the site's largest indexed page family,
    // under a 10 s pool statement_timeout, and both do the same first thing: find every
    // candidacy on one folded name. `idx_candidate_person_name (candidate_name_fold,
    // party_num)` is what makes that a seek; without it every /candidate/<name> arrival
    // scans 67k rows.
    //
    // ⚠️ Asserted on the BODY's predicate rather than on the function call, because a
    // `LANGUAGE sql` function invoked in a target list is opaque to EXPLAIN — the plan shows
    // one `Result` node whose buffer count folds in plan-cache warm-up and swings by 3x
    // between runs. The index choice is the property that actually protects the route; the
    // timings below are the coarse backstop.
    //
    // The predicate is probed with a BOUND parameter (extended protocol) rather than an
    // inlined literal, so the value cannot be constant-folded into the estimate.
    const worst = await allRows<{ display_name: string; fold: string }>(`
      SELECT p.display_name, cp.candidate_name_fold AS fold
        FROM candidate_person cp
        JOIN person p ON p.slug = cp.person_slug
       WHERE p.status = 'active' AND p.is_public_figure
       GROUP BY cp.candidate_name_fold, p.display_name
       ORDER BY count(DISTINCT cp.person_id) DESC, count(*) DESC
       LIMIT 1`);
    const { display_name: name, fold } = worst[0];

    const plan = (
      await allRows<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS)
           SELECT person_slug, election_date, party_num
             FROM candidate_person WHERE candidate_name_fold = $1`,
        [fold],
      )
    )
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    assert.ok(
      /idx_candidate_person_name/.test(plan),
      `the fold lookup stopped using idx_candidate_person_name:\n${plan}`,
    );
    assert.ok(
      !/Seq Scan on candidate_person/.test(plan),
      `the fold lookup fell back to a sequential scan:\n${plan}`,
    );

    // Coarse wall-clock backstop on the two real calls, warm. Measured 2026-09-04 on the
    // worst fold in the corpus (22 people): ~4 ms and ~2 ms. The ceiling is deliberately far
    // above that — this is here to catch an order-of-magnitude regression, not to track ms.
    const ms = async (sql: string, params: unknown[]): Promise<number> => {
      await allRows(sql, params); // warm the plan cache first
      const rows = await allRows<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE) ${sql}`,
        params,
      );
      const m = /Execution Time: ([\d.]+) ms/.exec(
        rows.map((r) => r["QUERY PLAN"]).join("\n"),
      );
      assert.ok(
        m,
        "EXPLAIN reported no execution time — this ceiling is vacuous",
      );
      return Number(m![1]);
    };
    const byName = await ms("SELECT candidate_person_by_name($1, NULL, $2)", [
      name,
      "2026_04_19",
    ]);
    const namesakes = await ms("SELECT candidate_person_namesakes($1)", [name]);
    assert.ok(
      byName < 250,
      `candidate_person_by_name took ${byName} ms on "${name}" (measured ~4)`,
    );
    assert.ok(
      namesakes < 500,
      `candidate_person_namesakes took ${namesakes} ms on "${name}" (measured ~2)`,
    );
  },
);
