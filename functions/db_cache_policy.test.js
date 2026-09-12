const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { LIVE_QUERY_ROUTES, dbCacheControl } = require("./db_cache_policy");

test("query results, failures and capability changes cannot be cached", () => {
  for (const route of LIVE_QUERY_ROUTES)
    for (const status of [200, 400, 404, 500])
      assert.equal(dbCacheControl(route, status), "no-store");
  assert.match(dbCacheControl("company", 200), /s-maxage=3600/);
  assert.equal(dbCacheControl("company", 500), null);
});

test("hosting overrides its generic API cache after the wildcard rule", () => {
  const config = JSON.parse(readFileSync(require.resolve("../firebase.json"), "utf8"));
  const headers = config.hosting.find((h) => h.target === "main").headers;
  const wildcard = headers.findIndex((h) => h.source === "/api/db/**");
  for (const route of LIVE_QUERY_ROUTES) {
    const i = headers.findIndex((h) => h.source === "/api/db/" + route);
    assert(i > wildcard, route);
    assert.equal(headers[i].headers.find((h) => h.key === "Cache-Control").value, "no-store");
  }
});
