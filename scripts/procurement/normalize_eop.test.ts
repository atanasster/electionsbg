// Regression lock for parseBgNumber — the shared Bulgarian-decimal parser the
// ЕОП normalizer and the amount-anomaly detector BOTH consume.
//
// The detector once carried a divergent copy that stripped comma-thousands but
// never dot-thousands, so a dot-grouped value like "1.234.567,89" parsed to NaN
// and the anomaly was silently invisible. The copy is gone (both import this
// function); this test pins the contract so it can't regress the same way.
//
//   npx tsx --test scripts/procurement/normalize_eop.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  parseBgNumber,
  resolveSupplierEik,
  normalizeEopDay,
  resolvePrimaryBuyer,
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

// ── Mixed-consortium members are KEPT. Regression for the defect that started
// docs/plans/procurement-foreign-consortium-members-v1.md: a non-BG member of a mixed
// consortium was dropped (foreign suppliers survived only when a contract had NO BG
// supplier), so УНП 00042-2024-0005 — МТС, €451.5m, 35 electric multiple units — kept 2
// of its 4 suppliers and both Alstom entities vanished. The field values below are
// verbatim from raw_data/procurement/eop/2025-05-02.json.gz, noticeId 686114.
test("normalizeEopDay: keeps every member of a mixed BG+foreign consortium", () => {
  const { rows, stats } = normalizeEopDay(
    [
      {
        contractNumber: "194447",
        uniqueProcurementNumber: "00042-2024-0005",
        buyerRegistryNumber: "000695388",
        buyerName: "МИНИСТЕРСТВО НА ТРАНСПОРТА И СЪОБЩЕНИЯТА",
        contractValue: "883057245,00",
        contractCurrency: "BGN",
        contractDate: "25.04.2025",
        supplierRegisterNumber:
          "181339162; RO6640696; IT02791070044; 207661045",
        supplierName:
          "КОНСОРЦИУМ БУЛЕМУ; ALSTOM TRANSPORT SA; Alstom Ferroviaria SpA; РВП ИНВЕСТ ЕООД",
      },
    ],
    "2025-05-02",
    "http://x",
  );

  // All four suppliers emit a row, with four distinct keys.
  assert.equal(rows.length, 4, "expected one row per supplier");
  assert.equal(
    new Set(rows.map((r) => r.key)).size,
    4,
    "keys must be distinct",
  );
  assert.equal(stats.rowsForeignKept, 2, "both Alstom entities kept");

  // Both Alstom entities are present and identifiable by name.
  const names = rows.map((r) => r.contractorName.toLowerCase());
  assert.ok(
    names.some((n) => n.includes("alstom transport")),
    `ALSTOM TRANSPORT missing from ${JSON.stringify(names)}`,
  );
  assert.ok(
    names.some((n) => n.includes("ferroviaria")),
    `Alstom Ferroviaria missing from ${JSON.stringify(names)}`,
  );

  // The equal-split signature 087's rebuild_consortium() keys on: every row carries the
  // SAME amount and they sum back to the awarded total. Without this the group is not
  // recognised as joint and the value stays fabricated across the members.
  const amounts = rows.map((r) => Math.round((r.amountEur ?? 0) * 100) / 100);
  assert.equal(
    new Set(amounts).size,
    1,
    "all member rows must share one amount",
  );
  const total = amounts.reduce((s, a) => s + a, 0);
  // 883,057,245 BGN at the 1.95583 peg.
  assert.ok(
    Math.abs(total - 883057245 / 1.95583) < 0.05,
    `split must sum back to the awarded total, got ${total}`,
  );
});

// An identity-less token beside real firms must NOT become a member. If it does, 087's
// `_named_carrier` picks it as CARRIER whenever any row in the group is ДЗЗД-named
// (`ORDER BY contractor_eik`, and `'' < '203250840'`), so the whole award value lands on
// `contractor_eik = ''` — which every contractor-side aggregate filters out. Corpus totals
// still reconcile, so nothing fails; the money just stops being attributed to anyone.
// 54 awards / €100.2m. Record verbatim from raw_data/procurement/eop/2021-07-01.json.gz,
// УНП 00024-2021-0005 — note the ДЗЗД name sits beside the withheld id, because an
// unincorporated ДЗЗД has no ЕИК.
test("normalizeEopDay: an identity-less supplier never joins a mixed group", () => {
  const { rows } = normalizeEopDay(
    [
      {
        contractNumber: "1",
        uniqueProcurementNumber: "00024-2021-0005",
        buyerRegistryNumber: "000695089",
        contractValue: "300",
        contractCurrency: "EUR",
        supplierRegisterNumber: "203250840; 205650534; не е наличен",
        supplierName: "МИРО ТРАНС - 86 ЕООД; БГ ЛЕНД КО АД; ДЗЗД „ТРАНС БГ“",
      },
    ],
    "2021-07-01",
    "http://x",
  );
  assert.equal(rows.length, 2, "only the two identified firms should emit");
  assert.ok(
    rows.every((r) => r.contractorEik !== ""),
    `no row may carry an empty contractor id, got ${JSON.stringify(
      rows.map((r) => r.contractorEik),
    )}`,
  );
  // And the split is over 2, not 3 — the dropped row must not take a slot.
  assert.equal(rows[0].amountEur, 150);
  assert.equal(
    rows.reduce((s, r) => s + (r.amountEur ?? 0), 0),
    300,
  );
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

// resolvePrimaryBuyer — the multi-EIK branches the --self-heal runbook now hinges
// on. `prefer` = the retired --only-buyers whitelist; `recoverToPrimary` = the
// cross-source-dedup / --self-heal cadence.
test("resolvePrimaryBuyer: single EIK passes through unchanged", () => {
  assert.deepEqual(resolvePrimaryBuyer("000695089", "АПИ"), {
    eik: "000695089",
    name: "АПИ",
  });
});

test("resolvePrimaryBuyer: multi-EIK is dropped in the general feed", () => {
  assert.deepEqual(
    resolvePrimaryBuyer("175076479999; 000695089", "АДФИ; АПИ"),
    { eik: "", name: "" },
  );
});

test("resolvePrimaryBuyer: --only-buyers recovers under the whitelisted authority", () => {
  assert.deepEqual(
    resolvePrimaryBuyer(
      "175076479999; 000695089",
      "АДФИ; АПИ",
      new Set(["000695089"]),
      false,
    ),
    { eik: "000695089", name: "АПИ" },
  );
});

test("resolvePrimaryBuyer: --self-heal skips the co-listed control organ (АДФИ) → АПИ", () => {
  // The regression guard: without the control-organ skip this returned АДФИ
  // 175076479999 (listed first), mis-attributing АПИ's road contracts.
  assert.deepEqual(
    resolvePrimaryBuyer(
      "175076479999; 000695089",
      "АДФИ; АПИ",
      undefined,
      true,
    ),
    { eik: "000695089", name: "АПИ" },
  );
});

test("resolvePrimaryBuyer: --self-heal keeps the first real buyer when no control organ", () => {
  assert.deepEqual(
    resolvePrimaryBuyer("000695089; 000695388", "АПИ; МТ", undefined, true),
    { eik: "000695089", name: "АПИ" },
  );
});
