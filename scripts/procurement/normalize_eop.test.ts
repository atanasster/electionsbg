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
import {
  parseBgNumber,
  resolveSupplierEik,
  normalizeEopDay,
} from "./normalize_eop";

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

// ── resolveSupplierEik — the ЕОП flat-feed supplier resolver. A clean BG EIK
// passes through; BG-VAT / "ЕИК …" / space-grouped ids are recovered as BG; a
// numeric-looking foreign id is NOT mis-read as BG; and anonymised markers become
// identity-less rows (so the value lands on the buyer, keyed by no contractor).

test("resolveSupplierEik: passes a clean 9-digit BG EIK through", () => {
  assert.deepEqual(resolveSupplierEik("131234567"), {
    eik: "131234567",
    foreign: false,
  });
});

test("resolveSupplierEik: recovers a BG-VAT-prefixed id", () => {
  const r = resolveSupplierEik("BG104529087");
  assert.equal(r.foreign, false);
  assert.equal(r.eik, "104529087");
});

test("resolveSupplierEik: recovers an 'ЕИК '-prefixed id", () => {
  const r = resolveSupplierEik("ЕИК 205994492");
  assert.equal(r.foreign, false);
  assert.equal(r.eik, "205994492");
});

test("resolveSupplierEik: recovers a space-grouped BG EIK", () => {
  assert.equal(resolveSupplierEik("827 184 123").eik, "827184123");
});

test("resolveSupplierEik: does NOT mis-read a 10-digit foreign id as BG", () => {
  assert.equal(resolveSupplierEik("821-24-77-136").foreign, true);
});

test("resolveSupplierEik: unpublished + new markers are identity-less", () => {
  for (const m of ["не се публикува", "н/д", "неизвестен", "—", "N.A."]) {
    assert.deepEqual(
      resolveSupplierEik(m),
      { eik: "", foreign: true },
      `marker ${JSON.stringify(m)} should be identity-less`,
    );
  }
});

test("resolveSupplierEik: keeps a genuine foreign vendor keyed by its id", () => {
  assert.equal(resolveSupplierEik("HRB 12345").foreign, true);
});

// ── FINDING-001 regression: a multi-supplier award whose suppliers ALL resolve
// to an empty contractor id must not lose value at the month-shard rowKey merge.
// normalizeEopDay emits one row per supplier (both identity-less → identical
// rowKey), which the ingest merge collapses to one; splitting by the raw supplier
// count would divide the value by phantom rows that then merge away. De-dup by
// key here to simulate that merge, then assert the full value survives.
test("normalizeEopDay: all-anonymous multi-supplier keeps full value after key-merge", () => {
  const { rows } = normalizeEopDay(
    [
      {
        contractNumber: "1",
        buyerRegistryNumber: "000695089",
        contractValue: "1000000",
        contractCurrency: "EUR",
        supplierRegisterNumber: "не се публикува; не се публикува",
      },
    ],
    "2026-06-12",
    "http://x",
  );
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byKey.set(r.key, r);
  const total = [...byKey.values()].reduce((s, r) => s + (r.amount ?? 0), 0);
  assert.equal(total, 1000000);
});
