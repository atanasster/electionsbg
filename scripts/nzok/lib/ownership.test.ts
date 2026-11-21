// Unit tests for the ownership classifier — the ladder that assigns a public
// label (state/municipal/private) to real hospitals on a public-money page, where
// a WRONG label is worse than none (the module's stated design principle). Pure +
// injectable, so the whole ladder is exercised against a synthetic ЕЕОФ index.
//
// Run: pnpm run test:nzok

import { test } from "vitest";
import assert from "node:assert/strict";
import { buildEeofOwnershipIndex, classifyOwnership } from "./ownership";
import { looksLikeRegisterEntry, unglue } from "./ownership_gap";

// A synthetic ЕЕОФ roster: two state hospitals (a distinctive-surname one and a
// common-saint one that needs a city to disambiguate) + one municipal.
const index = buildEeofOwnershipIndex({
  quarters: [
    {
      quarter: "2025-Q3",
      ownership: "state",
      hospitals: [
        { name: 'УМБАЛ "Св. Георги" - Пловдив ЕАД' },
        { name: 'МБАЛ "Св. Ив. Рилски" АД, Разград' },
      ],
    },
    {
      quarter: "2025-Q3",
      ownership: "municipal",
      hospitals: [{ name: "МБАЛ Провадия ЕООД" }],
    },
  ],
});
// The eik bridge is seeded by the caller from the loaded table (the JSON has no eik).
index.byEik.set("111111111", "municipal");

test("prefers manual eik override over any heuristic", () => {
  const v = classifyOwnership(
    { regNo: "x", name: "Военномедицинска академия", eik: "129000273" },
    index,
  );
  assert.equal(v.ownership, "state");
  assert.equal(v.method, "override");
});

test("bridges on exact eik before name matching", () => {
  const v = classifyOwnership(
    { regNo: "x", name: "A Name Not In The Roster", eik: "111111111" },
    index,
  );
  assert.equal(v.ownership, "municipal");
  assert.equal(v.method, "eik");
});

test("rejects a city-only shared token (city is a guard, not a key)", () => {
  // Shares ПЛОВДИВ with 'Св. Георги Пловдив' but no distinctive token → private.
  const v = classifyOwnership(
    { regNo: "x", name: "МБАЛ Тримонциум ООД Пловдив", eik: null },
    index,
  );
  assert.equal(v.ownership, "private");
});

test("requires city agreement for an all-common-saint-token match", () => {
  // 'Св. Иван Рилски' is a common saint name in a dozen towns; without a city it
  // must NOT match the Разград state hospital.
  const v = classifyOwnership(
    { regNo: "x", name: "МБАЛ Св. Иван Рилски-2003 ООД", eik: null },
    index,
  );
  assert.equal(v.ownership, "private");
});

test("matches a common-saint hospital when the city agrees", () => {
  const v = classifyOwnership(
    { regNo: "x", name: "МБАЛ Свети Иван Рилски - Разград АД", eik: null },
    index,
  );
  assert.equal(v.ownership, "state");
});

test("falls through to private (residual) when nothing matches", () => {
  const v = classifyOwnership(
    { regNo: "x", name: "УМБАЛ Софиямед ООД", eik: null },
    index,
  );
  assert.equal(v.ownership, "private");
  assert.equal(v.method, "residual");
});

// ── The register tripwire (./ownership_gap.ts) — the shapes that hid 33 public
// facilities in the residual on 2026-11-21.

test("gap detector: tolerates a one-letter slip on a long eponym", () => {
  assert.ok(
    looksLikeRegisterEntry(
      "МБАЛ Д-р Никола Василиев АД",
      'МБАЛ "Д-р Никола Василев" АД Кюстендил',
    ),
  );
});

test("gap detector: ungluing the register's run-together tokens", () => {
  assert.equal(
    unglue("МБАЛПроф. д-р Константин ЧиловЕООД Мадан"),
    "МБАЛ Проф. д-р Константин Чилов ЕООД Мадан",
  );
});

test("gap detector: a type-plus-town name needs the same type", () => {
  assert.ok(
    looksLikeRegisterEntry("МБАЛ - Исперих ЕООД", "МБАЛ Исперих ЕООД Разград"),
  );
  // "Света" folds away, leaving МБАЛ + СОФИЯ against ЦПЗ + СОФИЯ — not the same body.
  assert.ok(!looksLikeRegisterEntry("МБАЛ Света София ЕООД", "ЦПЗ-СОФИЯ ЕООД"));
});

test("gap detector: a common saint alone needs the town to agree", () => {
  assert.ok(
    looksLikeRegisterEntry(
      "МБАЛ Св.Пантелеймон АД гр.Ямбол",
      'МБАЛ "Св. Панталеймон" АД, Ямбол',
    ),
  );
  assert.ok(
    !looksLikeRegisterEntry(
      "МБАЛ Св.Пантелеймон АД гр.Ямбол",
      'СБАЛББ"Свети Пантелеймон" ЕООД, гр. Перник',
    ),
  );
});

test("classifier: the register-listed facilities the ladder misses are overridden", () => {
  for (const [eik, want] of [
    ["109080582", "state"], // Кюстендил
    ["128501598", "state"], // Ямбол
    ["000090154", "municipal"], // СБАЛОЗ Варна
  ] as const) {
    const v = classifyOwnership({ regNo: "x", name: "irrelevant", eik }, index);
    assert.equal(v.ownership, want, eik);
  }
  // The private namesake in Дупница must stay private.
  const priv = classifyOwnership(
    { regNo: "x", name: "МБАЛ Св. Иван Рилски-2003 ООД", eik: "109568877" },
    index,
  );
  assert.equal(priv.ownership, "private");
});
