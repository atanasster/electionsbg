// Integration gate for the ngo_board_links human-in-the-loop overrides
// (Tier 1.3). Asserts the two guarantees the public defamation-guard relies on:
//   1. a `promote` override flips a withheld medium link to public 'high';
//   2. a `suppress` override deletes a link, and WINS when the same ref is in
//      both arrays (promote runs first, suppress DELETE is unconditional).
//
// Runs inside a transaction that is always ROLLED BACK, so it never mutates the
// loaded table. Auto-skips when Postgres is unreachable or ngo_board_links is
// absent — matching the other *.data.test.ts gates (see docs/testing-standards.md).

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { withClient, allRows, end } from "../db/lib/pg";
import { applyOverrides } from "./load_ngo_board_links_pg";

afterAll(async () => {
  await end();
});

const reachable = async (): Promise<boolean> => {
  try {
    const [r] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.ngo_board_links') IS NOT NULL AS ok",
    );
    return !!r?.ok;
  } catch {
    return false;
  }
};

test("overrides: promote medium→high, suppress deletes and wins", async () => {
  if (!(await reachable())) return; // auto-skip without Postgres

  await withClient(async (c) => {
    const pick = await c.query<{ eik: string; ref: string }>(
      "SELECT eik, ref FROM ngo_board_links WHERE confidence = 'medium' LIMIT 1",
    );
    const row = pick.rows[0];
    if (!row) return; // no medium rows loaded — nothing to exercise

    await c.query("BEGIN");
    try {
      // promote → high
      const p = await applyOverrides(c, {
        promote: [{ eik: row.eik, ref: row.ref }],
        suppress: [],
      });
      assert.equal(p.promoted, 1, "promote should flip exactly one row");
      const afterPromote = await c.query<{ confidence: string }>(
        "SELECT confidence FROM ngo_board_links WHERE eik = $1 AND ref = $2",
        [row.eik, row.ref],
      );
      assert.equal(afterPromote.rows[0]?.confidence, "high");

      // suppress wins over a concurrent promote on the same ref
      const s = await applyOverrides(c, {
        promote: [{ eik: row.eik, ref: row.ref }],
        suppress: [{ eik: row.eik, ref: row.ref }],
      });
      assert.equal(s.suppressed, 1, "suppress should delete the row");
      const afterSuppress = await c.query(
        "SELECT 1 FROM ngo_board_links WHERE eik = $1 AND ref = $2",
        [row.eik, row.ref],
      );
      assert.equal(
        afterSuppress.rowCount,
        0,
        "row must be gone (suppress wins)",
      );
    } finally {
      await c.query("ROLLBACK");
    }
  });
});
