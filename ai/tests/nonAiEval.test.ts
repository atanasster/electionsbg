import { describe, expect, it, vi } from "vitest";
import known from "./nonAiEval.knownFailures.json";
import { NON_AI_CASES, evaluateNonAi } from "./nonAiEval";
import { HeuristicProvider } from "../llm/provider";
import * as registry from "../tools/registry";
const knownFailures = new Set(Object.keys(known));
describe("Non AI shared bilingual evals (known failures are explicit)", () => {
  const keys = NON_AI_CASES.flatMap((c) => [`${c.id}:en`, `${c.id}:bg`]);
  it("covers both languages and retains no stale known-failure entries", () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of knownFailures) expect(keys).toContain(key);
    expect(
      NON_AI_CASES.filter((c) =>
        ["realistic", "conversation", "clarification"].includes(c.group),
      ),
    ).toHaveLength(40);
  });
  for (const c of NON_AI_CASES)
    for (const lang of ["en", "bg"] as const) {
      const key = `${c.id}:${lang}`;
      // A repaired known failure becomes an unexpected pass: remove its entry.
      // A newly broken previously passing case fails normally. Never replace gold
      // tool/argument expectations with the deterministic router's current answer.
      const test = knownFailures.has(key) ? it.fails : it;
      test(`${key}${knownFailures.has(key) ? " [known gap]" : ""}`, () => {
        const result = evaluateNonAi(c, lang);
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
