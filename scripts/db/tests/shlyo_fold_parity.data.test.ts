// TypeScript and Postgres fold the SAME query to the SAME string.
//
// `gen_sql/shlyo_query_fold.test.ts` proves the checked-in SQL matches what the generator
// emits. That is a different claim from this one, and neither implies the other: the
// generator could emit SQL that is faithful to the table and still means something else,
// because it is a different regex ENGINE. Postgres uses POSIX ARE and JavaScript uses
// ECMAScript, and they agree on most of the syntax the rules use — right up until they do
// not:
//
//   - `a|ab` on "ab": ARE prefers the LONGEST overall match, ECMAScript the FIRST
//     alternative. Both engines accept the pattern. (Banned in shlyoRules.test.ts, which
//     is a guard against writing one, not a proof that the ones we have agree.)
//   - `\b`: a word boundary in ECMAScript, a BACKSPACE character in ARE.
//   - a `lower()` on one side only — which is exactly what T1.2 shipped and had to remove,
//     and which no all-lowercase corpus can detect.
//
// So this compares the two implementations directly, over a corpus chosen to include the
// shapes that have actually broken: mixed case, `c`/`h` adjacency, the ordered pairs, and
// real names out of the corpus the routes serve.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { SHLYO_TRIGGER, applyShlyoRules } from "@/lib/shlyoRules";

afterAll(async () => {
  await end();
});

/** Every string up to `len` over `alpha`. Small alphabet, so this stays in the thousands. */
const exhaustive = (alpha: string, len: number): string[] => {
  const out: string[] = [];
  const walk = (s: string): void => {
    if (s) out.push(s);
    if (s.length === len) return;
    for (const c of alpha) walk(s + c);
  };
  walk("");
  return out;
};

/** One round trip per batch instead of per string — 3k single-statement queries against a
 *  pooled connection is minutes, and the same work as one unnest is milliseconds. */
const foldAll = async (inputs: string[]): Promise<string[]> => {
  const rows = await allRows<{ i: string; f: string }>(
    `SELECT ord::text AS i, shlyo_query_fold(v) AS f
       FROM unnest($1::text[]) WITH ORDINALITY AS t(v, ord)`,
    [inputs],
  );
  const byIdx = new Map(rows.map((r) => [Number(r.i) - 1, r.f]));
  return inputs.map((_, i) => byIdx.get(i) ?? "");
};

const parity = async (inputs: string[], label: string): Promise<void> => {
  const sql = await foldAll(inputs);
  const diffs: string[] = [];
  inputs.forEach((v, i) => {
    const ts = applyShlyoRules(v);
    if (sql[i] !== ts)
      diffs.push(`${JSON.stringify(v)} sql=${sql[i]} ts=${ts}`);
  });
  assert.deepEqual(
    diffs.slice(0, 8),
    [],
    `${label}: ${diffs.length}/${inputs.length} disagreements — the SQL and TS folds have diverged`,
  );
};

test("the two folds agree over the alphabet the rules can see", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // 'c' and 'h' are in deliberately: `x → h` after a literal c, and a `ch` the caller's own
  // fold left in place, are the two shapes that broke the client derivation. EVERY VOWEL is
  // in for a second reason — the `y(?![aeiou])` lookahead is the one rule whose behaviour
  // depends on the NEXT character, so an alphabet whose only vowel is `a` exercises one
  // branch of it and calls that coverage.
  await parity(exhaustive("469qjwxychaeiou", 3), "exhaustive/lower");
});

test("the two folds agree on MIXED CASE — the lower() asymmetry", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // T1.2's first draft wrapped the SQL body in lower() while the TS twin did not, so
  // „6T" folded to „shT" in one and „sht" in the other. Both callers pre-fold, so it was
  // invisible; an all-lowercase corpus stays green through it. This one cannot.
  //
  // Mixed-case VOWELS are here for a distinct defect the first draft also missed: a SQL-side
  // `y(?![aeiouAEIOU])` — a plausible "fix" — differs from the TS rule only when an
  // UPPERCASE vowel follows a `y`, and no other corpus in this file produces that pair.
  await parity(exhaustive("6qJX4TyaEiO", 3), "exhaustive/mixed-case");
});

test("the two folds agree on the words readers actually type", async (t) => {
  if (!(await dbReachable())) return t.skip();
  await parity(
    [
      "",
      "6umen",
      "4erven",
      "sofiq",
      "SOFIQ",
      "plowdiw",
      "jelezopyten",
      "6tastie",
      "9nuari",
      "Jelqzkov",
      "jelyazkov",
      "zhelyazkov",
      "yordanov",
      "sofiya",
      "mariya",
      "xubav",
      "cx",
      "basicholding",
      "abemaciclib",
      "keytruda",
      // Non-ASCII and whitespace: neither implementation should touch them, but a
      // regexp_replace with a bad flag or an encoding mismatch would show up here.
      "желязков",
      "ivan petrov",
      "a\tb",
      "a\nb",
      "%_\\'",
    ],
    "typed",
  );
});

test("the two folds agree on real names from the corpus the routes serve", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // The point of a sample from person_search: its name_fold values are what the routes
  // compare against, so any character class the synthetic corpora miss is in here.
  const rows = await allRows<{ name_fold: string }>(
    `SELECT name_fold FROM person_search
      WHERE name_fold <> '' ORDER BY name_fold LIMIT 2000`,
  );
  assert.ok(
    rows.length > 0,
    "person_search is empty on a reachable server — run db:load:person-search:pg. " +
      "Skipping here would hide the only corpus with real name characters in it.",
  );
  await parity(
    rows.map((r) => r.name_fold),
    "person_search sample",
  );
});

test("the fold is the IDENTITY on a needle no rule can rewrite", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // This is what makes the routes' two-probe strategy additive, and it is the part that can
  // actually be asserted here. A first draft instead compared
  // `count(WHERE plain) <= count(WHERE plain OR shlyo)` — a SQL tautology, which passed with
  // the fold mutated to a constant AND to the identity. The real end-to-end additivity
  // belongs to the route that issues both probes, and is asserted there (T1.4); there is no
  // production caller yet.
  //
  // If the fold ever rewrote a rule-free needle, the second probe would stop being a
  // superset of the first and could return DIFFERENT rows rather than more of them.
  const clean = [
    "ivanov",
    "zhelyazkov",
    "sofiya",
    "yordanov",
    "mariya",
    "plovdiv",
    "abemaciclib",
    "georgiev",
    "basicholding",
  ];
  // Assert the fixture IS rule-free rather than assuming it. The first draft listed
  // „keytruda", whose `y` is followed by a consonant — so the ъ rule fires and the string
  // was never a valid example. The test caught its own fixture, which is the only reason
  // this guard exists.
  for (const v of clean)
    assert.ok(
      !SHLYO_TRIGGER.test(v),
      `${v} is not rule-free — it cannot demonstrate identity`,
    );
  const sql = await foldAll(clean);
  clean.forEach((v, i) => {
    assert.equal(
      sql[i],
      v,
      `${v} was rewritten by a fold that should not touch it`,
    );
    assert.equal(applyShlyoRules(v), v);
  });
});

test("the alternate needle actually recovers what the plain one cannot", async (t) => {
  if (!(await dbReachable())) return t.skip();
  // The other half — without this the parity tests above would pass on a fold that did
  // nothing at all. „Jelqzkov" is the measurement the whole tier is built on.
  const [row] = await allRows<{ plain: string; shlyo: string }>(
    `SELECT
       (SELECT count(*) FROM person_search
         WHERE name_fold %> translit_bg_latin($1))                     AS plain,
       (SELECT count(*) FROM person_search
         WHERE name_fold %> shlyo_query_fold(translit_bg_latin($1)))   AS shlyo`,
    ["Jelqzkov"],
  );
  assert.equal(Number(row.plain), 0, "Jelqzkov should miss the plain fold");
  assert.ok(
    Number(row.shlyo) > 0,
    "Jelqzkov should hit through shlyo_query_fold — the fold is not being applied",
  );
});
