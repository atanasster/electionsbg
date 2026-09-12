const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compileRollcallQuery,
  runRollcallQuery,
  rollcallCapabilities,
} = require("./rollcall_query");
test("hostile title text stays bound", () => {
  const q = compileRollcallQuery({
    corpus: "parliamentVotes",
    keyword: "x%' OR TRUE --",
  });
  assert(!q.sql.includes("x%'"));
  assert(q.params.includes("%x\\%' OR TRUE --%"));
});
test("missing source and timeout are unavailable, never empty", async () => {
  for (const code of ["42P01", "42501", "57014"]) {
    const r = await runRollcallQuery(
      () => {
        throw Object.assign(Error(), { code });
      },
      { corpus: "parliamentVotes" },
    );
    assert.equal(r.body.status, "unavailable");
  }
});
test("rollback switch stops queries and suppresses capabilities", async () => {
  const before = process.env.ROLLCALL_QUERY_DISABLED;
  process.env.ROLLCALL_QUERY_DISABLED = "1";
  try {
    const db = () => {
      throw Error("must not query");
    };
    assert.equal(
      (await runRollcallQuery(db, {})).body.reason,
      "capability_disabled",
    );
    assert.deepEqual((await rollcallCapabilities(db)).body.corpora, {});
  } finally {
    if (before === undefined) delete process.env.ROLLCALL_QUERY_DISABLED;
    else process.env.ROLLCALL_QUERY_DISABLED = before;
  }
});
test("bad fields and unsupported metrics do not execute SQL", async () => {
  let calls = 0;
  for (const q of [
    { corpus: "parliamentVotes", constructor: "x" },
    { corpus: "parliamentCasts", metric: "alignment" },
    { corpus: "councilCasts" },
  ])
    assert.equal(
      (
        await runRollcallQuery(() => {
          calls++;
        }, q)
      ).body.status,
      "unsupported",
    );
  assert.equal(calls, 0);
});
test("resolver and capability revisions share their evidence statement", async () => {
  const { rollcallEntities } = require("./rollcall_query");
  let calls = 0;
  const db = async (sql) => {
    calls++;
    assert(sql.includes("rollcall_query_revisions"));
    return [{ rows: [], revision: "same-snapshot" }];
  };
  assert.equal(
    (await rollcallEntities(db, { name: "Test Person" })).body.revision,
    "same-snapshot",
  );
  assert.equal(calls, 1);
  calls = 0;
  assert.equal((await rollcallCapabilities(db)).body.revision, "same-snapshot");
  assert.equal(calls, 1);
});
