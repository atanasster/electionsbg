import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  buildToolSystemPrompt,
  FORMAT_ANCHOR_TOOLS,
} from "../orchestrator/prompts";
import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import {
  preselectCandidates,
  prunePrefixToBudget,
  pruneToBudget,
} from "../orchestrator/toolPreselector";
import {
  proxyMessageBytes,
  routingMessages,
  routingRequestBytes,
  withinBudget,
} from "./promptBudget";
import { narrowCatalogueForBudget, OpenRouterProvider } from "./openrouter";
import { vi } from "vitest";
import type { ToolContext } from "../tools/types";
import * as registry from "../tools/registry";

const ctxBg: ToolContext = { lang: "bg", election: "2026_04_19" };
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
      // G1b pins the BUILDER; this pins the request assembly too, so an accidental
      // empty candidate list in `routingMessages` cannot send a 0-tool prompt while
      // the builder stays byte-identical.
      expect(routingMessages(lang, undefined, "x")[0].content).toBe(prompt);
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
    // No OTHER tool may appear — in the catalogue OR in the worked examples. The
    // earlier version of this test scanned only the "- name —" catalogue lines, which
    // is why a prompt whose ONLY examples named non-candidate tools shipped green.
    const allowed = new Set([
      ...candidates.map((t) => t.name),
      ...FORMAT_ANCHOR_TOOLS,
    ]);
    for (const tool of TOOLS) {
      if (allowed.has(tool.name)) continue;
      expect(prompt, `leaked ${tool.name} as a catalogue line`).not.toContain(
        `- ${tool.name} —`,
      );
      expect(prompt, `leaked ${tool.name} in an example`).not.toContain(
        `{"tool":"${tool.name}"`,
      );
    }
  });

  it("names a listed tool in every worked example it prints", () => {
    // The prompt tells the model to choose ONLY from the tools it lists, so its own
    // examples must not demonstrate the opposite. The two FORMAT anchors are kept
    // unconditionally, so `narrowCatalogueForBudget` must add their tools to the kept
    // set — this assertion pins that pairing, which is what was broken.
    for (const n of [3, 8, 14, 30]) {
      const listed = [
        ...new Set([...top(n).map((t) => t.name), ...FORMAT_ANCHOR_TOOLS]),
      ];
      const prompt = buildToolSystemPrompt(
        "bg",
        listed.map((name) => TOOLS_BY_NAME[name]),
      );
      const examples = prompt.slice(prompt.indexOf("Examples:"));
      expect(examples).toContain("Q:");
      for (const m of examples.matchAll(/\{"tool":"([^"]+)"/g))
        expect(listed.includes(m[1]), `example names unlisted ${m[1]}`).toBe(
          true,
        );
    }
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
    // NO tool-count cap: the byte bound is the only constraint (a cap of 24 was
    // measured to do all the pruning while costing 9.9% gold-tool reachability).
    expect(kept!.length).toBeGreaterThan(24);
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

describe("the branch runs end to end through the provider", () => {
  // The pieces were tested; nothing asserted that `selectRoute` narrows the PROMPT it
  // sends and constrains the PARSE to the same set. Both halves are asserted here,
  // because either one alone is advisory.
  const QUESTION = "Каква е инфлацията?";
  // The over-budget fixture is the one `promptBudget.test.ts` pins, gist included:
  // the margin is a few hundred bytes, and a trimmed gist silently brings the request
  // back UNDER the budget (measured: dropping "; дял: 25.3%; секции: 412" saved ~360 B
  // and made this branch unreachable, which is why the precondition is asserted below).
  const saturatedHistory = (): TurnMemory[] =>
    Array.from({ length: 8 }, () => ({
      question:
        "Каква беше избирателната активност и колко гласа взе ГЕРБ в Русе на последните парламентарни избори? ".repeat(
          4,
        ),
      tool: "partyResult",
      args: { party: "ГЕРБ" },
      gist: "Активност — 40.5%; ГЕРБ — гласове: 63,400; дял: 25.3%; секции: 412; област: Русе",
      lang: "bg" as const,
    }));
  const saturatedContent = () =>
    `${renderRoutingContext(buildContext(saturatedHistory(), CLOUD_BUDGET), "bg")}\n\nТекущ въпрос: ${QUESTION}`;

  const respond = async (content: string) => {
    const access = {
      start: async () => ({ sessionToken: "t", questionId: "q" }),
      finish: async () => {},
    };
    const provider = new OpenRouterProvider(
      {
        id: "google/gemini-3.5-flash-lite",
        ready: true,
        runtime: "cloud",
      } as never,
      access,
    );
    const bodies: unknown[] = [];
    // The suite has no data client, so the tool RUN is stubbed: this test is about
    // which route survives the parse, not about the tool's own output.
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        bodies.push(JSON.parse(String((init as RequestInit).body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
    try {
      const res = await provider.respond(QUESTION, ctxBg, undefined, {
        history: saturatedHistory(),
      });
      return { res, bodies };
    } finally {
      fetchMock.mockRestore();
      run.mockRestore();
    }
  };

  it("sends a NARROWED system prompt for a context that would not fit", async () => {
    // PRECONDITION: this fixture really is over budget, or the test would be
    // asserting the full-catalogue path while claiming to test narrowing.
    expect(
      withinBudget(routingMessages("bg", undefined, saturatedContent())),
      "the fixture no longer exceeds the budget",
    ).toBe(false);
    const { bodies } = await respond('{"tool":"macroIndicator","args":{}}');
    const sent = bodies[0] as { messages: { role: string; content: string }[] };
    const system = sent.messages[0].content;
    // Narrowed: it carries the instruction and not the whole catalogue.
    expect(system).toContain("Choose ONLY from the tool names listed");
    expect(Buffer.byteLength(system)).toBeLessThan(
      Buffer.byteLength(buildToolSystemPrompt("bg")),
    );
    // ...and the request it built fits the budget it was measured against.
    expect(withinBudget(sent.messages as never)).toBe(true);
  });

  it("rejects a tool the narrowed prompt never showed the model", async () => {
    // The excluded tool is read out of the prompt the provider ACTUALLY SENT, not
    // recomputed here: an earlier version computed its own kept set, which could
    // differ from the provider's, so the test could assert about a tool the sent
    // prompt did list.
    const SHORT_CIRCUITED = new Set([
      "rollcallQuery",
      "rollcallQuestion",
      "fundingQuery",
      "fundingQuestion",
      "procurementQuery",
      "procurementQuestion",
      "compareElections",
    ]);
    const first = await respond('{"tool":"macroIndicator","args":{}}');
    const sent = (first.bodies[0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(sent).toContain("Choose ONLY from the tool names listed");
    const excluded = TOOLS.find(
      (t) => !sent.includes(`- ${t.name} —`) && !SHORT_CIRCUITED.has(t.name),
    );
    expect(excluded, "the sent prompt lists every tool").toBeDefined();
    const { res } = await respond(
      JSON.stringify({ tool: excluded!.name, args: {} }),
    );
    // It did not execute: the deterministic route for the question answered instead.
    expect(res.tool).toBe("macroIndicator");
  });

  it("still executes a candidate tool the model was shown", async () => {
    const { res } = await respond('{"tool":"macroIndicator","args":{}}');
    expect(res.tool).toBe("macroIndicator");
  });
});

describe("the two pruners agree", () => {
  it("binary-search prefix pruning matches the linear contract", () => {
    // The fast path is what `selectRoute` uses because `fits` rebuilds an 85 KB
    // prompt; this pins it to the contract the tests above exercise.
    for (const q of ["Каква е инфлацията?", "Кой е кметът на Пловдив?", ""])
      for (const cap of [200, 40, 5]) {
        const candidates = preselectCandidates(q);
        // A real BYTE fits through the production composition, not an artificial
        // count bound: the equivalence is only worth asserting for the callback the
        // production path actually passes.
        const fits = (tools: readonly string[]) =>
          withinBudget(routingMessages("bg", tools, "Каква е инфлацията?"));
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
