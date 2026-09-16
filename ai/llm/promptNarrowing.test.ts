import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildToolSystemPrompt } from "../orchestrator/prompts";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import {
  preselectCandidates,
  prunePrefixToBudget,
  pruneToBudget,
} from "../orchestrator/toolPreselector";
import {
  K_MAX,
  proxyMessageBytes,
  routingMessages,
  routingRequestBytes,
  withinBudget,
} from "./promptBudget";
import { narrowCatalogueForBudget } from "./openrouter";
import {
  buildContext,
  CLOUD_BUDGET,
  renderRoutingContext,
  type TurnMemory,
} from "../orchestrator/memory";

// G1b — the full-catalogue path must stay BYTE-IDENTICAL.
//
// Measured before the candidate parameter existed (2026-09-16), and pinned so that
// adding narrowing cannot quietly change the prompt every published eval baseline
// was measured against. A DELIBERATE registry or prompt change re-pins these two
// values; anything else failing here means the no-candidate path was altered.
const FULL_CATALOGUE = {
  bg: {
    bytes: 85_121,
    sha256: "d5625cfb5d0961a8dacef5fbf5db0407d108260ea686c4206f5797d54d95f5e5",
  },
  en: {
    bytes: 56_632,
    sha256: "8f767f1043842f98e1612abff33dd3cb731c31bb39a6057a423ffacceb1420bb",
  },
} as const;

describe("the full-catalogue prompt is untouched (G1b)", () => {
  for (const lang of ["bg", "en"] as const)
    it(`${lang}: byte-identical without candidates`, () => {
      const prompt = buildToolSystemPrompt(lang);
      expect(Buffer.byteLength(prompt)).toBe(FULL_CATALOGUE[lang].bytes);
      expect(createHash("sha256").update(prompt).digest("hex")).toBe(
        FULL_CATALOGUE[lang].sha256,
      );
      // ...and it really is every tool: a narrowing bug that dropped tools would
      // otherwise still match a stale hash after a re-pin.
      for (const tool of TOOLS)
        expect(prompt, `${lang} is missing ${tool.name}`).toContain(
          `- ${tool.name} —`,
        );
    });
});

describe("the narrowed catalogue", () => {
  const top = (n: number) =>
    preselectCandidates("Каква е инфлацията?")
      .slice(0, n)
      .map((c) => c.tool)
      .map((n) => TOOLS_BY_NAME[n]);

  it("contains exactly the candidates it was given, and nothing else", () => {
    const candidates = top(14);
    const prompt = buildToolSystemPrompt("bg", candidates);
    for (const tool of candidates) expect(prompt).toContain(`- ${tool.name} —`);
    // No OTHER tool may appear: a leaked name is a tool the model can pick that the
    // enforcement layer (step 8) would then reject.
    const allowed = new Set(candidates.map((t) => t.name));
    for (const tool of TOOLS)
      if (!allowed.has(tool.name))
        expect(prompt, `leaked ${tool.name}`).not.toContain(`- ${tool.name} —`);
  });

  it("is dramatically smaller than the full catalogue", () => {
    // Measured 2026-09-16: the fixed part of the prompt is ~4.1 KB and an average
    // tool entry ~345 B, so 14 typical candidates land near 8 KB. The earlier plan
    // claimed 3–5 KB, which its own worst case contradicted.
    const prompt = buildToolSystemPrompt("bg", top(14));
    expect(Buffer.byteLength(prompt)).toBeLessThan(12_000);
    expect(Buffer.byteLength(prompt)).toBeGreaterThan(4_000);
    expect(Buffer.byteLength(prompt)).toBeLessThan(
      Buffer.byteLength(buildToolSystemPrompt("bg")) / 5,
    );
  });

  it("keeps the output-shape anchors even when no candidate is in the few-shot set", () => {
    // Strict filtering by candidate left many sets with NO example at all (prices,
    // health, local), and the examples are what pin the shape: a bare tool name, args
    // nested, JSON only.
    const prices = TOOLS.filter((t) => t.domain === "indicators").slice(0, 8);
    const prompt = buildToolSystemPrompt("bg", prices);
    expect(prompt).toContain("Examples:");
    // The two anchors are a scalar-with-entity and a series-with-count, taken from
    // the FEW_SHOT list itself (the earlier version of this test named a question
    // that exists only in the REGISTRY examples, so only one anchor could match).
    expect(prompt).toContain("Колко гласа взе ГЕРБ?");
    expect(prompt).toContain("machine-voting");
    expect(prompt).toContain('{"tool":"partyResult"');
    expect(prompt).toContain('{"tool":"machineVoteSeries"');
  });

  it("tells the model to choose only from the list it was given", () => {
    const prompt = buildToolSystemPrompt("bg", top(14));
    expect(prompt).toContain("Choose ONLY from the tool names listed");
    // The full-catalogue prompt must NOT carry that instruction.
    expect(buildToolSystemPrompt("bg")).not.toContain(
      "Choose ONLY from the tool names listed",
    );
  });
});

describe("the budget branch", () => {
  const QUESTION = "Каква беше активността и колко гласа взе ГЕРБ в Русе?";
  const thread = (repeat: number): TurnMemory[] =>
    Array.from({ length: 8 }, () => ({
      question:
        "Каква беше избирателната активност и колко гласа взе ГЕРБ в Русе на последните парламентарни избори? ".repeat(
          repeat,
        ),
      tool: "partyResult",
      args: { party: "ГЕРБ" },
      gist: "Активност — 40.5%; ГЕРБ — гласове: 63,400; дял: 25.3%; секции: 412; область: Русе",
      lang: "bg" as const,
    }));
  const ctxFor = (repeat: number) => {
    const context = renderRoutingContext(
      buildContext(thread(repeat), CLOUD_BUDGET),
      "bg",
    );
    return `${context}\n\nТекущ въпрос: ${QUESTION}`;
  };

  it("sends everything when the request already fits", () => {
    // The path every request takes today except the longest BG threads.
    const userContent = ctxFor(1);
    expect(withinBudget(routingMessages("bg", undefined, userContent))).toBe(
      true,
    );
    expect(
      narrowCatalogueForBudget("Каква е инфлацията?", "bg", userContent),
    ).toBeUndefined();
  });

  it("narrows only when the request would not fit, and then it fits", () => {
    // A context saturated at the system's own CLOUD_BUDGET, which measured ~92.2 KB
    // — over the 92,000 budget — so this branch is LIVE today.
    const userContent = ctxFor(4);
    expect(withinBudget(routingMessages("bg", undefined, userContent))).toBe(
      false,
    );
    const kept = narrowCatalogueForBudget(
      "Каква е инфляцията?",
      "bg",
      userContent,
    );
    expect(kept).toBeDefined();
    expect(kept!.length).toBeGreaterThan(0);
    expect(kept!.length).toBeLessThanOrEqual(K_MAX);
    // The narrowed request fits the budget, and every name is a real tool.
    expect(
      withinBudget(routingMessages("bg", kept, userContent)),
      `narrowed to ${kept!.length} tools and still over budget`,
    ).toBe(true);
    for (const name of kept!) expect(TOOLS_BY_NAME[name]).toBeDefined();
  });

  it("keeps the tool the question is about when it narrows", () => {
    const userContent = ctxFor(4);
    const kept = narrowCatalogueForBudget(
      "Каква е инфлацията?",
      "bg",
      userContent,
    )!;
    // The gold tool for that question, nominated verbatim from its own example.
    expect(kept).toContain("macroIndicator");
  });

  it("measures the request it will actually send", () => {
    // The composition is ONE function, so `fits` and `selectRoute` cannot disagree
    // about what is being measured.
    const userContent = ctxFor(1);
    const kept = ["macroIndicator", "budgetOverview"];
    expect(routingRequestBytes("bg", kept, userContent)).toBe(
      proxyMessageBytes(routingMessages("bg", kept, userContent)),
    );
    expect(routingRequestBytes("bg", kept, userContent)).toBeLessThan(
      routingRequestBytes("bg", undefined, userContent),
    );
  });
});

describe("the two pruners agree", () => {
  it("binary-search prefix pruning matches the linear contract", () => {
    // The fast path is what `selectRoute` uses because `fits` rebuilds an 85 KB
    // prompt; this pins it to the contract the tests above exercise.
    for (const q of ["Каква е инфлацията?", "Кой е кметът на Пловдив?", ""])
      for (const cap of [200, 40, 5]) {
        const candidates = preselectCandidates(q);
        const budget = 900; // an artificial "byte" bound, so both prune
        const fits = (tools: readonly string[]) => tools.length <= budget / 60;
        const linear = pruneToBudget(candidates, fits, cap);
        const fast = prunePrefixToBudget(candidates, fits, cap);
        expect(fast.kept, q).toEqual(linear.kept);
      }
  });

  it("sends one tool rather than an empty prompt when nothing fits", () => {
    const candidates = preselectCandidates("Каква е инфлацията?");
    expect(prunePrefixToBudget(candidates, () => false).kept).toHaveLength(1);
  });
});
