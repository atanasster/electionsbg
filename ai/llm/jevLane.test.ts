// The comparison is only meaningful if all three lanes are judged by the same
// rules on the same cases — this repo has already been burned by scoring the
// same question two ways. These tests pin that the Jev lane REUSES the
// deterministic lane's bank, input shaping, normalisation and scoring, and
// differs only in how the route is chosen.
import { describe, expect, it, vi } from "vitest";
import { JEV_LANE_CASES, evaluateJev, jevLaneRoute } from "./jevLane";
import { NON_AI_CASES, evaluateNonAi } from "../tests/nonAiEval";
import { NO_TOOL } from "./jevPrompt";
import type { JevResult } from "./jevClient";
import type { ToolContext } from "../tools/types";

const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };

const answer = (choice: string, confidence = 0.95): JevResult =>
  ({
    answers: {
      tool: { type: "choice", choice, probabilities: {}, confidence },
    },
    latencyMs: 40,
  }) as unknown as JevResult;

const asking = (result: JevResult | null) =>
  vi.fn(async () => result) as unknown as Parameters<typeof jevLaneRoute>[4];

describe("the shared bank", () => {
  it("is the SAME case list the deterministic lane scores", () => {
    // Not a copy, not a subset — the same array. A lane scored on different
    // cases is not comparable, however similar the numbers look.
    expect(JEV_LANE_CASES).toBe(NON_AI_CASES);
    expect(JEV_LANE_CASES.length).toBeGreaterThan(800);
  });
});

describe("jevLaneRoute", () => {
  it("answers a follow-on deterministically, without consulting Jev", async () => {
    // Both other lanes do this too — scoring it differently here would make
    // the comparison about the preamble rather than about routing.
    const ask = asking(answer("turnout"));
    const r = await jevLaneRoute(
      "а ГЕРБ?",
      ctx,
      { prev: { tool: "partyResult", args: { party: "ПП" } } },
      undefined,
      ask,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(r.routedByJev).toBe(false);
    expect(r.selected?.tool).toBe("partyResult");
  });

  it("marks a confident decline as routed by Jev, not as a gap", async () => {
    const r = await jevLaneRoute(
      "Какво е времето?",
      ctx,
      {},
      undefined,
      asking(answer(NO_TOOL)),
    );
    expect(r.selected).toBeNull();
    expect(r.routedByJev).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it("falls back to the deterministic route when Jev is unavailable", async () => {
    const r = await jevLaneRoute(
      "Каква беше избирателната активност?",
      ctx,
      {},
      undefined,
      asking(null),
    );
    expect(r.degraded).toBe(true);
    expect(r.routedByJev).toBe(false);
    // The lane still ANSWERS — a degraded routing call must not cost the case.
    expect(r.selected).not.toBeNull();
  });
  it("marks a failed ARGUMENT call as degraded, not as a refused pick", async () => {
    // Tier 2: Jev picks a tool the deterministic route cannot supply arguments
    // for, so a second call asks Jev for them. When that call fails (a rate
    // limit, most often) the row used to be scored as an ordinary refused pick
    // — an outage counted against the router as if it had decided.
    let calls = 0;
    const ask = vi.fn(async () =>
      ++calls === 1 ? answer("regionWinners") : null,
    ) as unknown as Parameters<typeof jevLaneRoute>[4];
    const r = await jevLaneRoute(
      "Каква беше избирателната активност?",
      ctx,
      {},
      undefined,
      ask,
    );
    expect(calls).toBe(2);
    expect(r.routedByJev).toBe(false);
    expect(r.degraded).toBe(true);
  });

  it("does not mark a refused pick degraded when both calls answered", async () => {
    // The discriminating half: the same refusal with a live second call is a
    // decision, and must stay undegraded.
    let calls = 0;
    const ask = vi.fn(async () =>
      ++calls === 1
        ? answer("regionWinners")
        : ({ answers: {}, latencyMs: 30 } as unknown as JevResult),
    ) as unknown as Parameters<typeof jevLaneRoute>[4];
    const r = await jevLaneRoute(
      "Каква беше избирателната активност?",
      ctx,
      {},
      undefined,
      ask,
    );
    expect(calls).toBe(2);
    expect(r.degraded).toBe(false);
  });
});

describe("evaluateJev", () => {
  const relevant = NON_AI_CASES.find((c) => c.tool && !c.history)!;

  it("scores a correct pick as a tool hit", async () => {
    const row = await evaluateJev(
      relevant,
      "bg",
      undefined,
      asking(answer(relevant.tool!)),
    );
    expect(row.toolOk).toBe(true);
    expect(row.routedByJev).toBe(true);
  });

  it("leaves argsOk null on a case that carries no expectation", async () => {
    // Identical to the other lanes: `null`, never `true`, so a consumer
    // averaging argsOk cannot report an unannotated case as a pass.
    const unannotated = NON_AI_CASES.find(
      (c) => c.tool && !c.args && !c.argsByLang,
    )!;
    const row = await evaluateJev(
      unannotated,
      "bg",
      undefined,
      asking(answer(unannotated.tool!)),
    );
    expect(row.argsOk).toBeNull();
    expect(row.argScored).toBe(false);
  });

  it("scores an irrelevance case as a hit only when nothing is routed", async () => {
    const irrelevant = NON_AI_CASES.find((c) => c.tool === null);
    if (!irrelevant) return;
    const declined = await evaluateJev(
      irrelevant,
      "bg",
      undefined,
      asking(answer(NO_TOOL)),
    );
    expect(declined.toolOk).toBe(true);

    const routed = await evaluateJev(
      irrelevant,
      "bg",
      undefined,
      asking(answer("turnout")),
    );
    expect(routed.toolOk).toBe(false);
  });

  it("agrees with the deterministic lane when Jev is unavailable", async () => {
    // The strongest statement that the two lanes share a scorer: with Jev
    // silent, the Jev lane IS the deterministic lane, so every field it shares
    // must match — a divergence here means the comparison is measuring the
    // harness rather than the router.
    for (const c of NON_AI_CASES.slice(0, 40))
      for (const lang of ["en", "bg"] as const) {
        const jev = await evaluateJev(c, lang, undefined, asking(null));
        const base = evaluateNonAi(c, lang);
        expect(jev.selected, `${c.id}/${lang}`).toEqual(base.selected);
        expect(jev.toolOk, `${c.id}/${lang}`).toBe(base.toolOk);
        expect(jev.callOk, `${c.id}/${lang}`).toBe(base.callOk);
        expect(jev.argsOk, `${c.id}/${lang}`).toBe(base.argsOk);
      }
  });
});
