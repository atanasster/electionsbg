// Unit coverage for the schools-loader math (scripts/db/lib/school_stats.ts).
// Pure — no Postgres, no filesystem — so it always runs under `npm run test:data`
// (unlike the Tier-3 schools_pg test, which skips when the DB is absent). Pins
// the exact rules the loader depends on: the ДЗИ↔НВО year lag, the OLS null
// guard, and the ±0.5·SD verdict banding — a silent off-by-one in any of these
// would otherwise pass every DB-level assertion.

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  ols,
  bandVerdict,
  nvoPriorOf,
  NVO_LAG_YEARS,
  VERDICT_BAND_SD,
} from "../lib/school_stats";

test("nvoPriorOf pairs ДЗИ year Y with НВО year Y − 5", () => {
  const nvo = { "2021": { bel: 61.4 }, "2020": { bel: 55.0 } };
  // ДЗИ 2026 cohort sat 7th-grade НВО in 2021 — not 2020, not null.
  assert.equal(NVO_LAG_YEARS, 5);
  assert.equal(nvoPriorOf(nvo, 2026), 61.4);
  assert.equal(nvoPriorOf(nvo, 2025), 55.0);
});

test("nvoPriorOf is null for a missing НВО year or unknown latest year", () => {
  const nvo = { "2021": { bel: 61.4 } };
  assert.equal(nvoPriorOf(nvo, 2030), null); // needs НВО 2025 — absent
  assert.equal(nvoPriorOf(nvo, null), null);
  assert.equal(nvoPriorOf(undefined, 2026), null);
  assert.equal(nvoPriorOf({ "2021": {} }, 2026), null); // year present, no bel
});

test("ols returns null below 30 points, fits above", () => {
  const under = Array.from({ length: 29 }, (_, i) => ({ x: i, y: i }));
  assert.equal(ols(under), null);

  // Exactly y = 2x + 1 over 30 points → slope 2, intercept 1, residualSd → 1
  // (perfect fit falls back to 1, never 0, so the banding cut is well-defined).
  const line = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 2 * i + 1 }));
  const r = ols(line);
  assert.ok(r, "expected a regression at 30 points");
  assert.ok(Math.abs(r.slope - 2) < 1e-9, `slope ${r.slope}`);
  assert.ok(Math.abs(r.intercept - 1) < 1e-9, `intercept ${r.intercept}`);
  assert.equal(r.residualSd, 1);
  assert.equal(r.n, 30);
});

test("bandVerdict bands at ±VERDICT_BAND_SD·residualSd", () => {
  const sd = 0.8;
  const cut = VERDICT_BAND_SD * sd; // 0.4
  assert.equal(bandVerdict(cut + 0.01, sd), "above");
  assert.equal(bandVerdict(-cut - 0.01, sd), "under");
  assert.equal(bandVerdict(cut, sd), "expected"); // exactly on the edge
  assert.equal(bandVerdict(-cut, sd), "expected");
  assert.equal(bandVerdict(0, sd), "expected");
});
