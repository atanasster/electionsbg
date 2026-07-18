// Unit tests for splitContractTitle — run with `npm run test:lib`
// (Vitest; see docs/testing-standards.md).
import { test } from "vitest";
import assert from "node:assert/strict";
import { splitContractTitle } from "./contractTitle";

test("splits subject from lot on the lot-marker colon", () => {
  assert.deepEqual(
    splitContractTitle("Доставка на храни, Обособена позиция 2: месо"),
    {
      main: "Доставка на храни",
      lotLabel: "Обособена позиция 2",
      lotDetail: "месо",
    },
  );
});

test("keeps an earlier colon in the subject (lazy split on the lot colon)", () => {
  const r = splitContractTitle("Услуга: X, Обособена позиция 1: Y");
  assert.equal(r.main, "Услуга: X");
  assert.equal(r.lotLabel, "Обособена позиция 1");
  assert.equal(r.lotDetail, "Y");
});

test("returns the whole string as main when there is no lot marker", () => {
  assert.deepEqual(splitContractTitle("Просто заглавие"), {
    main: "Просто заглавие",
  });
});

test("returns the whole string when the title opens with the lot marker", () => {
  assert.equal(
    splitContractTitle("Обособена позиция 1: X").main,
    "Обособена позиция 1: X",
  );
});

test("empty lot tail yields undefined lotDetail (dangling-label guard input)", () => {
  const r = splitContractTitle("A, Обособена позиция 1:");
  assert.equal(r.lotLabel, "Обособена позиция 1");
  assert.equal(r.lotDetail, undefined);
});

test("null / undefined / empty input returns an empty main", () => {
  assert.deepEqual(splitContractTitle(null), { main: "" });
  assert.deepEqual(splitContractTitle(undefined), { main: "" });
  assert.deepEqual(splitContractTitle("   "), { main: "" });
});

test("trims trailing separators from the subject", () => {
  const r = splitContractTitle("Ремонт на път,  Обособена позиция 3: асфалт");
  assert.equal(r.main, "Ремонт на път");
  assert.equal(r.lotDetail, "асфалт");
});

test("lot number is recoverable from lotLabel (feeds 'this is №N')", () => {
  const r = splitContractTitle("Строеж, Обособена позиция 12: мост");
  assert.equal(r.lotLabel?.match(/\d+/)?.[0], "12");
});
