// The wire contract for the two columns that let a search row tell its own money from its
// EIK's — `own_eur` / `primary_name` (006, 035), selected by `entitySearchSql`.
//
// WHY THIS FILE EXISTS. `ownEur` is shipped on every keystroke and read by no code path
// today: the client uses `primaryName` to LABEL the row and deliberately does not suppress
// the money (both candidate suppression rules were measured against the corpus and refuted
// — see procurementSearchSource.ts's rejected-rules note). A field with no consumer and no
// assertion is one tidy-up away from deletion, and the measurement that justifies carrying
// it would go with it. This pins the SELECT list instead.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

/** Captures the SQL each search arm issues; every query answers []. */
const capture = () => {
  const seen = [];
  const db = (sql) => {
    seen.push(String(sql).replace(/\s+/g, " "));
    return Promise.resolve([]);
  };
  db.seen = seen;
  return db;
};

const entityArms = (seen) =>
  seen.filter((q) => /search_(contractors|awarders)\(/.test(q));

test("procurement-search selects both provenance columns for BOTH entity arms", async () => {
  const db = capture();
  await DB_ROUTES["procurement-search"](db, { q: "клет" });
  const arms = entityArms(db.seen);
  // Contractors and awarders — the defect is symmetric, so the fix has to be.
  assert.equal(arms.length, 2, `expected 2 entity arms, got ${arms.length}`);
  for (const sql of arms) {
    assert.match(sql, /own_eur AS "ownEur"/);
    assert.match(sql, /primary_name AS "primaryName"/);
    // ⚠️ And inside the DISTINCT ON, or the outer select cannot see them.
    assert.match(sql, /DISTINCT ON \(eik\)[^)]*own_eur, primary_name/);
  }
});

test("the dedup keeps the MATCHED alias, not the dominant name", async () => {
  // Replacing `name` with `primary_name` would hide the query from its own result:
  // searching „Клементина" would return a row headed „ПЕТА МНОГОПРОФИЛНА БОЛНИЦА…", the
  // same hospital, reading as a mismatch. The dominant name rides BESIDE it.
  const db = capture();
  await DB_ROUTES["procurement-search"](db, { q: "клет" });
  for (const sql of entityArms(db.seen)) {
    assert.match(sql, /SELECT eik, name, contracts/);
    assert.ok(
      !/primary_name AS "name"/.test(sql),
      "the row must keep the alias that matched",
    );
  }
});

test("company-search uses the SAME builder — one SELECT list, not two", async () => {
  // The route has no consumer in this repo (verified 2026-09-02) and is kept only because
  // an undocumented external caller cannot be ruled out from inside it. Sharing the builder
  // is what stops a second SELECT list from silently going stale.
  const db = capture();
  await DB_ROUTES["company-search"](db, { q: "клет" });
  const [sql] = entityArms(db.seen);
  assert.ok(sql, "company-search issued no contractor search");
  assert.match(sql, /own_eur AS "ownEur"/);
  assert.match(sql, /primary_name AS "primaryName"/);
  assert.match(sql, /LIMIT 20/);
});
