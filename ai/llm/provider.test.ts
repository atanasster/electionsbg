import { afterEach, describe, expect, it, vi } from "vitest";
import {
  declinedAnswer,
  HeuristicProvider,
  nearMissEnvelope,
} from "./provider";
import { OpenRouterProvider } from "./openrouter";
import { DEFAULT_MODEL_ID, modelById } from "./models";
import { selectHeuristicRoute } from "./heuristicRoute";
import * as registry from "../tools/registry";
import { TOOLS_BY_NAME } from "../tools/registry";

// Near-miss clarification (plan C6): a question the keyword router declines, but
// which contains a surface variant of a word the tool vocabulary uses, must offer
// a chooser instead of `clarify()`'s single static sentence.
//
// The property that matters is the FALLBACK, not the feature: this runs on the
// path where the chat currently has nothing, so it must never make a declined
// question worse. Two ways it could:
//   - offering an option that cannot be run, which re-opens the same chooser when
//     picked (the caller re-runs `option.tool` with `option.args` verbatim);
//   - displacing the plain sentence for a question that has no near miss.

const ctx = { lang: "bg" as const, election: "2026_04_19" };

afterEach(() => vi.restoreAllMocks());

describe("near-miss chooser", () => {
  it("offers only tools whose whole answer is fixed by an empty arg set", async () => {
    // The property is NOT "declares no required param". `macroIndicator.indicator`
    // and `priceRanking.metric` are optional and still choose WHICH metric is
    // answered, so admitting them and passing `{}` answered a different question
    // than the sublabel promised.
    const cases = ["Каква е инфлацята?", "Колко похарчи НЗОК за лекрства?"];
    let offered = 0;
    for (const q of cases) {
      const env = nearMissEnvelope(q, ctx);
      expect(env?.clarify, q).toBeDefined();
      const options = env!.clarify!.options;
      expect(options.length, q).toBeGreaterThan(0);
      expect(options.length, q).toBeLessThanOrEqual(3);
      for (const o of options) {
        offered++;
        const tool = TOOLS_BY_NAME[o.tool];
        expect(tool, `${q}: ${o.tool} is not a registered tool`).toBeDefined();
        // Not one optional selector either — the whole param list must be empty.
        expect(
          tool.params.map((p) => `${p.name}${p.required ? "!" : ""}`),
          `${q}: ${o.tool} has an argument that selects what is answered`,
        ).toEqual([]);
        expect(o.args).toEqual({});
        expect(o.label.length).toBeGreaterThan(0);
      }
    }
    expect(offered).toBeGreaterThan(0);
  });

  it("offers NOTHING rather than a tool that would answer a different question", () => {
    // The regression test for the wrong-answer path: the only option this question
    // used to get was macroIndicator({}), which falls back to GDP growth. The tools
    // that would answer it need an `indicator`/`oblast`, so there is no correct
    // option to offer and the honest outcome is the plain sentence.
    expect(nearMissEnvelope("Колко е безработноста?", ctx)).toBeNull();
    expect(nearMissEnvelope("Каква е избирателната активнос?", ctx)).toBeNull();
    // ...and the plain sentence is what the caller then produces.
    expect(declinedAnswer("Колко е безработноста?", ctx).env).toBeNull();
  });

  it("never fires on an ordinary word that is not a typo", () => {
    // `лек` was a 3-character key reachable through the one-edit fallback from the
    // ordinary inflections `лека`/`леки`, so a question about how light a procedure
    // is fired all four drug tools. The corpus pins cannot see this: neither word
    // appears in it.
    for (const q of ["Колко лека е процедурата?", "Колко леки коли има?"])
      expect(nearMissEnvelope(q, ctx), q).toBeNull();
  });

  it("runs every offered option without landing back in a chooser", async () => {
    // Picking an option re-runs `option.tool` with `option.args` verbatim, so an
    // option that clarifies again would loop. Asserted by RUNNING it, not by
    // re-checking the filter the production code already applied.
    const run = vi
      .spyOn(registry, "runTool")
      .mockImplementation(async (name) => ({
        tool: name,
        kind: "scalar",
        title: name,
        viz: "none",
        facts: { ok: 1 },
        provenance: ["fixture"],
      }));
    try {
      let picked = 0;
      for (const q of [
        "Каква е инфлацята?",
        "Колко похарчи НЗОК за лекрства?",
      ]) {
        const env = nearMissEnvelope(q, ctx);
        for (const o of env!.clarify!.options) {
          picked++;
          const res = await new HeuristicProvider().runChoice(
            o.tool,
            o.args,
            ctx,
          );
          expect(
            res.env?.clarify,
            `${q}: ${o.tool} re-opened the chooser`,
          ).toBeUndefined();
          expect(res.tool).toBe(o.tool);
        }
      }
      expect(picked).toBeGreaterThan(0);
    } finally {
      run.mockRestore();
    }
  });

  it("explains the correction it is suggesting", () => {
    const env = nearMissEnvelope("Каква е инфлацята?", ctx);
    const first = env!.clarify!.options[0];
    // macroIndicator would answer a different question (see the filter above), so
    // the surviving option is the fixed-cohort comparison that genuinely concerns
    // inflation.
    expect(first.tool).toBe("basketVsInflation");
    // The sublabel names the surface variation, so the suggestion is explainable
    // rather than a silent guess.
    expect(first.sublabel).toContain("inflatsyata");
    expect(first.sublabel).toContain("inflatsiya");
  });

  it("keeps the plain sentence when there is no near miss", () => {
    for (const q of [
      "Министерският съвет колко похарчи?", // no surface variation
      "Какво е възнаграждението на кмета?", // no tool answers this intent
      "", // no evidence at all
    ])
      expect(nearMissEnvelope(q, ctx), q).toBeNull();
  });

  it("is reached only where the router declines, and then the provider shows it", async () => {
    const q = "Каква е инфлацята?";
    // Sanity: the ROUTER declines this one — checked at routing level, not by
    // running a tool, so the assertion is about routing and nothing else.
    expect(selectHeuristicRoute(q, ctx).route).toBeNull();
    const res = await new HeuristicProvider().respond(q, ctx);
    expect(res.env?.clarify).toBeDefined();
    expect(res.env?.tool).toBe("clarify");
    expect(res.meta?.narratedBy).toBe("rules");
    // The prompt IS the narration for a clarify envelope.
    expect(res.text).toBe(res.env!.clarify!.prompt);
  });

  it("labels the cloud lane's declined answer as No AI, with no model tokens", async () => {
    // The cloud lane reaches this branch when the model ABSTAINS or returns
    // something unusable. The answer contains no model output, so it must not be
    // labelled as model-generated, and it must not carry the routing call's tokens.
    const access = {
      start: async () => ({ sessionToken: "t", questionId: "q" }),
      finish: async () => {},
    };
    const provider = new OpenRouterProvider(
      modelById(DEFAULT_MODEL_ID)!,
      access,
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"tool":null,"args":{}}' } }],
          usage: { prompt_tokens: 123, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const res = await provider.respond("Каква е инфлацята?", ctx);
      expect(res.env?.clarify).toBeDefined();
      expect(res.meta?.model).toEqual({ bg: "Без AI", en: "No AI" });
      expect(res.meta?.narratedBy).toBe("rules");
      expect(res.meta?.inputTokens).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("does not change the answer for a question the router resolves", async () => {
    const q = "Колко гласа взе ГЕРБ?";
    // Resolved by the router, so the near-miss path is never consulted ...
    expect(selectHeuristicRoute(q, ctx).route?.tool).toBe("partyResult");
    expect(nearMissEnvelope(q, ctx)).toBeNull();
    // ... and the provider runs the tool, with no chooser in the response. The run
    // is stubbed because this suite has no data client.
    const run = vi.spyOn(registry, "runTool").mockResolvedValue({
      tool: "partyResult",
      kind: "scalar",
      title: "GERB",
      viz: "none",
      facts: { votes: 1 },
      provenance: ["fixture"],
    });
    try {
      const res = await new HeuristicProvider().respond(q, ctx);
      expect(res.env?.clarify).toBeUndefined();
      expect(res.tool).toBe("partyResult");
      expect(run).toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });
});
