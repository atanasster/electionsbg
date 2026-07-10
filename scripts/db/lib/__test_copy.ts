// Round-trip proof for copyRows(): every column type the loaders use, plus the
// text-format metacharacters that a naive encoder corrupts. Run:
//   npx tsx scripts/db/lib/__test_copy.ts
//
// The interesting cases are the ones that silently corrupt rather than throw:
//   · "\\N"        — a literal backslash-N must NOT read back as NULL
//   · ""  vs NULL  — must stay distinct (this is why we use text, not CSV)
//   · tab/newline  — must not split a field or a row
//   · 0.1+0.2      — a double must survive as the same IEEE-754 bits
//   · -0, NaN, Inf — float8 edge values
//   · jsonb        — nested object, and a string containing a quote

import assert from "node:assert/strict";
import { withClient, end } from "./pg";
import { copyRows } from "./copy";

const COLS = ["t", "n_int", "n_dbl", "n_num", "b", "ts", "j"];

const ROWS: unknown[][] = [
  [
    "plain",
    1,
    0.1 + 0.2,
    "12345.6789",
    true,
    new Date("2026-07-10T06:08:57.396Z"),
    { a: 1 },
  ],
  ["", 0, -0, "0", false, null, { s: 'he said "hi"' }],
  [null, null, null, null, null, null, null],
  [
    "back\\slash",
    -5,
    1e21,
    "-0.0001",
    true,
    new Date(0),
    { nested: { x: [1, 2] } },
  ],
  ["literal \\N here", 7, NaN, "1", false, null, []],
  ["tab\there", 8, Infinity, "2", true, null, { u: "ю" }],
  ["new\nline", 9, -Infinity, "3", false, null, null],
  ["carriage\rreturn", 10, 3.14159265358979, "4", true, null, { n: null }],
  [
    "unicode ✓ Кирилица",
    11,
    1.7976931348623157e308,
    "5",
    false,
    null,
    { k: "v" },
  ],
];

const main = async (): Promise<void> => {
  await withClient(async (c) => {
    await c.query("BEGIN");
    await c.query(`CREATE TEMP TABLE copy_probe (
      t text, n_int integer, n_dbl double precision, n_num numeric,
      b boolean, ts timestamptz, j jsonb
    ) ON COMMIT DROP`);

    const n = await copyRows(c, "copy_probe", COLS, ROWS);
    assert.equal(n, ROWS.length, "copyRows returned wrong count");

    const { rows: got } = await c.query(
      `SELECT ${COLS.join(",")} FROM copy_probe ORDER BY n_int NULLS FIRST`,
    );
    assert.equal(got.length, ROWS.length, "row count mismatch after COPY");

    const byInt = new Map(got.map((r) => [r.n_int, r]));

    // NULL row survived as all-NULL.
    const nulls = byInt.get(null);
    assert.ok(nulls, "all-null row missing");
    for (const col of COLS)
      assert.equal(nulls[col], null, `${col} should be NULL`);

    // Empty string is NOT null — the whole reason we use text format.
    const empty = byInt.get(0);
    assert.equal(empty.t, "", "empty string became NULL (CSV bug)");
    assert.notEqual(empty.t, null, "empty string must stay distinct from NULL");
    assert.equal(empty.b, false, "false must not become NULL");

    // A literal backslash-N is text, not a NULL sentinel.
    const litN = byInt.get(7);
    assert.equal(litN.t, "literal \\N here", "literal \\N corrupted");
    assert.ok(Number.isNaN(litN.n_dbl), "NaN did not round-trip");

    // Backslash doubling.
    assert.equal(byInt.get(-5).t, "back\\slash", "backslash corrupted");
    assert.equal(byInt.get(-5).n_dbl, 1e21, "1e21 corrupted");

    // Whitespace metacharacters did not split fields/rows.
    assert.equal(byInt.get(8).t, "tab\there", "tab corrupted");
    assert.equal(byInt.get(9).t, "new\nline", "newline corrupted");
    assert.equal(byInt.get(10).t, "carriage\rreturn", "CR corrupted");

    // Doubles keep their exact bits.
    assert.equal(byInt.get(1).n_dbl, 0.1 + 0.2, "0.1+0.2 lost precision");
    assert.equal(byInt.get(10).n_dbl, 3.14159265358979, "pi lost precision");
    assert.equal(
      byInt.get(11).n_dbl,
      1.7976931348623157e308,
      "MAX_VALUE lost precision",
    );
    assert.equal(byInt.get(8).n_dbl, Infinity, "Infinity lost");
    assert.equal(byInt.get(9).n_dbl, -Infinity, "-Infinity lost");

    // Timestamps land on the same instant.
    assert.equal(
      byInt.get(1).ts.toISOString(),
      "2026-07-10T06:08:57.396Z",
      "timestamptz drifted",
    );
    assert.equal(
      byInt.get(-5).ts.toISOString(),
      "1970-01-01T00:00:00.000Z",
      "epoch drifted",
    );

    // jsonb: quotes, nesting, arrays, unicode, explicit null member.
    assert.deepEqual(
      byInt.get(0).j,
      { s: 'he said "hi"' },
      "jsonb quote corrupted",
    );
    assert.deepEqual(
      byInt.get(-5).j,
      { nested: { x: [1, 2] } },
      "nested jsonb corrupted",
    );
    assert.deepEqual(byInt.get(7).j, [], "empty jsonb array corrupted");
    assert.deepEqual(byInt.get(8).j, { u: "ю" }, "unicode jsonb corrupted");
    assert.deepEqual(
      byInt.get(10).j,
      { n: null },
      "jsonb null member corrupted",
    );

    // numeric keeps its exact decimal text (no float detour).
    assert.equal(byInt.get(1).n_num, "12345.6789", "numeric drifted");
    assert.equal(byInt.get(-5).n_num, "-0.0001", "small numeric drifted");

    // Unicode text.
    assert.equal(
      byInt.get(11).t,
      "unicode ✓ Кирилица",
      "unicode text corrupted",
    );

    await c.query("ROLLBACK");
  });
  console.log(
    `✓ copyRows round-trip: ${ROWS.length} rows, 7 column types, all assertions passed`,
  );
  await end();
};

main().catch(async (e) => {
  console.error(e);
  await end();
  process.exit(1);
});
