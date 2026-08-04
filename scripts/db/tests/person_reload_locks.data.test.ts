// The person writers must never take a lock that blocks a serving read.
//
// WHAT REGRESSED. `TRUNCATE t; COPY t …` in one transaction holds an
// AccessExclusiveLock on `t` for the WHOLE rebuild, and AccessExclusive conflicts
// with the AccessShare every SELECT needs. `load_person_elections_pg` did exactly
// that on `candidate_person` + `person_election_stats`, and BOTH sit on the
// serving path — `person_election_stats` is read by `person_by_slug` (082) AND by
// `person_connections` (084) — so one loader run 500'd four routes at once.
// Measured on prod 2026-07-31 (19:08 and 20:58-21:01 UTC): 26 person-elections,
// 24 person-connections, 16 candidate-person, all at ~2.0 s.
//
// ~2.0 s because the serving pool's `lock_timeout: 2000` (functions/index.js,
// added 2026-07-31 with migration 123) converts an unbounded stall into a fast
// 55P03. Before that setting the SAME contention was paid as a ~10 s
// `statement_timeout` instead — which is why this defect looks like it began on
// 07-31 in the logs when only its SYMPTOM did. The timeout is the guard working;
// the defect was always the writer.
//
// The fix is the stage-merge (scripts/db/lib/stage_merge.ts), the same one the
// contracts corpus and the price writers use: build into an UNLOGGED twin nothing
// reads, then upsert + delete-absent under RowExclusiveLock only.
//
// The gate below reads the person serving surface OUT OF the SQL function bodies
// rather than hardcoding it, so a person route that starts reading a TRUNCATEd
// table trips this too. `ALLOWED` is the explicit, shrinking record of every
// writer still on the old pattern — an entry there is debt, not permission, and
// two further tests keep it honest: a stale entry fails, and an "accepted"
// exemption whose loader never explains itself fails.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dbReachable, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const haveDb = await dbReachable();

const REPO = path.resolve(import.meta.dirname, "../../..");

// The migrations defining the functions every /api/db/person-* route calls.
const PERSON_API_SQL = [
  "082_person_api.sql",
  "084_person_connections.sql",
  "085_person_elections.sql",
  "090_person_wealth.sql",
  "092_accumulation_gap.sql",
  "093_declaration_events.sql",
  "105_mp_serving.sql",
];

// Query aliases / CTE names / stray English words that the FROM|JOIN regex picks
// up. Excluded by construction rather than by a "does it exist in pg_class"
// check, so the gate stays runnable with no database.
const NOT_A_TABLE =
  /^(lateral|unnest|the|that|to|today|pick|yrs|subj|subj_co|rel|prev|agg|base|latest|scored|source_row|target|subject|roster|m|f|a|p_c|p_co|cand|eiks|mine|its|inside|over|below|and)$/;

/** Tables the person serving functions SELECT from. */
const servedByPersonRoutes = (): Set<string> => {
  const out = new Set<string>();
  for (const f of PERSON_API_SQL) {
    const p = path.join(REPO, "scripts/db/schema/pg", f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    for (const [, t] of src.matchAll(
      /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi,
    )) {
      const name = t.toLowerCase();
      if (!NOT_A_TABLE.test(name)) out.add(name);
    }
  }
  return out;
};

// Every remaining `TRUNCATE <served table>`, keyed per FILE AND TABLE so a new
// TRUNCATE added to an already-listed loader still trips the gate. Two kinds, and
// the distinction is the point:
//
//   "debt"     — a live instance of the defect above. Remove the entry when the
//                loader moves to a stage merge.
//   "accepted" — a reasoned exemption: the table is tiny enough that the lock is
//                sub-second and the loader is operator-run, so the stall never
//                reaches a reader. The loader must SAY so at the call site.
//
// The declarations family is the big debt and needs a design change first:
// `declaration.declaration_id` is a bigserial reassigned on every load and its
// four child tables key on it, so there is no stable merge key until the family is
// re-keyed on the filing's `source_url` (which the changelog already treats as the
// stable identity).
const ALLOWED = new Map<string, "debt" | "accepted">([
  ["scripts/db/load_declarations_pg.ts: declaration", "debt"],
  ["scripts/db/load_declarations_pg.ts: declaration_asset", "debt"],
  ["scripts/db/load_declarations_pg.ts: declaration_income", "debt"],
  ["scripts/db/load_declarations_pg.ts: declaration_stake", "debt"],
  ["scripts/db/load_declarations_pg.ts: declaration_event", "debt"],
  ["scripts/db/load_mp_roster_pg.ts: mp_profile", "debt"],
  ["scripts/db/load_mp_roster_pg.ts: mp_car", "debt"],
  ["scripts/db/load_funds_pg.ts: fund_beneficiaries", "debt"],
  ["scripts/db/load_funds_pg.ts: fund_projects", "debt"],
  // agri_subsidies was PAID OFF 2026-08-04 (gaps plan T2): the TRUNCATE became
  // an UNLOGGED stage build + one-transaction DELETE+INSERT publish.
  // ~5.7k rows, fingerprinted and usually skipped outright — see the call site.
  ["scripts/db/load_place_dim_pg.ts: place_dim", "accepted"],
  // One row per cabinet (~30) and per court (~200): both well under a second.
  ["scripts/db/load_pg.ts: cabinets", "accepted"],
  ["scripts/db/load_judicial_bodies_pg.ts: judicial_body", "accepted"],
]);

/** Served tables this file TRUNCATEs. Statements are flattened first, so a
 *  `TRUNCATE a,\n  b` is read as both tables rather than just the first. */
const servedTruncatesIn = (rel: string, served: Set<string>): string[] => {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) return [];
  const flat = fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join(" ");
  return [
    ...flat.matchAll(/TRUNCATE\s+(?:TABLE\s+)?([a-z_0-9,\s]+)/gi),
  ].flatMap(([, list]) =>
    list
      .split(",")
      // Each part is `  name` or `  name RESTART IDENTITY CASCADE` — take the
      // leading identifier, or the trailing option words become part of the name
      // and the LAST table in a multi-table TRUNCATE is silently missed.
      .map((s) =>
        (s.trim().match(/^[a-z_][a-z0-9_]*/i)?.[0] ?? "").toLowerCase(),
      )
      .filter((t) => served.has(t)),
  );
};

test("no person writer TRUNCATEs a table the person routes serve", () => {
  const served = servedByPersonRoutes();
  // Sanity: a regex that silently matched nothing would make the gate below
  // vacuously pass. These are the tables this test exists for.
  for (const t of [
    "candidate_person",
    "person_election_stats",
    "person",
    "person_role",
    "declaration",
  ])
    assert.ok(served.has(t), `expected ${t} in the served set (regex drift?)`);

  const files: string[] = [];
  for (const dir of ["scripts/db", "scripts/person", "scripts/agri"]) {
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs, { recursive: true, encoding: "utf8" }))
      if (f.endsWith(".ts") && !f.includes(".test.")) files.push(`${dir}/${f}`);
  }

  const offences: string[] = [];
  for (const rel of files)
    for (const t of servedTruncatesIn(rel, served))
      if (!ALLOWED.has(`${rel}: ${t}`)) offences.push(`${rel}: ${t}`);

  assert.deepEqual(
    offences,
    [],
    `TRUNCATE on a table a person route serves takes an AccessExclusiveLock for ` +
      `the rest of the transaction, so every reader queues behind the whole ` +
      `rebuild and 500s at the pool's lock_timeout. Build into a stage twin and ` +
      `merge instead (scripts/db/lib/stage_merge.ts):\n${offences.join("\n")}`,
  );
});

// The allowlist is only honest if every entry is real. An entry whose TRUNCATE is
// gone is stale and must be dropped, or the map silently grows into a place where
// new debt can hide behind a name that no longer means anything.
test("every ALLOWED entry still has the defect it records", () => {
  const served = servedByPersonRoutes();
  const byFile = new Map<string, string[]>();
  for (const key of ALLOWED.keys()) {
    const [rel, table] = key.split(": ");
    byFile.set(rel, [...(byFile.get(rel) ?? []), table]);
  }
  const stale: string[] = [];
  for (const [rel, tables] of byFile) {
    if (!fs.existsSync(path.join(REPO, rel))) {
      stale.push(`${rel} (file is gone)`);
      continue;
    }
    const found = new Set(servedTruncatesIn(rel, served));
    for (const t of tables)
      if (!found.has(t)) stale.push(`${rel}: ${t} (no such TRUNCATE left)`);
  }
  assert.deepEqual(
    stale,
    [],
    `ALLOWED is stale — these were fixed, so drop them from the map:\n${stale.join("\n")}`,
  );
});

// An "accepted" exemption is only acceptable if the call site says WHY. Without
// that, the next reader cannot tell a reasoned tradeoff from an oversight, and the
// map becomes a place to silence the gate.
test("every 'accepted' exemption justifies itself at the call site", () => {
  const unexplained: string[] = [];
  for (const [key, kind] of ALLOWED) {
    if (kind !== "accepted") continue;
    const [rel] = key.split(": ");
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    if (!/AccessExclusiveLock/.test(src)) unexplained.push(key);
  }
  assert.deepEqual(
    unexplained,
    [],
    `these TRUNCATEs are exempted as tiny/sub-second, but the loader never says ` +
      `so — document the lock tradeoff at the call site or fix it:\n${unexplained.join("\n")}`,
  );
});

// The merge must actually reproduce the corpus TRUNCATE+COPY produced. Row counts
// alone would pass on a merge that dropped the delete half, so this checks the
// live tables agree with each other and carry no unfolded name.
test.skipIf(!haveDb)(
  "candidate_person and person_election_stats are consistent after a merge load",
  async () => {
    const { allRows } = await import("../lib/pg");
    const [r] = await allRows<{
      unfolded: string;
      orphan_stats: string;
      leftover: string;
    }>(
      `SELECT
         (SELECT count(*) FROM candidate_person
           WHERE candidate_name_fold <> translit_bg_latin(candidate_name_fold)) AS unfolded,
         -- Every stats row must belong to a candidacy the same load produced.
         (SELECT count(*) FROM person_election_stats s
           WHERE NOT EXISTS (SELECT 1 FROM candidate_person c
                              WHERE c.person_id = s.person_id
                                AND c.election_date = s.election_date)) AS orphan_stats,
         (SELECT count(*) FROM pg_class
           WHERE relkind = 'r'
             AND relname IN ('candidate_person_stage','person_election_stats_stage')) AS leftover`,
    );
    assert.equal(
      r.unfolded,
      "0",
      "candidate_name_fold was not translit-folded",
    );
    assert.equal(
      r.orphan_stats,
      "0",
      "person_election_stats has rows with no candidate_person — the merge's " +
        "delete half did not run, or the two tables were merged in separate transactions",
    );
    assert.equal(
      r.leftover,
      "0",
      "a stage twin outlived the load — it would reach pg_dump and db:sync:cloud",
    );
  },
);
