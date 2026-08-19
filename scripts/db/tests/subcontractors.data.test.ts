// Gates for the subcontractor projection (migration 171, plan P8).
//
// The defect this guards is not an empty table. It is publishing „performed by
// the winner alone" about a named contract whose buyer never answered the
// question — 159,107 of 212,961 notices do not carry it.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { parseSubcontractorFacts } from "../../procurement/subcontractors/parse";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*)::text n FROM tender_subcontracting",
    ).catch(() => [{ n: "0" }])
  : [{ n: "0" }];
const skip = !haveDb
  ? "Postgres unreachable"
  : n === "0"
    ? "tender_subcontracting is empty — run npm run db:load:subcontractors:pg"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the phrase still carries the question", async () => {
  // ⚠️ THE DENOMINATOR MUST NOT BE THE LOADER'S OWN FILTER. The first version
  // divided stored rows by the loader's own predicate, so numerator and
  // denominator moved together and the ratio stayed ~1.0 whatever happened. If
  // the ЗОП form relabelled the field for NEW notices only, both counts would
  // stop growing in lockstep, the gate would stay green, and every new
  // declaration would go unseen — the exact scenario its failure message names.
  //
  // The independent denominator is the word ROOT, which no label change hides.
  const [r] = await allRows<Record<string, string>>(
    `SELECT (SELECT count(*)::text FROM tender_subcontracting) stored,
            (SELECT count(*)::text FROM tender_notice
              WHERE text ~ 'участват[[:space:] ]+подизпълнители') phrase,
            (SELECT count(*)::text FROM tender_notice
              WHERE text ILIKE '%подизпълнител%') root`,
  );
  const stored = Number(r.stored);
  const phrase = Number(r.phrase);
  const root = Number(r.root);
  assert.ok(stored > 0, "nothing projected");
  assert.ok(
    stored / phrase > 0.99,
    `only ${stored} of ${phrase} phrase-carrying notices parsed to a declaration`,
  );
  const share = phrase / root;
  assert.ok(
    share > 0.6 && share < 0.8,
    `${(share * 100).toFixed(1)}% of notices mentioning подизпълнител carry the ` +
      `labelled field (was 69.1%). A move this large means the ЗОП form's ` +
      `wording changed — check parseSubcontractorFacts.`,
  );
});

test.skipIf(skip)('NULL never becomes „no subcontractors"', async () => {
  // The safety property. A stored row exists only where the buyer ANSWERED, so
  // has_subcontractors must never be NULL in the table — the „did not ask" case
  // is represented by the ABSENCE of a row, not by a null answer.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM tender_subcontracting WHERE has_subcontractors IS NULL`,
  );
  assert.equal(
    Number(r.n),
    0,
    `${r.n} rows store a NULL answer. „The form does not ask" is the absence of ` +
      `a row; a NULL here would be rendered as „no subcontractors" by any ` +
      `consumer that reads the column directly.`,
  );
});

test.skipIf(skip)("inconsistent declarations stay rare", async () => {
  // ⚠️ THE FIRST VERSION COULD NOT FAIL: it selected `LIMIT 5` and asserted
  // `rows.length < 100`, true at every corpus size. Count without a limit and
  // assert a SHARE, so the gate actually discriminates.
  const [r] = await allRows<{ bad: string; total: string }>(
    `SELECT count(*) FILTER (
              WHERE (has_subcontractors = false AND subcontractor_count > 0)
                 OR (has_subcontractors = true  AND subcontractor_count = 0)
            )::text bad,
            count(*)::text total
       FROM tender_subcontracting`,
  );
  const share = Number(r.bad) / Math.max(Number(r.total), 1);
  assert.ok(
    share < 0.01,
    `${r.bad} of ${r.total} declarations are internally inconsistent ` +
      `(${(share * 100).toFixed(2)}%). Buyers do mis-fill the form, but at this ` +
      `rate the parser is more likely reading a count from outside its block.`,
  );
});
test.skipIf(skip)("the per-procedure fold takes ANY lot's Да", async () => {
  // A procedure with lots publishes one award notice per lot, so „the latest
  // notice wins" would let a later lot's Не erase an earlier lot's Да. 75
  // procedures in the corpus are genuinely mixed, so this is live, not
  // hypothetical.
  const mixed = await allRows<{ unp: string; n: string }>(
    `SELECT unp, count(*)::text n FROM tender_subcontracting
      GROUP BY unp HAVING bool_or(has_subcontractors)
         AND NOT bool_and(has_subcontractors)`,
  );
  // NOT a silent return when none exist: „no mixed procedure" would make every
  // assertion below vacuous, and the count is a property worth pinning.
  assert.ok(
    mixed.length > 0,
    "no procedure mixes Да and Не across its notices — the fold is untested, " +
      "and its whole purpose is that case",
  );
  for (const m of mixed.slice(0, 20)) {
    const [f] = await allRows<{ has_subcontractors: boolean; notices: number }>(
      "SELECT has_subcontractors, notices FROM tender_subcontracting_for($1)",
      [m.unp],
    );
    assert.equal(
      f?.has_subcontractors,
      true,
      `procedure ${m.unp} has a notice declaring Да and the fold returned ` +
        `${f?.has_subcontractors} — a later lot's Не is erasing an earlier Да.`,
    );
  }
});

test.skipIf(skip)(
  "the serving boundary returns NO ROW for a procedure nobody asked about",
  async () => {
    // ⚠️ THE SAFETY PROPERTY, AT THE BOUNDARY. The table models „never asked" as
    // the absence of a row — but an ungrouped aggregate returns ONE row over an
    // empty set, so the function used to answer an unknown УНП with
    // has_subcontractors = NULL, reintroducing exactly the confusion the table
    // avoids. A consumer reading that column would render it as „no
    // subcontractors" for a procedure nobody ever asked about.
    const rows = await allRows<{ has_subcontractors: boolean | null }>(
      "SELECT has_subcontractors FROM tender_subcontracting_for($1)",
      ["THIS-UNP-DOES-NOT-EXIST"],
    );
    assert.equal(
      rows.length,
      0,
      `tender_subcontracting_for returned ${rows.length} row(s) for an unknown ` +
        `УНП. It must return none — a row here is „never asked" wearing the ` +
        `costume of an answer.`,
    );
  },
);

test.skipIf(skip)("the amendment fields survive the projection", async () => {
  // They ride along in the same block and pair with procurement_annexes, which
  // counts amendments from an independent source — so a silent loss here would
  // only show up as a disagreement nobody is looking for.
  const [r] = await allRows<{ amended: string; counted: string }>(
    `SELECT count(*) FILTER (WHERE was_amended)::text amended,
            count(*) FILTER (WHERE amendment_count > 0)::text counted
       FROM tender_subcontracting`,
  );
  assert.ok(
    Number(r.amended) > 100,
    `only ${r.amended} declarations record an amendment — the field is not being read`,
  );
  assert.ok(Number(r.counted) > 0, "no amendment counts were parsed");
});

test.skipIf(skip)("the parser refuses prose", () => {
  // The 4-in-20,000 case: the phrase occurs in requirements text with no Да/Не.
  // Matching it would invent a declaration the buyer never made.
  const prose =
    "В случай че в изпълнението участват подизпълнители или трети лица, " +
    "същите трябва да отговарят на изискванията.";
  assert.equal(parseSubcontractorFacts(prose).hasSubcontractors, null);
  assert.equal(
    parseSubcontractorFacts(
      "участват подизпълнители Да Брой подизпълнители по договора 3",
    ).subcontractorCount,
    3,
  );
});
