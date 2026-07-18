// Unit tests for the pure parser layer of the НЗОК clinical-activity corpus — the
// code most likely to break silently when НЗОК reshuffles a column or a caption.
// All three units are pure (no I/O), so they lock cheaply.
//
//   npm run test:nzok
//
// `num` has genuinely subtle thousands-vs-decimal comma handling; `derivePeriod`
// parses free-text sheet names; `parseActivities` folds the (facility × procedure
// × ICD × ICD) grain up to (facility, procedure), summing cases + ЗОЛ.

import { test } from "vitest";
import assert from "node:assert/strict";
import * as xlsx from "xlsx";
import { num, derivePeriod, parseActivities } from "./parse_activities";

// --- num() — the subtle one -------------------------------------------------
test("num: passes JS numbers through untouched", () => {
  assert.equal(num(42), 42);
  assert.equal(num(0), 0);
});
test("num: strips a thousands separator (comma before 3 digits)", () => {
  assert.equal(num("1,234"), 1234);
  assert.equal(num("12,345"), 12345);
});
test("num: keeps a lone comma as a decimal separator", () => {
  assert.equal(num("12,5"), 12.5);
  assert.equal(num("1,2345"), 1.2345);
});
test("num: strips whitespace thousands groups", () => {
  assert.equal(num("1 234"), 1234);
});
test("num: blank / non-numeric → 0", () => {
  assert.equal(num(""), 0);
  assert.equal(num(null), 0);
  assert.equal(num("—"), 0);
});

// --- derivePeriod() ---------------------------------------------------------
test("derivePeriod: maps a Bulgarian sheet caption to MM.YYYY", () => {
  assert.equal(derivePeriod("Данни за Декември 2025"), "12.2025");
  assert.equal(derivePeriod("Данни за Май 2026"), "05.2026");
});
test("derivePeriod: returns '' when month or year is missing", () => {
  assert.equal(derivePeriod("Данни за 2025"), "");
  assert.equal(derivePeriod("Декември без година"), "");
  assert.equal(derivePeriod(""), "");
});

// --- parseActivities() — diagnosis-grain folding ----------------------------
// Build a tiny in-memory workbook in the real source shape: row 0 title, row 1
// header, data from row 2. Columns: РЗОК, Име ЛЗБП, КП/АПр/КПр, осн. дг, втор. дг,
// брой случаи, брой ЗОЛ.
const buildBook = (rows: unknown[][]): Buffer => {
  const aoa = [
    ["Отчетени брой случаи и брой ЗОЛ …"],
    ["РЗОК", "Име ЛЗБП", "КП/AПр/КПр", "Основна", "Вторична", "Случаи", "ЗОЛ"],
    ...rows,
  ];
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Данни за Декември 2025");
  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

test("parseActivities: folds two ICD pairs of one (facility, procedure) into one summed row", () => {
  const buf = buildBook([
    ["01", "МБАЛ Тест ЕООД", "A19", "H25.1", "E11.3", 3, 3],
    ["01", "МБАЛ Тест ЕООД", "A19", "H25.2", "I11.9", 5, 4],
  ]);
  const { period, rows } = parseActivities(buf);
  assert.equal(period, "12.2025");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    rzok: "01",
    facility: "МБАЛ Тест ЕООД",
    procedure: "A19",
    cases: 8,
    zol: 7,
  });
});

test("parseActivities: keeps distinct procedures separate", () => {
  const buf = buildBook([
    ["01", "МБАЛ Тест ЕООД", "A19", "H25.1", "", 3, 3],
    ["01", "МБАЛ Тест ЕООД", "P265.1", "M54.5", "", 2, 2],
  ]);
  const { rows } = parseActivities(buf);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.procedure).sort(), ["A19", "P265.1"]);
});

test("parseActivities: skips blank-facility / blank-procedure rows", () => {
  const buf = buildBook([
    ["01", "", "A19", "H25.1", "", 3, 3], // blank facility
    ["01", "МБАЛ Тест ЕООД", "", "H25.1", "", 3, 3], // blank procedure
    ["01", "МБАЛ Тест ЕООД", "A19", "H25.1", "", 1, 1], // kept
  ]);
  const { rows } = parseActivities(buf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cases, 1);
});
