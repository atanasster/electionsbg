// person_search (126_person_search.sql) — the single ranked index behind the combined-search
// "person-search" route. Plan: docs/plans/people-connections-phase1-impl-v1.md §S1.
//
// Every assertion pins a SILENT failure — the table builds and the route 200s, but search is
// quietly wrong:
//   1. TIER SEPARATION. rank_static must keep P ≫ V ≫ N, or a dormant namesake outranks the
//      minister the user meant — the exact failure the whole tier design exists to prevent.
//   2. THE ANTI-JOIN. A fold that is already a public person must appear ONLY as its P row, never
//      also as a V/N name-fold row — else the same human shows up twice, once real once fuzzy.
//   3. THE FOLD. A Cyrillic and a Latin spelling of the same name must resolve to one fold, or
//      half the users find nobody.
//   4. THE ROUTE'S ORDER BY. It must order each tier by the precomputed rank_static (the
//      early-stopping index) — a blended sort over all matches was 231 ms on the most common name.
//
// Counts are 2026-07 snapshots; assertions are invariants/ceilings so ±drift does not fail.
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const state = async (): Promise<"ok" | "no-server" | "missing" | "empty"> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_search') IS NOT NULL AS ok",
    );
    if (!t?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_search",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "no-server";
  }
};

const dbState = await state();
const skip = dbState === "no-server" ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql, params);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// Server up but table absent/empty is the FINDING, not a skip.
test.skipIf(skip)("person_search exists and is populated", () => {
  assert.equal(
    dbState,
    "ok",
    dbState === "missing"
      ? "person_search missing — run npm run db:load:person-search:pg (after db:load:persons-browse:pg)"
      : "person_search exists but is empty",
  );
});

// (1) All three tiers present — a build that dropped an arm still populates.
test.skipIf(skip)("all three tiers are populated", async () => {
  for (const t of ["P", "V", "N"] as const) {
    const n = await count(
      "SELECT count(*) n FROM person_search WHERE tier=$1",
      [t],
    );
    assert.ok(n > 1000, `tier ${t} has only ${n} rows`);
  }
});

// (1) TIER SEPARATION — the ranking invariant. rank_static must stratify P ≫ V ≫ N so the route,
// which orders by it, never floats a private namesake above a public figure.
test.skipIf(skip)("rank_static stratifies P > V > N", async () => {
  const [r] = await allRows<{
    p_min: number;
    v_max: number;
    v_min: number;
    n_max: number;
  }>(
    `SELECT min(rank_static) FILTER (WHERE tier='P') AS p_min,
            max(rank_static) FILTER (WHERE tier='V') AS v_max,
            min(rank_static) FILTER (WHERE tier='V') AS v_min,
            max(rank_static) FILTER (WHERE tier='N') AS n_max
       FROM person_search`,
  );
  assert.ok(
    r.p_min > r.v_max,
    `min P rank (${r.p_min}) must exceed max V rank (${r.v_max})`,
  );
  assert.ok(
    r.v_min > r.n_max,
    `min V rank (${r.v_min}) must exceed max N rank (${r.n_max})`,
  );
});

// (2) THE ANTI-JOIN — no fold is both a public person and a name-fold owner row.
test.skipIf(skip)("no name_fold appears in both P and V/N", async () => {
  const dupes = await count(
    `SELECT count(*) n FROM (
       SELECT name_fold FROM person_search WHERE tier='P'
       INTERSECT
       SELECT name_fold FROM person_search WHERE tier IN ('V','N')
     ) z`,
  );
  assert.equal(dupes, 0, `${dupes} folds appear in both P and V/N arms`);
});

// (2) Key + href shape per tier.
test.skipIf(skip)("keys and hrefs are well-formed per tier", async () => {
  const badP = await count(
    `SELECT count(*) n FROM person_search
      WHERE tier='P' AND (key NOT LIKE 'slug:%' OR href NOT LIKE '/person/%')`,
  );
  assert.equal(badP, 0, `${badP} P rows have a malformed key/href`);
  // V/N rows have THREE valid shapes. A private person MINTED from the Commerce Registry
  // carries a 'slug:' key and either 'verified' or — since tr-attribution-basis-v1 §2.6 —
  // 'shared_name', which is the same mint on a fold the registry says several people share.
  // Those are served, not hidden, so they must be findable by name; a name-fold row carries a
  // 'fold:' key + 'name_fold'. All three route to /person/…
  //
  // The rule is stated as "a minted person is slug-keyed", not as a list of the minted
  // identity values, so a fourth value cannot make 4,407 servable pages unfindable while this
  // still passes — which is exactly what the two-value form did when 'shared_name' arrived.
  const badVN = await count(
    `SELECT count(*) n FROM person_search
      WHERE tier IN ('V','N')
        AND (href NOT LIKE '/person/%'
             OR identity_confidence NOT IN ('verified','shared_name','name_fold')
             OR (identity_confidence <> 'name_fold' AND key NOT LIKE 'slug:%')
             OR (identity_confidence = 'name_fold' AND key NOT LIKE 'fold:%'))`,
  );
  assert.equal(badVN, 0, `${badVN} V/N rows are malformed`);
});

// (2) V is money-linked, N is not — the tier boundary. The NAME-FOLD V rows are money>0 by
// construction (money>0 ⇒ V); a VERIFIED private is money-LINKED (selected on it) but its broad
// SUM can round to ~0, so the strict >0 invariant is asserted on the name-fold arm.
test.skipIf(skip)("V rows carry public money, N rows do not", async () => {
  const badV = await count(
    `SELECT count(*) n FROM person_search
      WHERE tier='V' AND identity_confidence='name_fold' AND public_money_eur <= 0`,
  );
  assert.equal(badV, 0, `${badV} name-fold V rows have no public money`);
  const badN = await count(
    "SELECT count(*) n FROM person_search WHERE tier='N' AND public_money_eur > 0",
  );
  assert.equal(badN, 0, `${badN} N rows carry public money`);
});

// (3) THE FOLD — a Cyrillic spelling and its Latin transliteration collapse to one search key.
// A function property, so it needs no data fixture: assert the fold is spelling-invariant, then
// that a self-selected real fold matches itself equally whether queried Cyrillic or Latin.
test.skipIf(skip)("Cyrillic and Latin queries fold identically", async () => {
  const [r] = await allRows<{ same: boolean }>(
    "SELECT translit_bg_latin('Иван Иванов') = translit_bg_latin('Ivan Ivanov') AS same",
  );
  assert.equal(r.same, true, "Иван Иванов and Ivan Ivanov must fold the same");
});

// (1) End-to-end: for the MOST COMMON name that has any public figure, the top result by the
// route's ordering is that public figure — not a dormant private namesake. The fixture is
// self-selected (no hardcoded name that could later leave the data) — the most frequent
// name_fold with at least one P row.
test.skipIf(skip)("most common name ranks a public person first", async () => {
  const [top] = await allRows<{ tier: string }>(
    `WITH q AS (
       SELECT name_fold AS term FROM person_search
        GROUP BY name_fold HAVING bool_or(tier = 'P')
        ORDER BY count(*) DESC LIMIT 1
     )
     SELECT ps.tier FROM person_search ps, q
      WHERE ps.name_fold %> q.term
      ORDER BY ps.rank_static DESC LIMIT 1`,
  );
  assert.equal(
    top?.tier,
    "P",
    "the top-ranked match for the most common name must be public",
  );
});

// (4) THE ROUTE'S ORDER BY — asserted against source, because a regression to a blended sort
// over all matches (the 231 ms path) is invisible to a data assertion: it returns the same rows.
test("person-search route orders each tier by rank_static", () => {
  const src = readFileSync(path.join(ROOT, "functions/db_routes.js"), "utf8");
  assert.match(
    src,
    /ORDER BY rank_static DESC LIMIT \$2/,
    "the per-tier query must order by the precomputed rank_static (the early-stopping index), not a blended per-row score over all matches",
  );
});

// The migration must ship the (tier, rank_static DESC) index the route depends on for its
// early-stop, and the loader must be wired into db:refresh after persons-browse.
test("126 ships the rank index and the loader is wired into db:refresh", () => {
  const mig = readFileSync(
    path.join(ROOT, "scripts/db/schema/pg/126_person_search.sql"),
    "utf8",
  );
  assert.match(
    mig,
    /idx_person_search_rank[\s\S]*\(tier, rank_static DESC/,
    "126 must create the (tier, rank_static DESC) index the route's early-stop relies on",
  );
  const pkg = readFileSync(path.join(ROOT, "package.json"), "utf8");
  assert.match(
    pkg,
    /db:load:persons-browse:pg && npm run db:load:person-search:pg/,
    "db:refresh must run db:load:person-search:pg right after persons-browse (its P arm reads person_browse_table)",
  );
});

// ── MULTI-WORD NAMES (docs/plans/home-search-expansion-v1.md Phase 1) ──────────────────
//
// A Bulgarian full name is First + Patronymic + Family and the natural search skips the
// patronymic. `%>` is word_similarity(query, name_fold), which scores the query against ONE
// CONTINUOUS EXTENT of the name — so the whole-query form sank on exactly that skip, and the
// Sofia mayor was unfindable by first + family name. The route now ANDs one arm per word.
//
// ⚠️ THESE PROBES REPRODUCE THE ROUTE'S PREDICATE, THEY DO NOT CALL THE ROUTE — the route
// needs a pool this gate does not have. So nothing here would notice a route whose predicate
// had drifted: read them as corpus evidence, never as end-to-end coverage. What ties the two
// together is the source gate at the foot of this file, which asserts the arm expression
// below still appears verbatim in db_routes.js. The SQL SHAPE is pinned by
// functions/db_routes.person_search.test.js.

/** The route's arm list — ONE copy, shared by both probes below, so a drift is one edit
 *  rather than two. `$1` tier, `$2` limit, words from `$3`. */
const fuzzyArms = (words: string[]): string =>
  words
    .map((_, i) => `name_fold %> translit_bg_latin($${i + 3})`)
    .join(" AND ");

/** The route's per-tier fuzzy probe, one `%>` arm per word. */
const tierProbe = async (
  tier: string,
  words: string[],
  limit = 6,
): Promise<{ name: string; primary_role: string | null }[]> => {
  const arms = fuzzyArms(words);
  return allRows<{ name: string; primary_role: string | null }>(
    `SELECT name, primary_role FROM person_search
      WHERE tier = $1 AND ${arms}
      ORDER BY rank_static DESC LIMIT $2`,
    [tier, limit, ...words],
  );
};

// Three spellings of one query — the Latin typo the whole change exists for, the correct
// Latin spelling, and the Cyrillic original. All three must reach the same public row.
test.skipIf(skip)(
  "first + family name finds a three-part public figure, patronymic skipped",
  async () => {
    for (const words of [
      ["vassil", "terziev"],
      ["vasil", "terziev"],
      ["васил", "терзиев"],
    ]) {
      const rows = await tierProbe("P", words);
      const hit = rows.find(
        (r) => /Терзиев/i.test(r.name) && /Васил/i.test(r.name),
      );
      assert.ok(
        hit,
        `"${words.join(" ")}" must reach Васил Александров Терзиев; got ${JSON.stringify(
          rows.map((r) => r.name),
        )}`,
      );
      assert.equal(
        hit!.primary_role,
        "mayor",
        "the row reached must be the mayor, not a namesake",
      );
    }
  },
);

// MUTATION CHECK. The assertion above is satisfied by an implementation that quietly stopped
// tokenising IF the whole-query form happened to match — so prove it does not. Without this
// the gate passes on the bug it was written for.
test.skipIf(skip)(
  "the whole-query form does NOT find him — so the tokenised one is doing the work",
  async () => {
    const rows = await allRows<{ name: string }>(
      `SELECT name FROM person_search
        WHERE tier = 'P' AND name_fold %> translit_bg_latin($1)
        ORDER BY rank_static DESC LIMIT 6`,
      ["vassil terziev"],
    );
    assert.ok(
      !rows.some((r) => /Терзиев/i.test(r.name) && /Васил/i.test(r.name)),
      "the whole-query predicate now matches too — this gate has gone vacuous; re-derive it",
    );
  },
);

// ⚠️ MEASURE THROUGH THE DRIVER, NEVER `PREPARE`. Postgres plans an UNNAMED extended-protocol
// statement at Bind with the real parameter values, which is what lets it estimate
// translit_bg_latin($n)'s selectivity and pick the idx_person_search_rank early-stop.
// node-postgres sends unnamed statements and `allRows` is pool.query, so this measures what
// production runs. The same SQL through PREPARE/EXECUTE reports 190-539 ms and 11,980 buffers
// — a correct implementation looking like a blocker — and psql literals constant-fold to
// 0.46 ms. Neither is the route.
//
// The ceiling is on BUFFERS, not milliseconds: a wall-clock assertion is a flake on CI, and
// the failure this guards against is a plan change (BitmapAnd + full sort instead of the
// early-stop), which shows up as two orders of magnitude of buffers.
const explainPlan = async (
  tier: string,
  words: string[],
): Promise<{ text: string; buffers: number }> => {
  const rows = await allRows<Record<string, string>>(
    `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
     SELECT key, name FROM person_search
      WHERE tier = $1 AND ${fuzzyArms(words)}
      ORDER BY rank_static DESC LIMIT $2`,
    [tier, 6, ...words],
  );
  const text = rows.map((r) => Object.values(r)[0]).join("\n");
  // EXECUTION buffers only. `Planning:` carries its own Buffers line — 299 on a cold
  // catalog cache against 7 for the execution of the fastest case here — so including it
  // makes the metric swing by two orders of magnitude run to run, and any ceiling tight
  // enough to be useful would fail on the first run after a container restart.
  const exec = text.split(/^Planning:/m)[0];
  // ⚠️ MATCH THE TWO COUNTERS INDEPENDENTLY. `show_buffer_usage` prints each only when it
  // is non-zero, so a node whose reads all missed the cache prints `shared read=6936` with
  // no `hit=` at all — and a pattern requiring `hit=` scores that as 0 and passes any
  // ceiling. That is exactly the first `npm run test:data` after `docker compose up`, and
  // it is the worst case that disarms.
  const buffers = Math.max(
    0,
    ...[...exec.matchAll(/Buffers: shared[^\n]*/g)].map((m) => {
      const hit = Number(m[0].match(/hit=(\d+)/)?.[1] ?? 0);
      const read = Number(m[0].match(/read=(\d+)/)?.[1] ?? 0);
      return hit + read;
    }),
  );
  return { text, buffers };
};

// ⚠️ THE CEILINGS ARE SET FROM THE MEASURED HEALTHY VALUE, NOT AT A ROUND NUMBER, and a
// „Seq Scan" assertion is NOT the gate. Verified with `SET enable_indexscan = off`, which is
// how the degraded shape was reproduced: none of the three degrades to a sequential scan —
// all three stay bitmap plans — so a shape assertion alone catches nothing. Only the buffer
// count separates healthy from degraded, and the first draft's round ceilings (3,000 /
// 5,000 / 3,000) passed on two of the three degradations they were written to catch.
//
//   case                healthy   degraded   ceiling
//   N ivan+ivanov             7     11,980       600
//   N ivanov+georgiev       690      1,869     1,200
//   P vassil+terziev        260        260       500   ← see below
//
// ⚠️ `P vassil+terziev` ALREADY plans as BitmapAnd + Sort, on a healthy corpus, at 260
// buffers — tier P is small and both words are rare, so that shape is correct here and
// `enable_indexscan = off` does not change it at all. Its ceiling is the only gate it has,
// and it must never grow a plan-node assertion.
const RANK_EARLY_STOP = /Index Scan using idx_person_search_rank/;

test.skipIf(skip)(
  "the multi-word probe stays indexed and cheap on the corpus's worst shapes",
  async () => {
    const cases: [string, string[], number, boolean][] = [
      // Two individually-common words that DO co-occur — the common-name case, and the one
      // the rank early-stop exists for.
      ["N", ["ivan", "ivanov"], 600, true],
      // …and one where they never do. This is the worst case for that early-stop: the scan
      // walks the tier before it can stop. Still 2.7x cheaper than today's single
      // whole-query arm, which reads 6,936.
      ["N", ["ivanov", "georgiev"], 1_200, true],
      // Small tier, rare pair — legitimately a bitmap plan. Buffers only.
      ["P", ["vassil", "terziev"], 500, false],
    ];
    for (const [tier, words, ceiling, earlyStop] of cases) {
      const { text, buffers } = await explainPlan(tier, words);
      assert.ok(
        !/Seq Scan on person_search/.test(text),
        `${tier} ${words.join("+")} fell to a sequential scan:\n${text}`,
      );
      assert.ok(
        buffers <= ceiling,
        `${tier} ${words.join("+")} read ${buffers} execution buffers (ceiling ` +
          `${ceiling}) — the plan has changed shape:\n${text}`,
      );
      if (earlyStop)
        assert.match(
          text,
          RANK_EARLY_STOP,
          `${tier} ${words.join("+")} lost the rank_static early-stop:\n${text}`,
        );
    }
  },
);

// MUTATION CHECK on the gate itself. The ceilings above are only meaningful if the buffer
// EXTRACTION still works — and its two documented failure modes (a `read=`-only line scoring
// 0, and the Planning line dominating the max) both fail OPEN, i.e. the gate passes while
// measuring nothing. Neither is visible from a green run, so pin the parser directly.
test("the EXPLAIN buffer parser scores both counters and ignores planning", () => {
  const parse = (text: string): number => {
    const exec = text.split(/^Planning:/m)[0];
    return Math.max(
      0,
      ...[...exec.matchAll(/Buffers: shared[^\n]*/g)].map((m) => {
        const hit = Number(m[0].match(/hit=(\d+)/)?.[1] ?? 0);
        const read = Number(m[0].match(/read=(\d+)/)?.[1] ?? 0);
        return hit + read;
      }),
    );
  };
  assert.equal(parse("  Buffers: shared hit=690"), 690);
  assert.equal(parse("  Buffers: shared hit=690 read=8"), 698);
  // The cold-cache line PostgreSQL actually prints when nothing was in shared_buffers. A
  // pattern requiring `hit=` scores this 0 and passes every ceiling.
  assert.equal(parse("  Buffers: shared read=6936"), 6936);
  // Planning is excluded: on a cold catalog cache it is 299 against 7 for execution.
  assert.equal(
    parse(
      "  Buffers: shared hit=7\nPlanning:\n  Buffers: shared hit=291 read=8",
    ),
    7,
  );
});

// The word-qualifying rule has ONE definition, shared with the /persons browse table's
// searchFoldTokens arm. Two copies would mean the two surfaces disagree about which queries
// are multi-word at all — and the substring/trigram difference between their predicates is
// deliberate, so a reviewer diffing them would "fix" the wrong half.
test("the route and the browse table share one word-qualifying rule", () => {
  const src = readFileSync(path.join(ROOT, "functions/db_routes.js"), "utf8");
  assert.match(
    src,
    /qualifyingSearchWords/,
    "the person-search route must use db_table.js's shared word splitter, not a private copy",
  );
  const table = readFileSync(path.join(ROOT, "functions/db_table.js"), "utf8");
  assert.match(
    table,
    /qualifyingSearchWords,/,
    "db_table.js must export the shared word splitter",
  );
  // Two properties, asserted separately, and NEITHER pins a local identifier name: the
  // branch calls the helper, AND the inline splitter it replaced has not come back beside
  // it. The second half is the one that catches a re-introduced copy — a gate matching the
  // whole line would instead fail on a harmless rename of `g` with a message about
  // re-implementation, which is not what went wrong.
  assert.match(
    table,
    /searchFoldTokens \? qualifyingSearchWords\(/,
    "the searchFoldTokens arm must consume the shared splitter rather than re-implementing it",
  );
  // ONE word splitter in the whole file, and it is the shared helper's. A count is the
  // robust form here: matching the exact `for (const w of g.split(/\s+/))` line that was
  // removed would false-fire the day the helper's own body is rewritten in that shape, and
  // a `doesNotMatch` scoped any tighter cannot see a copy re-introduced elsewhere.
  assert.equal(
    (table.match(/\.split\(\/\\s\+\/\)/g) ?? []).length,
    1,
    "db_table.js must contain exactly one whitespace splitter — the shared helper's",
  );
  // …and the probes in THIS file reproduce the route's arm expression, so pin that it still
  // is the route's. Without this the corpus assertions above would keep passing against a
  // route whose predicate had drifted away from what they measure.
  assert.match(
    src,
    /name_fold %> translit_bg_latin\(\$\$\{i \+ FUZZY_WORD_PARAM_1\}\)/,
    "the route's arm shape must match the one this file's probes reproduce",
  );
});
