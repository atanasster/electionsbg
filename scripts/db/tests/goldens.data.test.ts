// Tier 2 — golden-fixture comparison. For each committed fixture under
// scripts/db/__golden__/procurement/, the live file (run-stamps stripped) must
// deep-equal the snapshot. This is the human-readable half of the byte-level
// net: when the manifest flags a category as changed, the relevant golden shows
// exactly which fields moved.
//
// Gated on DB_VERIFY=1 (via `npm run db:verify`) so the fortnightly data update
// doesn't fail the standing suite — refresh the baseline with `npm run db:goldens`.
//
// See docs/plans/sql-migration-v1.md (Phase 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROC_DIR, GOLDEN_DIR } from "../lib/paths";
import { walkJsonFiles, canonicalObject } from "../lib/canonical";

const verify = process.env.DB_VERIFY === "1";
const haveGoldens = existsSync(GOLDEN_DIR);
const haveData = existsSync(path.join(PROC_DIR, "index.json"));

const skip = !verify
  ? "set DB_VERIFY=1 (npm run db:verify) to run golden comparison"
  : !haveData
    ? "no procurement data on disk"
    : !haveGoldens
      ? "no golden fixtures — run npm run db:goldens"
      : false;

test("live procurement files match golden fixtures", { skip }, () => {
  const goldens = haveGoldens ? walkJsonFiles(GOLDEN_DIR) : [];
  assert.ok(goldens.length > 0, "no golden fixtures found");
  const missing: string[] = [];
  const differing: string[] = [];
  for (const goldenAbs of goldens) {
    const rel = path.relative(GOLDEN_DIR, goldenAbs);
    const liveAbs = path.join(PROC_DIR, rel);
    if (!existsSync(liveAbs)) {
      missing.push(rel);
      continue;
    }
    const expected = JSON.parse(readFileSync(goldenAbs, "utf8"));
    const actual = canonicalObject(liveAbs);
    try {
      assert.deepStrictEqual(actual, expected);
    } catch {
      differing.push(rel);
    }
  }
  assert.equal(
    missing.length,
    0,
    `golden target(s) absent from live corpus: ${missing.join(", ")}`,
  );
  assert.equal(
    differing.length,
    0,
    `golden fixture(s) differ from live: ${differing.join(", ")} — inspect the ` +
      `diff, then refresh with npm run db:goldens if the change is intended`,
  );
});
