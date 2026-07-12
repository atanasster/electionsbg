// Unit tests for the НЗОК activity-feed → EIK resolver. The activity feed spells
// hospitals differently from every other source (town suffix, local abbreviations,
// glued legal form), so the old exact-fold-only join matched only ~31% of
// facilities. These tests lock the behaviour of each recovery tier + the curated
// holdout tables so a future strongFold tweak can't silently regress the match rate
// or, worse, start attaching a WRONG EIK. No database needed.
//
//   npx tsx --test scripts/db/lib/nzok_activity_eik.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  strongFold,
  strongFoldTokens,
  brandTokens,
  buildActivityEikResolver,
  type NamedEik,
} from "./nzok_activity_eik";

test("strongFold: drops legal form, saint prefix, honorific; un-glues fused ЕАД", () => {
  assert.equal(
    strongFold("МБАЛ Д-р Атанас Дафовски АД Кърджали"),
    "МБАЛ АТАНАС ДАФОВСКИ КЪРДЖАЛИ",
  );
  assert.equal(
    strongFold("УМБАЛ Свети Георги ЕАД Пловдив"),
    "УМБАЛ СВ ГЕОРГИ ПЛОВДИВ",
  );
  // The activities feed glues the legal form onto a quoted brand: Черноземски''ЕАД.
  assert.ok(
    strongFoldTokens("УСБАЛО Проф. Иван Черноземски''ЕАД СОФИЯ").includes(
      "ЧЕРНОЗЕМСКИ",
    ),
  );
});

test("brandTokens: strips town, type acronym and generic hospital vocabulary", () => {
  assert.deepEqual(brandTokens("МБАЛ Д-р Атанас Дафовски АД Кърджали"), [
    "АТАНАС",
    "ДАФОВСКИ",
  ]);
  // City-only name → no brand survives (город is filtered, not a brand).
  assert.deepEqual(
    brandTokens("КОМПЛЕКСЕН ОНКОЛОГИЧЕН ЦЕНТЪР БУРГАС ЕООД"),
    [],
  );
});

// A small stand-in for the two EIK-resolved sources.
const PAYMENTS: NamedEik[] = [
  {
    name: "МБАЛ Д-р Атанас Дафовски АД Кърджали",
    eik: "108501669",
    rzok: "09",
  },
  {
    name: "АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА EАД",
    eik: "175077093",
    rzok: "22",
  },
  { name: "Аджибадем Сити клиник УМБАЛ ЕООД", eik: "202139132", rzok: "22" },
  { name: "УМБАЛСМ Н.И. Пирогов ЕАД", eik: "130345786", rzok: "22" },
  {
    name: "УМБАЛ - Проф., Д-р Ст. Киркович АД гр. Стара Загора",
    eik: "123535874",
    rzok: "24",
  },
  // Two same-region hospitals sharing a generic word only — must stay ambiguous.
  { name: "МБАЛ Медицински комплекс Берое ЕООД", eik: "202192245", rzok: "24" },
];
const FINANCIALS: NamedEik[] = [];
const resolve = buildActivityEikResolver(PAYMENTS, FINANCIALS);

test("tier A: exact fold match survives the town suffix", () => {
  assert.equal(
    resolve("МБАЛ ДР АТАНАС ДАФОВСКИ АД", "09 Кърджали"),
    "108501669",
  );
});

test("tier B/C: Пирогов bridges spelling variants within the region", () => {
  assert.equal(
    resolve("УМБАЛСМ Н.И. ПИРОГОВ ЕАД СОФИЯ", "22 София град"),
    "130345786",
  );
});

test("tier D: Токуда wins on max overlap over the shorter sibling brand", () => {
  // Both "…ТОКУДА…" and plain "Аджибадем Сити Клиник" subset the activity name;
  // the distinctive ТОКУДА overlap must pick the Токуда EIK, not the sibling.
  assert.equal(
    resolve("АДЖИБАДЕМ СИТИ КЛИНИК УМБАЛ ТОКУДА СОФИЯ ЕАД", "22 София град"),
    "175077093",
  );
});

test("tier D: Киркович matches despite the Ст./Стоян abbreviation", () => {
  assert.equal(
    resolve(
      "УМБАЛ Проф. д-р Стоян Киркович АД гр. Стара Загора",
      "24 Стара Загора",
    ),
    "123535874",
  );
});

test("no false positive from generic words (Св. Иван Рилски ≠ Берое)", () => {
  // Shares only МЕДИЦИНСКИ/КОМПЛЕКС with Берое — both generic — so must NOT match.
  assert.equal(
    resolve(
      "МБАЛ Медицински комплекс Свети Иван Рилски ЕООД клон гр. Стара Загора",
      "24 Стара Загора",
    ),
    null,
  );
});

test("FORCE table: every МВР facility resolves to the МВР institute", () => {
  assert.equal(resolve("МИ МВР СОФИЯ", "22 София град"), "129007218");
  assert.equal(resolve("БПЛР МИ-МВР филиал Хисар", "16 Пловдив"), "129007218");
});

test("FALLBACK table: abbreviation-only + dialysis holdouts resolve", () => {
  assert.equal(resolve("МБАЛ-ПЗ АД", "13 Пазарджик"), "130072241");
  assert.equal(resolve("ЮЗБ", "01 Благоевград"), "101522447");
  assert.equal(
    resolve("ДЦ Фърст Диализис Сървисиз България ЕАД Пловдив", "16 Пловдив"),
    "131269708",
  );
  assert.equal(
    resolve(
      "ДЦ ФЪРСТ ДИАЛИЗИС СЪРВИСИЗ БЪЛГАРИЯ ЕАД ГР. МОНТАНА",
      "12 Монтана",
    ),
    "131269708",
  );
  assert.equal(
    resolve("УСБАЛО Проф. Иван Черноземски''ЕАД СОФИЯ", "22 София град"),
    "000662776",
  );
});

test("unknown facility stays null (honest)", () => {
  assert.equal(resolve("МС Здраве Пазарджик", "13 Пазарджик"), null);
});
