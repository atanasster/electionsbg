// The db:sync:cloud parity gate (parityShortfalls). A --clean pg_restore exits 0
// even when it silently drops-not-recreates a table whose CREATE failed — the
// failure that wiped the tr_* subgraph on Cloud SQL in 2026-07 and was only
// noticed hours later. This pins the pure comparison the gate runs after every
// restore so that class of silent corruption always aborts the sync loudly.

import { test } from "vitest";
import assert from "node:assert/strict";
import { parityShortfalls, type TableCount } from "./sync_cloud";

test("a silently-dropped table (target 0) is a shortfall", () => {
  const short = parityShortfalls([
    { table: "tr_companies", src: 1_019_272, tgt: 0 },
  ]);
  assert.deepEqual(
    short.map((c) => c.table),
    ["tr_companies"],
  );
});

test("a fully-restored table is not a shortfall", () => {
  const short = parityShortfalls([
    { table: "contracts", src: 407_558, tgt: 407_558 },
  ]);
  assert.deepEqual(short, []);
});

test("under 90% trips; at/over 90% does not (live-write tolerance)", () => {
  // 89% → shortfall; 90% and 95% → OK. The 90% floor keeps a churning table's
  // in-flight writes from false-alarming while still catching a real loss.
  const rows: TableCount[] = [
    { table: "at89", src: 1000, tgt: 890 },
    { table: "at90", src: 1000, tgt: 900 },
    { table: "at95", src: 1000, tgt: 950 },
  ];
  assert.deepEqual(
    parityShortfalls(rows).map((c) => c.table),
    ["at89"],
  );
});

test("a table absent from the source (src 0) is skipped, not flagged", () => {
  // Nothing to assert against — a table the source doesn't have must never make
  // the gate fail, or every optional/derived table would block a valid sync.
  assert.deepEqual(parityShortfalls([{ table: "x", src: 0, tgt: 0 }]), []);
});

test("mixed set reports only the shortfalls, preserving order", () => {
  const rows: TableCount[] = [
    { table: "contracts", src: 407_558, tgt: 407_558 }, // ok
    { table: "tr_companies", src: 1_019_272, tgt: 0 }, // dropped
    { table: "tenders", src: 232_340, tgt: 232_340 }, // ok
    { table: "tr_officers", src: 751_328, tgt: 12 }, // partial
  ];
  assert.deepEqual(
    parityShortfalls(rows).map((c) => c.table),
    ["tr_companies", "tr_officers"],
  );
});
