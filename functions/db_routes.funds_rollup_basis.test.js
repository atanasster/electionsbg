// awarder-funds-rollup ?basis=grant (transport-hub-v1 D6/A11): opt-in, echoed, and
// the default call — water's useVik and the AI tool — stays on fund_beneficiaries.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DB_ROUTES } = require("./db_routes");

const capture = async (q) => {
  const calls = [];
  const r = await DB_ROUTES["awarder-funds-rollup"](async (sql, params) => {
    calls.push({ sql, params });
    return [{ eik: "130823243" }];
  }, q);
  return { r, calls };
};

test("the default call reads fund_beneficiaries and carries no basis key", async () => {
  const { r, calls } = await capture({ eiks: "130823243" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM fund_beneficiaries/);
  assert.deepEqual(Object.keys(r.body), ["operators"]);
});

test("basis=grant reads fund_projects and echoes its basis", async () => {
  const { r, calls } = await capture({ eiks: "130823243", basis: "grant" });
  assert.match(calls[0].sql, /FROM fund_projects/);
  assert.match(calls[0].sql, /sum\(grant_eur\)/);
  assert.equal(r.body.basis, "grant");
  assert.deepEqual(calls[0].params, [["130823243"]]);
});

test("an unknown basis falls back to the default, never to SQL", async () => {
  const { r, calls } = await capture({ eiks: "130823243", basis: "x' OR 1" });
  assert.match(calls[0].sql, /FROM fund_beneficiaries/);
  assert.equal(r.body.basis, undefined);
});
