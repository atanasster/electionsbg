// Route-level tests for the `cleanDelivery` arm of /api/db/company (migration 175).
//
// WHY THIS FILE EXISTS. The arm shares the company route's single `Promise.all`, so its
// rejection is not a missing tile — it is a 500 on the WHOLE company payload, for every
// company AND every awarder, since CompanyDbScreen serves both. And the thing that makes it
// reject is a documented routine operator command: `db:load:clean-delivery:pg[:cloud]` opens
// its transaction with `TRUNCATE isun_clean_contract, isun_clean_beneficiary` and holds an
// AccessExclusiveLock through both COPYs, so a concurrent reader is cancelled with 55P03
// against the pool's `lock_timeout: 2000` (reproduced 2026-09-02).
//
// This arm degraded on 42P01/42883 ONLY until then, on the stated grounds that it "reads
// plain TABLES and so cannot raise the matview codes". 55P03 is not a matview code — it is a
// lock code, and a plain table under a TRUNCATE-reload takes the same lock. That reasoning
// had also been copied into the sibling `declaredStakes` arm's first cut. These tests pin the
// corrected set so neither can drift back.
//
// The second group pins the payload shape the 2026-09-02 rewrite of 175 introduced: the
// function drives from BOTH ИСУН registers, so `on_time_contracts` arrives NULL — never 0 —
// for a company listed among the correction-free CONTRACTS but not among the beneficiaries
// (956 EIKs, 17.5% of the register). This route must not coalesce that on the way out.
//
//   npm run functions:test

const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

const EIK = "130714137";
const err = (code) => Object.assign(new Error(`pg ${code}`), { code });

/** Every query the company route makes answers `[]`; only the clean-delivery arm is steered. */
const fakeDb = (cd) => (sql) => {
  if (sql.includes("isun_clean_delivery_for_eik")) {
    return cd instanceof Error ? Promise.reject(cd) : Promise.resolve(cd);
  }
  return Promise.resolve([]);
};

const call = (cd) =>
  DB_ROUTES.company(fakeDb(cd), { eik: EIK }).then((r) => r.body);

// ── the payload passes through untouched ─────────────────────────────────────────────────
test("a served row reaches the body under `cleanDelivery`", async () => {
  const row = {
    eik: EIK,
    name: "БУЛГЕД ООД",
    on_time_contracts: 4,
    clean_contracts: "2",
    programmes: ["Иновации и конкурентоспособност"],
    absence_meaning: "Отсъствието от тези списъци НЕ означава…",
    beneficiary_listed: true,
    contracts: [{ contract_number: "BG-RRP-3.008-0282" }],
  };
  assert.deepEqual((await call([row])).cleanDelivery, row);
});

test("NO ROW is passed through as null — absence is not a zero", async () => {
  // 175 returns no row for an EIK in neither register. The tile mounts on a present row
  // only, because „0 clean contracts" against a named company is an accusation the source
  // cannot support: ИСУН publishes no complement, and OLAF's IMS is confidential.
  assert.equal((await call([])).cleanDelivery, null);
});

test("a NULL `on_time_contracts` survives the route — it is not coalesced to 0", async () => {
  // The contract-only shape (956 EIKs). „Not listed as a correction-free beneficiary" and
  // „listed with zero on-time contracts" are different claims and only the second is a
  // number; the corpus cannot tell them apart (0 of 32,420 rows carry a literal 0), so the
  // NULL is the only carrier of the distinction.
  const row = {
    eik: "000024663",
    name: "ОБЩИНА БАНСКО",
    on_time_contracts: null,
    clean_contracts: "2",
    beneficiary_listed: false,
    contracts: [{ contract_number: "BG05M9OP001-4.001-0126" }],
  };
  const got = (await call([row])).cleanDelivery;
  assert.equal(got.on_time_contracts, null);
  assert.equal(got.beneficiary_listed, false);
  assert.equal(got.contracts.length, 1);
});

// ── the degrade contract ─────────────────────────────────────────────────────────────────
for (const code of ["42P01", "42883", "55000", "55P03", "42501"]) {
  test(`${code} degrades to null and leaves the rest of the company payload served`, async () => {
    const body = await call(err(code));
    assert.equal(body.cleanDelivery, null);
    // The whole point: the OTHER arms still answered. A rejection here would have taken
    // them with it.
    assert.equal(body.eik, EIK);
    assert.ok("procurement" in body && "officers" in body);
  });
}

test("55P03 specifically — a concurrent clean-delivery load must not 500 every company page", async () => {
  // Named separately from the loop because it is the one the first cut missed, and the one
  // whose trigger is a routine publish rather than a first deploy.
  assert.equal((await call(err("55P03"))).cleanDelivery, null);
});

test("42501 specifically — 175's DROP+CREATE can revoke its own EXECUTE", async () => {
  // 175 replaces the function with DROP + CREATE under a role-guarded GRANT, so re-applying
  // it to a database with no `app_readonly` leaves the function LESS privileged than it went
  // in while reporting success. The pool connects as app_readonly.
  assert.equal((await call(err("42501"))).cleanDelivery, null);
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
