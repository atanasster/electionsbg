import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  INPUT_BYTE_CEILING,
  ROUTING_BYTE_BUDGET,
  ROUTING_MARGIN,
  budgetHeadroom,
  proxyMessageBytes,
  utf8Bytes,
  withinBudget,
  withinCeiling,
  type BudgetMessage,
} from "./promptBudget";
import { buildToolSystemPrompt } from "../orchestrator/prompts";
import {
  buildContext,
  CLOUD_BUDGET,
  renderRoutingContext,
  type TurnMemory,
} from "../orchestrator/memory";
import { estimateTokens } from "../orchestrator/tokens";

// G3: the byte invariant, and the margin that makes it meaningful.
//
// Loaded through createRequire, as `prompts.test.ts` does: the proxy policy is a
// CommonJS Node module with no type declarations, and importing it as ESM would
// need an `any` cast.
const { POLICY, payload, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
) as {
  POLICY: { inputBytes: number };
  payload: (body: unknown) => unknown;
  MODEL: string;
};

const user = (content: string, role: "system" | "user" = "user") =>
  ({ role, content }) as BudgetMessage;
const requestOf = (content: string): BudgetMessage[] => [
  user(content, "system"),
  user("y"),
];

describe("the budget mirrors the proxy's own measurement", () => {
  it("pins the ceiling to the shipped proxy policy", () => {
    // The duplicate constant is only safe because this asserts it. A policy change
    // in functions/llm_security.js fails HERE rather than shipping a client that
    // measures against a ceiling the server no longer uses.
    expect(INPUT_BYTE_CEILING).toBe(POLICY.inputBytes);
  });

  it("keeps a margin that is deliberate and non-trivial", () => {
    expect(ROUTING_BYTE_BUDGET).toBe(INPUT_BYTE_CEILING - ROUTING_MARGIN);
    expect(ROUTING_BYTE_BUDGET).toBeLessThan(INPUT_BYTE_CEILING);
    expect(ROUTING_MARGIN).toBeGreaterThanOrEqual(2_000);
    // The margin is headroom, not a second ceiling: it must stay a small fraction.
    expect(ROUTING_MARGIN / INPUT_BYTE_CEILING).toBeLessThan(0.1);
  });

  it("computes exactly what the proxy computes", () => {
    // `payload()` measures `Buffer.byteLength(JSON.stringify(messages))` on the
    // mapped array. Comparing against that directly is the strongest available
    // check: any escaping or encoding difference shows up as a mismatch. The
    // samples include the cases where the two encoders could plausibly diverge — a
    // lone surrogate, NUL, an HTML-looking sequence, and U+2028/U+2029, which
    // JSON.stringify does NOT escape.
    const samples: BudgetMessage[][] = [
      [user("ASCII only", "system")],
      [user('Кирилица с нови редове\nи "кавички"', "system")],
      [user("a".repeat(5_000), "system"), user("Каква е инфлацията? — 42%")],
      [user("😀 emoji + combining e\u0301 + tab\tend", "system")],
      [user("lone surrogate: \ud800 and NUL: \u0000", "system")],
      [user("</script><script>alert(1)</script>", "system")],
      [user("line\u2028separator\u2029paragraph", "system")],
    ];
    for (const messages of samples) {
      const viaProxy = Buffer.byteLength(
        JSON.stringify(
          messages.map(({ role, content }) => ({ role, content })),
        ),
      );
      expect(proxyMessageBytes(messages)).toBe(viaProxy);
    }
    // utf8Bytes is UTF-8, not UTF-16 code units: an emoji is 4 bytes, not 2.
    expect(utf8Bytes("😀")).toBe(4);
    expect(utf8Bytes("Ж")).toBe(2);
  });

  it("ignores anything on a message the proxy would not send", () => {
    const extra = [
      { role: "system", content: "x", ignored: "y".repeat(1_000) },
    ] as unknown as BudgetMessage[];
    expect(proxyMessageBytes(extra)).toBe(
      proxyMessageBytes([user("x", "system")]),
    );
  });

  it("agrees with the proxy across the whole margin region", () => {
    // The margin (92,000–96,000) is the one band where the client narrows and the
    // server would still accept. Both sides are checked there, so the client's
    // number is tied to observed server behaviour rather than to a second copy of
    // the same constant.
    // Build each sample to an EXACT measured size rather than by guessing the
    // framing overhead: at the ceiling a 60-byte guess is enough to overshoot.
    const framing = proxyMessageBytes(requestOf(""));
    const exactSize = (size: number) =>
      requestOf("x".repeat(Math.max(0, size - framing)));
    for (const size of [
      ROUTING_BYTE_BUDGET - 1_000,
      ROUTING_BYTE_BUDGET,
      ROUTING_BYTE_BUDGET + 1_000,
      INPUT_BYTE_CEILING,
    ]) {
      const messages = exactSize(size);
      expect(proxyMessageBytes(messages), `${size} exact`).toBe(size);
      const accepts = (() => {
        try {
          payload({ model: MODEL, messages, max_tokens: 120 });
          return true;
        } catch {
          return false;
        }
      })();
      expect(withinCeiling(messages), `${size} bytes vs ceiling`).toBe(true);
      expect(accepts, `${size} bytes accepted by the proxy`).toBe(true);
      // Below the budget the client would not narrow; above it, it does.
      expect(withinBudget(messages)).toBe(
        proxyMessageBytes(messages) <= ROUTING_BYTE_BUDGET,
      );
    }
    // ...and over the ceiling the proxy refuses, which is the failure the client
    // exists to prevent.
    const over = exactSize(INPUT_BYTE_CEILING + 10);
    expect(withinCeiling(over)).toBe(false);
    expect(() =>
      payload({ model: MODEL, messages: over, max_tokens: 120 }),
    ).toThrowError(/input_too_large/);
  });

  it("finds the proxy's real threshold by bisection, without trusting our copy", () => {
    // The oracle above is an inline copy of the proxy's mapping, so the two could
    // drift together. This pins the ACTUAL limit by asking the proxy.
    let lo = 0,
      hi = INPUT_BYTE_CEILING + 5_000;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const messages = requestOf("x".repeat(Math.max(0, mid - 60)));
      let ok = true;
      try {
        payload({ model: MODEL, messages, max_tokens: 120 });
      } catch {
        ok = false;
      }
      if (ok) lo = mid;
      else hi = mid;
    }
    // The largest accepted content budget, measured by asking the server, lands
    // within the fixed request framing of our ceiling.
    expect(lo).toBeGreaterThan(INPUT_BYTE_CEILING - 200);
    expect(lo).toBeLessThanOrEqual(INPUT_BYTE_CEILING);
  });

  it("reports the headroom rather than leaving it to be inferred", () => {
    const messages = [user("x".repeat(1_000), "system")];
    const headroom = budgetHeadroom(messages);
    expect(headroom).toBe(ROUTING_BYTE_BUDGET - proxyMessageBytes(messages));
    expect(headroom).toBeGreaterThan(0);
    expect(withinBudget(messages)).toBe(true);
  });

  it("keeps the largest tool blocks well inside the byte bound", () => {
    // There is no tool-count cap (see promptBudget.ts for the measurement that
    // removed it), so the meaningful assertion is that the byte bound is not at the
    // mercy of one huge entry: the largest block is a small fraction of the budget.
    const catalogue = buildToolSystemPrompt("bg");
    const blocks = catalogue
      .split("\n- ")
      .map((block, i) => (i === 0 ? block : `- ${block}`))
      .map((block) => utf8Bytes(block))
      .sort((a, b) => b - a);
    const largest = blocks.slice(0, 24).reduce((a, b) => a + b, 0);
    expect(largest).toBeLessThan(ROUTING_BYTE_BUDGET);
    expect(blocks[0]).toBeLessThan(ROUTING_BYTE_BUDGET / 10);
  });
});

describe("the real routing request today", () => {
  const bgRequest = (context: string, question: string): BudgetMessage[] => [
    user(buildToolSystemPrompt("bg"), "system"),
    user(context ? `${context}\n\nТекущ въпрос: ${question}` : question),
  ];
  const thread = (repeat: number): TurnMemory[] =>
    Array.from({ length: 8 }, () => ({
      question:
        "Каква беше избирателната активност и колко гласа взе ГЕРБ в Русе на последните парламентарни избори? ".repeat(
          repeat,
        ),
      tool: "partyResult",
      args: { party: "ГЕРБ" },
      gist: "Активност — 40.5%; ГЕРБ — гласове: 63,400; дял: 25.3%; секции: 412; област: Русе",
      lang: "bg" as const,
    }));
  const QUESTION = "Каква беше активността и колко гласа взе ГЕРБ в Русе?";

  it("fits a typical BG conversation window", () => {
    const ctx = buildContext(thread(1), CLOUD_BUDGET);
    const messages = bgRequest(renderRoutingContext(ctx, "bg"), QUESTION);
    expect(withinBudget(messages)).toBe(true);
    // No tight band: the exact number measures a moving registry, and a band narrow
    // enough to be interesting breaks on the next tool added.
    expect(budgetHeadroom(messages)).toBeGreaterThan(2_000);
  });

  it("DOES exceed the budget for the largest context the system admits", () => {
    // The honest current state, measured 2026-09-16: this is NOT a guard for a
    // future registry. A single long turn saturates CLOUD_BUDGET (1,200 estimated
    // tokens) and the request reaches ~92.2 KB — over the 92,000 budget — while
    // still inside the proxy's 96,000 ceiling. An earlier revision of the plan
    // claimed nothing narrowed yet; that was wrong and is corrected here.
    const ctx = buildContext(thread(4), CLOUD_BUDGET);
    const context = renderRoutingContext(ctx, "bg");
    const messages = bgRequest(context, QUESTION);
    // The estimator itself can exceed its own budget for one inseparable turn,
    // which is how the request grows past the budget.
    expect(estimateTokens(context)).toBeGreaterThan(CLOUD_BUDGET.tokens);
    expect(withinBudget(messages)).toBe(false);
    expect(withinCeiling(messages)).toBe(true);
    expect(budgetHeadroom(messages)).toBeLessThan(0);
  });

  it("has far more room in EN, which must therefore never narrow", () => {
    const messages: BudgetMessage[] = [
      user(buildToolSystemPrompt("en"), "system"),
      user("How many votes did GERB get?"),
    ];
    expect(withinBudget(messages)).toBe(true);
    // A floor, not a band: EN has tens of thousands of bytes of room.
    expect(budgetHeadroom(messages)).toBeGreaterThan(30_000);
  });
});
