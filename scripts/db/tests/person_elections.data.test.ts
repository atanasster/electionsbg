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

// ── the trajectory arc (person-candidate-display-unification-v1 Tier 2) ─────────────────
//
// `person_election_stats.stats` is the raw name-folder array, which accumulates the fold's
// history across every cycle — so a namesake who ran in a DIFFERENT election than the one
// the loader's collision guard inspects lands on this person's chart. Measured 2026-09-03
// before the fix: 5,111 of 55,046 drawn bars (2,458 people) were cycles the person has no
// row for, and 100% of those were explained by a same-name candidate in that cycle owned by
// a different person_id. `person_elections()` now derives the arc from the person's OWN rows.
//
// ⚠️ The gates below read the FUNCTION, never the `stats` column: that column is deliberately
// left as the raw shard capture (it still feeds top_settlements / top_sections), so asserting
// over it would assert the defect.

// Every bar every person's chart would draw, out of the serving function itself — the ONE
// unwrap all four arc gates share, so a change to the payload's shape cannot leave one of
// them quietly measuring something else. `history` is the person's whole arc and identical on
// each row, so row 0 is the whole payload's answer.
const DRAWN_BARS_SQL = `
  WITH people AS (
    SELECT p.slug, p.person_id
      FROM person p
      JOIN person_election_stats e USING (person_id)
     WHERE p.status = 'active' AND p.is_public_figure
     GROUP BY p.slug, p.person_id
  ),
  payload AS (
    SELECT pl.slug, pl.person_id,
           jsonb_path_query_first(person_elections(pl.slug), '$[0].history') AS arc
      FROM people pl
  ),
  bars AS (
    SELECT pa.slug, pa.person_id, b->>'elections_date' AS cycle,
           b->'party'->>'nickName' AS nick,
           b->'party'->>'color' AS color,
           (SELECT jsonb_agg(jsonb_build_array(x->>'oblast', x->>'pref', x->>'preferences')
                     ORDER BY x->>'oblast')
              FROM jsonb_array_elements(b->'preferences') x) AS prefs
      FROM payload pa, jsonb_array_elements(COALESCE(pa.arc, '[]'::jsonb)) b
     -- Only entries the chart would DRAW. Redundant on the current body (a non-empty
     -- regions array implies non-empty preferences) and deliberately kept: it is what makes
     -- these counts comparable to the pre-fix figures, which were measured over the old
     -- FRONTEND model, i.e. PersonElectoralSection longest-history pick with this filter.
     WHERE jsonb_array_length(COALESCE(b->'preferences', '[]'::jsonb)) > 0
  )`;

test.skipIf(skip)(
  "no person's trajectory draws a cycle they did not stand in",
  async () => {
    // THE Tier 2 invariant, and the one this file was missing. It fails on `main` — at
    // 196,128 foreign bars as this query counts them, because before the fix `$[0].history`
    // was the NEWEST row's shard array. The 5,111 in the plan is the same defect counted over
    // the old FRONTEND model (the longest-history pick), which is what a reader saw.
    const [r] = await allRows<{
      bars: string;
      foreign_bars: string;
      people: string;
      sample: string | null;
    }>(`${DRAWN_BARS_SQL}
      SELECT count(*) AS bars,
             count(*) FILTER (WHERE o.election_date IS NULL) AS foreign_bars,
             count(DISTINCT b.slug) FILTER (WHERE o.election_date IS NULL) AS people,
             min(b.slug || ' @ ' || b.cycle) FILTER (WHERE o.election_date IS NULL) AS sample
        FROM bars b
        LEFT JOIN person_election_stats o
               ON o.person_id = b.person_id AND o.election_date = b.cycle`);
    assert.ok(
      Number(r.bars) > 10_000,
      `only ${r.bars} bars across the corpus — nothing to assert on`,
    );
    assert.equal(
      Number(r.foreign_bars),
      0,
      `${r.foreign_bars} bars on ${r.people} people's charts are cycles they have no row for (e.g. ${r.sample})`,
    );
  },
);

test.skipIf(skip)(
  "the arc is exactly the person's own cycles WITH results, once each",
  async () => {
    // Both directions. A missing cycle silently shortens someone's career; a duplicate
    // inflates `history.length` past the ≥2 the tile needs and draws the same year twice.
    // Rows with no regions are excluded on purpose — a roster-only candidacy has no bar.
    const [r] = await allRows<{
      mismatched: string;
      duped: string;
      sample: string | null;
    }>(`${DRAWN_BARS_SQL},
      expected AS (
        SELECT p.slug, count(*) n
          FROM person p
          JOIN person_election_stats e USING (person_id)
         WHERE p.status = 'active' AND p.is_public_figure
           AND jsonb_array_length(e.regions) > 0
         GROUP BY p.slug
      ),
      actual AS (
        SELECT slug, count(*) n, count(DISTINCT cycle) d FROM bars GROUP BY slug
      )
      SELECT count(*) FILTER (WHERE COALESCE(a.n, 0) <> COALESCE(x.n, 0)) AS mismatched,
             count(*) FILTER (WHERE a.n <> a.d) AS duped,
             min(COALESCE(a.slug, x.slug)) FILTER (
               WHERE COALESCE(a.n, 0) <> COALESCE(x.n, 0)) AS sample
        FROM expected x FULL JOIN actual a USING (slug)`);
    assert.equal(
      Number(r.mismatched),
      0,
      `the arc disagrees with the person's own result-bearing rows (e.g. ${r.sample})`,
    );
    assert.equal(Number(r.duped), 0, "a cycle appears twice in one arc");
  },
);

test.skipIf(skip)(
  "every bar carries the party and the preferences the person's own row states",
  async () => {
    // The arc is DERIVED, so it can be re-derived and compared — the mutation check that
    // stops "it has the right cycles" from passing on an arc of empty bars. Compares each
    // bar's party nick/colour and its per-region (oblast, pref, votes) against the row.
    //
    // ⚠️ This compares the function against its OWN input. That the derivation is faithful to
    // the SHARD is a different claim and has its own gate below.
    const [r] = await allRows<{
      checked: string;
      bad: string;
      sample: string | null;
    }>(
      `${DRAWN_BARS_SQL},
      expected AS (
        SELECT b.slug, b.cycle, e.party_nick, e.party_color,
               (SELECT jsonb_agg(jsonb_build_array(x->>'oblast', x->>'pref', x->>'totalVotes')
                         ORDER BY x->>'oblast')
                  FROM jsonb_array_elements(e.regions) x) AS prefs
          FROM bars b
          JOIN person_election_stats e
            ON e.person_id = b.person_id AND e.election_date = b.cycle
      )
      SELECT count(*) AS checked,
             count(*) FILTER (
               WHERE b.nick IS DISTINCT FROM x.party_nick
                  OR b.color IS DISTINCT FROM x.party_color
                  OR b.prefs::text IS DISTINCT FROM x.prefs::text
             ) AS bad,
             min(b.slug || ' @ ' || b.cycle) FILTER (
               WHERE b.nick IS DISTINCT FROM x.party_nick
                  OR b.color IS DISTINCT FROM x.party_color
                  OR b.prefs::text IS DISTINCT FROM x.prefs::text
             ) AS sample
        FROM bars b JOIN expected x ON x.slug = b.slug AND x.cycle = b.cycle`,
    );
    assert.ok(
      Number(r.checked) > 10_000,
      `only ${r.checked} bars re-derived — the comparison found nothing`,
    );
    assert.equal(
      Number(r.bad),
      0,
      `a bar disagrees with its own row's party or preferences (e.g. ${r.sample})`,
    );
  },
);

test.skipIf(skip)(
  "the arc reproduces the SHARD's OWN-cycle entry, field for field",
  async () => {
    // The independent check the gate above cannot make: `regions` and the shard's `stats`
    // entry are two separate captures of the same source, so agreeing across both is what
    // makes "reproduces the shard's own entries exactly" a corpus fact rather than the one
    // hand-checked person the SQL comment cites. Measured 2026-09-04: 49,828 pairs, 0
    // differing.
    //
    // ⚠️ Compared against each row's OWN cycle inside its own `stats` array, and only that.
    // The rest of that array is the pollution this tier removed — measured, 322 (person,
    // cycle) pairs there carry a namesake's extra МИР on top of the person's own regions
    // (e.g. andrey-andreev-1hwlwe's 2014 entry lists Бургас AND Шумен where his own row
    // lists only Бургас) — so a gate comparing the arc against the WHOLE array would be
    // asserting the defect. That direction is measured by the sentinel below instead.
    //
    // It rests on the RETIRED `stats` column, so it retires itself — and skips with its own
    // reason rather than passing vacuously, because "no evidence" must never read as
    // "verified".
    const [have] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_election_stats
        WHERE jsonb_array_length(COALESCE(stats, '[]'::jsonb)) > 0`,
    );
    if (Number(have.n) === 0) {
      console.warn(
        "person_elections shard-fidelity: SKIPPED — the retired `stats` column is empty or gone, so there is nothing independent left to compare the arc against",
      );
      return;
    }
    const [r] = await allRows<{ compared: string; differ: string }>(`
      WITH own_entry AS (
        SELECT e.person_id, e.election_date AS cycle,
               (SELECT jsonb_agg(jsonb_build_array(y->>'oblast', y->>'pref', y->>'preferences')
                         ORDER BY y->>'oblast')
                  FROM jsonb_array_elements(z->'preferences') y) AS shard_prefs,
               (SELECT jsonb_agg(jsonb_build_array(x->>'oblast', x->>'pref', x->>'totalVotes')
                         ORDER BY x->>'oblast')
                  FROM jsonb_array_elements(e.regions) x) AS derived_prefs
          FROM person_election_stats e, jsonb_array_elements(e.stats) z
         WHERE z->>'elections_date' = e.election_date
           AND jsonb_array_length(e.regions) > 0
           AND jsonb_array_length(COALESCE(z->'preferences', '[]'::jsonb)) > 0
      )
      SELECT count(*) AS compared,
             count(*) FILTER (
               WHERE shard_prefs::text IS DISTINCT FROM derived_prefs::text) AS differ
        FROM own_entry`);
    assert.ok(
      Number(r.compared) > 10_000,
      `only ${r.compared} cycles could be compared against the shard`,
    );
    assert.equal(
      Number(r.differ),
      0,
      `${r.differ} cycles where the derived arc disagrees with the shard's own entry`,
    );
  },
);

test.skipIf(skip)(
  "SENTINEL: the retired `stats` column still carries the defect it was retired for",
  async () => {
    // Not a mutation check — it measures the CORPUS, not the implementation: would reading
    // `stats` still publish other people's cycles? If this ever reports ~zero, the gates
    // above have stopped discriminating and the reason is that the corpus got clean, not
    // that the fix works. (What proves the gates fail on a reverted derivation is that they
    // read `person_elections()`, whose body is the thing under test.)
    const [r] = await allRows<{
      foreign_bars: string;
      people: string;
      inflated_cycles: string;
    }>(`
      WITH pub AS (
        SELECT person_id FROM person
         WHERE status = 'active' AND is_public_figure
      ),
      longest AS (
        SELECT DISTINCT ON (e.person_id) e.person_id, e.stats
          FROM person_election_stats e JOIN pub USING (person_id)
         ORDER BY e.person_id, jsonb_array_length(e.stats) DESC, e.election_date DESC
      ),
      drawn AS (
        SELECT l.person_id, e->>'elections_date' AS cycle
          FROM longest l, jsonb_array_elements(l.stats) e
         WHERE jsonb_array_length(COALESCE(e->'preferences', '[]'::jsonb)) > 0
      ),
      cross_cycle AS (
        SELECT count(*) AS n, count(DISTINCT d.person_id) AS people
          FROM drawn d
          LEFT JOIN person_election_stats o
                 ON o.person_id = d.person_id AND o.election_date = d.cycle
         WHERE o.election_date IS NULL
      ),
      -- The SECOND direction, and the reason the fidelity gate above compares own-cycle
      -- entries only: within a cycle the shard array also carries a namesake's extra МИР on
      -- top of the person's own regions.
      within_cycle AS (
        SELECT count(*) AS n FROM (
          SELECT e.person_id, e.election_date
            FROM person_election_stats e
            JOIN pub USING (person_id), jsonb_array_elements(e.stats) z
           WHERE z->>'elections_date' <> e.election_date
             AND EXISTS (
                   SELECT 1 FROM person_election_stats o
                    WHERE o.person_id = e.person_id
                      AND o.election_date = z->>'elections_date'
                      AND jsonb_array_length(o.regions)
                          < jsonb_array_length(COALESCE(z->'preferences', '[]'::jsonb)))
           GROUP BY 1, 2
        ) x
      )
      SELECT (SELECT n FROM cross_cycle) AS foreign_bars,
             (SELECT people FROM cross_cycle) AS people,
             (SELECT n FROM within_cycle) AS inflated_cycles`);
    assert.ok(
      Number(r.foreign_bars) > 1000,
      `the shard column now yields only ${r.foreign_bars} foreign bars — the gates above may no longer discriminate`,
    );
    // Both directions must still be visible. The within-cycle one is what makes the
    // fidelity gate's own-cycle restriction necessary rather than merely convenient.
    assert.ok(
      Number(r.inflated_cycles) > 0,
      "the shard array no longer inflates any cycle's region list — re-check the fidelity gate's restriction",
    );
  },
);
