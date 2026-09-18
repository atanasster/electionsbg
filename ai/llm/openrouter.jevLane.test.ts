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
