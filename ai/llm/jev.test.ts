// The invariant this file exists to pin: the Jev-routed lane NEVER reaches an
// LLM, and never runs a tool it cannot supply arguments for. Whatever Jev does
// — answer, decline, time out, or never run — this lane answers from its own
// deterministic router and its own templates. A fallback that changed lanes
// would silently give a user who chose "no LLM" an LLM.
import { describe, expect, it, vi } from "vitest";
import {
  ARG_UNSPECIFIED,
  JEV_CONFIDENCE_GATE,
  JEV_FALLBACK_LABEL,
  JEV_LABEL,
  JevProvider,
  NO_TOOL,
  ENTITY_PARAMS,
  ENTITY_PARAM_TYPES,
  NOT_AN_ENTITY,
  entityKindFor,
  acceptJevPick,
  argQuestions,
  argsSufficient,
  fillArgs,
  fillableTool,
  soleEntityParam,
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
    // UNSURE, not degraded: Jev answered, it was just below the gate. The two
    // were one flag, and the answer band then told the reader "Jev did not
    // answer in time" about a call that returned promptly.
    expect(r.unsure).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("marks a missing answer as degraded, not unsure", async () => {
    // The other half: no answer at all is an outage, and must not be reported
    // as the router abstaining.
    const r = await jevRoute("q", creds(), asking(null));
    expect(r.degraded).toBe(true);
    expect(r.unsure).toBeFalsy();
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

  it("reports a below-gate turn as UNSURE, and still answers it by the rules", async () => {
    // Jev answered promptly, below the confidence gate. The band used to say
    // "Jev did not answer in time" here — a false claim about a successful
    // call, on ~19% of turns — and a below-gate pair (no route, no failure) is
    // exactly the shape a naive decline check would mistake for a decline.
    const provider = new JevProvider(
      creds,
      asking(answer(deterministicRoute!.tool, 0.52)),
    );
    const res = await provider.respond(DETERMINISTIC_Q, ctx);
    expect(res.meta?.routerUnsure).toBe(true);
    expect(res.meta?.routerDegraded).toBeUndefined();
    expect(res.meta?.routerDeclined).toBeUndefined();
    expect(res.meta?.routerConfidence).toBe(0.52);
    // Not declined: the rules answer it.
    expect(res.meta?.routedBy).toBe("rules");
    expect(res.tool).toBe(deterministicRoute!.tool);
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
    }
  });

  // The band renders `meta.model` verbatim, so this IS the guard against a turn
  // claiming Jev routed it when Jev did not. Reverting the per-turn swap back to
  // `this.label` fails here — the component tests alone cannot catch it,
  // because they set `meta.model` by hand.
  it("labels each turn by what actually produced it", async () => {
    const routedByJev = await new JevProvider(
      creds,
      asking(answer(deterministicRoute!.tool, 0.95)),
    ).respond(DETERMINISTIC_Q, ctx);
    expect(routedByJev.meta?.model).toEqual(JEV_LABEL);

    for (const result of [null, answer(deterministicRoute!.tool, 0.1)]) {
      const res = await new JevProvider(creds, asking(result)).respond(
        DETERMINISTIC_Q,
        ctx,
      );
      expect(res.meta?.model).toEqual(JEV_FALLBACK_LABEL);
      expect(res.meta?.model.bg).not.toContain("Jev");
    }
  });

  it("does not credit Jev for a disambiguation pick it never saw", async () => {
    const res = await new JevProvider(creds, asking(null)).runChoice(
      "turnout",
      {},
      ctx,
    );
    expect(res.meta?.model).toEqual(JEV_FALLBACK_LABEL);
    expect(res.meta?.model.bg).not.toContain("Jev");
  });

  // The band turns `routerDegraded` into "Jev не отговори навреме". A refused
  // pick is NOT that: Jev answered on time and the lane declined to use it
  // because it could not fill the tool's parameters.
  it("does not report a refused-but-successful pick as a Jev failure", async () => {
    const paramTool = TOOLS.find(
      (t) => t.params.length > 0 && t.name !== deterministicRoute!.tool,
    )!;
    const res = await new JevProvider(
      creds,
      asking(answer(paramTool.name, 0.99)),
    ).respond(DETERMINISTIC_Q, ctx);
    expect(res.meta?.routedBy).toBe("rules");
    expect(res.meta?.routerDegraded).toBeUndefined();
  });

  it("marks a decline so the band does not claim a tool was chosen", async () => {
    const res = await new JevProvider(
      creds,
      asking(answer(NO_TOOL, 0.99)),
    ).respond(DETERMINISTIC_Q, ctx);
    expect(res.meta?.routerDeclined).toBe(true);
    expect(res.tool).toBeUndefined();
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

describe("closed-vocabulary arguments (tier 2)", () => {
  const enumTool = TOOLS.find((t) => t.params.some((p) => p.values?.length))!;
  const enumParam = enumTool.params.find((p) => p.values?.length)!;

  it("only asks about parameters whose values the registry enumerates", () => {
    const questions = argQuestions(enumTool.name);
    // An open-vocabulary param (a name, a free-text query) has no candidate
    // list, so Jev is never asked about it — it cannot generate a value.
    for (const key of Object.keys(questions)) {
      const p = enumTool.params.find((x) => x.name === key)!;
      expect(p.values?.length, `${key} has no enumerable values`).toBeTruthy();
    }
    expect(Object.keys(questions)).toContain(enumParam.name);
  });

  it("offers an explicit unspecified option on every argument question", () => {
    // Without it a Choice must pick SOME value, inventing an argument the user
    // never gave — worse than leaving the parameter unset.
    for (const q of Object.values(argQuestions(enumTool.name)))
      expect(Object.keys(q.criteria as object)).toContain(ARG_UNSPECIFIED);
  });

  it("fills a confidently answered parameter, preserving the declared type", () => {
    const value = enumParam.values![0];
    const { args, filled } = fillArgs(enumTool.name, {
      answers: {
        [enumParam.name]: {
          type: "choice",
          choice: String(value),
          probabilities: {},
          confidence: 0.96,
        },
      },
      latencyMs: 5,
    });
    expect(filled).toContain(enumParam.name);
    // The answer is always a string; a numeric `values` entry must come back as
    // the number the tool declares, not "2021".
    expect(args[enumParam.name]).toBe(value);
  });

  it.each([
    ["unspecified", ARG_UNSPECIFIED, 0.99],
    ["below the gate", String(0), JEV_CONFIDENCE_GATE - 0.01],
    ["not a declared value", "definitely-not-a-value", 0.99],
  ])(
    "leaves a parameter unset when the answer is %s",
    (_l, choice, confidence) => {
      const { args } = fillArgs(enumTool.name, {
        answers: {
          [enumParam.name]: {
            type: "choice",
            choice,
            probabilities: {},
            confidence,
          },
        },
        latencyMs: 5,
      });
      // Unset falls back to the tool's own default; a guessed value silently
      // answers a different question.
      expect(args[enumParam.name]).toBeUndefined();
    },
  );

  it("refuses a tool whose REQUIRED parameter could not be filled", () => {
    const required = TOOLS.find((t) => t.params.some((p) => p.required));
    if (!required) return;
    expect(argsSufficient(required.name, {})).toBe(false);
  });

  it("accepts a tool once every required parameter is present", () => {
    const required = TOOLS.find((t) => t.params.some((p) => p.required));
    if (!required) return;
    const args = Object.fromEntries(
      required.params.filter((p) => p.required).map((p) => [p.name, "x"]),
    );
    expect(argsSufficient(required.name, args)).toBe(true);
  });

  it("does not spend a second call when the pick was already accepted", async () => {
    const ask = asking(answer(deterministicRoute!.tool, 0.95));
    await new JevProvider(creds, ask).respond(DETERMINISTIC_Q, ctx);
    expect(
      (ask as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(1);
  });
});

describe("the second call rescues a refused pick", () => {
  // The tier-2 win: without argument filling, acceptJevPick refuses every
  // param-bearing tool the deterministic router disagreed about, so a correct
  // Jev pick was thrown away. These use NAMED registry tools rather than a
  // `find(...)` + `if` guard — a conditional fixture is how the first cut of
  // this suite ended up asserting nothing at all.
  const askingSequence = (results: (JevResult | null)[]) => {
    let i = 0;
    return vi.fn(
      async () => results[Math.min(i++, results.length - 1)],
    ) as unknown as Parameters<typeof jevRoute>[2];
  };
  const argAnswer = (values: Record<string, string>, confidence = 0.95) =>
    ({
      answers: Object.fromEntries(
        Object.entries(values).map(([k, v]) => [
          k,
          { type: "choice", choice: v, probabilities: {}, confidence },
        ]),
      ),
      latencyMs: 30,
    }) as unknown as JevResult;

  // `rankPlaces` declares a REQUIRED param whose values the registry enumerates
  // — the exact shape tier 2 exists to rescue.
  const RESCUABLE = "rankPlaces";
  const required = TOOLS_BY_NAME[RESCUABLE].params.filter((p) => p.required);

  it("uses the registry fixture this suite assumes", () => {
    // Pins the fixture itself, so a registry change turns into a failure here
    // rather than silently making the tests below vacuous.
    expect(required.length).toBeGreaterThan(0);
    for (const p of required) expect(p.values?.length).toBeTruthy();
    expect(fillableTool(RESCUABLE)).toBe(true);
  });

  it("accepts the picked tool once Jev supplies its required values", async () => {
    const values = Object.fromEntries(
      required.map((p) => [p.name, String(p.values![0])]),
    );
    const ask = askingSequence([answer(RESCUABLE, 0.97), argAnswer(values)]);
    const res = await new JevProvider(creds, ask).respond(DETERMINISTIC_Q, ctx);
    // NB: `res.tool` is not assertable here — running any real tool needs data
    // this suite has no network for, so runAndNarrate catches and reports the
    // failure without echoing the attempted call. What IS observable is the
    // routing DECISION, and `routerFilledArgs` is true only when the rescue
    // was accepted with at least one value actually chosen.
    expect(res.meta?.routerFilledArgs).toBe(true);
    expect(res.meta?.routedBy).toBe("jev");
    expect(res.meta?.routerDegraded).toBeUndefined();
    // The value mapping itself (including numeric coercion and rejection) is
    // pinned directly on `fillArgs` above.
    const { args, filled } = fillArgs(RESCUABLE, argAnswer(values));
    expect(filled).toEqual(required.map((p) => p.name));
    for (const p of required) expect(args[p.name]).toBe(p.values![0]);
  });

  it("keeps the deterministic answer when a required value is not given", async () => {
    const unspecified = Object.fromEntries(
      required.map((p) => [p.name, ARG_UNSPECIFIED]),
    );
    const ask = askingSequence([
      answer(RESCUABLE, 0.97),
      argAnswer(unspecified),
    ]);
    const res = await new JevProvider(creds, ask).respond(DETERMINISTIC_Q, ctx);
    expect(res.tool).not.toBe(RESCUABLE);
    expect(res.meta?.routerFilledArgs).toBeUndefined();
  });

  // The FINDING-001 regression: these three tools declare enumerable params and
  // NO required param, so `argsSufficient` is vacuously true for them. Without
  // the "filled nothing" guard, an all-unspecified second call would run them
  // with args:{} and discard a correct deterministic answer — the
  // macroIndicator({}) trap through a different door.
  it.each(["presidentialResults", "regionWinners", "voteTransitions"])(
    "never runs %s with empty args when Jev filled nothing",
    async (tool) => {
      expect(
        TOOLS_BY_NAME[tool].params.some((p) => p.required),
        `${tool} now has a required param — fixture stale`,
      ).toBe(false);
      const ask = askingSequence([
        answer(tool, 0.97),
        { answers: {}, latencyMs: 30 },
      ]);
      const res = await new JevProvider(creds, ask).respond(
        DETERMINISTIC_Q,
        ctx,
      );
      // `routedBy` is the assertion that discriminates for ALL THREE: two of
      // these tools throw without network, so `res.tool` is undefined either
      // way and would pass vacuously. Accepting an empty-args rescue sets
      // usedJev, and therefore routedBy "jev" — so "rules" is the proof the
      // rescue was refused.
      expect(res.meta?.routedBy).toBe("rules");
      expect(res.tool).not.toBe(tool);
      expect(res.meta?.routerFilledArgs).toBeUndefined();
    },
  );

  it("spends no second call on a tool the registry predetermines it cannot fill", async () => {
    // An open-vocabulary REQUIRED param can never be filled, so asking would
    // burn one of the three reserved calls per question to learn something
    // readable locally.
    const unrescuable = TOOLS.find((t) =>
      t.params.some((p) => p.required && !p.values?.length),
    )!;
    expect(fillableTool(unrescuable.name)).toBe(false);
    const ask = askingSequence([answer(unrescuable.name, 0.97), null]);
    await new JevProvider(creds, ask).respond(DETERMINISTIC_Q, ctx);
    expect(
      (ask as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(1);
  });
});

describe("name-shaped arguments (tier 3)", () => {
  // A question the deterministic router answers with a DIFFERENT tool while
  // still yielding a name — the only shape where tier 3 can change anything.
  // When the router already picked the same tool, acceptJevPick takes its
  // extracted args and no entity resolution is needed.
  const ENTITY_Q = "Разкажи за Асен Василев";

  // ⚠️ THE SWEEP. `type: "person"` is not a reliable signal — the registry
  // reuses it for generic free-text names, and `schoolMatura.school` is a
  // SCHOOL. Resolving that against the person index would hand Jev a list of
  // real human beings for a question about a building. Every person/company
  // -typed required param must therefore be triaged explicitly, one way or the
  // other, or this fails.
  it("triages every name-typed required param in the registry", () => {
    const untriaged: string[] = [];
    for (const t of TOOLS)
      for (const p of t.params) {
        if (!p.required || !ENTITY_PARAM_TYPES.has(p.type)) continue;
        const key = `${t.name}.${p.name}`;
        if (!ENTITY_PARAMS[key] && !NOT_AN_ENTITY[key]) untriaged.push(key);
      }
    expect(
      untriaged,
      `untriaged name-shaped params — add to ENTITY_PARAMS or NOT_AN_ENTITY: ${untriaged.join(", ")}`,
    ).toEqual([]);
  });

  it("never resolves a param the allowlist excludes", () => {
    // The concrete regression: a school must not be looked up as a person.
    expect(NOT_AN_ENTITY["schoolMatura.school"]).toBeTruthy();
    expect(soleEntityParam("schoolMatura")).toBeNull();
    expect(entityKindFor("schoolMatura", "school")).toBeNull();
  });

  it("keeps the allowlist honest about which registry it queries", () => {
    for (const [key, kind] of Object.entries(ENTITY_PARAMS)) {
      const [tool, param] = key.split(".");
      expect(TOOLS_BY_NAME[tool], `${key}: unknown tool`).toBeTruthy();
      expect(
        TOOLS_BY_NAME[tool].params.some((p) => p.name === param),
        `${key}: unknown param`,
      ).toBeTruthy();
      expect(entityKindFor(tool, param)).toBe(kind);
    }
  });

  it("identifies the sole required person param of a people tool", () => {
    // Named fixture, not a find() — a conditional fixture is how an earlier
    // test in this file ended up asserting nothing.
    expect(soleEntityParam("personWealth")?.name).toBe("name");
    expect(entityKindFor("personWealth", "name")).toBe("person");
  });

  it("refuses a tool with no name-shaped required param", () => {
    expect(soleEntityParam("rankPlaces")).toBeNull();
  });

  it("resolves a person and runs the tool with the chosen identity", async () => {
    let call = 0;
    const ask = vi.fn(async () =>
      call++ === 0
        ? answer("personWealth", 0.97)
        : ({
            answers: {
              entity: {
                type: "choice",
                choice: "Асен Васков Василев",
                probabilities: {},
                confidence: 0.94,
              },
            },
            latencyMs: 20,
          } as unknown as JevResult),
    ) as unknown as Parameters<typeof jevRoute>[2];
    const search = vi.fn(async () => [
      { value: "Асен Васков Василев", label: "Асен Васков Василев — mp" },
      { value: "Асен Николаев Василев", label: "Асен Николаев Василев" },
    ]);
    const res = await new JevProvider(creds, ask, search).respond(
      ENTITY_Q,
      ctx,
    );
    expect(search).toHaveBeenCalledWith(
      "person",
      expect.stringContaining("Асен"),
    );
    expect(res.meta?.routedBy).toBe("jev");
    expect(res.meta?.routerFilledArgs).toBe(true);
    // Exactly two calls: route + entity. Every sole-entity tool has no other
    // enumerable param, and an empty question map is a 400 at the proxy that
    // would trip the breaker after a SUCCESSFUL turn.
    expect(
      (ask as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(2);
  });

  it("keeps the deterministic answer when the entity search finds nobody", async () => {
    const ask = asking(answer("personWealth", 0.97));
    const res = await new JevProvider(creds, ask, async () => []).respond(
      ENTITY_Q,
      ctx,
    );
    // Naming the wrong person is the failure this path exists to avoid, so an
    // empty search resolves to "no route", never to a guess.
    expect(res.meta?.routedBy).toBe("rules");
    expect(res.meta?.routerFilledArgs).toBeUndefined();
  });

  it("keeps the deterministic answer when Jev refuses every candidate", async () => {
    let call = 0;
    const ask = vi.fn(async () =>
      call++ === 0
        ? answer("personWealth", 0.97)
        : ({
            answers: {
              entity: {
                type: "choice",
                choice: "none_of_these",
                probabilities: {},
                confidence: 0.99,
              },
            },
            latencyMs: 20,
          } as unknown as JevResult),
    ) as unknown as Parameters<typeof jevRoute>[2];
    const res = await new JevProvider(creds, ask, async () => [
      { value: "Кирил Петков Петков", label: "Кирил Петков Петков — mp" },
    ]).respond(ENTITY_Q, ctx);
    expect(res.meta?.routedBy).toBe("rules");
  });
});
