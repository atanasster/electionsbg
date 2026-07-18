/**
 * Unit tests for resolveOffice(). Run with:
 *   npx tsx --test scripts/declarations/parse_registered_office.test.ts
 *
 * Runs under Vitest (see docs/testing-standards.md). Loads the
 * real data/settlements.json + data/postcode_ekatte.json so the matcher is
 * exercised against production reference data.
 */

import fs from "fs";
import path from "path";
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildSettlementIndex,
  resolveOffice,
  type Settlement,
  type PostcodeIndex,
} from "./parse_registered_office";
import { SOFIA_EKATTE } from "../lib/oblast_names";

const ROOT = process.cwd();
const settlements: Settlement[] = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "settlements.json"), "utf-8"),
);
const postcodeFile = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "postcode_ekatte.json"), "utf-8"),
) as { byPostcode: PostcodeIndex };
const idx = buildSettlementIndex(settlements);
const pcIdx = postcodeFile.byPostcode;
const resolve = (raw: string) => resolveOffice(raw, idx, pcIdx);

test("Sofia long form with postcode → 68134 / high", () => {
  const m = resolve("БЪЛГАРИЯ, гр. София, 1618");
  assert.equal(m.ekatte, SOFIA_EKATTE);
  assert.equal(m.quality, "high");
});

test("Sofia long form without postcode → 68134", () => {
  assert.equal(resolve("БЪЛГАРИЯ, гр. София").ekatte, SOFIA_EKATTE);
});

test("Sofia uppercase bare → 68134", () => {
  assert.equal(resolve("СОФИЯ").ekatte, SOFIA_EKATTE);
});

test("Sofia typo 'Софиа' → 68134", () => {
  assert.equal(resolve("Софиа").ekatte, SOFIA_EKATTE);
});

test("Sofia typo 'Сифия' → 68134", () => {
  assert.equal(resolve("Сифия").ekatte, SOFIA_EKATTE);
});

test("Sofia with (столица) qualifier → 68134", () => {
  assert.equal(resolve("София (столица)").ekatte, SOFIA_EKATTE);
});

test("Varna bare name → unique city EKATTE", () => {
  const m = resolve("Варна");
  assert.equal(m.ekatte, "10135");
  assert.equal(m.quality, "medium");
});

test("Varna long form → high quality", () => {
  const m = resolve("БЪЛГАРИЯ, гр. Варна, 9000");
  assert.equal(m.ekatte, "10135");
  assert.equal(m.quality, "high");
});

test("Plovdiv long form with street → 56784", () => {
  const m = resolve("БЪЛГАРИЯ, гр. Пловдив, 4003, ул. Капитан Райчо 7");
  assert.equal(m.ekatte, "56784");
});

test("Burgas bare → 07079", () => {
  assert.equal(resolve("Бургас").ekatte, "07079");
});

test("Stara Zagora bare → 68850", () => {
  assert.equal(resolve("Стара Загора").ekatte, "68850");
});

test("Village with postcode disambiguates Абланица correctly", () => {
  // 2932 is the BLG Абланица (ekatte 00014)
  const m = resolve("БЪЛГАРИЯ, с. Абланица, 2932");
  assert.equal(m.ekatte, "00014");
  assert.equal(m.quality, "high");
});

test("Sofia satellite Лозен with postcode 1151 resolves uniquely", () => {
  const m = resolve("БЪЛГАРИЯ, с. Лозен, 1151");
  assert.equal(m.ekatte, "44063"); // Lozen in Stolichna
  assert.equal(m.quality, "high");
});

test("Neofit Rilski village (single name match) → high", () => {
  const m = resolve("с. Неофит Рилски");
  assert.equal(m.ekatte, "51487"); // only one Неофит Рилски
});

test("Foreign 'Amsterdam' → foreign", () => {
  const m = resolve("Amsterdam");
  assert.equal(m.ekatte, null);
  assert.equal(m.quality, "foreign");
});

test("Foreign 'Great Britain' → foreign", () => {
  assert.equal(resolve("Great Britain").quality, "foreign");
});

test("Foreign 'чужбина' → foreign", () => {
  assert.equal(resolve("чужбина").quality, "foreign");
});

test("Foreign 'САЩ' never matches a settlement", () => {
  const m = resolve("САЩ");
  assert.equal(m.quality, "foreign");
  assert.equal(m.ekatte, null);
});

test("Garbage 'Сифи' (truncated) → unresolved", () => {
  const m = resolve("Сифи");
  assert.equal(m.ekatte, null);
  assert.equal(m.quality, "unresolved");
});

test("Empty input → unresolved", () => {
  assert.equal(resolve("").quality, "unresolved");
  assert.equal(resolve("   ").quality, "unresolved");
});

test("Sofia stub 'БЪЛГАРИЯ, гр. София, .' still resolves to 68134", () => {
  // The trailing "." used to break the parser; verify Sofia synonym wins.
  assert.equal(resolve("БЪЛГАРИЯ, гр. София, .").ekatte, SOFIA_EKATTE);
});
