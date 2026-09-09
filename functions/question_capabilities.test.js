const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTRACT_VERSION,
  EXPECTED_FUNCTION_RESULT,
  REQUIRED_RELATIONS,
  readQuestionCapabilities,
} = require("./question_capabilities");

const columnRows = (complete = true) =>
  Object.entries(REQUIRED_RELATIONS).flatMap(([table_name, columns]) =>
    columns
      .filter((column) => complete || column !== "source_sha256")
      .map((column_name) => ({ table_name, column_name })),
  );

test("publishes schema and source versions only for a complete serving contract", async () => {
  const calls = [];
  const manifest = await readQuestionCapabilities({
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: columnRows() };
      if (calls.length === 2)
        return {
          rows: [
            {
              present: true,
              executable: true,
              result: EXPECTED_FUNCTION_RESULT,
            },
          ],
        };
      return {
        rows: [
          {
            election_type: "parliamentary",
            source_material: "p:source:granular",
            latest_period: "2026-04-19",
            contest_count: 18,
          },
          {
            election_type: "presidential",
            source_material: "r:source:granular",
            latest_period: "2021-11-21",
            contest_count: 5,
          },
        ],
      };
    },
  });
  assert.equal(manifest.contractVersion, CONTRACT_VERSION);
  assert.equal(manifest.schemaVersion, 195);
  assert.match(manifest.sourceVersion, /^[a-f0-9]{64}$/);
  assert.equal(manifest.latestPeriod, "2026-04-19");
  assert.deepEqual(
    manifest.capabilities.map(({ id, ready }) => ({ id, ready })),
    [
      { id: "nationalResults", ready: true },
      { id: "presidentialResults", ready: true },
    ],
  );
  assert.ok(calls[2].sql.includes("c.granular_reconciled"));
  assert.ok(calls[2].sql.includes("EXISTS"));
  assert.ok(calls[2].sql.includes("granular_sha256"));
});

test("keeps guarded recipes unavailable on an older or partial schema", async () => {
  let calls = 0;
  const manifest = await readQuestionCapabilities({
    query: async () => {
      calls += 1;
      return { rows: columnRows(false) };
    },
  });
  assert.equal(
    calls,
    1,
    "must not inspect a function or read a relation on a partial schema",
  );
  assert.equal(manifest.schemaVersion, null);
  assert.equal(manifest.sourceVersion, null);
  assert.ok(manifest.capabilities.every((item) => !item.ready));
});

test("does not advertise recipes when the exact function signature is absent", async () => {
  let calls = 0;
  const manifest = await readQuestionCapabilities({
    query: async () => {
      calls += 1;
      return calls === 1
        ? { rows: columnRows() }
        : {
            rows: [
              {
                present: false,
                executable: false,
                result: null,
              },
            ],
          };
    },
  });
  assert.equal(calls, 2);
  assert.equal(manifest.schemaVersion, null);
  assert.ok(manifest.capabilities.every((item) => !item.ready));
});

test("does not advertise an empty migrated database", async () => {
  let calls = 0;
  const manifest = await readQuestionCapabilities({
    query: async () => {
      calls += 1;
      if (calls === 1) return { rows: columnRows() };
      if (calls === 2)
        return {
          rows: [
            {
              present: true,
              executable: true,
              result: EXPECTED_FUNCTION_RESULT,
            },
          ],
        };
      return { rows: [] };
    },
  });
  assert.equal(calls, 3);
  assert.equal(manifest.schemaVersion, 195);
  assert.equal(manifest.sourceVersion, null);
  assert.equal(manifest.latestPeriod, null);
  assert.ok(manifest.capabilities.every((item) => !item.ready));
});

test("requires the exact return contract and current-user execute privilege", async () => {
  for (const row of [
    {
      present: true,
      executable: false,
      result: EXPECTED_FUNCTION_RESULT,
    },
    { present: true, executable: true, result: "TABLE(other text)" },
  ]) {
    let calls = 0;
    const manifest = await readQuestionCapabilities({
      query: async () => {
        calls += 1;
        return calls === 1 ? { rows: columnRows() } : { rows: [row] };
      },
    });
    assert.equal(calls, 2);
    assert.equal(manifest.schemaVersion, null);
    assert.ok(manifest.capabilities.every((item) => !item.ready));
  }
});
