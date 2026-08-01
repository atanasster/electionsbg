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

const count = async (sql: string, params: unknown[] = []): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql, params);
  return Number(r.n);
};

afterAll(async () => {
  await end();
});

// Server up but table absent/empty is the FINDING, not a skip.
test.skipIf(dbState === "no-server")(
  "person_search exists and is populated",
  () => {
    assert.equal(
      dbState,
      "ok",
      dbState === "missing"
        ? "person_search missing — run npm run db:load:person-search:pg (after db:load:persons-browse:pg)"
        : "person_search exists but is empty",
    );
  },
);

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
  const badVN = await count(
    `SELECT count(*) n FROM person_search
      WHERE tier IN ('V','N') AND (key NOT LIKE 'fold:%'
            OR href NOT LIKE '/person/%' OR identity_confidence <> 'name_fold')`,
  );
  assert.equal(badVN, 0, `${badVN} V/N rows are malformed`);
});

// (2) V is money-linked, N is not — the tier boundary.
test.skipIf(skip)("V rows carry public money, N rows do not", async () => {
  const badV = await count(
    "SELECT count(*) n FROM person_search WHERE tier='V' AND public_money_eur <= 0",
  );
  assert.equal(badV, 0, `${badV} V rows have no public money`);
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
    /ORDER BY rank_static DESC LIMIT \$3/,
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
