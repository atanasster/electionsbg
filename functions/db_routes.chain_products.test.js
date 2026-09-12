const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes.js");

test("chain products names an unranked chain and withholds misattributed prices", async () => {
  const result = await DB_ROUTES["price-payload"](
    async (sql, params) => {
      assert.deepEqual(params, ["130007884"]);
      assert.match(sql, /p.payload->>'asOf'/);
      return [
        {
          chain: "Билла",
          sourceConflict: true,
          payload: {
            products: [{ title: "НАКЛОФЕН", price: 2.03 }],
            asOf: "2026-09-11",
          },
        },
      ];
    },
    { kind: "chain-products", key: "130007884" },
  );
  assert.equal(result.body.chain, "Билла");
  assert.equal(result.body.sourceConflict, "chain-store-mismatch");
  assert.deepEqual(result.body.products, []);
  assert.equal(result.body.asOf, "2026-09-11");
});

test("a corrected source retains its product prices", async () => {
  const products = [{ title: "Хляб", price: 1.29 }];
  const result = await DB_ROUTES["price-payload"](
    async () => [
      { chain: "Билла", sourceConflict: false, payload: { products } },
    ],
    { kind: "chain-products", key: "130007884" },
  );
  assert.deepEqual(result.body.products, products);
  assert.equal(result.body.sourceConflict, null);
});

test("a chain without a product blob still has a name and an empty list", async () => {
  const result = await DB_ROUTES["price-payload"](
    async () => [{ chain: "Билла", payload: null, sourceConflict: false }],
    { kind: "chain-products", key: "130007884" },
  );
  assert.equal(result.body.chain, "Билла");
  assert.deepEqual(result.body.products, []);
});

test("an unknown chain returns null", async () => {
  const result = await DB_ROUTES["price-payload"](async () => [], {
    kind: "chain-products",
    key: "unknown",
  });
  assert.equal(result.body, null);
});

test("other payload kinds keep the original lookup", async () => {
  const result = await DB_ROUTES["price-payload"](
    async (sql, params) => {
      assert.deepEqual(params, ["chains", ""]);
      assert.doesNotMatch(sql, /price_stores/);
      return [{ payload: { national: [] } }];
    },
    { kind: "chains" },
  );
  assert.deepEqual(result.body, { national: [] });
});
