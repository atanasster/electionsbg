// Route-level unit tests for `company-political` — the /company/:eik political-links tile's
// server-side union of three arms (company_politicians 008, the ИСУН political-by-eik shard, and
// company_political_links 158). The SQL is covered by
// scripts/db/tests/company_political_links.data.test.ts; this pins the JS union layer, which is
// where every property the route exists for actually lives.
//
// No DB: a fake `dbRows` dispatches on the SQL text so each of the five queries can be answered —
// or FAILED — independently. That is the whole point of the fake: the route's contract is that one
// missing migration never blanks the other arms, and only per-query control can test it.
//
// Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog } = require("./db_routes.js");

const EIK = "175155542";

const missing = (code = "42883") =>
  Object.assign(new Error("no migration"), { code });

/** Dispatch on SQL text. Any value may be an Error, which that query then rejects with. */
function fakeDb({
  pg = [],
  pgSlug = [],
  funds = [],
  fundsSlug = [{ slug_map: {} }],
  links = [{ r: null }],
} = {}) {
  const answer = (v) =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  return (sql) => {
    if (sql.includes("company_political_links")) return answer(links);
    if (sql.includes("person_slug_redirect") && sql.includes("fund_payloads"))
      return answer(fundsSlug);
    if (sql.includes("person_slug_redirect")) return answer(pgSlug);
    if (sql.includes("fund_payloads")) return answer(funds);
    if (sql.includes("company_politicians")) return answer(pg);
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  };
}

const body = (opts, q = { eik: EIK }) =>
  DB_ROUTES["company-political"](fakeDb(opts), q).then((r) => r.body);

// ── the defect this route exists to delete ───────────────────────────────────────────────
//
// /company/175155542 printed «Няма установени връзки с политици.» for an NGO chaired by a former
// Deputy PM, because BOTH pre-existing arms are money-gated and the company has neither contracts
// nor EU funds. The person layer alone must be able to answer.
test("a person-layer-only company still yields a direct link (the §1 regression)", async () => {
  const b = await body({
    pg: [],
    funds: [],
    links: [
      {
        r: {
          direct: [
            {
              slug: "mp-2829",
              name: "Красимир Дончев Каракачанов",
              officeSource: "mp",
              officeRole: "mp",
              roles: ["ngo_board", "ngo_representative"],
              linkBasis: "name_match",
            },
          ],
          bridged: [],
        },
      },
    ],
  });
  assert.equal(b.direct.length, 1);
  assert.equal(b.direct[0].slug, "mp-2829");
  assert.equal(b.direct[0].arm, "person_layer");
  assert.deepEqual(b.direct[0].trRoles, ["ngo_board", "ngo_representative"]);
  assert.equal(b.arms.pg, "absent");
  assert.equal(b.arms.funds, "absent");
  assert.equal(b.arms.personLayer, "ok");
});

// ── dedup: the majority case, not an edge case ───────────────────────────────────────────
test("a person in all three arms renders once, and PG wins", async () => {
  const b = await body({
    pg: [
      {
        politician: "Х",
        ref: "/candidate/mp-1",
        kind: "mp",
        role: "director",
        relations: [],
        total_eur: 5,
      },
    ],
    pgSlug: [{ ref: "/candidate/mp-1", person_slug: "mp-1" }],
    funds: [
      {
        payload: {
          mps: [{ mpId: 1, mpName: "Х", relations: [] }],
          officials: [],
        },
      },
    ],
    fundsSlug: [{ slug_map: { "mp-1": "mp-1" } }],
    links: [{ r: { direct: [{ slug: "mp-1", name: "Х" }], bridged: [] } }],
  });
  assert.equal(b.direct.length, 1, "one human, one row");
  assert.equal(
    b.direct[0].arm,
    "pg",
    "PG carries total_eur, so it wins the collision",
  );
  assert.equal(b.direct[0].totalEur, 5);
});

test("a RETIRED mp slug still dedups — the redirect-aware key", async () => {
  // company_politicians names mp-4769; 158 emits its live target mp-4594. Without the redirect
  // in the slug query these are two keys, so the same human renders twice AND escapes the
  // bridged subtraction below.
  const b = await body({
    pg: [
      {
        politician: "Х",
        ref: "/candidate/mp-4769",
        kind: "mp",
        role: null,
        relations: [],
        total_eur: null,
      },
    ],
    pgSlug: [{ ref: "/candidate/mp-4769", person_slug: "mp-4594" }],
    links: [{ r: { direct: [{ slug: "mp-4594", name: "Х" }], bridged: [] } }],
  });
  assert.equal(b.direct.length, 1);
  assert.equal(b.direct[0].slug, "mp-4594");
});

// ── the two arms stay separate, and one human is never in both ───────────────────────────
//
// 158's own data test asserts this INSIDE its payload; the union can break it from outside,
// because a PG-arm person with no person_role at this EIK is absent from 158's direct_role and
// may legitimately appear in its bridged array. Measured on the live corpus: 7 people.
test("a person in the direct block never reappears as a bridged lead", async () => {
  const b = await body({
    pg: [
      {
        politician: "Х",
        ref: "/officials/x-1",
        kind: "official",
        role: "mayor",
        relations: [],
        total_eur: 1,
      },
    ],
    pgSlug: [{ ref: "/officials/x-1", person_slug: "petar-1" }],
    links: [
      {
        r: {
          direct: [],
          bridged: [
            { slug: "petar-1", name: "Х", viaEik: "1", bridgeCompanies: 2 },
            { slug: "other-9", name: "Y", viaEik: "2", bridgeCompanies: 3 },
          ],
        },
      },
    ],
  });
  assert.deepEqual(
    b.bridged.map((x) => x.slug),
    ["other-9"],
    "the direct person is subtracted; the unrelated lead survives",
  );
  assert.equal(
    b.bridgedSuppressedAsDirect,
    1,
    "and the subtraction reports itself",
  );

  // MUTATION CHECK. Without the subtraction the assertion above is satisfied by any
  // implementation that simply returns 158's array — so prove the filter is load-bearing by
  // showing the same input yields the person when nothing is in `direct` to subtract.
  const unfiltered = await body({
    pg: [],
    pgSlug: [],
    links: [
      {
        r: {
          direct: [],
          bridged: [
            { slug: "petar-1", name: "Х", viaEik: "1", bridgeCompanies: 2 },
            { slug: "other-9", name: "Y", viaEik: "2", bridgeCompanies: 3 },
          ],
        },
      },
    ],
  });
  assert.deepEqual(
    unfiltered.bridged.map((x) => x.slug),
    ["petar-1", "other-9"],
    "with no direct row to subtract, both leads survive — so the filter, not the fixture, is what removed it",
  );
  assert.equal(unfiltered.bridgedSuppressedAsDirect, 0);
});

// ── independent degradation ──────────────────────────────────────────────────────────────
test("a missing 158 leaves the other two arms intact", async () => {
  __resetMissLog?.();
  const b = await body({
    pg: [
      {
        politician: "Х",
        ref: "/candidate/mp-1",
        kind: "mp",
        role: null,
        relations: [],
        total_eur: 1,
      },
    ],
    pgSlug: [{ ref: "/candidate/mp-1", person_slug: "mp-1" }],
    links: missing("42883"),
  });
  assert.equal(b.direct.length, 1, "the PG row survives");
  assert.equal(b.arms.personLayer, "unavailable");
  assert.equal(b.arms.pg, "ok");
  assert.deepEqual(b.bridged, []);
});

test("a missing company_politicians leaves the person layer intact", async () => {
  __resetMissLog?.();
  const b = await body({
    pg: missing("42P01"),
    links: [{ r: { direct: [{ slug: "mp-2829", name: "К" }], bridged: [] } }],
  });
  assert.equal(b.arms.pg, "unavailable");
  assert.equal(b.arms.personLayer, "ok");
  assert.equal(b.direct.length, 1);
});

// A missing person layer (106) must cost dedup QUALITY, never rows — the rows are servable from
// 008 alone, and blanking them would make the new tile show LESS than the one it replaces.
test("a missing slug resolver keeps the PG rows, keyed by ref", async () => {
  __resetMissLog?.();
  const b = await body({
    pg: [
      {
        politician: "Х",
        ref: "/officials/x-1",
        kind: "official",
        role: "mayor",
        relations: [],
        total_eur: 2,
      },
    ],
    pgSlug: missing("42883"),
    links: [{ r: { direct: [], bridged: [] } }],
  });
  assert.equal(b.direct.length, 1, "rows survive a missing resolver");
  assert.equal(b.direct[0].slug, null);
  assert.equal(
    b.arms.pg,
    "ok",
    "the ROW arm answered; only the identity side degraded",
  );
});

test("an unexpected error still propagates rather than degrading", async () => {
  await assert.rejects(
    () => body({ links: Object.assign(new Error("boom"), { code: "57014" }) }),
    /boom/,
  );
});

// ── shape guards ─────────────────────────────────────────────────────────────────────────
test("a malformed eik returns a null body without touching the DB", async () => {
  const db = () => {
    throw new Error("should not be called");
  };
  for (const eik of ["", "12345", "abcdefghi", "1234567890123456"]) {
    const r = await DB_ROUTES["company-political"](db, { eik });
    assert.equal(r.body, null, `rejected: ${JSON.stringify(eik)}`);
  }
});

test("arms report CONTRIBUTION, so an empty answer is 'absent' rather than 'ok'", async () => {
  const b = await body({
    pg: [],
    funds: [{ payload: { mps: [], officials: [] } }],
    links: [{ r: { direct: [], bridged: [], directCount: 0 } }],
  });
  assert.equal(b.arms.pg, "absent");
  assert.equal(
    b.arms.funds,
    "absent",
    "a shard row with two empty arrays contributed nothing",
  );
  assert.equal(
    b.arms.personLayer,
    "absent",
    "158 returns a non-null object for every eik, so existence is not contribution",
  );
});

test("a 158 row with no slug gets a fallback key and no /person/null href", async () => {
  const b = await body({
    links: [
      {
        r: {
          direct: [
            { slug: null, name: "А" },
            { slug: null, name: "Б" },
          ],
          bridged: [],
        },
      },
    ],
  });
  assert.equal(b.direct.length, 2, "slug-less rows must not collapse into one");
  assert.deepEqual(
    b.direct.map((d) => d.href),
    [null, null],
  );
});
