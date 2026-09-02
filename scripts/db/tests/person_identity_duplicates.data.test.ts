// The duplicate-identity RATCHET — one human published as two `/person` pages.
//
// This is not a test of a feature. It is a ceiling on a KNOWN, MEASURED defect that the
// home-search expansion made maximally visible and did not cause, kept here so the number
// cannot drift upward unnoticed while nobody is looking at it.
//
// ⚠️ WHAT IT IS. `resolve_persons.ts` unions two mentions of one name only when a tier
// licenses it. For the `official_muni` ↔ `local` pair — a mayor or councillor who appears
// both in the Сметна палата roster and on their own election result — the licences are:
//
//   Tier 1  `weakBoth`      party AND place, both present and equal
//   Tier 1  `sameLocalSeat` local↔local ONLY: `official_muni` carries no `localSeat`
//                           corroborant, so `seatTerm()` is null and the rule cannot fire
//                           across the two sources at all
//   Tier 1  `samePartyOffice` needs a NATIONAL party office; it fires for a handful here
//   Tier 2a same unique full name (`namesake_risk <= 1`)
//   Tier 2b register-anchored — and its condition 3 REFUSES a `local`-only component by
//           design, because a council roll implies no filing (see cluster.ts)
//
// (Tier 0 and the `shareUic` / `birthDate` arms of `strongPair` are omitted from that list
// because neither source carries a gold key, a company EIK or a birth date. §2.7 of the plan
// says the same thing at length.)
//
// So in practice the pair merges on Tier 2a or not at all. Measured 2026-09-02 over the
// whole corpus, identical on local Postgres and on Cloud SQL:
//
//   folds spanning both sources that MERGE   4,033 — of which 4,027 (99.9%) namesake_risk <= 1
//   folds spanning both sources that SPLIT   1,211 — of which    21 ( 1.7%) namesake_risk <= 1
//
// ⚠️ THE DISCRIMINATOR IS `namesake_risk`, AND IT DOES NOT COUNT PEOPLE. It is
// `officer_name_counts.company_count` — how many COMPANIES an officer of this name appears
// on — which cluster.ts's own Tier 2a comment already says is the wrong number ("it refuses
// a man for sitting on two boards"). A mayor who sits on two boards is therefore split from
// their own officials record, which is exactly why Васил Александров Терзиев, a businessman,
// is published twice as mayor of Столична община.
//
// ⚠️ IT IS A CLASS, NOT A CASE, so `person_link_override` is the wrong instrument. 1,101 of
// the 1,211 split folds carry an IDENTICAL (fold, role, place_code) triple across the two
// sources — one name, one office, one place — which is the same exclusivity argument
// `sameLocalSeat` already rests on ("a село has ONE кмет"), applied across the two sources
// instead of across two cycles. Closing it is a resolver tier and belongs in scripts/person/
// with its own gate; docs/plans/home-search-expansion-v1.md §2.6-2.7 / Phase 2a records the
// decision to scope it out of the home-search work rather than ship 1,211 adjudications.
//
// ⚠️ THE ASSERTIONS PULL IN TWO DIRECTIONS ON PURPOSE, and that is not decoration — it is
// the house rule `local_person_continuity.data.test.ts` states two files away: "a gate in
// only one of those directions would be satisfied by disabling the rule". A CEILING alone
// reads every corpus regression as progress. Measured on this very file's first cut: a
// coarser fold takes splitFolds to 481 and losing half the local roles takes it to 658 —
// both comfortably under 1,211, both reported as green, and the header then tells the
// operator to re-cut the ceiling and lock the regression in. Over-merging in the resolver —
// the defamation-critical direction `person_resolve.data.test.ts` polices — has the same
// signature. So every ceiling here is paired with a FLOOR on its own denominator.
//
// TO RE-DERIVE ANY NUMBER BELOW, run this file's queries against the database directly; each
// `scalar()` call is the whole derivation. The figures were taken on a full `db:refresh`
// corpus and re-taken through the Cloud SQL proxy the same day.
//
//   npx vitest run scripts/db/tests/person_identity_duplicates.data.test.ts

import { readFileSync } from "node:fs";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end, pinLocalDatabase } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { stripComments } from "../../lib/strip_comments";

// ⚠️ Pinned to LOCAL, and the reason is not "the numbers are the same". They were, on
// 2026-09-02, on every figure here — but that is a point-in-time fact about two corpora, not
// a property, and the two databases drift by design (CLAUDE.md's person-chain section
// measures ~1% of tr/ngo roles apart). The pin is here so that a
// `DATABASE_URL=…:5434 npx vitest` run cannot report LOCAL numbers under a cloud URL, which
// is the trap graph.data.test.ts documents. To measure cloud, query it directly.
pinLocalDatabase();

/**
 * Ceilings, not equalities. Measured 2026-09-02.
 *
 * A number that FALLS is only the fix landing if its FLOOR below still holds — that pairing
 * is the whole design (see the header). Re-cut a ceiling ONLY after checking the floors, and
 * say so in docs/plans/home-search-expansion-v1.md §2.6.
 */
const CEILINGS = {
  /** Name folds holding an `official_muni` AND a `local` role on ≥2 person rows. */
  splitFolds: 1211,
  /**
   * (fold, role, place_code) TRIPLES naming two person rows across the two sources — one
   * name, one office, one place. The population a cross-source seat rule would close.
   *
   * ⚠️ A COUNT OF TRIPLES, NOT OF FOLDS, and the two differ: those 1,127 triples fall on
   * **1,101** distinct folds (one person split across two offices contributes two triples).
   * 1,101/1,211 = 90.9% is the coverage figure §2.7 quotes; 1,127 is what this ceiling
   * counts. Naming both is deliberate — they were briefly one number in two places.
   */
  exactSignatureTriples: 1127,
  /** `person_search` P rows sitting in a same-(fold, place_label, primary_role) cluster of
   *  more than one — what a reader actually sees, in the finder and on /persons. */
  duplicateSearchRows: 4766,
} as const;

/**
 * Floors on the DENOMINATORS the ceilings above are a share of. Bands, not equalities, so
 * ordinary corpus movement does not fail them while a fold regression, a lost source or an
 * over-merging resolver does.
 */
const FLOORS = {
  /** Folds holding BOTH sources at all — the population the first two ceilings live in. */
  crossSourceFolds: 5244,
  /** `person_role` rows in scope. */
  scopedRoleRows: 31966,
  /** `person_search` tier-P rows — the denominator of the 4,766. */
  searchPRows: 63836,
} as const;

/** How far a denominator may fall before a lower numerator stops counting as progress. */
const FLOOR_BAND = 0.95;

const probe = async (): Promise<
  "ok" | "no-server" | "missing" | "empty" | { err: string }
> => {
  let up = false;
  try {
    await allRows("SELECT 1");
    up = true;
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.person') IS NOT NULL
          AND to_regclass('public.person_role') IS NOT NULL AS ok`,
    );
    if (!t?.ok) return "missing";
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source IN ('official_muni','local')",
    );
    return Number(c.n) > 0 ? "ok" : "empty";
  } catch (e) {
    // ⚠️ Only a failure of the FIRST query means "no server". Reporting every throw as
    // unreachable is how a reachable-but-broken install (a missing column, a revoked GRANT)
    // comes to print "skipped" against a fully loaded corpus — the positional boundary
    // scripts/db/lib/pg.ts's own header argues for.
    if (!up) return "no-server";
    return { err: e instanceof Error ? e.message : String(e) };
  }
};

const dbState = await probe();
// A server that is up but has no person layer is a SKIP: this gate is a ceiling on a defect,
// and an unresolved database has no defect to measure. It is the one place a `0` must not
// read as success — hence the floors and the non-vacuity assertions below.
const skip =
  dbState === "ok"
    ? false
    : dbState === "no-server"
      ? "Postgres unreachable"
      : dbState === "missing" || dbState === "empty"
        ? "person layer not resolved — run npm run db:resolve:persons"
        : false; // a broken install FAILS below rather than skipping
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the person layer probe succeeded", () => {
  assert.equal(
    typeof dbState === "string" ? dbState : dbState.err,
    "ok",
    "the database is reachable but the probe threw — a broken install, not an absent one",
  );
});

const scalar = async (sql: string): Promise<number> => {
  const [r] = await allRows<{ n: string }>(sql);
  return Number(r.n);
};

/**
 * The two sources this gate is about.
 *
 * ⚠️ `p.name_fold`, the STORED column, NOT `translit_bg_latin(p.display_name)`. Re-deriving
 * looks like the more independent choice and is the less faithful one: the stored value is
 * the fold the RESOLVER partitioned on, while the function is mid-migration in this repo
 * (`000_search_fns.sql` + `176_translit_homoglyph_refold.sql` are an outstanding two-part
 * change on Cloud SQL, and CLAUDE.md states that until the refold lands the function's output
 * and the stored folds disagree). The moment they diverge, a re-deriving gate silently
 * partitions names into a DIFFERENT equivalence class than the resolver did — and all three
 * numbers move for a reason that has nothing to do with identity, in a file whose whole job
 * is to notice when they move. Reading the column also drops an undeclared dependency on 000.
 */
const CROSS_SOURCE = `
  WITH r AS (
    SELECT p.person_id, p.namesake_risk, p.name_fold AS fold,
           pr.source, pr.role, pr.place_code
      FROM person p JOIN person_role pr USING (person_id)
     WHERE pr.source IN ('official_muni', 'local')
  )`;

/** A ceiling is only evidence while its denominator holds. */
const assertFloor = (label: string, actual: number, floor: number): void =>
  assert.ok(
    actual >= floor * FLOOR_BAND,
    `${label} is ${actual}, against ${floor} when the ceilings were cut — the POPULATION ` +
      "shrank, so a lower numerator is not evidence of a fix. Check the fold, the sources " +
      "and the resolver before re-cutting anything.",
  );

test.skipIf(skip)(
  "the official_muni ↔ local identity split does not grow",
  async () => {
    const denom = await scalar(`${CROSS_SOURCE}
      SELECT count(*) n FROM (
        SELECT fold FROM r GROUP BY fold HAVING count(DISTINCT source) > 1) z`);
    const rows = await scalar(
      "SELECT count(*) n FROM person_role WHERE source IN ('official_muni','local')",
    );
    assertFloor("cross-source folds", denom, FLOORS.crossSourceFolds);
    assertFloor("scoped person_role rows", rows, FLOORS.scopedRoleRows);

    const n = await scalar(`${CROSS_SOURCE}
      SELECT count(*) n FROM (
        SELECT fold FROM r GROUP BY fold
         HAVING count(DISTINCT person_id) > 1 AND count(DISTINCT source) > 1) z`);
    assert.ok(
      n > 0,
      "zero split folds — either the resolver tier landed (re-cut the ceiling, and say so " +
        "in docs/plans/home-search-expansion-v1.md §2.6) or this gate has gone vacuous",
    );
    assert.ok(
      n <= CEILINGS.splitFolds,
      `${n} name folds are split across official_muni/local, up from ${CEILINGS.splitFolds}. ` +
        "One human is published as two /person pages for each of them.",
    );
  },
);

test.skipIf(skip)(
  "the identical (name, role, place) signature does not grow",
  async () => {
    const denom = await scalar(`${CROSS_SOURCE}
      SELECT count(*) n FROM (
        SELECT fold FROM r GROUP BY fold HAVING count(DISTINCT source) > 1) z`);
    assertFloor("cross-source folds", denom, FLOORS.crossSourceFolds);

    const n = await scalar(`${CROSS_SOURCE}
      SELECT count(*) n FROM (
        SELECT fold, role, place_code FROM r GROUP BY fold, role, place_code
         HAVING count(DISTINCT person_id) > 1 AND count(DISTINCT source) > 1) z`);
    assert.ok(n > 0, "zero exact signatures — see the non-vacuity note above");
    assert.ok(
      n <= CEILINGS.exactSignatureTriples,
      `${n} (name, role, place) triples name two person rows, up from ` +
        `${CEILINGS.exactSignatureTriples}`,
    );
  },
);

test.skipIf(skip)(
  "what a reader sees — duplicate P rows in the search index — does not grow",
  async () => {
    // person_search is a DERIVED index with its own loader, so its absence says nothing about
    // the resolver. Skipped explicitly rather than by an early `return`, which vitest reports
    // as a PASS — a green line for a check that never ran.
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.person_search') IS NOT NULL AS ok",
    );
    const built = t?.ok
      ? await scalar("SELECT count(*) n FROM person_search WHERE tier = 'P'")
      : 0;
    if (!built) {
      // ⚠️ `import.meta.url` BARE, not `${import.meta.url}#search`. `gateName` resolves the
      // argument through `fileURLToPath`, which drops the fragment — so the suffix bought no
      // disambiguation, printed the same label as the module-scope call above it, and
      // hand-typed part of a value the API requires to be derived. The reason names the arm.
      reportSkip(
        import.meta.url,
        "person_search not built — run npm run db:load:person-search:pg",
      );
      return;
    }
    assertFloor("person_search tier-P rows", built, FLOORS.searchPRows);

    const n = await scalar(`
      SELECT coalesce(sum(c), 0) n FROM (
        SELECT count(*) c FROM person_search WHERE tier = 'P'
         GROUP BY name_fold, coalesce(place_label, ''), coalesce(primary_role, '')
        HAVING count(*) > 1) z`);
    assert.ok(n > 0, "zero duplicate P rows — see the non-vacuity note above");
    assert.ok(
      n <= CEILINGS.duplicateSearchRows,
      `${n} public rows sit in a same-(name, place, role) duplicate cluster, up from ` +
        `${CEILINGS.duplicateSearchRows} — the home finder and /persons both show these`,
    );
  },
);

// THE DIAGNOSIS, pinned. Without this the ratchets above are three numbers with no
// explanation, and the next person to look at them re-derives the whole investigation — or,
// worse, reaches for `person_link_override` because 1,211 rows look like 1,211 decisions.
//
// The claim: the folds that MERGE are overwhelmingly Tier-2a eligible and the folds that
// SPLIT are overwhelmingly not, i.e. the discriminator is `namesake_risk` and nothing else.
// If that ever stops being true, some OTHER tier has started carrying these merges and the
// argument recorded above — and in the plan — needs re-deriving before it is quoted again.
//
// TWO-SIDED, like the ratchets: a bound on only the split side is satisfied by a resolver
// that has stopped merging anything.
test.skipIf(skip)(
  "the split is explained by namesake_risk (Tier 2a), not by party or place",
  async () => {
    const [r] = await allRows<{
      merged: string;
      merged_unique: string;
      split: string;
      split_unique: string;
    }>(`${CROSS_SOURCE}, k AS (
        SELECT fold,
               count(DISTINCT person_id) > 1 AS is_split,
               max(namesake_risk) AS risk
          FROM r GROUP BY fold HAVING count(DISTINCT source) > 1)
      SELECT count(*) FILTER (WHERE NOT is_split)               AS merged,
             count(*) FILTER (WHERE NOT is_split AND risk <= 1) AS merged_unique,
             count(*) FILTER (WHERE is_split)                   AS split,
             count(*) FILTER (WHERE is_split AND risk <= 1)     AS split_unique
        FROM k`);
    assert.ok(
      Number(r.merged) > 0 && Number(r.split) > 0,
      "one side of the comparison is empty — the percentages below mean nothing",
    );
    const mergedPct = (100 * Number(r.merged_unique)) / Number(r.merged);
    const splitPct = (100 * Number(r.split_unique)) / Number(r.split);
    assert.ok(
      mergedPct >= 95,
      `only ${mergedPct.toFixed(1)}% of merged folds are Tier-2a eligible (was 99.9%) — ` +
        "another tier is now carrying these merges; re-derive §2.7 before quoting it",
    );
    assert.ok(
      splitPct <= 10,
      `${splitPct.toFixed(1)}% of split folds are Tier-2a eligible (was 1.7%) — the split ` +
        "is no longer explained by namesake_risk; re-derive §2.7 before quoting it",
    );
  },
);

// `namesake_risk` counts COMPANIES, not people — the thing that makes this a resolver defect
// rather than a corpus fact.
//
// ⚠️ PIN THE CODE, NOT THE PROSE, AND STRIP COMMENTS FIRST. `namesakeRisk <= 1` occurs FOUR
// times in cluster.ts and only ONE of them is the rule; measured, deleting that one line left
// a bare `/namesakeRisk <= 1/` match green. The mirror flaw is as bad: a regex pinned to a
// comment's line break fires on a cosmetic reflow and claims the field changed meaning. This
// is the exact failure CLAUDE.md names for the repo's two static-analysis gates — "prose that
// MENTIONS a pattern is not an occurrence of it" — and `stripComments` is the tool it ships
// for it. `trailing` stays at its default: these files carry `//` inside string literals.
const codeOf = (p: string): string => stripComments(readFileSync(p, "utf8"));

test("namesake_risk is a company count, and Tier 2a is what gates on it", () => {
  // The DEFINITION, in code. A comment can go on saying "company count" long after the field
  // has stopped being one.
  assert.match(
    codeOf("scripts/person/resolve_persons.ts"),
    /company_count\s+FROM\s+officer_name_counts/,
    "namesakeRisk is no longer fed from officer_name_counts.company_count — §2.7 is stale",
  );
  // The RULE, in code.
  assert.match(
    codeOf("scripts/person/cluster.ts"),
    /mentions\[i\]\.namesakeRisk <= 1/,
    "Tier 2a no longer gates on namesakeRisk <= 1 — re-derive the split/merge diagnosis",
  );
  // …and the structural fact the licence table rests on: `sameLocalSeat` cannot fire across
  // the two sources because only a `local` mention carries the corroborant it reads.
  assert.match(
    codeOf("scripts/person/resolve_persons.ts"),
    /localSeat:\s*\n?\s*r\.source === "local"/,
    "localSeat is no longer local-only — sameLocalSeat may now bridge the two sources, " +
      "which would invalidate §2.7's licence table",
  );
});

// SELF-CHECK on the pin above. A gate whose anchors have silently stopped matching the files
// they name is indistinguishable from one that passes — so assert the strip is doing work and
// that the prose-only matches it exists to reject are really there.
test("the source pin rejects prose and would fail on a real deletion", () => {
  const raw = readFileSync("scripts/person/cluster.ts", "utf8");
  const stripped = stripComments(raw);
  assert.ok(
    (raw.match(/namesakeRisk <= 1/g) ?? []).length >= 2,
    "cluster.ts no longer mentions the rule in prose — this self-check has gone vacuous",
  );
  assert.ok(
    (stripped.match(/namesakeRisk <= 1/g) ?? []).length <
      (raw.match(/namesakeRisk <= 1/g) ?? []).length,
    "stripComments removed nothing — the pin above is matching comments again",
  );
  // The mutation the pin must catch: delete the one line that implements Tier 2a.
  const mutant = stripComments(
    raw
      .split("\n")
      .filter((l) => !l.includes("const legacy = idxs.filter"))
      .join("\n"),
  );
  assert.doesNotMatch(
    mutant,
    /mentions\[i\]\.namesakeRisk <= 1/,
    "removing Tier 2a's implementation leaves the pin green — it is matching something else",
  );
});
