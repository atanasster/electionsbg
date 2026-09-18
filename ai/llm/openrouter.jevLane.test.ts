// The AI lane's Jev pre-step, at the provider boundary.
//
// Two guarantees: without a Jev hook this lane behaves EXACTLY as it did
// before (same calls, same order), and with one it never falls back to keyword
// routing — a user who chose the model gets the full Gemini prompt when Jev
// cannot answer, not a weaker router.
import { describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "./openrouter";
import type { AiTurnPlan } from "./jevAiLane";
import type { ModelOption } from "./models";
import type { ToolContext } from "../tools/types";

const model: ModelOption = {
  id: "google/gemini-3.5-flash-lite",
  label: { bg: "Gemini", en: "Gemini" },
  sizeNote: { bg: "", en: "" },
  advantage: { bg: "", en: "" },
  ready: true,
  runtime: "cloud",
  routes: true,
};

const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };

// A pick is only run as-is when the tool needs NO arguments — otherwise the
// lane still asks the model to route, because Gemini fills arguments and an
// empty object answers a different question. `turnout` declares `election`, so
// it is the wrong fixture for "skips routing".
const ZERO_ARG_TOOL = "waterServices";

const access = {
  start: async () => ({ sessionToken: "s", questionId: "q" }),
  finish: async () => {},
};

/** Captures every proxy call so a test can assert what the lane actually did. */
const stubFetch = (reply: (body: Record<string, unknown>) => string) => {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    calls.push(body);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [{ message: { content: reply(body) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    } as unknown as Response;
  });
  return calls;
};

/** A routing call is the one whose system prompt teaches the {"tool":...,"args":...}
 *  reply shape. Matching on that — rather than on `action`, which EVERY proxy
 *  call carries — is what makes the assertions below non-vacuous. */
const isRoutingCall = (c: Record<string, unknown>) =>
  ((c.messages as { content: string }[])?.[0]?.content ?? "").includes(
    '{"tool"',
  );

const plan = (over: Partial<AiTurnPlan> = {}): AiTurnPlan => ({
  tool: null,
  noTool: false,
  compound: false,
  kind: null,
  degraded: false,
  ...over,
});

describe("without a Jev hook", () => {
  it("makes exactly the calls it made before Jev existed", async () => {
    const calls = stubFetch(() => '{"name": null}');
    const provider = new OpenRouterProvider(model, access);
    await provider.respond("Каква беше избирателната активност?", ctx);
    // A ROUTING call must still happen — without the hook the model does its
    // own tool selection. Asserting `action === "complete"` alone was vacuous:
    // every proxy call carries that action by construction.
    expect(calls.filter(isRoutingCall)).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe("with a Jev hook", () => {
  it("skips the model routing call when Jev confidently picks a zero-arg tool", async () => {
    const calls = stubFetch(() => "Активността беше висока.");
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ tool: ZERO_ARG_TOOL }),
    );
    await provider.respond("Каква беше избирателната активност?", ctx);
    // Only narration should be billed — the routing call is what Jev replaced.
    expect(calls.filter(isRoutingCall)).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("falls through to the full Gemini prompt when Jev cannot answer", async () => {
    const calls = stubFetch(() => '{"name": null}');
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ degraded: true }),
    );
    await provider.respond("Каква беше избирателната активност?", ctx);
    // The lane must still ask the MODEL to route — never drop to keyword
    // routing, which would give a user who chose the model a weaker answer
    // than they would have got without Jev in the path at all.
    expect(calls.filter(isRoutingCall)).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("rejects a conversational answer that states an unsupported figure", async () => {
    // No tool ran, so there are NO grounded facts — any statistic the model
    // volunteers is unverifiable, and this is the path most likely to produce
    // one. The turn must fall back to the ordinary decline instead.
    stubFetch(() => "Избирателната активност беше 38.9% през 2026 г.");
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ noTool: true, kind: "conversational" }),
    );
    const res = await provider.respond("Здравей, кой си ти?", ctx);
    expect(res.text).not.toContain("38.9");
    vi.unstubAllGlobals();
  });

  it("allows a conversational answer that states no figures", async () => {
    stubFetch(() => "Здравейте! Мога да помогна с данни за България.");
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ noTool: true, kind: "conversational" }),
    );
    const res = await provider.respond("Здравей, кой си ти?", ctx);
    expect(res.text).toContain("Мога да помогна");
    expect(res.meta?.narratedBy).toBe("model");
    vi.unstubAllGlobals();
  });

  it("asks the model to split a compound request", async () => {
    const calls = stubFetch((body) => {
      const msgs = body.messages as { content: string }[];
      const system = msgs[0]?.content ?? "";
      if (system.includes("Раздели"))
        return "Каква беше активността?\nКой спечели във Варна?";
      return "Отговор.";
    });
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ compound: true, tool: ZERO_ARG_TOOL }),
    );
    await provider.respond(
      "Каква беше активността и кой спечели във Варна?",
      ctx,
    );
    const splitCalls = calls.filter((c) =>
      JSON.stringify((c.messages as { content: string }[])[0]).includes(
        "Раздели",
      ),
    );
    // Splitting needs GENERATED text, which is the one thing Jev cannot do —
    // so it is the model's job, and it must actually be asked.
    expect(splitCalls).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("does not split when Jev says the turn is a single ask", async () => {
    const calls = stubFetch(() => "Отговор.");
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ tool: ZERO_ARG_TOOL, compound: false }),
    );
    await provider.respond("Каква беше активността?", ctx);
    const splitCalls = calls.filter((c) =>
      JSON.stringify((c.messages as { content: string }[])[0]).includes(
        "Раздели",
      ),
    );
    expect(splitCalls).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

// JEV PICKS THE TOOL, THE MODEL FILLS ITS PARAMETERS. `turnout` declares an
// `election` parameter, so a confident Jev pick of it must reach the model —
// but with a catalogue of that ONE tool, not the ~85 KB full one.
const PARAM_TOOL = "turnout";
// Runs offline under the fetch stub (`waterServices` fetches data and fails),
// so `res.tool` reports the route rather than an execution error.
const OTHER_TOOL = "turnoutSeries";
// Named only in the FULL catalogue — never in the general instructions — so it
// tells a one-tool prompt from the full one. (`turnoutSeries` cannot do this:
// the routing instructions mention it by name.)
const CATALOGUE_ONLY_TOOL = "waterServices";
const routingCalls = (calls: Record<string, unknown>[]) =>
  calls.filter(isRoutingCall);
const systemOf = (c: Record<string, unknown>) =>
  (c.messages as { content: string }[])[0].content;

describe("Jev picks the tool, the model fills its parameters", () => {
  it("asks the model about Jev's tool ONLY, and runs it", async () => {
    const calls = stubFetch((body) =>
      isRoutingCall(body)
        ? `{"tool":"${PARAM_TOOL}","args":{}}`
        : "Активността беше висока.",
    );
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL, toolConfidence: 0.93 }),
    );
    const res = await provider.respond(
      "Каква беше избирателната активност?",
      ctx,
    );
    const routing = routingCalls(calls);
    expect(routing).toHaveLength(1);
    // The one-tool catalogue: Jev's tool is described, another tool is not.
    expect(systemOf(routing[0])).toContain(PARAM_TOOL);
    expect(systemOf(routing[0])).not.toContain(CATALOGUE_ONLY_TOOL);
    expect(res.tool).toBe(PARAM_TOOL);
    // The answer band names who picked the tool.
    expect(res.meta?.routedBy).toBe("jev");
    expect(res.meta?.routerConfidence).toBe(0.93);
    vi.unstubAllGlobals();
  });

  it("sends a far smaller routing prompt than the full catalogue", async () => {
    const jevCalls = stubFetch(() => `{"tool":"${PARAM_TOOL}","args":{}}`);
    await new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    ).respond("Каква беше избирателната активност?", ctx);
    const one = systemOf(routingCalls(jevCalls)[0]).length;
    vi.unstubAllGlobals();
    const fullCalls = stubFetch(() => `{"tool":"${PARAM_TOOL}","args":{}}`);
    await new OpenRouterProvider(model, access).respond(
      "Каква беше избирателната активност?",
      ctx,
    );
    const full = systemOf(routingCalls(fullCalls)[0]).length;
    vi.unstubAllGlobals();
    // Measured: one tool against the whole catalogue is well over 10x smaller.
    expect(one * 10).toBeLessThan(full);
  });

  it("gives the full prompt — not the rules — when the model rejects Jev's tool", async () => {
    let routing = 0;
    const calls = stubFetch((body) => {
      if (!isRoutingCall(body)) return "Разказ.";
      // First routing call (Jev's one tool): the model says it does not fit.
      // Second (full catalogue): it picks another tool.
      return ++routing === 1
        ? '{"tool":null}'
        : `{"tool":"${OTHER_TOOL}","args":{}}`;
    });
    const provider = new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    );
    const res = await provider.respond(
      "Каква беше избирателната активност?",
      ctx,
    );
    const r = routingCalls(calls);
    expect(r).toHaveLength(2);
    // First Jev's one tool, then the full catalogue.
    expect(systemOf(r[0])).not.toContain(CATALOGUE_ONLY_TOOL);
    expect(systemOf(r[1])).toContain(CATALOGUE_ONLY_TOOL);
    expect(res.tool).toBe(OTHER_TOOL);
    expect(res.meta?.routedBy).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("gives the full prompt when the model's reply to Jev's tool is unusable", async () => {
    let routing = 0;
    const calls = stubFetch((body) => {
      if (!isRoutingCall(body)) return "Разказ.";
      return ++routing === 1
        ? "not json"
        : `{"tool":"${OTHER_TOOL}","args":{}}`;
    });
    const res = await new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    ).respond("Каква беше избирателната активност?", ctx);
    // An unparseable reply used to fall back to the keyword router inside
    // `selectRoute`; on the Jev path it must reach the model's full prompt.
    expect(routingCalls(calls)).toHaveLength(2);
    expect(res.tool).toBe(OTHER_TOOL);
    vi.unstubAllGlobals();
  });

  it("stays inside the per-question call budget when it has to re-ask", async () => {
    // Jev (1) + Jev's tool (1) + the full prompt (1) = the whole budget of 3.
    // The narration call would be the fourth and the proxy would reject it, so
    // the answer is worded from the template instead.
    let routing = 0;
    const calls = stubFetch((body) => {
      if (!isRoutingCall(body)) return "Разказ от модела.";
      return ++routing === 1
        ? '{"tool":null}'
        : `{"tool":"${OTHER_TOOL}","args":{}}`;
    });
    const res = await new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    ).respond("Каква беше избирателната активност?", ctx);
    expect(calls).toHaveLength(2);
    expect(res.meta?.narratedBy).toBe("rules");
    expect(res.text).not.toContain("Разказ от модела");
    vi.unstubAllGlobals();
  });

  it("narrates with the model when Jev's tool was accepted first time", async () => {
    // The discriminating half of the budget test: jev + fill + narrate = 3, so
    // the ordinary path keeps its model narration.
    const calls = stubFetch((body) =>
      isRoutingCall(body)
        ? `{"tool":"${PARAM_TOOL}","args":{}}`
        : "Разказ от модела.",
    );
    const res = await new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    ).respond("Каква беше избирателната активност?", ctx);
    expect(calls).toHaveLength(2);
    expect(res.meta?.narratedBy).toBe("model");
    vi.unstubAllGlobals();
  });

  it("keeps a deterministic scope decision over Jev's pick, at no model cost", async () => {
    // „Поръчки на АПИ" resolves to `procurementQuery`, one of the scopes the
    // rules settle before any model is asked (they resolve a named buyer or
    // party better than the model does). Jev's pick must not override that,
    // and settling it must cost no model call at all.
    const calls = stubFetch(() => "Разказ.");
    const res = await new OpenRouterProvider(model, access, async () =>
      plan({ tool: PARAM_TOOL }),
    ).respond("Поръчки на АПИ", ctx);
    expect(routingCalls(calls)).toHaveLength(0);
    expect(res.tool).toBe("procurementQuery");
    vi.unstubAllGlobals();
  });

  it("gives the full prompt when Jev is unsure, as before", async () => {
    const calls = stubFetch(() => `{"tool":"${OTHER_TOOL}","args":{}}`);
    await new OpenRouterProvider(model, access, async () =>
      plan({ tool: null, toolConfidence: 0.5 }),
    ).respond("Каква беше избирателната активност?", ctx);
    const r = routingCalls(calls);
    expect(r).toHaveLength(1);
    expect(systemOf(r[0])).toContain(CATALOGUE_ONLY_TOOL);
    vi.unstubAllGlobals();
  });
});
