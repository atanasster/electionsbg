const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes");
test("funding name lookup depends only on requested source and binds the exact name", async () => {
  for (const [corpus, table] of [
    ["isunProjects", "fund_projects"],
    ["agriPayments", "agri_subsidies"],
    ["interregPartners", "interreg_partners"],
  ]) {
    let call;
    const r = await DB_ROUTES["funding-entities"](
      async (sql, params) => {
        call = { sql, params };
        return [];
      },
      { corpus, name: "Name' OR TRUE" },
    );
    assert.equal(r.status, undefined);
    assert(call.sql.includes("FROM " + table));
    assert(!call.sql.includes("UNION"));
    assert.deepEqual(call.params, ["Name' OR TRUE"]);
  }
  assert.equal(
    (
      await DB_ROUTES["funding-entities"](
        () => {
          throw Error("must not execute");
        },
        { name: "Example", corpus: "injected" },
      )
    ).status,
    400,
  );
});
test("funding endpoint logs normalized outcome without raw identifiers or names", async () => {
  const logs = [],
    old = console.info;
  console.info = (x) => logs.push(JSON.parse(x));
  try {
    await DB_ROUTES["funding-query"](
      () => {
        throw Object.assign(Error(), { code: "57014" });
      },
      {
        query: JSON.stringify({
          corpus: "isunProjects",
          entityIds: ["111111111"],
          keyword: "Private name",
        }),
      },
    );
    assert.equal(logs.length, 1);
    assert.equal(logs[0].reason, "query_timeout");
    assert.equal(logs[0].status, "unavailable");
    assert.equal(typeof logs[0].durationMs, "number");
    assert(!JSON.stringify(logs).includes("111111111"));
    assert(!JSON.stringify(logs).includes("Private name"));
  } finally {
    console.info = old;
  }
});
