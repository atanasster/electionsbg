// Route-level tests for the `tr_companies` arm of /api/db/company after it gained
// `subject_of_activity` (003).
//
// WHY THIS FILE EXISTS. Adding a COLUMN to an ancient base table creates a migration
// dependency where there was none, and it raises a SQLSTATE this file's degrade helpers do
// not handle: **42703 (undefined_column)**, not the 42883/42P01 pair every guarded arm here
// tests. `tr_companies` has existed since 003 shipped, so this arm could never fail on a
// missing RELATION — which is exactly why the new failure mode is easy to miss in review.
//
// The blast radius is not the field. This arm is #1 of a ~30-way `Promise.all`, so a
// rejection is a 500 on the WHOLE company payload — for every company AND every awarder,
// since `CompanyDbScreen` serves `/company/:eik` and `/awarder/:eik` from this one route.
// And 003's only loader-side applier is `db:load:tr:pg`, ~34.9 min on cloud, so a
// `deploy:db` landing first would be a site-wide outage with a half-hour floor on recovery.
//
// The asymmetry worth knowing: the server-rendered `/company/**` HEAD (functions/index.js's
// `loadCompany`) does not select the column, so it keeps working while the SPA body 500s.
// That makes the failure present as an intermittent front-end bug rather than a migration
// gap, which is the second reason to pin it here.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const EIK = "203261744";
const err = (code) => Object.assign(new Error(`pg ${code}`), { code });

const COMPANY_ROW = {
  uic: EIK,
  name: "АНТОН ТОТЕВ 92",
  legal_form: "ET",
  seat: null,
  subject_of_activity: "Внос-износ; покупка на стоки",
  status: "active",
};

/**
 * Every query answers `[]`; the tr_companies arm is steered. `preOo3` models a database
 * that has not applied 003: the first (new-column) SELECT raises 42703, and only the
 * fallback — recognisable by `NULL::text AS subject_of_activity` — succeeds.
 */
const fakeDb = ({ pre003 = false, row = COMPANY_ROW } = {}) => {
  const calls = [];
  const db = (sql) => {
    if (sql.includes("FROM tr_companies")) {
      calls.push(sql);
      const isFallback = sql.includes("NULL::text AS subject_of_activity");
      if (pre003 && !isFallback) return Promise.reject(err("42703"));
      return Promise.resolve([
        isFallback ? { ...row, subject_of_activity: null } : row,
      ]);
    }
    return Promise.resolve([]);
  };
  db.calls = calls;
  return db;
};

const call = (opts) =>
  DB_ROUTES.company(fakeDb(opts), { eik: EIK }).then((r) => r.body);

// ── the happy path passes the field through ──────────────────────────────────────────────
test("serves subject_of_activity when the column exists", async () => {
  const body = await call();
  assert.equal(body.company.subject_of_activity, COMPANY_ROW.subject_of_activity);
});

// ── the degrade: a database that predates 003 still serves the page ──────────────────────
test("a 42703 falls back rather than 500ing the whole company payload", async () => {
  const db = fakeDb({ pre003: true });
  const body = await DB_ROUTES.company(db, { eik: EIK }).then((r) => r.body);

  // The page is whole — this is the property that matters. Without the guard the entire
  // Promise.all rejects and every company and awarder page is a 500.
  assert.equal(body.company.uic, EIK);
  assert.equal(body.company.name, "АНТОН ТОТЕВ 92");
  // …and the field is absent rather than invented.
  assert.equal(body.company.subject_of_activity, null);
  // Assert the fallback actually ran: without this, a stub that never rejected would
  // satisfy the assertions above and the guard could be deleted unnoticed.
  assert.equal(db.calls.length, 2);
  assert.ok(db.calls[1].includes("NULL::text AS subject_of_activity"));
});

// ── the degrade is NARROW: nothing but 42703 is swallowed ────────────────────────────────
for (const code of ["42P01", "42883", "57014", "55P03"]) {
  test(`a ${code} on tr_companies still rejects — only 42703 degrades`, async () => {
    const db = (sql) =>
      sql.includes("FROM tr_companies")
        ? Promise.reject(err(code))
        : Promise.resolve([]);
    await assert.rejects(() => DB_ROUTES.company(db, { eik: EIK }));
  });
}
