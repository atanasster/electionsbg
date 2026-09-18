// ⚠️ THE GATE THAT WAS MISSING, and the reason it matters more than it looks.
//
// The browser builds a Jev payload (ai/llm/jev.ts) and our own proxy validates
// it (functions/jev_payload.js). Nothing checked that the payload we actually
// ship PASSES that validator — and it did not: two registry tools produced
// option text over the 600-character limit, so `jevPayload` answered 400 for
// EVERY routing call. In production that means the lane degrades on every turn
// and the circuit breaker opens; Jev would have routed nothing at all.
//
// It was invisible because the eval harness calls the TypeSafe API directly,
// bypassing the proxy — so the measured lane scored perfectly while the shipped
// lane was broken. This test closes that gap by running the REAL built payload
// through the REAL validator, across the whole registry.
//
// The two live in different packages (browser ESM vs CommonJS Cloud Function),
// so this is a gate rather than a shared constant.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  argQuestions,
  toolCriteria,
  turnQuestions,
  MAX_ARG_QUESTIONS,
} from "./jev";
import { aiTurnQuestions } from "./jevAiLane";
import { entityQuestion } from "./jevEntity";
import { TOOLS } from "../tools/registry";

const require = createRequire(import.meta.url);
const { jevPayload, LIMITS } = require("../../functions/jev_payload.js") as {
  jevPayload: (body: unknown) => unknown;
  LIMITS: { optionChars: number; questions: number; options: number };
};

const accepts = (
  questions: Record<string, unknown>,
  state = "Каква беше активността?",
) => jevPayload({ state, questions });

describe("every payload the chat builds passes the proxy's own validator", () => {
  it("accepts the tool-routing question over the FULL registry", () => {
    // The whole catalogue in one Choice — the shape every turn sends.
    expect(() => accepts(turnQuestions())).not.toThrow();
  });

  it("accepts the AI lane's batched three-question turn", () => {
    expect(() => accepts(aiTurnQuestions())).not.toThrow();
  });

  it("keeps every tool option inside the proxy's per-option limit", () => {
    // Per-REQUEST rejection: one over-long tool breaks the whole routing call,
    // so this must hold for all of them, not most.
    const over = Object.entries(toolCriteria()).filter(
      ([, v]) => v.length > LIMITS.optionChars,
    );
    expect(
      over.map(([k, v]) => `${k} (${v.length} chars)`),
      "option text exceeds the proxy limit — routing would 400 on every turn",
    ).toEqual([]);
  });

  it("accepts the argument questions of EVERY tool that has any", () => {
    const rejected: string[] = [];
    for (const t of TOOLS) {
      const questions = argQuestions(t.name);
      if (!Object.keys(questions).length) continue;
      try {
        accepts(questions);
      } catch (e) {
        rejected.push(`${t.name}: ${(e as Error).message}`);
      }
    }
    expect(rejected).toEqual([]);
  });

  it("never asks more questions than the proxy accepts", () => {
    // procurementQuery declares 22 enumerable params and fundingQuery 20 — an
    // unbounded fan-out is a 400 for the whole call on exactly the tools tier 2
    // exists to serve.
    expect(MAX_ARG_QUESTIONS).toBeLessThanOrEqual(LIMITS.questions);
    for (const t of TOOLS)
      expect(
        Object.keys(argQuestions(t.name)).length,
        `${t.name} asks too many argument questions`,
      ).toBeLessThanOrEqual(LIMITS.questions);
  });

  it("puts REQUIRED parameters first when it has to cap", () => {
    // The cap decides whether the tool can run at all, so the params that
    // determine that must survive it.
    const capped = TOOLS.find(
      (t) =>
        t.params.filter((p) => p.values?.length).length > MAX_ARG_QUESTIONS &&
        t.params.some((p) => p.required && p.values?.length),
    );
    if (!capped) return;
    const asked = Object.keys(argQuestions(capped.name));
    for (const p of capped.params.filter((x) => x.required && x.values?.length))
      expect(asked, `${capped.name}.${p.name} was capped out`).toContain(
        p.name,
      );
  });

  it("accepts an entity disambiguation question", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      value: `Кандидат ${i}`,
      label: `Кандидат ${i} — депутат — София`,
    }));
    expect(() =>
      accepts({ entity: entityQuestion(candidates, "person") }),
    ).not.toThrow();
  });
});
