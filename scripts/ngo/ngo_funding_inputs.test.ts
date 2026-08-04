// Pins the three-tier absence contract of the ngo_funding inputs (gaps plan
// T4.2): a TRACKED input that is missing throws; a curated/optional one is a
// clean empty; a present file parses. Unit-level and DB-free — the regression
// this blocks is a refactor quietly reverting the tracked-tier throw to the
// old `return []`, which loads a silently-halved corpus.

import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertTracked, parseCurated } from "./load_ngo_funding_pg";

const dir = mkdtempSync(path.join(tmpdir(), "ngo-inputs-"));
const missing = path.join(dir, "definitely-absent.json");

test("assertTracked throws on a missing tracked file", () => {
  assert.throws(() => assertTracked(missing), /git-tracked but missing/);
});

test("parseCurated: missing tracked input throws, missing optional input is empty", () => {
  assert.throws(() => parseCurated(missing, "ned", true));
  assert.deepEqual(parseCurated(missing, "ned", false), []);
});

test("parseCurated parses a present curated file with per-row source fallback", () => {
  const f = path.join(dir, "grants.json");
  writeFileSync(
    f,
    JSON.stringify([
      { name: "Фондация X", year: 2024, amountEur: 1000, eik: "123456789" },
      { name: "Y Assoc", source: "abf", funder: "ABF" },
    ]),
  );
  const rows = parseCurated(f, "ned", true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "ned");
  assert.equal(rows[0].vat, "BG123456789");
  assert.equal(rows[1].source, "abf");
  rmSync(dir, { recursive: true, force: true });
});
