// `search_fund_projects` (086) — the bilingual ИСУН project search.
//
// `fund_projects.title` is raw Cyrillic and this function searched it directly, so a Latin
// keyboard reached NOTHING here while places, people, institutions, companies, contracts and
// tenders all support one. The fix ADDS a folded arm beside the raw one rather than replacing
// the predicate, because folding both sides changes `word_similarity` scores against a
// threshold the function pins at 0.5 — which moves the RANKING and the MEMBERSHIP of every
// existing Cyrillic result, silently.
//
// Every assertion below pins one half of that:
//   1. A CYRILLIC query returns exactly what the raw arm alone returns — the "unchanged"
//      claim, asserted as an invariant rather than against a snapshot nobody can re-take.
//   2. A LATIN query returns rows, AND the raw arm alone returns none for it — so the folded
//      arm is provably doing the work rather than the assertion passing on a coincidence.
//   3. The folded arm rides its expression index, and does NOT run at all for a Cyrillic
//      query (measured 124 ms → 384 ms when it did, for zero extra rows).
//   4. The REINDEX obligation that expression index carries is written down.
//
//   npx vitest run scripts/db/tests/fund_search_fold.data.test.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase, withClient } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MIGRATION = path.join(
  ROOT,
  "scripts/db/schema/pg/086_search_fund_projects.sql",
);

const probe = async (): Promise<"ok" | "no-server" | "missing" | "empty"> => {
  try {
    const [f] = await allRows<{ ok: boolean }>(
      "SELECT to_regprocedure('search_fund_projects(text,int)') IS NOT NULL AS ok",
    );
    if (!f?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM fund_projects WHERE title IS NOT NULL AND title <> ''",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch {
    return "no-server";
  }
};

const dbState = await probe();
const skip =
  dbState === "ok"
    ? false
    : dbState === "no-server"
      ? "Postgres unreachable"
      : dbState === "missing"
        ? "086 not applied — run npm run db:load:funds-fit:pg (or apply_functions.ts 086)"
        : "fund_projects empty — run npm run db:load:funds:pg";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

/** The function's own answer, in order. */
const search = async (q: string, lim = 6): Promise<string[]> =>
  (
    await allRows<{ contract_number: string }>(
      "SELECT contract_number FROM search_fund_projects($1, $2)",
      [q, lim],
    )
  ).map((r) => r.contract_number);

/**
 * The RAW arm alone — this function exactly as it was before the folded arm existed.
 *
 * ⚠️ THE THRESHOLD IS SPELLED OUT, NOT LEFT TO THE GUC, AND THAT IS WHAT MAKES THIS THE
 * PRE-CHANGE BODY RATHER THAN A LOOKALIKE. `<%` is `word_similarity(…) >= threshold`, the
 * function pins 0.5 via `SET pg_trgm.word_similarity_threshold`, and an ad-hoc query here
 * inherits pg_trgm's 0.6 DEFAULT instead — a materially different predicate. Measured:
 * „саниране" has 209 candidates at 0.5 and 47 at 0.6. The comparison below passed anyway at
 * `LIMIT 6` because the top rows clear both, i.e. it was an ACCIDENTAL pass; at `lim = 60`
 * the two disagree outright.
 *
 * A `SET LOCAL` cannot be prepended — `allRows` runs each call on a pooled connection with no
 * transaction affinity — so the value is written into the predicate.
 */
const WORD_SIM_THRESHOLD = 0.5;

const rawArmOnly = async (q: string, lim = 6): Promise<string[]> =>
  (
    await allRows<{ contract_number: string }>(
      `SELECT f.contract_number
         FROM fund_projects f
        WHERE f.title IS NOT NULL AND f.title <> ''
          AND word_similarity($1, f.title) >= $3
        ORDER BY word_similarity($1, f.title) DESC,
                 f.total_eur DESC NULLS LAST,
                 f.contract_number
        LIMIT $2`,
      [q, lim, WORD_SIM_THRESHOLD],
    )
  ).map((r) => r.contract_number);

// Ordinary Bulgarian search words, chosen to span the corpus rather than to be easy.
const CYRILLIC = [
  "ремонт",
  "енергийна ефективност",
  "обучение",
  "саниране",
  "пътища",
  "водоснабдяване",
  // ⚠️ „оса" IS THE GATE'S OWN TEST CASE, and without it this whole file passes with the gate
  // removed. It is a short word whose fold („osa") matches DIFFERENT titles: measured, an
  // ungated folded arm changes 5 of the 6 rows returned. That makes the gate a CORRECTNESS
  // property, not merely a cost one — the „a Cyrillic result set is unchanged" claim is true
  // only because the folded arm does not run for a Cyrillic query.
  "оса",
  // Mixed script: the Cyrillic character is what decides, so the folded arm must stay off
  // even though most of the query is Latin.
  "ремонт 2024",
];

test.skipIf(skip)(
  "a Cyrillic query returns EXACTLY the raw arm's rows, in the raw arm's order",
  async () => {
    // The whole safety argument for adding an arm rather than replacing the predicate. A
    // snapshot would rot with the corpus; this is the invariant that makes it true.
    let nonEmpty = 0;
    for (const q of CYRILLIC) {
      const [now, before] = await Promise.all([search(q), rawArmOnly(q)]);
      assert.deepEqual(
        now,
        before,
        `"${q}" no longer returns what the raw arm alone returns — the folded arm has ` +
          "started changing existing Cyrillic results, which is what its gate prevents",
      );
      if (now.length) nonEmpty += 1;
    }
    assert.ok(
      nonEmpty >= CYRILLIC.length - 1,
      `only ${nonEmpty}/${CYRILLIC.length} Cyrillic probes matched anything — the corpus or ` +
        "the threshold has moved and this gate is comparing two empty sets",
    );
  },
);

test.skipIf(skip)(
  "a Latin query returns rows the raw arm cannot find",
  async () => {
    // Two-sided on purpose: "returns rows" alone would pass on an implementation that had
    // quietly reverted, if the raw arm happened to match the Latin string.
    const LATIN = [
      ["remont", "ремонт"],
      ["obuchenie", "обучение"],
      ["saniraneto", "саниране"],
    ] as const;
    for (const [latin, cyrillic] of LATIN) {
      const [folded, raw, cyr] = await Promise.all([
        search(latin),
        rawArmOnly(latin),
        search(cyrillic),
      ]);
      assert.equal(
        raw.length,
        0,
        `"${latin}" matches the RAW Cyrillic titles directly — pick a probe that does not, ` +
          "or this test proves nothing about the folded arm",
      );
      assert.ok(
        folded.length > 0,
        `"${latin}" returns nothing — the folded arm is not reaching Cyrillic titles`,
      );
      assert.ok(
        cyr.length > 0,
        `"${cyrillic}" returns nothing — the probe pair is not comparable`,
      );
    }
  },
);

/**
 * EXPLAIN the DEPLOYED body — read out of the catalogue, not copied into this file.
 *
 * ⚠️ AN INLINED COPY TESTS THE COPY. The first cut of this file re-declared the two arms in
 * its own SQL, so replacing the gate with `WHERE true` in the migration, applying it and
 * re-running left all five tests GREEN — the one test whose whole subject is the gate was
 * asserting against its own restatement of it.
 *
 * `EXPLAIN SELECT * FROM search_fund_projects(…)` does not help either: a SQL function that is
 * not inlined shows as a bare `Function Scan` with no inner nodes at all. So the body comes
 * from `pg_get_functiondef` and the two parameters are substituted into it — the plan then
 * belongs to whatever is actually deployed.
 */
const plan = async (q: string, lim = 6): Promise<string> => {
  const [d] = await allRows<{ def: string }>(
    "SELECT pg_get_functiondef('search_fund_projects(text,int)'::regprocedure) AS def",
  );
  const body = d.def.slice(
    d.def.indexOf("$function$") + "$function$".length,
    d.def.lastIndexOf("$function$"),
  );
  // ⚠️ ONE CONNECTION, because the threshold is a function ATTRIBUTE (`SET
  // pg_trgm.word_similarity_threshold` on the CREATE, not inside the body) and extracting the
  // body leaves it behind. `allRows` pools per call and cannot carry a preceding SET, so the
  // plan would be measured at pg_trgm's 0.6 default against a function that runs at 0.5.
  return withClient(async (c) => {
    await c.query(
      `SET pg_trgm.word_similarity_threshold = ${WORD_SIM_THRESHOLD}`,
    );
    const r = await c.query(
      `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${body
        .replace(/\bq\b/g, "$1")
        .replace(/\blim\b/g, "$2")}`,
      [q, lim],
    );
    return r.rows.map((x) => Object.values(x)[0]).join("\n");
  });
};

/** The largest `shared hit+read` on any node — the portable cost signal. */
const maxBuffers = (text: string): number =>
  Math.max(
    0,
    ...[...text.matchAll(/Buffers: shared[^\n]*/g)].map((m) => {
      const hit = Number(m[0].match(/hit=(\d+)/)?.[1] ?? 0);
      const read = Number(m[0].match(/read=(\d+)/)?.[1] ?? 0);
      return hit + read;
    }),
  );

test.skipIf(skip)(
  "the folded arm rides its expression index, and a Cyrillic query does not run it at all",
  async () => {
    const latin = await plan("remont");
    assert.match(
      latin,
      /Bitmap Index Scan on idx_fund_projects_title_fold_trgm/,
      `the folded arm is not using its expression index:\n${latin}`,
    );
    assert.ok(
      !/Seq Scan on fund_projects/.test(latin),
      `the folded arm fell to a sequential scan:\n${latin}`,
    );

    // ⚠️ For a CYRILLIC needle the folded arm must not execute. Measured: it returns exactly
    // the same 701 candidates the raw arm does (at the pinned 0.5) and contributes ZERO rows,
    // while the lossy gin recheck re-evaluates translit_bg_latin(title) on every one of them —
    // „енергийна ефективност" went 124 ms to 384 ms. And on „оса" it CHANGES the answer.
    for (const q of ["ремонт", "оса", "ремонт 2024"]) {
      const cyr = await plan(q);
      const lines = cyr.split("\n");
      const foldNode = lines.findIndex((l) =>
        l.includes("idx_fund_projects_title_fold_trgm"),
      );
      assert.ok(
        foldNode === -1 || /never executed/.test(lines[foldNode]),
        `the folded arm ran for the Cyrillic query "${q}" — it adds no rows, costs 3x, and ` +
          `on „оса" changes the result:\n${cyr}`,
      );
    }
  },
);

// TEST-002: the cost, as buffers rather than milliseconds. The LIMIT sits in front of the
// join-back for this reason — with it below, `best` handed every candidate to a PK lookup and
// „енергийна ефективност" read 22,624 buffers to return 6 rows. Wall-clock hid it locally
// (120 ms → 145 ms) because everything is in shared_buffers, which is why this is a buffer
// ceiling and not a timing.
test.skipIf(skip)("the search stays inside its buffer budget", async () => {
  // Measured 2026-09-02: 2,424 / 2,142 / 1,444 / 1,300 against a single-arm 1,268 / 509 /
  // 493 / 431. The ceiling is ~2x the worst measured value and an order of magnitude below
  // the pre-pushdown 22,624, so it discriminates the regression without failing on drift.
  for (const q of ["енергийна ефективност", "обучение", "ремонт", "remont"]) {
    const text = await plan(q);
    const n = maxBuffers(text);
    assert.ok(
      n > 0,
      `no buffer counters in the plan for "${q}" — the parser has stopped measuring:\n${text}`,
    );
    assert.ok(
      n <= 5_000,
      `"${q}" read ${n} buffers (ceiling 5,000) — most likely the LIMIT has moved behind the ` +
        `join-back again:\n${text}`,
    );
  }
});

// The expression index carries a maintenance obligation nothing else in this repo enforces,
// and the file that would be expected to carry it does not.
test("086 records the REINDEX obligation its expression index creates", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_fund_projects_title_fold_trgm[\s\S]*translit_bg_latin\(title\) gin_trgm_ops/,
    "086 must create the folded expression index the second arm rides",
  );
  assert.match(
    sql,
    /REINDEX INDEX/,
    "086 must record that an expression index over translit_bg_latin needs a REINDEX when " +
      "that function's body changes — 176_translit_homoglyph_refold does NOT touch expression " +
      "indexes, and Postgres does not reindex on an IMMUTABLE body change",
  );
  // The refold migration recomputes STORED folds and one loader-written column. If it ever
  // grows an expression-index arm, this gate should point at it instead of at 086's comment.
  const refold = readFileSync(
    path.join(ROOT, "scripts/db/schema/pg/176_translit_homoglyph_refold.sql"),
    "utf8",
  );
  // NOT an assertion that 176 stays broken — a REINDEX arm there is the better home for this
  // and should not fail a gate. It only requires the obligation to live in ONE of the two.
  assert.ok(
    /REINDEX/.test(sql) || /REINDEX/.test(refold),
    "neither 086 nor 176 records the REINDEX an expression index over translit_bg_latin needs",
  );
});

// What the arm rank actually guarantees, stated precisely: a folded row may not outrank an
// exact hit AT EQUAL SIMILARITY. A strictly BETTER folded match does displace a weaker raw
// one, by design — measured on the Latin probe `[a-z]`, two of the old top-6 are gone and the
// survivors are re-ordered. „The folded arm may only ever add" is false for a Latin query and
// was the last copy of a claim the plan already retired.
// ⚠️ READ THE DEPLOYED FUNCTION, NOT THE FILE. A grep over the migration passes on a database
// where somebody applied a different body by hand — measured: stripping BOTH the DISTINCT ON
// and the arm rank from the deployed function left the file-grep version 5/5 green.
test.skipIf(skip)(
  "the DEPLOYED function keeps the arm rank and the one-row-per-project fold",
  async () => {
    const [r] = await allRows<{ def: string }>(
      "SELECT pg_get_functiondef('search_fund_projects(text,int)'::regprocedure) AS def",
    );
    assert.match(
      r.def,
      /ORDER BY sim DESC, arm,/,
      "the arm rank must sit below similarity and above the money, or a folded near-match " +
        "outranks the title as published",
    );
    assert.match(
      r.def,
      /DISTINCT ON \(contract_number\)[\s\S]*ORDER BY contract_number, sim DESC, arm/,
      "a title both arms match must collapse to ONE row, keeping the stronger arm",
    );
    assert.match(
      r.def,
      /q !~ '\[.-.\]'|q !~ '\[Ѐ-ӿ\]'/,
      "the folded arm's Cyrillic gate is gone from the deployed function — a Cyrillic query " +
        "now runs it, which costs 3x AND changes the answer on the probe 'оса'",
    );
    assert.match(
      r.def,
      /word_similarity_threshold"? (TO|=) '?0\.5/,
      "the 0.5 threshold is no longer pinned — the function has silently moved to pg_trgm's " +
        "0.6 default and every candidate set changed",
    );
    // …and the file it is supposed to have come from agrees with it.
    const sql = readFileSync(MIGRATION, "utf8");
    assert.match(sql, /ORDER BY sim DESC, arm,/);
    assert.match(sql, /q !~ '\[Ѐ-ӿ\]'/);
  },
);
