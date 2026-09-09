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
// ⚠️ IT IS A CLASS, NOT A CASE, so `person_link_override` is the wrong instrument. Most split
// folds carry an IDENTICAL (fold, role, place_code) triple across the two sources — one name,
// one office, one place. Closing it is a resolver tier and belongs in scripts/person/ with its
// own gate; docs/plans/home-search-expansion-v1.md §2.6-2.7 / Phase 2a records the decision to
// scope it out of the home-search work rather than ship ~1,200 adjudications.
//
// ⚠️ BUT THE TRIPLE IS NOT A LICENCE ON ITS OWN, and this file said it was until 2026-09-09.
// The exclusivity argument being borrowed is `sameLocalSeat`'s "a село has ONE кмет" — and
// measured by role, only 101 of the 1,133 triples ARE a mayor. "Councillor of PAZ24" names one
// of 10-40 people, so it is not the name-independent link `person_resolve.data.test.ts`'s
// cross-source invariant requires; and the Commerce Registry says 483 of the 1,215 split folds
// are borne by 2+ people, i.e. some of these splits are CORRECT. The buildable safe core is the
// mayor arm, not the whole class. §2.7a carries the measurements, the Bridge B harm the split
// causes downstream, and why swapping this rule's discriminator for a people count does not
// work — read it before quoting the paragraph above.
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
 * say so in the plan that owns it: `home-search-expansion-v1.md` §2.6 for the first three,
 * `person-search-duplicate-rows-v1.md` §5 C1 for `headerIdenticalRows` — which is a different
 * surface with a different remedy, so a re-cutter sent to the wrong document would read the
 * wrong argument for why the number is what it is.
 */
const CEILINGS = {
  /** Name folds holding an `official_muni` AND a `local` role on ≥2 person rows. */
  splitFolds: 1215,
  /**
   * (fold, role, place_code) TRIPLES naming two person rows across the two sources — one
   * name, one office, one place. The population a cross-source seat rule would close.
   *
   * ⚠️ A COUNT OF TRIPLES, NOT OF FOLDS, and the two differ: those triples fall on 1,106
   * distinct folds (one person split across two offices contributes two triples).
   * 1,106/1,215 = 91.0% is the coverage figure §2.7 quotes; this ceiling counts triples.
   * Naming both is deliberate — they were briefly one number in two places.
   *
   * ⚠️ 1130 → 1132 on 2026-09-04, and the two are a GATE WORKING RATHER THAN A REGRESSION.
   * `officials-roster-missing-mayor-v1` T2 takes a municipal official's published role from
   * their own filing instead of the register's listing label, which promoted Раднево's
   * Георги Йовчев Петров (listed „Общински съветник") and Разград's Добрин Младенов Добрев
   * (listed „Заместник кмет") to `mayor`.
   *
   * Each of those two already had TWO officials slugs for one human — the slug's
   * disambiguator carries the listing role, so the register relabelling somebody between
   * folder years forks them — and each already had both rows on one `person_id`. What
   * changed is that the two rows stopped naming different offices and started naming the
   * same one, which is what they always were. So the split did not grow; it became visible
   * to precisely the signal this ceiling exists to measure.
   *
   * That makes these two the CHEAPEST members of this population to close, and the only
   * ones whose cause is fully documented: see docs/plans/officials-roster-missing-mayor-v1.md.
   *
   * ⚠️ 1132 → 1133 on 2026-09-08, and unlike that pair this one is the CLASS ITSELF caught
   * in the act — the plain `namesake_risk` mechanism §2.7 names, so it is a re-cut and not
   * something to close here. Пламен Ясенов Горумов, общински съветник in Ракитово
   * (PAZ24), is now published as `plamen-yasenov-gorumov-f0fd62` (his 2019 + 2023 council
   * terms) AND `plamen-yasenov-gorumov-f0fd62-2` (his Сметна палата roster record).
   *
   * ONE Commerce-Registry row is the whole cause. Until 2026-09-05 the fold's only TR role
   * was a manager at ИБЧО МЕБЕЛ (ЕИК 201429467, added 2024-04-02), so
   * `officer_name_counts.company_count` was 1 and Tier 2a licensed the union. That day's
   * daily batch added a partner role at ВИП ГОР (ЕИК 205845514), the count went to 2,
   * and the 2026-09-08 resolve refused the merge.
   *
   * Cloud SQL is what makes that decisive rather than inferred: resolved 2026-09-04, BEFORE
   * the batch, it still publishes him as ONE person carrying both sources — `namesake_risk`
   * is 1 there and 2 here off an IDENTICAL `officer_name_counts` (both read 2 today),
   * because the field is stamped at resolve time. Both population floors held EXACTLY
   * (5,244 / 31,966), neither other ceiling moved up (4,649 and 2,186), and the diagnosis
   * assertion still reads 99.85% / 1.73%.
   *
   * He is one human: ИБЧО МЕБЕЛ is seated in с. Дорково, which `place_dim` puts in
   * PAZ24 — the municipality he is a councillor of. The resolver reads no seat; that is
   * evidence for this comment, not a licence.
   *
   * ⚠️ AND THE SPLIT HIDES THE COMPANIES THAT CAUSED IT, on both resulting pages. Bridge B's
   * people-uniqueness guard (`bridgeB.ts`) requires the fold to map to exactly ONE `person`
   * row, so once it splits neither row is eligible: cloud's merged person carries the ИБЧО
   * МЕБЕЛ `tr` role and NEITHER local row carries any tr/ngo role at all — though
   * `tr_name_fold_people.people_n` is still 1 and the footprint is 2, well under
   * FOOTPRINT_CAP. A second company makes a councillor two people and then takes both
   * companies off both of them, which is worth knowing before reading a split page as
   * evidence that somebody holds nothing.
   */
  exactSignatureTriples: 1133,
  /** `person_search` P rows sitting in a same-(fold, place_label, primary_role) cluster of
   *  more than one — what a reader actually sees, in the finder and on /persons. */
  duplicateSearchRows: 4778,
  /**
   * The same question for the HEADER dropdown, which renders a different set of fields and
   * therefore has its own number. Measured 2026-09-04: rows sitting in a same-(fold,
   * party badge, office, place) cluster of more than one.
   *
   * ⚠️ IT MUST GROUP ON `person_election_stats.party_nick`, NOT on `person_search.party`.
   * The badge 082's `person_search(text,int)` emits comes from the first; `party_primary`
   * (which `person_search.party` carries) is a different column with a different NULL
   * population — 34,899 rows carry no party_nick against 25,046 with no party_primary — so
   * grouping on the convenient one UNDERSTATES what the header shows. The plan's first draft
   * did exactly that and reported 3,028 → 572 for a change that is really 4,527 → 2,312.
   *
   * The 4,527 is what the header rendered before the office+place line (13b8b9e2d4 /
   * dcc03eec2b) and is re-derived by the companion assertion below rather than pinned as a
   * constant — a stored "before" would go stale against a moving corpus and prove nothing.
   */
  headerIdenticalRows: 2312,
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
  /** Active public figures carrying a tier-P browse row — the denominator of the 2,312.
   *  Close to `searchPRows` but derived from a different relation, so it is its own floor. */
  headerPersonRows: 63844,
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

// What the HEADER dropdown shows, which is a different question from the one above and has a
// different answer. The home finder renders `roleSubtitle` (office · place); the header
// renders the party BADGE as well, and until 2026-09-04 rendered nothing else — so two
// same-named people in one party were two byte-identical rows there while being
// distinguishable in the finder. Tier A of docs/plans/person-search-duplicate-rows-v1.md
// added the same office+place line to the header; this pins the result so it cannot regress.
//
// ⚠️ IT READS THE PRODUCER, NOT THE SERVED PAYLOAD, and that boundary is deliberate. This
// gate is about the CORPUS — whether the office and place still tell same-named people apart
// — and it fires if a resolve or a browse rebuild blanks either column for a large share of
// people. Whether the API and the renderer still carry them is a different claim, held by
// person_search_card.data.test.ts and SearchItems.test.tsx; duplicating it here would make
// this file's numbers depend on a function's body.
const HEADER_ROWS = `
  WITH hdr AS (
    SELECT p.name_fold, pty.party_nick, b.primary_role, b.place_label
      FROM person p
      -- ⚠️ LEFT, mirroring person_browse_card's SELECT … INTO: a person missing from 120 is
      -- still SERVED by person_search(), as a name+badge row with a null subtitle — the most
      -- indistinguishable row there is. An INNER join drops them from the numerator AND the
      -- denominator together, so losing browse rows would read as the number improving, which
      -- is the exact failure this file's header is written about. The floor does not pay for
      -- it either: at FLOOR_BAND a browse rebuild could lose ~3,192 people and still pass.
      -- Verified to change nothing today (63,844 / 2,312 / 4,527 either way).
      --
      -- tier = 'P' is redundant against p.is_public_figure — 120 derives tier from that
      -- very column — and is kept only so the two notions of "public" cannot silently
      -- diverge; person_browse_card applies no tier filter at all.
      LEFT JOIN person_browse_table b ON b.slug = p.slug AND b.tier = 'P'
      -- The badge exactly as 082's person_search() picks it: the most recent candidacy that
      -- has one. Grouping on person_search.party instead is the understatement documented on
      -- CEILINGS.headerIdenticalRows.
      LEFT JOIN LATERAL (
        SELECT pes.party_nick FROM person_election_stats pes
         WHERE pes.person_id = p.person_id AND pes.party_nick IS NOT NULL
         ORDER BY pes.election_date DESC LIMIT 1) pty ON true
     WHERE p.status = 'active' AND p.is_public_figure)`;

/** Rows in a cluster of more than one, grouped on whatever the header renders. */
const headerClusterSql = (keys: string): string => `${HEADER_ROWS}
  SELECT coalesce(sum(c), 0) n FROM (
    SELECT count(*) c FROM hdr GROUP BY ${keys} HAVING count(*) > 1) z`;

const NAME_AND_BADGE = "name_fold, coalesce(party_nick, '')";
const PLUS_OFFICE_PLACE = `${NAME_AND_BADGE}, coalesce(primary_role, ''), coalesce(place_label, '')`;

test.skipIf(skip)(
  "what the header shows — identical person rows in the dropdown — does not grow",
  async () => {
    // person_browse_table and person_election_stats have their own loaders, so their absence
    // says nothing about the resolver. Skipped explicitly rather than by an early `return`,
    // which vitest reports as a PASS — a green line for a check that never ran.
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.person_browse_table') IS NOT NULL
          AND to_regclass('public.person_election_stats') IS NOT NULL AS ok`,
    );
    // ⚠️ ROW COUNTS, not just to_regclass — the sibling arm above makes the same distinction.
    // A matview that EXISTS and is unloaded would otherwise reach the floor with built = 0
    // and fail blaming the RESOLVER, which did nothing wrong; one created WITH NO DATA raises
    // 55000 on read rather than returning zero rows, hence the catch. And an empty
    // person_election_stats blanks every badge — merging clusters and moving both numbers for
    // a reason that has nothing to do with identity — while person_browse_table stays full,
    // so the floor would clear and the arm would pass on a number meaning something else.
    const counts = t?.ok
      ? await allRows<{ b: string; e: string }>(
          `SELECT (SELECT count(*) FROM person_browse_table WHERE tier = 'P') b,
                  (SELECT count(*) FROM person_election_stats) e`,
        ).catch(() => null)
      : null;
    if (!counts || !Number(counts[0].b) || !Number(counts[0].e)) {
      reportSkip(
        import.meta.url,
        "person_browse_table / person_election_stats not built — run " +
          "npm run db:load:declarations:pg -- --resolve && npm run db:load:person-elections:pg",
      );
      return;
    }
    const built = await scalar(`${HEADER_ROWS} SELECT count(*) n FROM hdr`);
    assertFloor("header person rows", built, FLOORS.headerPersonRows);

    const n = await scalar(headerClusterSql(PLUS_OFFICE_PLACE));
    assert.ok(
      n > 0,
      "zero identical header rows — see the non-vacuity note above",
    );
    assert.ok(
      n <= CEILINGS.headerIdenticalRows,
      `${n} people render as an indistinguishable header row — name, party badge, office ` +
        `and place all equal — up from ${CEILINGS.headerIdenticalRows}`,
    );

    // ⚠️ THE PAIR IS THE POINT, and the ceiling alone is satisfied by the corpus losing the
    // very columns it is measuring: blank every place_label and the clusters MERGE rather
    // than grow, so the number goes UP — but blank one of the two and it can go DOWN while
    // the surface gets worse. This re-derives the number the header showed BEFORE the
    // office+place line and requires it to be substantially larger, i.e. that the line is
    // still doing work.
    //
    // A MARGIN, not `>`. Strictly-greater is satisfied by ONE person out of 63,844 being
    // separated, which is indistinguishable from the pair having collapsed. Measured
    // 2026-09-04: 4,527 against 2,312, a ratio of 1.96 — so 1.25 is well below the real
    // separation and well above the noise, and a corpus that genuinely stopped discriminating
    // cannot creep under it.
    const MIN_SEPARATION = 1.25;
    const withoutSubtitle = await scalar(headerClusterSql(NAME_AND_BADGE));
    assert.ok(
      withoutSubtitle >= n * MIN_SEPARATION,
      `the office+place line has stopped discriminating: ${withoutSubtitle} rows are ` +
        `identical on name + badge alone against ${n} once office and place are added, a ` +
        `ratio of ${(withoutSubtitle / Math.max(n, 1)).toFixed(2)} against the ${MIN_SEPARATION} ` +
        "this asserts (1.96 when measured). Either person_browse_table's " +
        "primary_role/place_label went blank, or the two columns no longer vary across " +
        "same-named people.",
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
