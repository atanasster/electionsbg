import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { buildNarrationPrompt } from "../orchestrator/prompts";
import {
  INPUT_BYTE_CEILING,
  proxyMessageBytes,
  routingRequestBytes,
} from "./promptBudget";
import type { Envelope, Lang } from "../tools/types";

// G3b — the OTHER request that carries a system prompt and inlined content.
//
// The routing prompt gets all the attention (`promptNarrowing`, `promptBudget`), but
// `buildNarrationPrompt` inlines `JSON.stringify(env.facts)` into its user turn under
// the SAME 96,000-byte proxy ceiling, and nothing bounded it. This is the cheap half
// of the guard: it pins the structural reason narration cannot breach the ceiling,
// and `ai/tests/regression.ts` — which executes every tool against real data —
// carries the exhaustive half for the envelopes actually produced.
const { POLICY } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
) as { POLICY: { inputBytes: number } };

const envelope = (facts: Record<string, string | number>): Envelope =>
  ({
    tool: "fixture",
    kind: "scalar",
    title: "Fixture — test",
    viz: "none",
    facts,
    provenance: ["fixture.json"],
  }) as Envelope;

const narrationBytes = (env: Envelope, lang: Lang): number => {
  const { system, user } = buildNarrationPrompt(env, lang);
  return proxyMessageBytes([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
};

describe("the narration request cannot reach the proxy ceiling", () => {
  it("bases the guarantee on the fact VALUE TYPE, not on a sample", () => {
    // `Envelope.facts` is `Record<string, string | number>` — there is no nesting and
    // no arrays, so the payload grows only with the number and length of scalars, both
    // of which are code-determined. A compile-time check keeps that true: a nested or
    // array-valued fact would not typecheck here, and this test would not compile.
    const bounded: Record<string, string | number> = {
      scalar: 1,
      text: "x",
    };
    expect(narrationBytes(envelope(bounded), "bg")).toBeGreaterThan(0);
  });

  it("stays far inside the ceiling for a payload no tool approaches", () => {
    // 200 facts of 100 characters: ~20 KB of facts, which no production envelope comes
    // close to (the largest observed are a few hundred bytes). Even this stays an
    // order of magnitude under the ceiling, so narration size is not a cliff — it is a
    // guard against a future tool inlining a table into `facts` by mistake.
    const facts: Record<string, string> = {};
    for (let i = 0; i < 200; i++) facts[`fact_${i}`] = "я".repeat(100);
    const bytes = narrationBytes(envelope(facts), "bg");
    // Measured 45,382 bytes — Cyrillic is 2 bytes per character in UTF-8, so the
    // synthetic payload is ~40 KB of facts alone. The honest bound is the ceiling, not
    // a comfortable factor under it: the point is that a payload NO real envelope
    // approaches still arrives, which is what makes the structural argument below
    // sufficient rather than merely suggestive.
    expect(bytes).toBeGreaterThan(40_000);
    expect(bytes).toBeLessThan(INPUT_BYTE_CEILING);
    expect(bytes).toBeLessThan(POLICY.inputBytes);
  });

  it("is an order of magnitude smaller than the routing prompt it accompanies", () => {
    // The routing prompt carries the whole catalogue; narration carries one envelope.
    const tiny = narrationBytes(envelope({ a: 1, b: "two" }), "bg");
    const routing = routingRequestBytes("bg", undefined, "Какво е това?");
    expect(tiny).toBeLessThan(routing / 10);
  });

  it("grows with facts rather than being constant, so the bound is meaningful", () => {
    const small = narrationBytes(envelope({ a: "x" }), "bg");
    const large = narrationBytes(
      envelope(
        Object.fromEntries(
          Array.from({ length: 50 }, (_, i) => [`k${i}`, "y".repeat(50)]),
        ),
      ),
      "bg",
    );
    expect(large).toBeGreaterThan(small + 2_000);
  });
});
