// Route-level tests for /api/db/procurement-settlement — the shape contract the tiles and
// the settlement page depend on. The SQL is covered by
// scripts/db/tests/procurement_settlement_scope.data.test.ts; this covers the JS layer,
// where the payload is trimmed.
//
// The load-bearing property is `awarderCount`. The tiles used to read `awarders.length`
// for their "buyers" KPI; under the ?slim shape that array is truncated to five, so
// without a separate count every settlement in the country would report "5 buyers" — a
// wrong number rendered confidently, with nothing failing.
//
// No DB: the handler is (dbRows, query) => Promise<{ body }>. Run: cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES } = require("./db_routes.js");

const handler = DB_ROUTES["procurement-settlement"];

const payload = (n) => ({
  ekatte: "10135",
  name: "Варна",
  contractCount: 15079,
  totalEur: 3622680723,
  awarders: Array.from({ length: n }, (_, i) => ({
    eik: String(i),
    name: `Buyer ${i}`,
    totalEur: 1,
  })),
  topContracts: [{ key: "abc", amountEur: 1 }],
  byYear: [],
});

const db = (rows) => async () => rows;

test("drops topContracts from the default shape", async () => {
  const { body } = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
  });
  assert.equal(body.topContracts, undefined, "no consumer reads it");
  assert.equal(body.awarders.length, 112, "the full list is served");
  assert.equal(body.contractCount, 15079, "the totals survive");
});

test("awarderCount is the TRUE count in both shapes", async () => {
  const full = await handler(db([{ r: payload(112) }]), { ekatte: "10135" });
  assert.equal(full.body.awarderCount, 112);

  const slim = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
    slim: "1",
  });
  assert.equal(slim.body.awarders.length, 5, "the list is truncated");
  assert.equal(
    slim.body.awarderCount,
    112,
    "but the count still describes the settlement, not the slice",
  );
});

test("?limit is clamped, and never widens past the real list", async () => {
  const big = await handler(db([{ r: payload(112) }]), {
    ekatte: "10135",
    slim: "1",
    limit: "999",
  });
  assert.equal(big.body.awarders.length, 50, "clamped to the ceiling");

  const small = await handler(db([{ r: payload(3) }]), {
    ekatte: "10135",
    slim: "1",
    limit: "20",
  });
  assert.equal(small.body.awarders.length, 3, "a short list stays short");
});

test("slim is parsed as a boolean, not as string truthiness", async () => {
  // `?slim=0` and `?slim=false` are the first spellings a caller reaches for; a bare
  // `?slim` is what an HTML form emits. Reading the raw string would invert all three.
  for (const q of [{ slim: "0" }, { slim: "false" }, { slim: "no" }]) {
    const { body } = await handler(db([{ r: payload(112) }]), {
      ekatte: "10135",
      ...q,
    });
    assert.equal(
      body.awarders.length,
      112,
      `${JSON.stringify(q)} must mean FULL`,
    );
  }
  for (const q of [{ slim: "" }, { slim: "1" }, { slim: "true" }]) {
    const { body } = await handler(db([{ r: payload(112) }]), {
      ekatte: "10135",
      ...q,
    });
    assert.equal(
      body.awarders.length,
      5,
      `${JSON.stringify(q)} must mean SLIM`,
    );
  }
});

test("a missing ekatte is a 400, and an unknown one is a null body", async () => {
  const bad = await handler(db([]), {});
  assert.equal(bad.status, 400);

  const none = await handler(db([{ r: null }]), { ekatte: "00000" });
  assert.equal(none.body, null, "no settlement → null, not an empty shell");
});

test("a null awarders array cannot reach the client as a non-array", async () => {
  // The type declares `awarders` non-optional; a shape guard applied to only one branch
  // would let the full response through with `awarders: null` and crash every consumer
  // that maps over it.
  const { body } = await handler(
    db([{ r: { ...payload(0), awarders: null } }]),
    {
      ekatte: "10135",
    },
  );
  assert.ok(Array.isArray(body.awarders), "always an array");
  assert.equal(body.awarderCount, 0);
});
