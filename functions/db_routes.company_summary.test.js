// Route-level tests for the `summary` arm of /api/db/company, and for the unscoped
// awarder probe beside it.
//
// WHY THIS FILE EXISTS. Everything else on this route is windowed by `?from`/`?to`, and
// only 3.8% of the corpus's contract money — and 12.3% of its contractors — falls inside
// the page's DEFAULT window (the selected parliament). These two arms are the page's only
// answer to „where is the money you came looking for", so they are read by a note that
// prints a sentence: „N договора на стойност €X · Виж всички периоди".
//
// A sentence needs ONE basis, and this arm carries THREE numbers on TWO of them:
//
//   contracts      count(*)                        — every tag. Gates `hasProcurement`,
//                                                    so an amendment-only supplier still
//                                                    renders a procurement body. 23 such
//                                                    suppliers exist in the corpus.
//   contract_rows  tag='contract' AND not a member — the basis the page's own „Договори"
//                                                    StatCard uses (011's contract_count).
//   contracts_eur  tag='contract'                  — members are €0 after 087, so they
//                                                    are safely inside the SUM.
//
// The two ways to get it wrong are both silent and both measured:
//   • collapsing `contracts` into the filtered count dead-ends those 23 pages;
//   • dropping the consortium clause from `contract_rows` pairs €0 placeholder rows with a
//     sum that excludes them — 3,230 suppliers, worst case 176 printed beside a „Договори
//     50" tile on the same screen (EIK 103895548).
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const EIK = "130878827";

/** Captures the SQL of the two unscoped probes; every arm answers []. */
const fakeDb = () => {
  const sql = { summary: null, awarderAllTime: null };
  const db = (q) => {
    const flat = String(q).replace(/\s+/g, " ");
    if (flat.includes("AS contracts_eur") && flat.includes("contractor_eik = $1"))
      sql.summary = flat;
    if (flat.includes("AS total_eur") && flat.includes("awarder_eik = $1"))
      sql.awarderAllTime = flat;
    return Promise.resolve([]);
  };
  db.sql = sql;
  return db;
};

const probes = async () => {
  const db = fakeDb();
  await DB_ROUTES.company(db, { eik: EIK });
  assert.ok(db.sql.summary, "the summary arm did not run");
  assert.ok(db.sql.awarderAllTime, "the awarder all-time probe did not run");
  return db.sql;
};

test("summary keeps the all-tag gate separate from the money basis", async () => {
  const { summary } = await probes();
  // `contracts` is unfiltered — the page's own gate. Collapsing it into the filtered
  // count takes `hasProcurement` false for the 23 amendment-only suppliers, dead-ending
  // their pages with every row count still reconciling.
  assert.match(summary, /count\(\*\)::int AS contracts\b/);
  assert.ok(
    !/count\(\*\) FILTER \([^)]*\)::int AS contracts\b/.test(summary),
    "`contracts` must stay unfiltered — it gates whether the page renders at all",
  );
});

test("contract_rows uses the SAME filter as the Договори card it sits beside", async () => {
  const { summary } = await probes();
  const m = summary.match(/count\(\*\) FILTER \((.*?)\)::int AS contract_rows/);
  assert.ok(m, "contract_rows is not a filtered count");
  assert.match(m[1], /tag = 'contract'/);
  // ⚠️ The clause that is easy to drop and impossible to see afterwards. 087 zeroes a
  // joint award's member rows onto its carrier, so they contribute €0 to the sum this
  // count is printed beside — and 011's contract_count excludes them.
  assert.match(m[1], /consortium_role IS DISTINCT FROM 'member'/);
});

test("contracts_eur keeps the members IN — they are €0, and the sum is the card's", async () => {
  const { summary } = await probes();
  // Excluding them here would make the note's money disagree with `company_procurement`'s
  // `total_eur`, which is the figure the headline StatCard renders.
  assert.match(
    summary,
    /sum\(amount_eur\) FILTER \(WHERE tag = 'contract'\), 0\) AS contracts_eur/,
  );
});

test("the awarder all-time probe counts on the buy-side card's basis too", async () => {
  const { awarderAllTime } = await probes();
  assert.match(awarderAllTime, /consortium_role IS DISTINCT FROM 'member'/);
  assert.match(awarderAllTime, /tag = 'contract'/);
  // Deliberately UNSCOPED — that is the whole point of the probe. A `from`/`to` here and
  // the page loses its only way to say where the money actually is.
  assert.ok(
    !/\$2|\$3/.test(awarderAllTime),
    "the all-time probe must take no date bound",
  );
});

test("the summary probe is unscoped as well", async () => {
  const { summary } = await probes();
  assert.ok(
    !/\$2|\$3/.test(summary),
    "the all-time summary must take no date bound",
  );
});
