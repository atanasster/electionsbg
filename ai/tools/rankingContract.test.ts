import { expect, it, vi } from "vitest";
import { normalizeRanking } from "./rankingContract";
import { validateArguments } from "../orchestrator/validateArguments";
import { rankPlaces } from "./placesGov";
import {
  validateRouteScope,
  parseModelRoute,
} from "../orchestrator/routeScope";
it("preserves direction and geography in legacy calls", () => {
  expect(
    normalizeRanking({ indicator: "lowest unemployment by oblast" }),
  ).toEqual({ indicator: "longTermUnemployment", order: "asc" });
  expect(
    normalizeRanking({ indicator: "общини с най-висока безработица" })
      .indicator,
  ).toBe("unemployment");
});
it("rejects unsupported ratios and arbitrary indicators before execution", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected fetch"));
  try {
    for (const indicator of [
      "EU money per capita by oblast",
      "basket cost relative to GDP",
      "rainfall",
      "unknown",
    ]) {
      expect(
        validateArguments("rankPlaces", { indicator }).errors.indicator,
      ).toBe("choice");
      const env = await rankPlaces(
        { indicator },
        { lang: "en", election: "2026_04_19" },
      );
      expect(env.clarify?.options.length).toBeGreaterThan(0);
      expect(env.facts).toEqual({});
      expect(env.provenance).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
it("coerces only known integral local election years", () => {
  expect(validateArguments("localMayorsWon", { cycle: 2023 }).args.cycle).toBe(
    "2023",
  );
  for (const cycle of [2023.5, 2022, true, "2023garbage"])
    expect(
      validateArguments("localMayorsWon", { cycle }).errors.cycle,
    ).toBeDefined();
});
it("blocks calendar year truncation without mistaking history for the question", () => {
  const route = { tool: "turnoutSeries", args: { years: 1 } };
  expect(validateRouteScope(route, "turnout in 2024")).toEqual({
    tool: "turnout",
    args: { election: "2024" },
  });
  expect(validateRouteScope(route, "активност през 2024")).toEqual({
    tool: "turnout",
    args: { election: "2024" },
  });
  expect(
    validateRouteScope(
      route,
      "Previous year 2024\nCurrent question: Last five years",
    ),
  ).toEqual(route);
});

it("only accepts explicitly named specialist aliases, never arbitrary metrics", () => {
  expect(
    parseModelRoute(
      '{"tool":"rankPlaces","args":{"indicator":"regionalInvestment"}}',
      "EU funds",
    ),
  ).toEqual({ tool: "regionalInvestment", args: {} });
  expect(
    parseModelRoute(
      '{"tool":"rankPlaces","args":{"indicator":"rainfall"}}',
      "rainfall",
    ),
  ).toBeNull();
  expect(
    parseModelRoute(
      '{"tool":"rankPlaces","args":{"indicator":"regionalInvestment","year":2023}}',
      "EU funds in 2023",
    ),
  ).toBeNull();
  expect(
    validateArguments("municipalFiscalRanking", { n: 8, metric: "arrears" })
      .args.count,
  ).toBe(8);
  expect(
    validateArguments("municipalFiscalRanking", { n: 8, count: 4 }).errors
      .count,
  ).toBe("conflict");
});

it("blocks a plausible metric for a different question and an invented pronoun referent", () => {
  expect(
    parseModelRoute(
      '{"tool":"rankPlaces","args":{"indicator":"gdpPerCapita"}}',
      "basket cost relative to GDP",
    ),
  ).toBeNull();
  const raw = '{"tool":"personWealth","args":{"name":"Бойко Борисов"}}';
  expect(parseModelRoute(raw, "А той какво е декларирал?")).toBeNull();
  expect(
    parseModelRoute(
      raw,
      'Previous tool: personWealth, args: {"name":"Бойко Борисов"}\nCurrent question: А той какво е декларирал?',
    )?.tool,
  ).toBe("personWealth");
});
