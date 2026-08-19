// Gate for declaration_employer_link (migration 165) — the bridge from a
// declarant's stated employer to a procurement buyer.
//
// It is a NAME MATCH, and this repo's rule for those is that a name match is not
// an identity. So the assertions are about the REFUSALS as much as the matches:
//
//   • an ambiguous fold writes nothing, rather than being graded;
//   • an unresolved employer means „not matched to a buyer", never „no employer";
//   • the declared string survives, so a surface can show what the declarant
//     wrote rather than the registry name it was matched to.
//
// The coverage floor matters too, in the other direction: this table is only
// worth having because ~30% of filings resolve. A loader change that quietly
// takes that to 3% leaves every surface rendering „not matched" and looking like
// a design decision.
//
// ⚠️ IT SKIPS ON A FRESH CLONE, and not for the usual reason. `filed_institution`
// is NOT loaded by any chain step: the shards do not carry it, and
// `load_declarations_pg.ts` only CARRIES it across its own TRUNCATE. It exists
// because of a ~5-hour crawl of a rate-limited register, or because
// `ship_filed_position.ts` copied it from a database that has it. So a clean
// checkout can run all of db:refresh and legitimately end with an empty bridge —
// which must read as „this corpus has no employer data", never as „the loader is
// broken". Same shape and the same distinct skip reason as
// `declaration_foreign_assets.data.test.ts` uses for an un-stamped table_num.
//
// Otherwise it auto-skips ONLY when Postgres is down, and an empty table IS a
// failure — everything else it needs the chain does load.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
/** Populated at all? ABSENT is not EMPTY — see the header. */
const haveEmployers = haveDb
  ? await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration
        WHERE filed_institution IS NOT NULL AND btrim(filed_institution) <> ''`,
    )
      .then((r) => Number(r[0]?.n ?? 0) > 0)
      .catch(() => false)
  : false;
const skip = !haveDb
  ? "Postgres unreachable"
  : !haveEmployers
    ? "declaration.filed_institution is empty — it comes from a crawl or ship_filed_position.ts, never from db:refresh"
    : false;

afterAll(async () => {
  await end();
});

/** The loader's fold, restated — deliberately, because a test that imports the
 *  implementation's fold cannot catch the fold changing meaning. */
const FOLD = (col: string) =>
  // NBSP (U+00A0) is NOT in Postgres's `\s`, and it turns up in pasted register
  // names — so it is normalised to a space FIRST, before the collapse. Without
  // that, „Община  Варна" with a hard space folds to a different key than the
  // same name typed with an ordinary one, and the two never meet.
  `lower(regexp_replace(btrim(replace(${col}, U&'\\00A0', ' ')), '\\s+', ' ', 'g'))`;

test.skipIf(skip)("the bridge is populated", async () => {
  const [r] = await allRows<{ n: string; eiks: string }>(
    `SELECT count(*) n, count(DISTINCT eik) eiks FROM declaration_employer_link`,
  );
  assert.ok(
    Number(r.n) > 500,
    `declaration_employer_link holds ${r.n} rows — run db:load:employer-links:pg`,
  );
  assert.ok(Number(r.eiks) > 400, `only ${r.eiks} distinct buyers`);
});

test.skipIf(skip)(
  "every stored link is unambiguous — the refusal holds",
  async () => {
    // The rule the table exists to enforce. A fold that names more than one buyer
    // must have written NOTHING; if any survived, the bridge is attributing a
    // declarant to one of several same-named institutions.
    const rows = await allRows<{ employer_fold: string; eiks: string }>(
      `WITH buyer AS (
       SELECT ${FOLD("awarder_name")} AS fold, count(DISTINCT awarder_eik) AS eiks
         FROM contracts WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL
        GROUP BY 1
     )
     SELECT l.employer_fold, b.eiks::text
       FROM declaration_employer_link l JOIN buyer b ON b.fold = l.employer_fold
      WHERE b.eiks > 1`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.employer_fold} (${r.eiks} buyers)`),
      [],
      "ambiguous folds reached the bridge — an employer naming several buyers must " +
        "be refused, not resolved to one of them",
    );
  },
);

test.skipIf(skip)(
  "the refusal is not vacuous — ambiguous folds exist",
  async () => {
    // If no fold were ever ambiguous, the test above would pass on an empty set
    // and prove nothing. Measured: 110 folds are ambiguous and correctly absent.
    const [r] = await allRows<{ n: string }>(
      `WITH employer AS (
       SELECT ${FOLD("filed_institution")} AS fold FROM declaration
        WHERE filed_institution IS NOT NULL AND btrim(filed_institution) <> ''
        GROUP BY 1
     ),
     buyer AS (
       SELECT ${FOLD("awarder_name")} AS fold, count(DISTINCT awarder_eik) AS eiks
         FROM contracts WHERE awarder_eik IS NOT NULL AND awarder_name IS NOT NULL
        GROUP BY 1
     )
     SELECT count(*) n FROM employer e JOIN buyer b USING (fold) WHERE b.eiks > 1`,
    );
    assert.ok(
      Number(r.n) > 0,
      "no employer fold is ambiguous any more — the refusal test above proves nothing",
    );
  },
);

test.skipIf(skip)(
  "no stored fold names two organisations in an independent register",
  async () => {
    // The one-sided-refusal defect. A fold can name exactly ONE buyer and still
    // name two real organisations — „средно училище „Бачо Киро"" is two schools
    // with different EIKs, and the first cut attributed declarants to whichever
    // of them happened to procure. Checking the buyer side alone cannot see it.
    const rows = await allRows<{ fold: string; n: string; reg: string }>(
      `WITH reg AS (
         SELECT ${FOLD("name")} AS fold, count(DISTINCT eik) AS n, 'schools' AS reg
           FROM schools WHERE eik IS NOT NULL AND name IS NOT NULL GROUP BY 1
         UNION ALL
         SELECT ${FOLD("name")}, count(DISTINCT uic), 'tr_companies'
           FROM tr_companies WHERE uic IS NOT NULL AND name IS NOT NULL GROUP BY 1
       )
       SELECT l.employer_fold AS fold, reg.n::text AS n, reg.reg
         FROM declaration_employer_link l JOIN reg ON reg.fold = l.employer_fold
        WHERE reg.n > 1`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.fold} (${r.n} in ${r.reg})`),
      [],
      "these folds name several real organisations and the bridge picked one",
    );
  },
);

test.skipIf(skip)("every stored eik is a real buyer", async () => {
  const rows = await allRows<{ eik: string }>(
    `SELECT l.eik FROM declaration_employer_link l
      WHERE NOT EXISTS (SELECT 1 FROM contracts c WHERE c.awarder_eik = l.eik)`,
  );
  assert.deepEqual(
    rows.map((r) => r.eik),
    [],
    "the bridge names EIKs that buy nothing — it is supposed to point at buyers",
  );
});

test.skipIf(skip)("the declared string is kept verbatim", async () => {
  // `feedback_name_match_not_identity`: show what the declarant wrote, never
  // silently substitute the registry name it was matched to.
  const [r] = await allRows<{ missing: string }>(
    `SELECT count(*) missing FROM declaration_employer_link
      WHERE employer_sample IS NULL OR btrim(employer_sample) = ''`,
  );
  assert.equal(
    Number(r.missing),
    0,
    "rows carry no verbatim employer spelling — a surface would have to render " +
      "the matched registry name as if the declarant had written it",
  );
});

test.skipIf(skip)(
  "coverage is high enough for the table to be worth having",
  async () => {
    const [r] = await allRows<{ filings: string; matched: string }>(
      `SELECT count(*) filings, count(l.eik) matched
       FROM declaration d
       LEFT JOIN declaration_employer_link l
              ON l.employer_fold = ${FOLD("d.filed_institution")}
      WHERE d.filed_institution IS NOT NULL AND btrim(d.filed_institution) <> ''`,
    );
    assert.ok(
      Number(r.filings) > 10_000,
      `only ${r.filings} filings carry an employer — the share below would be ` +
        `computed over a denominator too small to mean anything`,
    );
    const pct = (Number(r.matched) / Number(r.filings)) * 100;
    assert.ok(
      pct > 20,
      `only ${pct.toFixed(1)}% of filings resolve to a buyer (was 29.0%). Below ~20% ` +
        `every surface renders „not matched" and the bridge stops being useful — ` +
        `check whether the fold or filed_institution changed shape.`,
    );
  },
);

test.skipIf(skip)(
  "the procurement-officer arm resolves, which is the point",
  async () => {
    // „who was authorised to run procurement at this buyer" is the fact this
    // bridge exists to make queryable. If that category stops resolving, the table
    // can still look healthy on its overall coverage.
    const [r] = await allRows<{ filings: string; matched: string }>(
      `SELECT count(*) filings, count(l.eik) matched
       FROM declaration d
       LEFT JOIN declaration_employer_link l
              ON l.employer_fold = ${FOLD("d.filed_institution")}
      WHERE d.category = 'procurement_officer'
        AND d.filed_institution IS NOT NULL`,
    );
    const pct = (Number(r.matched) / Number(r.filings)) * 100;
    assert.ok(
      pct > 30,
      `only ${pct.toFixed(1)}% of procurement-officer filings resolve to a buyer ` +
        `(was 41.5%)`,
    );
  },
);

test.skipIf(skip)(
  "confidence is stored, and only what the loader writes",
  async () => {
    // The column exists so a future trigram arm can be added WITHOUT relabelling
    // what is already published. Today only 'exact' is written; a stray value means
    // something started grading matches.
    const rows = await allRows<{ confidence: string; n: string }>(
      `SELECT confidence, count(*) n FROM declaration_employer_link GROUP BY 1`,
    );
    assert.deepEqual(
      rows.map((r) => r.confidence).sort(),
      ["exact"],
      "the bridge stores a confidence the loader does not write",
    );
  },
);
