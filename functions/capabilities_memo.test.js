const test = require("node:test");
const assert = require("node:assert/strict");
const { memoCapabilities, __resetCapabilitiesMemo } = require("./capabilities_memo");

test("concurrent and repeat calls share one probe", async () => {
  __resetCapabilitiesMemo();
  let calls = 0;
  const route = memoCapabilities("x", async () => ({ body: { n: ++calls } }));
  const [a, b] = await Promise.all([route(null, {}), route(null, {})]);
  assert.equal(a.body.n, 1);
  assert.equal(b.body.n, 1);
  assert.equal((await route(null, {})).body.n, 1);
  assert.equal(calls, 1);
});

test("a rollback flag is part of the key, so it takes effect at once", async () => {
  __resetCapabilitiesMemo();
  const before = process.env.FUNDING_QUERY_DISABLED;
  const route = memoCapabilities("y", async () => ({
    body: { disabled: process.env.FUNDING_QUERY_DISABLED === "1" },
  }));
  try {
    delete process.env.FUNDING_QUERY_DISABLED;
    assert.equal((await route(null, {})).body.disabled, false);
    process.env.FUNDING_QUERY_DISABLED = "1";
    assert.equal((await route(null, {})).body.disabled, true);
  } finally {
    if (before === undefined) delete process.env.FUNDING_QUERY_DISABLED;
    else process.env.FUNDING_QUERY_DISABLED = before;
  }
});

test("failures are not kept", async () => {
  __resetCapabilitiesMemo();
  let calls = 0;
  const thrower = memoCapabilities("z", async () => {
    calls++;
    throw Error("boom");
  });
  await assert.rejects(thrower(null, {}));
  await assert.rejects(thrower(null, {}));
  assert.equal(calls, 2);
  let n = 0;
  const erroring = memoCapabilities("w", async () => ({ status: 500, body: { n: ++n } }));
  await erroring(null, {});
  await new Promise((r) => setImmediate(r));
  assert.equal((await erroring(null, {})).body.n, 2);
});
