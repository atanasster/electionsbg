import { describe, expect, it } from "vitest";
import {
  parseToolCall,
  toolSelectionSchema,
  validateToolArgs,
} from "./toolSchema";
import { parseModelRoute } from "./routeScope";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";

// G4 — candidate narrowing must be ENFORCED, not merely suggested (plan C4).
//
// The cloud path measures the routing request against a 96,000-byte proxy ceiling
// and narrows the tool catalogue to a candidate set when it would not fit. Without
// this, the narrowing is advisory: the model can name any of the 235 registered
// tools and it would still parse and EXECUTE, so the candidate set would only
// shrink the prompt while the answer came from anywhere.

const ALLOWED = new Set(["macroIndicator", "budgetOverview"]);

describe("a non-candidate tool name cannot execute", () => {
  it("is rejected by parseToolCall when a candidate set is given", () => {
    // A REAL registered tool that the prompt did not offer.
    expect(TOOLS_BY_NAME.partyResult).toBeDefined();
    const raw = JSON.stringify({
      tool: "partyResult",
      args: { party: "ГЕРБ" },
    });
    expect(parseToolCall(raw)).not.toBeNull(); // full catalogue: accepted
    expect(parseToolCall(raw, ALLOWED)).toBeNull(); // narrowed: REJECTED
  });

  it("is rejected by parseModelRoute, which is what the provider calls", () => {
    const raw = JSON.stringify({
      tool: "partyResult",
      args: { party: "ГЕРБ" },
    });
    expect(parseModelRoute(raw, "Колко гласа взе ГЕРБ?")?.tool).toBe(
      "partyResult",
    );
    expect(parseModelRoute(raw, "Колко гласа взе ГЕРБ?", ALLOWED)).toBeNull();
  });

  it("still accepts a candidate, with its own tool, so rejection is not blanket", () => {
    const raw = JSON.stringify({
      tool: "macroIndicator",
      args: { indicator: "инфлация" },
    });
    expect(parseToolCall(raw, ALLOWED)?.tool).toBe("macroIndicator");
    // And an empty set rejects everything rather than admitting everything.
    expect(parseToolCall(raw, new Set())).toBeNull();
  });

  it("keeps the un-narrowed behaviour byte-for-byte", () => {
    // The eval harnesses and the in-browser router pass no candidate set and must
    // keep accepting every valid name — the enforcement is opt-in.
    // Each needs a VALID arg set: an empty one fails validation, which is a
    // different rejection from the one under test here.
    const VALID: [string, Record<string, string>][] = [
      ["partyResult", { party: "ГЕРБ" }],
      ["turnout", { election: "2023" }],
      ["localMunicipality", { place: "Пловдив" }],
    ];
    for (const [tool, args] of VALID) {
      const raw = JSON.stringify({ tool, args });
      expect(parseToolCall(raw)?.tool, tool).toBe(tool);
    }
    // An unknown name is still rejected with or without a set.
    expect(parseToolCall('{"tool":"madeUp","args":{}}')).toBeNull();
    expect(
      parseToolCall('{"tool":"madeUp","args":{}}', new Set(["madeUp"])),
    ).toBeNull();
  });
});

describe("routes re-derived from the QUESTION also respect the candidates", () => {
  // `parseModelRoute` re-derives a route from the question for a few intents before
  // it ever consults `parseToolCall` (roll-call, funding, procurement, and the
  // rankPlaces metric alias). Those branches returned a tool regardless of the
  // candidate set, so narrowing was advisory on exactly the intents most likely to
  // be re-derived — a narrowed prompt that excluded procurementQuery still executed
  // it.
  const Q = "Колко договора са сключени през 2025?";

  it("rejects a DERIVED tool that is not a candidate", () => {
    const raw = JSON.stringify({ tool: "procurementQuery", args: {} });
    const withoutIt = new Set(["macroIndicator"]);
    // With no candidate set the derived route still wins (unchanged behaviour).
    expect(parseModelRoute(raw, Q)?.tool).toBe("procurementQuery");
    // With a set that excludes it, the derivation is refused.
    expect(parseModelRoute(raw, Q, withoutIt)).toBeNull();
  });

  it("still accepts the derived tool when it IS a candidate", () => {
    const raw = JSON.stringify({ tool: "procurementQuery", args: {} });
    expect(parseModelRoute(raw, Q, new Set(["procurementQuery"]))?.tool).toBe(
      "procurementQuery",
    );
  });
});

describe("the grammar can be narrowed to the same set", () => {
  it("lists exactly the candidates when given, and every tool when not", () => {
    const narrowed = JSON.parse(toolSelectionSchema(ALLOWED)) as {
      properties: { tool: { enum: string[] } };
    };
    expect(narrowed.properties.tool.enum.sort()).toEqual([...ALLOWED].sort());
    const full = JSON.parse(toolSelectionSchema()) as {
      properties: { tool: { enum: string[] } };
    };
    expect(full.properties.tool.enum).toHaveLength(TOOLS.length);
    // The per-tool argument conditions must shrink with the enum, or a grammar
    // could still describe a tool it does not offer.
    const narrowedAllOf = JSON.parse(toolSelectionSchema(ALLOWED)) as {
      allOf: unknown[];
    };
    expect(narrowedAllOf.allOf).toHaveLength(ALLOWED.size);
  });

  it("keeps argument validation unchanged", () => {
    // Enforcement is about WHICH tool, never about accepting worse arguments for it.
    expect(
      validateToolArgs("macroIndicator", { indicator: "инфлация" }),
    ).not.toBeNull();
    // Unknown keys are ignored by design (`ignoreUnknown: true`), while a MISSING
    // required argument is rejected — asserted as a pair so neither half of that
    // contract can drift unnoticed when the candidate set is threaded through.
    expect(validateToolArgs("macroIndicator", { nope: "x" })).toEqual({});
    expect(validateToolArgs("partyResult", {})).toBeNull();
    expect(validateToolArgs("partyResult", { party: "ГЕРБ" })).toEqual({
      party: "ГЕРБ",
    });
  });
});
