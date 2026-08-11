// Tier 2b — the people-counted arm of the resolver's unique-full-name merge
// (`clusterBlock`, scripts/person/cluster.ts), asserted against the resolved corpus.
//
// Tier 2a gates on `namesakeRisk`, which is `officer_name_counts.company_count`: how many
// COMPANIES an officer of this name appears on, not how many people bear it. It refuses a
// man for sitting on two boards and accepts one whose name touches no company at all. 2b
// asks the same question of real per-person ids instead — the Сметна палата filing GUID
// and the parliament mp id.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
//
// It pins the OUTCOME — how many MPs still have their ministerial or mayoral declarations
// on a person row of their own — and not the rule that produces it. Re-deriving 2b's
// conditions in SQL would put the merge rule in two languages, which is exactly the drift
// this repo keeps paying for elsewhere (`shlyo_query_fold`, the vote-outcome bucketing).
// The rule's own behaviour is covered exhaustively and hermetically in
// scripts/person/cluster.test.ts, which needs no database.
//
// A first draft of this file asserted the rule instead, and was wrong twice over:
//   • "no person row aggregates two different register declarants" — the register RE-ISSUES
//     person ids between folders, and scripts/officials/_slug_collisions.json documents
//     that case as one person to be LEFT MERGED ("identical holdings mean ONE person whose
//     id the register re-issued … change nothing"). The meaningful direction — one register
//     person must not span two person rows — is already gated by
//     scripts/person/resolve_persons.data.test.ts.
//   • "a register-unique fold is never left at exactly two identities" — 2b legitimately
//     refuses several shapes that assertion did not model, most visibly the 4-token
//     hyphenated double surnames whose two spellings differ only by a space
//     („Башлиева-Панова" / „Башлиева- Панова"). Those fold together but are `ambiguous`,
//     and every Tier-2 arm refuses an ambiguous name by design.
//
//   npm run test:data
import { describe, it, expect, afterAll } from "vitest";
import { allRows, end } from "../lib/pg";
import { PERSON_GUID_SQL_PATTERN } from "../../officials/slug_identity";
import { OFFICIAL_DECLARATION_SOURCES } from "../../../src/lib/officialSources";

// The officials half of Tier 2b's counted sources, read from the one set that already
// answers "whose ref is a declaration slug" — so a new dedicated source (the way
// `president` / `mep` / `diplomat` were split off `official_exec`) joins both the rule and
// this gate at once, instead of silently falling out of the gate only.
const COUNTED_OFFICIAL_SOURCES = [...OFFICIAL_DECLARATION_SOURCES];

// The population docs/plans/mp-declaration-split-v1.md is about: a person carrying an `mp`
// role, and a DIFFERENT person on the same name fold who holds the declarations. Before
// Tier 2b: 172 pairs over 119 MPs, 462 stranded filings, of which 84 pairs sat on a fold
// the register itself knows exactly one declarant for.
const SPLIT_PAIRS_SQL = `
  WITH mps AS (
    SELECT DISTINCT p.person_id, p.name_fold
      FROM person p JOIN person_role r ON r.person_id = p.person_id
     WHERE r.source = 'mp')
  SELECT DISTINCT m.person_id AS mp_id, m.name_fold, o.person_id AS oth_id
    FROM mps m
    JOIN person o ON o.name_fold = m.name_fold AND o.person_id <> m.person_id
    JOIN declaration d ON d.person_id = o.person_id`;

// Distinct declarants the register knows per name fold — a count of PEOPLE, folded with the
// same normalizer the resolver uses.
const REGISTER_PEOPLE_SQL = `
  SELECT translit_bg_latin(d.declarant_name) AS f,
         count(DISTINCT upper(substring(d.source_url from $1))) AS n
    FROM declaration d
   WHERE substring(d.source_url from $1) IS NOT NULL
   GROUP BY 1`;

const probe = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration WHERE person_id IS NOT NULL`,
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const skip = (await probe())
  ? false
  : "Postgres unreachable / declarations not loaded+resolved";

afterAll(async () => {
  await end();
});

describe("Tier 2b — MPs whose declarations sit on a separate person row", () => {
  // The headline. Measured after the conservative variant shipped: 132 pairs over 80 MPs,
  // 327 stranded filings — down from 172 / 119 / 462.
  //
  // Ceilings rather than equalities, because the corpus moves under this daily: a new
  // officials harvest or a new parliament adds pairs legitimately. They are set just above
  // the measured value so a REGRESSION in the merge rule is caught while ordinary corpus
  // growth is not. If one trips because the corpus genuinely grew, re-measure and raise it
  // in the same commit that explains why.
  it.skipIf(skip)(
    "stays at or below the post-Tier-2b level",
    async () => {
      const [r] = await allRows<{
        pairs: string;
        mps: string;
        stranded: string;
      }>(
        `WITH pairs AS (${SPLIT_PAIRS_SQL})
       SELECT (SELECT count(*) FROM pairs)::text AS pairs,
              (SELECT count(DISTINCT mp_id) FROM pairs)::text AS mps,
              (SELECT count(*) FROM declaration d
                WHERE d.person_id IN (SELECT oth_id FROM pairs))::text AS stranded`,
      );
      expect(
        Number(r.pairs),
        `${r.pairs} MP↔declarant split pairs (was 132 after Tier 2b, 172 before). Each is ` +
          `one person's roles on one /person page and their declared wealth on another.`,
      ).toBeLessThanOrEqual(150);
      expect(
        Number(r.mps),
        `${r.mps} MPs affected (was 80)`,
      ).toBeLessThanOrEqual(95);
      expect(
        Number(r.stranded),
        `${r.stranded} declarations stranded on the wrong person row (was 327)`,
      ).toBeLessThanOrEqual(370);
    },
    120_000,
  );

  // The subset Tier 2b targets: folds the register itself calls unique. 84 before, 44 after
  // — the rest are 2b's documented refusals (an ambiguous 4-token name, a `tr` mention in
  // the group, or a third identity on the fold).
  //
  // This is the assertion that would catch the rule being silently disabled, since a
  // reverted 2b sends it straight back to ~84 while the totals above move much less.
  it.skipIf(skip)(
    "has materially reduced the register-unique subset",
    async () => {
      const [r] = await allRows<{ n: string }>(
        `WITH pairs AS (${SPLIT_PAIRS_SQL}), regp AS (${REGISTER_PEOPLE_SQL})
       SELECT count(*)::text AS n
         FROM pairs x JOIN regp ON regp.f = x.name_fold AND regp.n = 1`,
        [PERSON_GUID_SQL_PATTERN],
      );
      expect(
        Number(r.n),
        `${r.n} split pairs sit on a fold the register knows exactly ONE declarant for ` +
          `(was 84 before Tier 2b, 44 after). A jump back toward 84 means the people-counted ` +
          `arm has stopped firing — check registerPeople/mpPeople are still reaching Mention.`,
      ).toBeLessThanOrEqual(60);
    },
    120_000,
  );

  // THE OVER-MERGE DIRECTION, and the reason it needs its own assertion here.
  //
  // `person_resolve.data.test.ts`'s cross-source invariant is the repo's general guard
  // against a name-based merge across sources — and it is BLIND to exactly this population.
  // It exempts any person holding an `exact_id` role, and `confidence` is written per
  // PERSON rather than per role, so an MP (whose candidacies are gold-keyed by mp id) is
  // exempt for every other role they carry. Measured 2026-08-11: all 136 MP↔official
  // common-name persons are invisible to it. Reading its green as evidence about Tier 2b —
  // as an earlier draft of this file's own commit message did — is a mistake.
  //
  // So the two conditions that bound 2b's licence are asserted DIRECTLY, on the population
  // it actually merges. Both ceilings above only catch the arm ceasing to fire; these catch
  // it firing too widely, which is the direction that publishes a wrong claim about a named
  // person.
  it.skipIf(skip)(
    "never name-merges an MP with an official on a mass name",
    async () => {
      const bad = await allRows<{ display_name: string; risk: string }>(
        `SELECT p.display_name, p.namesake_risk::text AS risk
           FROM person p
          WHERE p.namesake_risk > 12
            AND EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id AND r.source = 'mp')
            AND EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id AND r.source = ANY($1::text[]))
            -- a gold key (mp id or register GUID) is a name-INDEPENDENT licence and is
            -- always allowed, however common the name
            AND NOT EXISTS (SELECT 1 FROM person_role r
                             WHERE r.person_id = p.person_id AND r.confidence = 'exact_id')
          LIMIT 10`,
        [COUNTED_OFFICIAL_SOURCES],
      );
      expect(
        bad,
        `MP↔official merge(s) on a name too common for the licence (TIER2B_NAMESAKE_CAP ` +
          `is 12) with no gold key behind them. 2b shipped without this cap and a review ` +
          `found live merges up to namesake_risk 70: ${JSON.stringify(bad)}`,
      ).toEqual([]);
    },
    120_000,
  );

  it.skipIf(skip)(
    "never name-merges an MP with an official the register knows two of",
    async () => {
      const bad = await allRows<{ display_name: string; declarants: string }>(
        `WITH regp AS (${REGISTER_PEOPLE_SQL})
         SELECT p.display_name, regp.n::text AS declarants
           FROM person p
           JOIN regp ON regp.f = p.name_fold AND regp.n > 1
          WHERE EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id AND r.source = 'mp')
            AND EXISTS (SELECT 1 FROM person_role r
                         WHERE r.person_id = p.person_id AND r.source = ANY($2::text[]))
            AND NOT EXISTS (SELECT 1 FROM person_role r
                             WHERE r.person_id = p.person_id AND r.confidence = 'exact_id')
          LIMIT 10`,
        [PERSON_GUID_SQL_PATTERN, COUNTED_OFFICIAL_SOURCES],
      );
      expect(
        bad,
        `MP↔official merge(s) on a fold the Сметна палата knows more than one declarant ` +
          `for, with no gold key. This is the shape Tier 2b's registerPeople === 1 gate ` +
          `exists to refuse: ${JSON.stringify(bad)}`,
      ).toEqual([]);
    },
    120_000,
  );

  // Non-vacuity: the queries above must range over a real population, or a corpus that
  // failed to load would satisfy every ceiling by returning zero.
  it.skipIf(skip)(
    "ranges over a populated corpus",
    async () => {
      const [r] = await allRows<{ mps: string; decls: string }>(
        `SELECT (SELECT count(DISTINCT person_id) FROM person_role WHERE source = 'mp')::text AS mps,
              (SELECT count(*) FROM declaration WHERE person_id IS NOT NULL)::text AS decls`,
      );
      expect(
        Number(r.mps),
        "no MP person rows — the split query is vacuous",
      ).toBeGreaterThan(1500);
      expect(
        Number(r.decls),
        "no resolved declarations — run db:load:declarations:pg -- --resolve",
      ).toBeGreaterThan(40_000);
    },
    120_000,
  );
});
