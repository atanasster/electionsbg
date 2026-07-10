// Regression lock for parseBgNumber — the shared Bulgarian-decimal parser the
// ЕОП normalizer and the amount-anomaly detector BOTH consume.
//
// The detector once carried a divergent copy that stripped comma-thousands but
// never dot-thousands, so a dot-grouped value like "1.234.567,89" parsed to NaN
// and the anomaly was silently invisible. The copy is gone (both import this
// function); this test pins the contract so it can't regress the same way.
//
//   npx tsx --test scripts/procurement/normalize_eop.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBgNumber } from "./normalize_eop";

// [input, expected]. `undefined` = rejected (blank / non-numeric).
const CASES: [string | number | undefined, number | undefined][] = [
  // The whole point of the unification: dot = thousands when a comma is present.
  ["1.234.567,89", 1234567.89],
  ["20159200,10", 20159200.1],
  ["201592,00", 201592],
  // Space-grouped thousands (the other common shape in the feed).
  ["1 234 567,89", 1234567.89],
  ["10 000 000,00", 10000000],
  // Comma decimal with no grouping.
  ["5112918,81", 5112918.81],
  // No comma at all → dots are NOT stripped (a bare decimal point stays).
  ["1234.56", 1234.56],
  ["1234567", 1234567],
  // Signs.
  ["-4 680", -4680],
  ["-50,5", -50.5],
  // Numeric passthrough.
  [1234.56, 1234.56],
  [0, 0],
  // Rejected.
  ["", undefined],
  ["—", undefined],
  ["  ", undefined],
  [undefined, undefined],
  [NaN, undefined],
];

test("parseBgNumber: Bulgarian decimal shapes, incl. dot-grouped thousands", () => {
  for (const [input, expected] of CASES) {
    assert.equal(
      parseBgNumber(input),
      expected,
      `parseBgNumber(${JSON.stringify(input)}) → expected ${expected}`,
    );
  }
});
