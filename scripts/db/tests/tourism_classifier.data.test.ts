// Pins the tourism CPV → category classifier. The dashboard's headline split
// (advertising ~53%, production ~11%, events/digital ~9%, research ~4%, other
// ~15%) is validated against the real 303-row corpus in the classifier's own
// comment — but nothing else stops an edit to a `d4 === "79xx"` branch from
// silently reshuffling it. This locks the CPV→bucket mapping.
//
// Pure logic, no DB. Run: npm run test:data (tsx --test), or standalone:
//   npx tsx --test scripts/db/tests/tourism_classifier.data.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { tourismClassifier } from "../../../src/screens/sector/tourism/tourismCategories";
import type { ProcurementContract } from "../../../src/data/dataTypes";

const cat = (cpv: string): string =>
  tourismClassifier.categoryOf({ cpv } as ProcurementContract);

test("advertising & media — CPV 92 (broadcast/film/news) + 7934–7936", () => {
  assert.equal(cat("92111000"), "advertising"); // film/video production
  assert.equal(cat("92400000"), "advertising"); // news agency
  assert.equal(cat("79341000"), "advertising"); // advertising services
  assert.equal(cat("79342200"), "advertising"); // promotion services
});

test("events / research / digital / production families", () => {
  assert.equal(cat("79952000"), "events"); // event services
  assert.equal(cat("79310000"), "research"); // market research
  assert.equal(cat("79411000"), "research"); // management consulting
  assert.equal(cat("71000000"), "research"); // architecture/engineering
  assert.equal(cat("72000000"), "digital"); // IT services
  assert.equal(cat("64000000"), "digital"); // telecom
  assert.equal(cat("79800000"), "production"); // 7980 printing
  assert.equal(cat("39154000"), "production"); // exhibition equipment (div 39)
});

test("other — empty or unmapped CPV falls back to the sink", () => {
  assert.equal(cat(""), "other");
  assert.equal(cat("50000000"), "other"); // repair & maintenance
  assert.equal(cat("98000000"), "other"); // other community/personal services
});
