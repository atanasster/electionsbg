// The invariant this file exists to pin: the Jev-routed lane NEVER reaches an
// LLM, and never runs a tool it cannot supply arguments for. Whatever Jev does
// — answer, decline, time out, or never run — this lane answers from its own
// deterministic router and its own templates. A fallback that changed lanes
// would silently give a user who chose "no LLM" an LLM.
import { describe, expect, it, vi } from "vitest";
import {
  JEV_CONFIDENCE_GATE,
  JevProvider,
  NO_TOOL,
  acceptJevPick,
  jevRoute,
  toolCriteria,
  turnQuestions,
} from "./jev";
import type { JevAnswer, JevResult } from "./jevClient";
import { TOOL_INSTRUCTIONS, toolOptionText } from "./jevPrompt";
import { route } from "../orchestrator/router";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import type { ToolContext } from "../tools/types";

const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };

const answer = (choice: string, confidence: number): JevResult => ({
  answers: {
    tool: {
      type: "choice",
      choice,
      probabilities: { [choice]: confidence },
      confidence,
    },
  },
  latencyMs: 400,
});

/** A typed stub for the client seam, so the tests type-check the same shape the
 *  provider consumes rather than casting it away. */
type Ask = (
  state: unknown,
  questions: Record<string, unknown>,
  credentials: unknown,
) => Promise<JevResult | null>;
const asking = (result: JevResult | null) =>
  vi.fn<Ask>(async () => result) as unknown as Parameters<typeof jevRoute>[2];

const creds = () => ({ sessionToken: "s", questionId: "q" });

// A question the deterministic router answers, so "did the lane fall back?" is
// checkable by ROUTE rather than by prose length (any decline is also non-empty).
const DETERMINISTIC_Q = "Каква беше избирателната активност?";
const deterministicRoute = route(DETERMINISTIC_Q, ctx);

describe("tool criteria", () => {
  it("offers every registry tool plus an explicit no_tool option", () => {
    const criteria = toolCriteria();
    // A Choice must return one of its options — it cannot abstain — so
    // "call nothing" only exists as an answer because we offer it.
    expect(criteria[NO_TOOL]).toBeTruthy();
    expect(Object.keys(criteria)).toHaveLength(TOOLS.length + 1);
    for (const t of TOOLS) expect(criteria[t.name]).toBeTruthy();
  });

  it("asks the question the measured harness asked", () => {
    // The 96% EN / 95% BG figure this lane's header cites was produced by
    // ai/llm/fcEval.jev.ts. Both sides build the prompt from jevPrompt.ts, so
    // this pins that the production catalogue really uses that shared shape —
    // if it drifts, the accuracy claim stops being about the shipped prompt.
    expect(turnQuestions().tool.instructions).toBe(TOOL_INSTRUCTIONS);
    const withParams = TOOLS.find((t) => t.params.length > 0)!;
    expect(toolCriteria()[withParams.name]).toBe(
      toolOptionText(
        withParams.description.en,
        withParams.params.map((p) => p.name),
      ),
    );
  });

  it("describes tools in English, the configuration the accuracy was measured with", () => {
    const criteria = toolCriteria();
    const sample = TOOLS.find((t) => t.description.en !== t.description.bg);
    expect(sample, "no tool with differing bg/en descriptions").toBeTruthy();
    expect(criteria[sample!.name]).toContain(sample!.description.en);
  });
});

describe("jevRoute", () => {
  it("routes a confident pick", async () => {
    const tool = TOOLS[0].name;
    const r = await jevRoute("q", creds(), asking(answer(tool, 0.95)));
    expect(r.route?.tool).toBe(tool);
    expect(r.degraded).toBe(false);
    expect(r.confidence).toBe(0.95);
  });

  it("discards a pick below the confidence gate and asks the lane to fall back", async () => {
    const r = await jevRoute(
      "q",
      creds(),
      asking(answer(TOOLS[0].name, JEV_CONFIDENCE_GATE - 0.01)),
    );
    expect(r.route).toBeNull();
    expect(r.degraded).toBe(true);
  });

  it("accepts a pick exactly at the gate", async () => {
    const r = await jevRoute(
      "q",
      creds(),
      asking(answer(TOOLS[0].name, JEV_CONFIDENCE_GATE)),
    );
    expect(r.route).not.toBeNull();
    expect(r.degraded).toBe(false);
  });

  // `undefined < 0.7` and `NaN < 0.7` are both FALSE, so a naive comparison
  // reads an unparseable confidence as "confident" and routes on it — from a
  // payload the proxy forwards verbatim.
  it.each([
    ["missing", { type: "choice", choice: "turnout", probabilities: {} }],
    [
      "NaN",
      { type: "choice", choice: "turnout", probabilities: {}, confidence: NaN },
    ],
    [
      "null",
      {
        type: "choice",
        choice: "turnout",
        probabilities: {},
        confidence: null,
      },
    ],
    [
      "a string",
      {
        type: "choice",
        choice: "turnout",
        probabilities: {},
        confidence: "0.99",
      },
    ],
  ])(
    "degrades rather than routing when confidence is %s",
    async (_label, tool) => {
      const r = await jevRoute(
        "q",
        creds(),
        asking({
          answers: { tool: tool as unknown as JevAnswer },
          latencyMs: 1,
        }),
      );
      expect(r.route).toBeNull();
      expect(r.degraded).toBe(true);
    },
  );

  it("treats a confident no_tool as a real answer, not a failure", async () => {
    const r = await jevRoute("q", creds(), asking(answer(NO_TOOL, 0.98)));
    expect(r.route).toBeNull();
    // NOT degraded: re-routing a confident decline through keywords would
    // manufacture a match for a question that has none.
    expect(r.degraded).toBe(false);
  });

  it("degrades when the client returns nothing at all", async () => {
    const r = await jevRoute("q", creds(), asking(null));
    expect(r.route).toBeNull();
    expect(r.degraded).toBe(true);
  });

  it("degrades when the answer is not a choice", async () => {
    const r = await jevRoute(
      "q",
      creds(),
      asking({
        answers: { tool: { type: "noul", noul: 1 } },
        latencyMs: 1,
      }),
    );
    expect(r.route).toBeNull();
    expect(r.degraded).toBe(true);
  });
});

describe("acceptJevPick — the argument rule", () => {
  const paramTool = TOOLS.find((t) => t.params.length > 0)!;
  const zeroParamTool = TOOLS.find((t) => t.params.length === 0)!;

  it("takes the router's extracted args when both picked the same tool", () => {
    const det = { tool: paramTool.name, args: { party: "ГЕРБ" } };
    const accepted = acceptJevPick({ tool: paramTool.name, args: {} }, det);
    expect(accepted.route).toBe(det);
    expect(accepted.usedJev).toBe(true);
  });

  // The critical one: a param-bearing tool run with {} answers a DIFFERENT
  // question than the one asked — confidently, at a 200. `macroIndicator({})`
  // falls back to GDP growth, so "Колко е безработицата?" would be answered
  // with GDP.
  it("refuses a param-bearing pick it cannot fill, keeping the deterministic route", () => {
    const det = { tool: zeroParamTool.name, args: {} };
    const accepted = acceptJevPick({ tool: paramTool.name, args: {} }, det);
    expect(accepted.route).toBe(det);
    expect(accepted.usedJev).toBe(false);
  });

  it("never emits a param-bearing tool with empty args, for ANY registry tool", () => {
    for (const t of TOOLS) {
      const accepted = acceptJevPick({ tool: t.name, args: {} }, null);
      if (!accepted.route) continue;
      const params = TOOLS_BY_NAME[accepted.route.tool]?.params ?? [];
      if (Object.keys(accepted.route.args).length === 0)
        expect(
          params.length,
          `${accepted.route.tool} would run with no arguments`,
        ).toBe(0);
    }
  });

  it("runs a zero-param pick directly, since {} is its complete call", () => {
    const accepted = acceptJevPick(
      { tool: zeroParamTool.name, args: {} },
      null,
    );
    expect(accepted.route?.tool).toBe(zeroParamTool.name);
    expect(accepted.usedJev).toBe(true);
  });

  it("falls back to the deterministic route when Jev picked nothing", () => {
    const det = { tool: zeroParamTool.name, args: {} };
    expect(acceptJevPick(null, det)).toEqual({ route: det, usedJev: false });
  });
});

describe("JevProvider", () => {
  it("answers from the deterministic router when Jev never runs", async () => {
    // The No-LLM lane has no Turnstile session by design, so this is the
    // ORDINARY path there — and it must still answer the SAME route the
    // deterministic lane would have.
    expect(
      deterministicRoute,
      "fixture question no longer routes",
    ).toBeTruthy();
    const provider = new JevProvider(() => undefined, asking(null));
    const res = await provider.respond(DETERMINISTIC_Q, ctx);
    expect(res.tool).toBe(deterministicRoute!.tool);
    expect(res.meta?.routedBy).toBe("rules");
    expect(res.meta?.routerDegraded).toBe(true);
    expect(res.meta?.narratedBy).toBe("rules");
  });

  it("marks a Jev-routed turn as routed by jev, with its confidence", async () => {
    const provider = new JevProvider(
      creds,
      asking(answer(deterministicRoute!.tool, 0.93)),
    );
    const res = await provider.respond(DETERMINISTIC_Q, ctx);
    expect(res.meta?.routedBy).toBe("jev");
    expect(res.meta?.routerConfidence).toBe(0.93);
    expect(res.meta?.routerDegraded).toBeUndefined();
    expect(res.meta?.narratedBy).toBe("rules");
  });

  it("declines end to end on a confident no_tool, without re-routing through keywords", async () => {
    const provider = new JevProvider(creds, asking(answer(NO_TOOL, 0.99)));
    const res = await provider.respond(DETERMINISTIC_Q, ctx);
    // The deterministic router WOULD have matched this question — the point is
    // that a confident decline is respected rather than overridden.
    expect(res.tool).toBeUndefined();
    expect(res.meta?.routedBy).toBe("jev");
    expect(res.meta?.routerDegraded).toBeUndefined();
    expect(res.text.length).toBeGreaterThan(0);
  });

  it("reports no routing meta at all when Jev was never consulted", async () => {
    // A follow-on is answered before any model is asked, so badging the turn
    // "degraded" would report a failure that never happened.
    const ask = asking(answer("turnout", 0.99));
    const provider = new JevProvider(creds, ask);
    const res = await provider.respond("а ГЕРБ?", ctx, undefined, {
      prev: { tool: "partyResult", args: { party: "ПП" } },
    });
    expect(ask).not.toHaveBeenCalled();
    expect(res.meta?.routedBy).toBeUndefined();
    expect(res.meta?.routerDegraded).toBeUndefined();
  });

  it("never narrates with a model, whatever Jev returns", async () => {
    for (const result of [
      null,
      answer(NO_TOOL, 0.99),
      answer(deterministicRoute!.tool, 0.99),
      answer(deterministicRoute!.tool, 0.1),
    ]) {
      const provider = new JevProvider(creds, asking(result));
      const res = await provider.respond(DETERMINISTIC_Q, ctx);
      expect(res.meta?.narratedBy).toBe("rules");
      expect(res.meta?.model).toEqual(provider.label);
    }
  });

  it("does not claim to be AI-free in its label", () => {
    // Routing through Jev IS a hosted model call. A turn it routed must not be
    // labelled "Без AI" — the honesty requirement from plan §7.
    const provider = new JevProvider();
    expect(provider.label.bg).not.toBe("Без AI");
    expect(provider.label.en).not.toBe("No AI");
    expect(provider.label.bg).toContain("Jev");
  });

  it("runs a disambiguation pick without routing at all", async () => {
    const ask = asking(answer("turnout", 0.99));
    const provider = new JevProvider(creds, ask);
    const res = await provider.runChoice("turnout", {}, ctx);
    expect(ask).not.toHaveBeenCalled();
    expect(res.meta?.narratedBy).toBe("rules");
  });

  it("reports a tool failure as a message rather than throwing", async () => {
    const provider = new JevProvider(
      creds,
      asking(answer("definitelyNotARealTool", 0.99)),
    );
    const res = await provider.respond("нещо", ctx);
    expect(res.text.length).toBeGreaterThan(0);
  });
});
