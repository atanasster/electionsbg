import { describe, expect, it, vi } from "vitest";
import known from "./nonAiEval.knownFailures.json";
import { LEGACY_GROUPS, NON_AI_CASES, evaluateNonAi } from "./nonAiEval";
import { expectedArgs } from "../llm/currentEval";
import { STARTERS } from "../app/starters";
import { STARTER_CASES, droppedStarters } from "../llm/currentEval.starters";
import { HeuristicProvider } from "../llm/provider";
import * as registry from "../tools/registry";
type Known = { expectedTool: string | null; observedRoute: unknown };
const knownFailures = known as Record<string, Known>;
describe("Non AI shared bilingual evals (known failures are explicit)", () => {
  const keys = NON_AI_CASES.flatMap((c) => [`${c.id}:en`, `${c.id}:bg`]);
  it("covers both languages and retains no stale known-failure entries", () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of Object.keys(knownFailures)) expect(keys).toContain(key);
    expect(
      NON_AI_CASES.filter((c) =>
        ["realistic", "conversation", "clarification"].includes(c.group),
      ),
    ).toHaveLength(40);
  });
  it("carries the starter bank as its own group, with its arguments measured", () => {
    // The bank is the repo's richest argument ground truth (241 BG / 242 EN
    // starters declare expected args). It must not silently drop out of the
    // suite, and it must not be folded into another group where its argument
    // cases would be indistinguishable from the 53 legacy ones.
    const starters = NON_AI_CASES.filter((c) => c.group === "starter");
    // Pinned, not a floor: `starterEvalCases` filters on the registry, so a tool
    // rename would otherwise remove every starter pointing at it in silence.
    expect(droppedStarters()).toEqual([]);
    expect(STARTER_CASES).toHaveLength(STARTERS.length);
    expect(starters).toHaveLength(367);
    const argScored = (lang: "en" | "bg") =>
      starters.filter((c) => expectedArgs(c, lang) !== undefined).length;
    expect(argScored("bg")).toBe(241);
    expect(argScored("en")).toBe(242);
    // The bank is recall-tainted, so it must never be the denominator of the
    // legacy floor.
    expect(LEGACY_GROUPS as readonly string[]).not.toContain("starter");
  });
  it("keeps the legacy floor denominator stable", () => {
    // The pre-registered G0 floor (tool >=75.8% EN / 83.2% BG, argument
    // >=30.2%/39.6%) was measured on this corpus. Measured 2026-09-16: 474 cases
    // per language with 53 argument-annotated. A case added to any legacy group
    // would move the denominator the floor is checked against, so it is pinned.
    expect([...LEGACY_GROUPS]).toEqual([
      "registry",
      "challenge",
      "holdout",
      "unsupported",
      "realistic",
      "clarification",
      "conversation",
    ]);
    const legacy = NON_AI_CASES.filter((c) =>
      (LEGACY_GROUPS as readonly string[]).includes(c.group),
    );
    expect(legacy).toHaveLength(474);
    for (const lang of ["en", "bg"] as const)
      expect(
        legacy.filter((c) => expectedArgs(c, lang) !== undefined),
      ).toHaveLength(53);
  });
  for (const c of NON_AI_CASES)
    for (const lang of ["en", "bg"] as const) {
      const key = `${c.id}:${lang}`;
      const rec = knownFailures[key];
      // A known gap is ASSERTED, not skipped. `it.fails` was wrong for this: it
      // absorbs ANY throw (so a crash reads as the expected failure) and never
      // reads the recorded route, which let the file rot — 42 of its entries had
      // already drifted when this replaced it. Asserting the record makes a
      // repaired gap fail loudly, which is what the ratchet is for.
      it(`${key}${rec ? " [known gap]" : ""}`, () => {
        const result = evaluateNonAi(c, lang);
        if (rec) {
          expect(
            result.expectedTool,
            `${key}: recorded expectedTool drifted — the GOLD changed`,
          ).toBe(rec.expectedTool);
          expect(
            result.selected ?? null,
            `${key}: the router's answer changed — update this entry's observedRoute`,
          ).toEqual(rec.observedRoute);
          expect(
            result.callOk,
            `${key}: this known gap now PASSES — delete its knownFailures entry`,
          ).toBe(false);
          return;
        }
        expect(result.callOk, JSON.stringify(result)).toBe(true);
      });
    }
});
it("the Non AI chat provider uses this route without invoking a model", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("No network in Non AI routing tests"));
  const run = vi.spyOn(registry, "runTool").mockResolvedValue({
    tool: "turnout",
    kind: "scalar",
    title: "Turnout fixture",
    viz: "none",
    facts: { turnout: 42 },
    provenance: ["fixture"],
  });
  try {
    const response = await new HeuristicProvider().respond(
      "What was turnout in 2024?",
      { lang: "en", election: "2026_04_19" },
    );
    expect(run).toHaveBeenCalledWith(
      "turnout",
      { election: "2024" },
      { lang: "en", election: "2026_04_19" },
    );
    expect(response.meta?.narratedBy).toBe("rules");
    expect(response.meta?.inputTokens).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    run.mockRestore();
    fetch.mockRestore();
  }
});
