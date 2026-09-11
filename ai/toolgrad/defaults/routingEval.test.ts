import { expect, it } from "vitest";
import { FRESH_CASES } from "./routingCases";
import { matchesExpected, rawRoute, explicitAbstention } from "./routingEval";
it("rejects wrong geography, dropped years and extra filters", () => {
  const c = FRESH_CASES[0];
  expect(
    matchesExpected(c, {
      tool: c.tool!,
      args: { place: "Plovdiv", election: "2023" },
    }),
  ).toBe(true);
  expect(
    matchesExpected(c, {
      tool: "regionResults",
      args: { oblast: "PDV", election: "2023" },
    }),
  ).toBe(false);
  expect(
    matchesExpected(c, { tool: c.tool!, args: { place: "Plovdiv" } }),
  ).toBe(false);
  expect(
    rawRoute(
      '{"tool":"municipalTransfers","args":{"year":2024,"place":"Plovdiv"}}',
    ),
  ).toBeNull();
});
it("distinguishes malformed responses from abstention", () => {
  expect(rawRoute("bad JSON")).toBeNull();
  expect(explicitAbstention("bad JSON")).toBe(false);
  expect(explicitAbstention('{"tool":null,"args":{}}')).toBe(true);
});
it("freezes unique bilingual cases with explicit expected scope", () => {
  expect(FRESH_CASES).toHaveLength(25);
  expect(new Set(FRESH_CASES.map((c) => c.id)).size).toBe(25);
  expect(new Set(FRESH_CASES.flatMap((c) => [c.bg, c.en])).size).toBe(50);
});

it("accepts the production province spelling without equating it with the city", () => {
  const c = FRESH_CASES.find((c) => c.id === "province-summary")!;
  expect(
    matchesExpected(c, {
      tool: "regionResults",
      args: { oblast: "Пловдив област", election: "2023" },
    }),
  ).toBe(true);
  expect(
    matchesExpected(c, {
      tool: "regionResults",
      args: { oblast: "PDV-00", election: "2023" },
    }),
  ).toBe(false);
});
