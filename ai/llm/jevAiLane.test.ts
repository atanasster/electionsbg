// The AI lane's Jev pre-step. Two invariants matter most:
//   1. when Jev cannot answer, the caller must run the FULL Gemini prompt —
//      never a weaker router, which would downgrade a user who asked for the
//      model below what they would have got without Jev in the path at all;
//   2. every field degrades CONSERVATIVELY on its own, so one unreadable
//      answer cannot make the turn behave strangely.
import { describe, expect, it } from "vitest";
import {
  COMPOUND_THRESHOLD,
  jevRoutingStep,
  MAX_SPLIT_PARTS,
  TURN_KINDS,
  aiTurnQuestions,
  parseSplit,
  readAiTurnPlan,
} from "./jevAiLane";
import { JEV_CONFIDENCE_GATE } from "./jev";
import { NO_TOOL } from "./jevPrompt";
import type { JevResult } from "./jevClient";

const result = (answers: Record<string, unknown>): JevResult =>
  ({ answers, latencyMs: 40 }) as unknown as JevResult;

const choice = (c: string, confidence = 0.95) => ({
  type: "choice",
  choice: c,
  probabilities: {},
  confidence,
});

describe("aiTurnQuestions", () => {
  it("batches all three questions into one call", () => {
    // Questions run in parallel upstream, so three cost about what one does —
    // chaining them would be three round trips for no benefit.
    expect(Object.keys(aiTurnQuestions()).sort()).toEqual([
      "is_compound",
      "kind",
      "tool",
    ]);
  });

  it("offers the abstain option on the tool question", () => {
    const tool = aiTurnQuestions().tool;
    expect(Object.keys(tool.criteria as object)).toContain(NO_TOOL);
  });

  it("separates conversational from off-topic", () => {
    // They take different paths: conversational goes to Gemini for a freeform
    // answer, off-topic is declined. Collapsing them would answer questions we
    // mean to decline.
    expect(Object.keys(TURN_KINDS)).toEqual([
      "data",
      "conversational",
      "off_topic",
    ]);
  });
});

describe("readAiTurnPlan", () => {
  it("reports a confident tool pick", () => {
    const plan = readAiTurnPlan(
      result({
        tool: choice("turnout"),
        is_compound: { type: "noul", noul: 0.02 },
      }),
    );
    expect(plan.tool).toBe("turnout");
    expect(plan.degraded).toBe(false);
    expect(plan.compound).toBe(false);
  });

  it("withholds a below-gate pick", () => {
    const plan = readAiTurnPlan(
      result({ tool: choice("turnout", JEV_CONFIDENCE_GATE - 0.01) }),
    );
    expect(plan.tool).toBeNull();
    // NOT degraded — Jev answered, it just was not confident. The caller still
    // has a usable signal and falls through to the full Gemini prompt.
    expect(plan.degraded).toBe(false);
  });

  it("distinguishes a confident no_tool from a missing answer", () => {
    const declined = readAiTurnPlan(result({ tool: choice(NO_TOOL) }));
    expect(declined.noTool).toBe(true);
    expect(declined.degraded).toBe(false);

    const missing = readAiTurnPlan(result({}));
    expect(missing.noTool).toBe(false);
    expect(missing.degraded).toBe(true);
  });

  it("degrades when there is no result at all", () => {
    expect(readAiTurnPlan(null)).toMatchObject({ degraded: true, tool: null });
  });

  it.each([
    [0.95, true],
    [COMPOUND_THRESHOLD, true],
    [COMPOUND_THRESHOLD - 0.01, false],
    [0.01, false],
  ])("reads compound at probability %s as %s", (noul, expected) => {
    const plan = readAiTurnPlan(
      result({ tool: choice("turnout"), is_compound: { type: "noul", noul } }),
    );
    expect(plan.compound).toBe(expected);
  });

  it("treats an unreadable compound answer as NOT compound", () => {
    // The conservative direction: splitting a single question yields two
    // half-answers, while not splitting a compound one still answers the
    // primary ask — which is what the lane does today anyway.
    const plan = readAiTurnPlan(
      result({ tool: choice("turnout"), is_compound: choice("yes") }),
    );
    expect(plan.compound).toBe(false);
  });

  it.each([
    ["a below-gate kind", choice("conversational", JEV_CONFIDENCE_GATE - 0.01)],
    ["an unknown kind", choice("something_else")],
    ["a wrong primitive", { type: "noul", noul: 0.9 }],
  ])("returns no opinion for %s", (_label, kind) => {
    const plan = readAiTurnPlan(result({ tool: choice("turnout"), kind }));
    expect(plan.kind).toBeNull();
  });

  it("reports a confident kind", () => {
    const plan = readAiTurnPlan(
      result({ tool: choice(NO_TOOL), kind: choice("conversational") }),
    );
    expect(plan.kind).toBe("conversational");
  });
});

describe("parseSplit", () => {
  it("splits a compound reply into atomic questions", () => {
    expect(
      parseSplit("Каква беше активността?\nКой спечели във Варна?", "orig"),
    ).toEqual(["Каква беше активността?", "Кой спечели във Варна?"]);
  });

  it("strips list markers the model adds despite the instruction", () => {
    expect(parseSplit("1. Първи въпрос\n- Втори въпрос", "orig")).toEqual([
      "Първи въпрос",
      "Втори въпрос",
    ]);
  });

  it("falls back to the original when the split yields fewer than two parts", () => {
    // A reworded single question is not a split — answering the original is
    // strictly better than answering the model's paraphrase of it.
    expect(parseSplit("Само един въпрос", "оригинал")).toEqual(["оригинал"]);
    expect(parseSplit("", "оригинал")).toEqual(["оригинал"]);
  });

  it("caps the number of parts", () => {
    // Every part becomes its own tool call, and every call is billed — a model
    // that misreads the instruction must not fan out without bound.
    const many = Array.from({ length: 12 }, (_, i) => `Въпрос ${i}?`).join(
      "\n",
    );
    expect(parseSplit(many, "orig")).toHaveLength(MAX_SPLIT_PARTS);
  });
});

describe("jevRoutingStep — Jev picks, the model fills", () => {
  const p = (tool: string | null) => ({
    tool,
    noTool: false,
    compound: false,
    kind: null,
    degraded: false,
  });
  it("runs a parameter-free tool with no model routing call", () => {
    expect(jevRoutingStep(p("waterServices"))).toEqual({
      kind: "run",
      tool: "waterServices",
    });
  });
  it("asks the model to fill a tool that takes parameters", () => {
    expect(jevRoutingStep(p("turnout"))).toEqual({
      kind: "fill",
      tool: "turnout",
    });
  });
  it("gives the full prompt when Jev picked nothing", () => {
    expect(jevRoutingStep(p(null))).toEqual({ kind: "full" });
    expect(jevRoutingStep(null)).toEqual({ kind: "full" });
  });
  it("gives the full prompt for a tool name the registry does not know", () => {
    // Not "run": an unknown name has no parameter list, and reading that as
    // "takes no parameters" would send an invented name straight to runTool.
    expect(jevRoutingStep(p("noSuchTool"))).toEqual({ kind: "full" });
  });
});
