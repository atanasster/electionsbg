// Route-level tests for the `procurement_annexes` dependency `company_procurement` (011) and
// `person_procurement` (024) acquired when a consortium MEMBER gained its carrier's annex trail.
//
// WHY THIS FILE EXISTS. Both functions now read `procurement_annexes` (114) to answer "how many
// times was the joint contract this firm is a member of amended". That creates a migration
// dependency ACROSS LOADERS:
//
//   011 is applied by db:load:pg          (the contracts publish)
//   024 is applied by db:load:tr:pg       (the TR publish, a REFRESH_EXCLUSIONS member)
//   114 is applied by db:load:annexes:pg  (neither of the above)
//
// So the documented one-liner for shipping a body change —
// `apply_functions.ts 011_company_api.sql 024_person_api.sql` — can land a function that reads
// a relation the target database does not have. A `LANGUAGE sql` body under
// `check_function_bodies = off` (both files set it) does NOT fail at CREATE: it raises
// **42P01 at the first CALL**.
//
// The blast radius is the whole page, not the field. Both call sites sit inside a ~30-way
// `Promise.all`, so an unguarded rejection is a 500 on every `/company/:eik` AND
// `/awarder/:eik` (CompanyDbScreen serves both from the one route) and on every `/person`.
// Degrading to `null` is exactly what the page did before any of this shipped, and the
// once-per-process `co:` log is what stops the degrade being silent.
//
// ⚠️ THE DEGRADE IS 42P01 ONLY. 114 is a TABLE, so its absence is `undefined_table`. A
// `42883` on these arms can only mean 011/024 itself is absent, and swallowing that would
// blank procurement on every company, awarder and person page at a 200 — far wider than the
// gap being guarded. It stays a loud 500, and the tests below pin that.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

const EIK = "113581389";
const NAME = "ГЕОРГИ ГЕОРГИЕВ МАНОЛОВ";
const err = (code) => Object.assign(new Error(`pg ${code}`), { code });

const PAYLOAD = {
  totalEur: 0,
  contractCount: 0,
  consortiumEur: 69185496.51,
  consortiumCount: 2,
  consortiumAnnexCount: 5,
  consortiumContracts: [],
};

/** Every query answers `[]`; only the named rollup function is steered. */
const fakeDb = (fnName, { fail = null, payload = PAYLOAD } = {}) => {
  const calls = [];
  const db = (sql) => {
    if (sql.includes(`${fnName}($1`)) {
      calls.push(sql);
      if (fail) return Promise.reject(err(fail));
      return Promise.resolve([{ r: payload }]);
    }
    return Promise.resolve([]);
  };
  db.calls = calls;
  return db;
};

const companyBody = (opts) =>
  DB_ROUTES.company(fakeDb("company_procurement", opts), { eik: EIK }).then(
    (r) => r.body,
  );
const personBody = (opts) =>
  DB_ROUTES.person(fakeDb("person_procurement", opts), { name: NAME }).then(
    (r) => r.body,
  );

// ── the happy path passes the annex count through ────────────────────────────────────────
test("company: serves consortiumAnnexCount when 114 is present", async () => {
  const body = await companyBody();
  assert.equal(body.procurement.consortiumAnnexCount, 5);
  // The invariant that matters: the carrier's joint value never reaches the headline.
  assert.equal(body.procurement.totalEur, 0);
});

test("person: serves consortiumAnnexCount when 114 is present", async () => {
  const body = await personBody();
  assert.equal(body.procurement.consortiumAnnexCount, 5);
  assert.equal(body.procurement.totalEur, 0);
});

const route = (label, db) =>
  label === "company"
    ? DB_ROUTES.company(db, { eik: EIK })
    : DB_ROUTES.person(db, { name: NAME });

// ── the degrade: a database with 011/024 but no 114 still serves the page ─────────────────
for (const [label, fn] of [
  ["company", "company_procurement"],
  ["person", "person_procurement"],
]) {
  test(`${label}: a 42P01 from ${fn} degrades instead of 500ing the payload`, async () => {
    const db = fakeDb(fn, { fail: "42P01" });
    const body = await route(label, db).then((r) => r.body);

    // The page is WHOLE — the property that matters. Without the guard the entire
    // Promise.all rejects and every company, awarder and person page is a 500.
    assert.ok(body, "no body was produced at all");
    // …and the rollup is absent rather than invented. `null` is the pre-change behaviour:
    // the screen simply renders no procurement section.
    assert.equal(body.procurement, null);
    // Assert the guarded call actually ran — without this a stub that never rejected would
    // satisfy the assertions above and the guard could be deleted unnoticed.
    assert.equal(db.calls.length, 1);
  });

  // ⚠️ THE LOG IS THE WHOLE REASON THIS DEGRADE IS ALLOWED TO BE SILENT TO THE READER.
  // Three comment blocks call it "what stops it being silent"; without an assertion that
  // claim is unenforced, and a degrade nobody can find in the logs is indistinguishable
  // from the corpus genuinely holding no procurement for this entity.
  test(`${label}: the ${fn} degrade LOGS, once per process, under co:`, async () => {
    // `logMissOnce` dedupes per PROCESS, so the 42P01 test above has already consumed this
    // key — without the reset this assertion silently observes nothing and becomes
    // order-dependent, which is what `__resetMissLog` exists for.
    __resetMissLog();
    const warned = [];
    const orig = console.warn;
    console.warn = (m) => warned.push(String(m));
    try {
      await route(label, fakeDb(fn, { fail: "42P01" }));
      await route(label, fakeDb(fn, { fail: "42P01" }));
    } finally {
      console.warn = orig;
    }
    assert.equal(
      warned.length,
      1,
      "a crawler must not multiply this into one line per request",
    );
    // `co:`, not the `ir:` (Interreg) prefix the sibling helper uses — an operator greps the
    // family, and CLAUDE.md treats these tokens as the stable answer to "did the loader run?".
    assert.match(warned[0], new RegExp(`co:no-procurement:${fn}:42P01`));
    // Names the migration AND the command, so the log is actionable on its own.
    assert.match(warned[0], /procurement_annexes/);
    assert.match(warned[0], /114/);
    // Must NOT claim €0 — the sentinel is null, so the page renders no section at all. The
    // absent/zero distinction is the one this repo insists on everywhere else.
    assert.doesNotMatch(warned[0], /€0/);
  });

  // ── the degrade is NARROW, and 42883 is the case worth spelling out ──────────────────────
  //
  // 42883 means the rollup FUNCTION is absent — 011/024 never reached this database. It is
  // NOT the guarded dependency (114 is a table, so its absence is 42P01), and swallowing it
  // would render "no procurement" on every /company, every /awarder and every /person at a
  // 200 behind one log line. For a state buyer that is its whole contract history reading as
  // nothing. A deploy:db ahead of 011 must stay a loud 500.
  //
  // 57014 is the pool's OWN statement_timeout and 55P03 a lock it could not take: both are
  // transient, and degrading either turns a 10 s failure into a permanent silent blank.
  for (const code of ["42883", "57014", "55P03", "42501", "53400"]) {
    test(`${label}: a ${code} from ${fn} still rejects — only 42P01 degrades`, async () => {
      await assert.rejects(() => route(label, fakeDb(fn, { fail: code })));
    });
  }
}
