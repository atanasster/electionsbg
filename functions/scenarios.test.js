// Unit tests for the `scenarios` function's pure helpers (functions/
// scenarios_lib.js) — the security-critical input gate (parseScenarioQs) and
// the displayed-number math (histMedian) + storage policy (histKey).
// Run: cd functions && npm test   (Node 22 built-in runner, zero deps)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseScenarioQs,
  histMedian,
  histKey,
  clampNum,
} = require("./scenarios_lib");

test("parseScenarioQs: rejects unknown keys", () => {
  assert.equal(parseScenarioQs("bogus=1"), null);
});

test("parseScenarioQs: rejects out-of-range ints", () => {
  assert.equal(parseScenarioQs("dds=99"), null);
  assert.equal(parseScenarioQs("dds=9"), null); // below min 10
  assert.equal(parseScenarioQs("wi=-6"), null); // below min -5
});

test("parseScenarioQs: rejects non-integer int values", () => {
  assert.equal(parseScenarioQs("dds=22.5"), null);
  assert.equal(parseScenarioQs("dds=abc"), null);
});

test("parseScenarioQs: rejects bad flags / enum misses", () => {
  assert.equal(parseScenarioQs("b2=2"), null);
  assert.equal(parseScenarioQs("nocap=0"), null); // flag wants exact "1"
  assert.equal(parseScenarioQs("food=spicy"), null);
});

test("parseScenarioQs: rejects duplicate keys", () => {
  assert.equal(parseScenarioQs("dds=22&dds=23"), null);
});

test("parseScenarioQs: rejects prototype-pollution keys", () => {
  assert.equal(parseScenarioQs("__proto__=x"), null);
  assert.equal(parseScenarioQs("constructor=x"), null);
  assert.equal(parseScenarioQs("hasOwnProperty=x"), null);
});

test("parseScenarioQs: rejects oversized qs / non-strings", () => {
  assert.equal(parseScenarioQs("?" + "a".repeat(600)), null);
  assert.equal(parseScenarioQs(null), null);
  assert.equal(parseScenarioQs(42), null);
});

// `levers` is intentionally a null-prototype object (prototype-pollution
// defense), so spread into a plain object before structural comparison.
const levers = (qs) => {
  const r = parseScenarioQs(qs);
  return r === null ? null : { ...r.levers };
};

test("parseScenarioQs: accepts the empty (current-law) qs as {}", () => {
  assert.deepEqual(levers(""), {});
  assert.deepEqual(levers("?"), {});
});

test("parseScenarioQs: accepts a valid scenario (leading ? optional)", () => {
  assert.deepEqual(levers("dds=22&food=reduced"), {
    dds: "22",
    food: "reduced",
  });
  assert.deepEqual(levers("?nocap=1&pit=15"), { nocap: "1", pit: "15" });
});

test("parseScenarioQs: levers has a null prototype (pollution defense)", () => {
  assert.equal(Object.getPrototypeOf(parseScenarioQs("dds=22").levers), null);
});

test("histMedian: returns the weighted median key", () => {
  assert.equal(histMedian({ 10: 1, 20: 3, 30: 1 }), 20);
  assert.equal(histMedian({ "-2": 5, 4: 1 }), -2);
});

test("histMedian: returns null on empty / all-NaN keys", () => {
  assert.equal(histMedian({}), null);
  assert.equal(histMedian(null), null);
  assert.equal(histMedian({ standard: 5, reduced: 2 }), null);
});

test("histKey: enum + flag levers store no histogram", () => {
  assert.equal(histKey("food", "reduced"), null);
  assert.equal(histKey("nocap", "1"), null);
  assert.equal(histKey("bogus", "1"), null);
});

test("histKey: narrow int levers keep the raw value", () => {
  assert.equal(histKey("dds", "22"), "22");
  assert.equal(histKey("pit", "15"), "15");
});

test("histKey: wide int levers bucket to their step", () => {
  assert.equal(histKey("mod", "2137"), "2100"); // step 100
  assert.equal(histKey("t2", "3120"), "3000"); // step 250
  assert.equal(histKey("nm", "1234"), "1200"); // step 100 (still within domain head)
  assert.equal(histKey("tp", "117"), "120"); // step 10
});

test("clampNum: clamps and coerces", () => {
  assert.equal(clampNum(5, 0, 10), 5);
  assert.equal(clampNum(-3, 0, 10), 0);
  assert.equal(clampNum(99, 0, 10), 10);
  assert.equal(clampNum("not a number", -5, 5), 0);
  assert.equal(clampNum(undefined, -5, 5), 0);
});
