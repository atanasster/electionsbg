import { describe, it, expect } from "vitest";
import {
  registryEvalCases,
  evalUserContent,
  expectedArgs,
  scoreProduction,
  summarize,
  type EvalCase,
} from "./currentEval";
import { CHALLENGES, UNSUPPORTED } from "./currentEval.cases";
import { REALISTIC, CONVERSATIONS } from "./currentEval.realistic";
import { TOOLS } from "../tools/registry";
import { STARTER_CASES } from "./currentEval.starters";
describe("production eval scoring", () => {
  const c: EvalCase = {
    id: "arg",
    group: "challenge",
    tool: "contractSearch",
    en: "",
    bg: "",
    args: { company: ["831646048"], year: [2024] },
  };
  it("never gives empty, malformed, unknown-tool, or failed replies abstention credit", () => {
    for (const raw of ["", "{}", "oops", '{"tool":"madeUp"}', '{"tool":false}'])
      expect(scoreProduction(UNSUPPORTED[0], "en", raw).callOk).toBe(false);
    expect(scoreProduction(UNSUPPORTED[0], "en", '{"tool":null}').callOk).toBe(
      true,
    );
    expect(
      scoreProduction(UNSUPPORTED[0], "en", '{"tool":null}', "HTTP 429").callOk,
    ).toBe(false);
  });
  it("requires named exact arguments, not another key or substring", () => {
    expect(
      scoreProduction(
        c,
        "en",
        '{"tool":"contractSearch","args":{"company":"831646048","year":2024}}',
      ).callOk,
    ).toBe(true);
    for (const args of [
      { company: "831646048", query: "2024" },
      { company: "831646048", year: 2023 },
      { company: "prefix831646048", year: 2024 },
    ])
      expect(
        scoreProduction(c, "en", JSON.stringify({ tool: c.tool, args })).callOk,
      ).toBe(false);
  });
  it("distinguishes a chosen tool from a usable call", () => {
    const s = scoreProduction(c, "en", '{"tool":"contractSearch","args":{}}');
    expect(s.toolOk).toBe(true);
    expect(s.callOk).toBe(false);
  });
  it("keeps wrong-tool cases in argument denominator", () => {
    const a = scoreProduction(
      c,
      "en",
      '{"tool":"contractSearch","args":{"company":"831646048","year":2024}}',
    );
    const b = scoreProduction(c, "en", '{"tool":"budgetOverview","args":{}}');
    expect(summarize([a, b]).en.argAcc).toBe(0.5);
  });
  it("covers every registry tool and keeps unique cases", () => {
    const cases = [
      ...registryEvalCases(),
      ...CHALLENGES,
      ...UNSUPPORTED,
      ...REALISTIC,
      ...CONVERSATIONS,
    ];
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(
      new Set(registryEvalCases().map((c) => c.id.split(":")[0])).size,
    ).toBe(TOOLS.filter((t) => t.examples.length > 0).length);
    for (const c of [...CHALLENGES, ...REALISTIC, ...CONVERSATIONS].filter(
      (c) => c.tool,
    )) {
      const t = TOOLS.find((t) => t.name === c.tool);
      expect(t).toBeDefined();
      for (const k of Object.keys(c.args ?? {}))
        expect(t!.params.some((p) => p.name === k)).toBe(true);
    }
  });
});

it("renders real conversation memory and versions clarified legacy expectations", () => {
  const c = CONVERSATIONS[0];
  expect(evalUserContent(c, "en")).toContain("831646048");
  expect(evalUserContent(c, "en")).toContain("Current question:");
  expect(
    registryEvalCases().find((c) => c.id === "companyConnections:2")?.tool,
  ).toBeNull();
  expect(registryEvalCases().find((c) => c.id === "census:1")?.en).toContain(
    "2021",
  );
});

it("keeps raw model selection separate from validated usable routing", () => {
  const c: EvalCase = {
    id: "alias",
    group: "challenge",
    tool: "regionalInvestment",
    en: "EU funds by oblast",
    bg: "Европейски средства по области",
  };
  const result = scoreProduction(
    c,
    "en",
    '{"tool":"rankPlaces","args":{"indicator":"regionalInvestment"}}',
  );
  expect(result.toolOk).toBe(false);
  expect(result.callOk).toBe(true);
  expect(result.selected).toBe("rankPlaces");
  expect(result.parsed?.tool).toBe("regionalInvestment");
});

describe("argument expectations are per-language and value-shaped", () => {
  // The real bank case: `fundingQuery.basePredicates` is a `stringList` parameter
  // whose VALUE is `["bulgarian","lead"]`. Encoding it as a list of alternatives
  // made it unpassable (`String(["bulgarian","lead"])` is "bulgarian,lead"), which
  // is what recorded it as a router gap it never was. The route is re-derived from
  // the question here, so what varies below is the EXPECTATION.
  const s23 = STARTER_CASES.find((c) => c.id === "starter:funding-query-S23")!;
  const withExpected = (basePredicates: (string | number)[]): EvalCase => ({
    ...s23,
    args: { ...(s23.args as object), basePredicates: [basePredicates] },
    argsByLang: undefined,
  });
  it("matches a list-valued argument as ONE value, element-wise", () => {
    expect(scoreProduction(s23, "en", "").argsOk).toBe(true);
    // Each of these is wrong in exactly one way: a flipped element, a shorter
    // list, and a reordered list. All three differ from the gold value.
    for (const wrong of [
      ["bulgarian", "zinc"],
      ["bulgarian"],
      ["lead", "bulgarian"],
    ])
      expect(
        scoreProduction(withExpected(wrong), "en", "").argsOk,
        `expected [${wrong}] to be rejected`,
      ).toBe(false);
  });
  it("reports null, never true, for a case with no annotated arguments", () => {
    const bare: EvalCase = {
      id: "bare",
      group: "starter",
      tool: "turnout",
      en: "turnout",
      bg: "активност",
    };
    const s = scoreProduction(bare, "en", '{"tool":"turnout","args":{}}');
    expect(s.argScored).toBe(false);
    expect(s.argsOk).toBeNull();
    expect(s.callOk).toBe(true);
    // ...and it stays out of the argument denominator.
    expect(summarize([s]).en.argN).toBe(0);
    expect(summarize([s]).en.argAcc).toBeNull();
  });
  it("treats the per-language overlay as authoritative", () => {
    // When the two languages disagree the overlay is the ONLY expectation: a
    // language it omits is unscored, never graded against the other language's
    // gold. The earlier `?? c.args` fallback did exactly that.
    const split: EvalCase = {
      id: "split",
      group: "starter",
      tool: "partyResult",
      en: "GERB votes",
      bg: "гласове ГЕРБ",
      args: { n: [1] },
      argsByLang: { bg: { party: ["герб"] } },
    };
    expect(expectedArgs(split, "bg")).toEqual({ party: ["герб"] });
    expect(expectedArgs(split, "en")).toBeUndefined();
    expect(
      scoreProduction(split, "en", '{"tool":"partyResult","args":{}}')
        .argScored,
    ).toBe(false);
  });
});
