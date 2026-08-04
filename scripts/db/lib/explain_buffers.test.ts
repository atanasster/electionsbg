// Pure, no database — the buffer-ceiling gates that depend on this parser are *.data.test.ts
// files that auto-skip when Postgres is down, so without this the instrument they all measure
// with would be unverified on exactly the machines that run the suite most often.
//
// Its breakage does not announce itself. It surfaced as a ceiling gate's control leg failing
// with "the ceiling no longer discriminates" — a message that reads like data drift, that
// reproduced only inside a full `test:data` run (the cache state is the variable), and that
// took an hour to trace back to a regex.

import { test } from "vitest";
import assert from "node:assert/strict";
import { sumExecutionBuffers } from "./explain_buffers";

const plan = (...body: string[]) =>
  [
    "Result  (cost=0.00..0.26 rows=1 width=32) (actual time=78.3..78.3 rows=1 loops=1)",
    ...body,
    "Planning:",
    "  Buffers: shared hit=458 read=12",
    "Planning Time: 0.082 ms",
    "Execution Time: 78.376 ms",
  ].map((l) => ({ "QUERY PLAN": l }));

test("counts the whole shared group, whatever the cache state", () => {
  // The defect: `shared` prefixes the group once, so a regex anchored on `shared (hit|read)=`
  // drops the bare `read=`. These two lines are the SAME query, warm and after cache churn.
  assert.equal(
    sumExecutionBuffers(plan("  Buffers: shared hit=3684 read=7545")),
    11229,
  );
  assert.equal(
    sumExecutionBuffers(plan("  Buffers: shared hit=11 read=11218")),
    11229,
  );

  // Postgres omits zero-valued counters, so each end of that range appears alone.
  assert.equal(
    sumExecutionBuffers(plan("  Buffers: shared read=11229")),
    11229,
  );
  assert.equal(sumExecutionBuffers(plan("  Buffers: shared hit=11229")), 11229);
});

test("counts accesses only — not writeback, not the other buffer pools", () => {
  assert.equal(
    sumExecutionBuffers(
      plan(
        "  Buffers: shared hit=80 read=1 dirtied=40 written=30, local hit=99 read=99, temp read=99 written=99",
      ),
    ),
    81,
  );
});

test("excludes the Planning section and sums every execution node", () => {
  // Planning buffers scale with the schema and with which pooled backend ran the query —
  // counting them makes the score depend on test-execution order.
  assert.equal(sumExecutionBuffers(plan("  Buffers: shared hit=81")), 81);

  assert.equal(
    sumExecutionBuffers(
      plan(
        "  ->  Index Scan using idx_person_name_fold on person",
        "        Buffers: shared hit=20 read=2",
        "  ->  Seq Scan on person_alias",
        "        Buffers: shared read=59",
      ),
    ),
    81,
  );
});

test("throws rather than scoring 0 when the format changes", () => {
  // A silent 0 sails under every ceiling — the one direction that must never fail quietly.
  assert.throws(
    () => sumExecutionBuffers([{ "QUERY PLAN": "Seq Scan on person" }]),
    /parser needs updating/,
  );
});
