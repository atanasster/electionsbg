// Gate for awarder_declared_officers (migration 168) — the people who declared
// they work at a given buyer.
//
// This is the surface where a wrong row is a false statement about a NAMED
// PERSON, so the assertions are mostly about what it must never claim:
//
//   • it must not attribute anyone to an employer whose name is ambiguous (165
//     refuses those; this inherits the refusal and must not re-open it);
//   • it must not silently drop a filer the person layer has not resolved — a
//     missing slug is „no profile", not „not a real person";
//   • it must keep the declarant's OWN words for employer and position, rather
//     than substituting the registry name we matched them to;
//   • it must not mix categories, or a ЗОП authorisation reads as a directorship.
//
// Auto-skips when Postgres is down, or when `filed_institution` is empty — the
// same fresh-clone case declaration_employer_link's gate documents: that column
// comes from a crawl, never from db:refresh.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const haveLinks = haveDb
  ? await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_employer_link`,
    )
      .then((r) => Number(r[0]?.n ?? 0) > 0)
      .catch(() => false)
  : false;
const skip = !haveDb
  ? "Postgres unreachable"
  : !haveLinks
    ? "declaration_employer_link is empty — filed_institution comes from a crawl, not from db:refresh"
    : false;

afterAll(async () => {
  await end();
});

interface Person {
  name: string;
  category: string;
  declaredEmployer: string | null;
  declaredPosition: string | null;
  firstYear: number | null;
  lastYear: number | null;
  filings: number;
  slug: string | null;
}

const officers = async (eik: string): Promise<Person[]> => {
  const [r] = await allRows<{ r: { people: Person[] } }>(
    `SELECT awarder_declared_officers($1) AS r`,
    [eik],
  );
  return r.r.people;
};

test.skipIf(skip)("the ministry's own filers resolve", async () => {
  const people = await officers("000695160");
  assert.ok(
    people.length > 3,
    `only ${people.length} people declared Министерство на културата as their employer`,
  );
  for (const p of people) {
    assert.ok(p.name?.length > 3, "a person with no name");
    assert.ok(
      p.declaredEmployer?.length,
      `${p.name}: the declarant's own words for their employer were dropped — a ` +
        `surface would have to render OUR matched registry name as if they had ` +
        `written it`,
    );
    assert.ok(
      p.filings > 0 && p.lastYear! >= p.firstYear!,
      `${p.name}: bad years`,
    );
  }
});

test.skipIf(skip)(
  "an unknown eik returns an empty list, not null",
  async () => {
    // A buyer nobody declared is the ORDINARY case (only 194 of 4,400+ buyers have
    // one). It must render as „nobody declared this", never as an error.
    const people = await officers("999999999");
    assert.deepEqual(people, []);
  },
);

test.skipIf(skip)("no attribution rides on an ambiguous employer", async () => {
  // 165 refuses a fold naming more than one organisation. This function joins
  // that table, so it inherits the refusal — unless someone later joins the raw
  // fold instead, which is exactly the regression this catches.
  const rows = await allRows<{ fold: string }>(
    `WITH reg AS (
       SELECT lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) AS fold,
              count(DISTINCT eik) AS n
         FROM schools WHERE eik IS NOT NULL AND name IS NOT NULL GROUP BY 1
     )
     SELECT l.employer_fold AS fold
       FROM declaration_employer_link l JOIN reg ON reg.fold = l.employer_fold
      WHERE reg.n > 1`,
  );
  assert.deepEqual(
    rows.map((r) => r.fold),
    [],
    "an ambiguous employer reached the bridge this function reads",
  );
});

test.skipIf(skip)(
  "filers with no person profile are kept, not dropped",
  async () => {
    // The set of people who file is bigger than the set the resolver has reached.
    // Dropping the unresolved ones would narrow a register of NAMED PUBLIC
    // OFFICIALS to whoever our own pipeline happened to match — and it would look
    // like a smaller, cleaner list rather than a censored one.
    const [r] = await allRows<{ total: string; resolved: string }>(
      `SELECT count(*) total, count(person_id) resolved
       FROM declaration d
       JOIN declaration_employer_link l
         ON l.employer_fold = lower(regexp_replace(
              btrim(replace(d.filed_institution, U&'\\00A0', ' ')), '\\s+', ' ', 'g'))
      WHERE d.filed_institution IS NOT NULL`,
    );
    assert.ok(Number(r.total) > 0, "the bridge matched no filings at all");
    // Today every matched filing IS resolved; the assertion that matters is that
    // the FUNCTION does not filter on it, which the next test proves directly.
    // `resolved <= total` is a tautology and asserted nothing. What is worth
    // asserting is that the function's OUTPUT keeps every distinct filer the
    // join finds for a buyer — so it is compared against the raw join.
    const [mk] = await allRows<{ n: string }>(
      `SELECT count(DISTINCT COALESCE(d.person_id::text, d.declarant_name)) n
         FROM declaration d
         JOIN declaration_employer_link l
           ON l.employer_fold = lower(regexp_replace(
                btrim(replace(d.filed_institution, U&'\\00A0', ' ')),
                '\\s+', ' ', 'g'))
        WHERE l.eik = '000695160' AND d.filed_institution IS NOT NULL`,
    );
    const people = await officers("000695160");
    // The payload groups by (person, category), so it can only ever have MORE
    // rows than distinct people — never fewer. Fewer means someone was dropped.
    assert.ok(
      people.length >= Number(mk.n),
      `the join finds ${mk.n} distinct filers at МК and the function returns ` +
        `${people.length} — somebody is being dropped`,
    );
  },
);

test.skipIf(skip)("the function does not filter on person_id", async () => {
  // Proven against the definition rather than the data: with 100% resolution
  // today, a WHERE person_id IS NOT NULL would be invisible in the output and
  // would start silently dropping people the moment a re-resolve retires a slug.
  const [r] = await allRows<{ def: string }>(
    `SELECT pg_get_functiondef('awarder_declared_officers(text)'::regprocedure) def`,
  );
  // A regex over the definition catches ONE spelling; an INNER JOIN to `person`
  // would drop unresolved filers just as surely and this would not see it. So
  // both shapes are checked.
  assert.ok(
    !/person_id\s+IS\s+NOT\s+NULL/i.test(r.def),
    "the function filters on person_id explicitly — an unresolved filer would " +
      "vanish from a register of named public officials",
  );
  assert.ok(
    !/(?<!LEFT\s)JOIN\s+person\b/i.test(r.def),
    "the function INNER JOINs `person`, which drops unresolved filers just as " +
      "surely as an explicit filter would",
  );
});

test.skipIf(skip)("the procurement-officer layer is populated", async () => {
  // T2.4's whole point: „who was authorised to run procurement at this buyer".
  const [r] = await allRows<{ officers: string; buyers: string }>(
    `SELECT count(DISTINCT d.declarant_name) officers, count(DISTINCT l.eik) buyers
       FROM declaration d
       JOIN declaration_employer_link l
         ON l.employer_fold = lower(regexp_replace(
              btrim(replace(d.filed_institution, U&'\\00A0', ' ')), '\\s+', ' ', 'g'))
      WHERE d.category = 'procurement_officer'`,
  );
  assert.ok(
    Number(r.officers) > 200,
    `only ${r.officers} procurement officers resolve to a buyer (was 431)`,
  );
  assert.ok(
    Number(r.buyers) > 100,
    `only ${r.buyers} buyers have one (was 194)`,
  );
});

test.skipIf(skip)("categories stay distinct in the payload", async () => {
  // A consumer filters on `category` to say „кой ръководи" versus „кой възлага".
  // If the column ever collapsed, a ЗОП authorisation would render as a
  // directorship on the institutions page.
  const people = await officers("000695160");
  const cats = new Set(people.map((p) => p.category));
  assert.ok(
    cats.size > 1,
    `every filer at МК carries the same category (${[...cats]}) — the page's ` +
      `„who runs it" filter would show everyone`,
  );
});
