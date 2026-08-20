// Route-level tests for the `declaredStakes` arm of /api/db/company (migration 177).
//
// WHY THIS FILE EXISTS. The arm shares the company route's single `Promise.all`, so its
// rejection is not a narrower answer — it is a 500 on the WHOLE company payload, for every
// company on the site. And the thing that makes it reject is routine: 177 is a thin function
// over 096's MATERIALIZED VIEW, and 096 opens with `DROP MATERIALIZED VIEW … CASCADE` inside
// one transaction, which the plan measures at 4 h 41 m on Cloud SQL. A concurrent reader gets
// 55P03 for the duration.
//
// The first cut of this arm degraded on 42P01/42883 only — copied from `cleanDelivery`, which
// reads plain TABLES and so cannot raise the matview codes. That is the defect these tests
// pin, and it is invisible in review because both spellings look like "the degrade pattern".
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const EIK = "125537379";
const err = (code) => Object.assign(new Error(`pg ${code}`), { code });

/** Every query the company route makes answers `[]`; only the stakes arm is steered. */
const fakeDb = (stakes) => (sql) => {
  if (sql.includes("company_declared_stakes")) {
    return stakes instanceof Error ? Promise.reject(stakes) : Promise.resolve(stakes);
  }
  return Promise.resolve([]);
};

const call = (stakes) =>
  DB_ROUTES.company(fakeDb(stakes), { eik: EIK }).then((r) => r.body);

// ── the payload passes through untouched ─────────────────────────────────────────────────
test("a served payload reaches the body under `declaredStakes`", async () => {
  const payload = { uic: EIK, total: 1, groups: [{ personId: 7 }] };
  const body = await call([{ r: payload }]);
  assert.deepEqual(body.declaredStakes, payload);
});

test("NULL from the function is passed through as null, not invented into an empty shape", async () => {
  // NULL means „nothing survived 096's gates", which is NOT „no stake was declared here".
  // Turning it into `{groups: []}` would let a consumer render a negative finding.
  const body = await call([{ r: null }]);
  assert.equal(body.declaredStakes, null);
});

// ── the degrade contract ─────────────────────────────────────────────────────────────────
for (const code of ["42P01", "42883", "55000", "55P03", "42501"]) {
  test(`${code} degrades to null and leaves the rest of the company payload served`, async () => {
    const body = await call(err(code));
    assert.equal(body.declaredStakes, null);
    // The whole point: the OTHER arms still answered. A rejection here would have taken
    // them with it.
    assert.equal(body.eik, EIK);
    assert.ok("procurement" in body && "officers" in body);
  });
}

test("55P03 specifically — a concurrent 096 rebuild must not 500 every company page", async () => {
  // Named separately from the loop because it is the one the first cut missed, and the one
  // whose window is hours rather than a deploy.
  const body = await call(err("55P03"));
  assert.equal(body.declaredStakes, null);
});

// ── and what must NOT be swallowed ───────────────────────────────────────────────────────
test("57014 is NOT degraded — the request has already spent its timeout budget", async () => {
  // 57014 is the pool's own statement_timeout, not the "locked" code (that is 55P03).
  // Degrading it would turn a 10 s failure into a slower one while still holding a pooled
  // connection, under exactly the saturation that caused it.
  await assert.rejects(() => call(err("57014")), /57014/);
});

test("an unrelated error still surfaces rather than serving a quietly incomplete page", async () => {
  await assert.rejects(() => call(err("42601")), /42601/);
});
