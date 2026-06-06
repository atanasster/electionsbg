// Cloud-provider harness: exercises OpenRouterProvider against a MOCKED proxy
// (no network, no key) to lock the contract that matters — the model picks the
// tool + writes prose, but a bad/absent model never breaks the chat (it falls
// back to the deterministic router + template narrator). Run via npm run ai:test:all.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gistOf, type TurnMemory } from "../orchestrator/memory";
import { setFetcher } from "../tools/dataClient";
import type { ToolContext } from "../tools/types";
import type { ModelOption } from "./models";
import { OpenRouterProvider } from "./openrouter";

// runTool reads the local data tree (same as the other harnesses).
setFetcher(async (path: string) =>
  JSON.parse(
    await readFile(
      join(process.cwd(), "data", path.replace(/^\//, "")),
      "utf8",
    ),
  ),
);

const MODEL: ModelOption = {
  id: "google/gemini-2.5-flash-lite",
  label: { bg: "Gemini", en: "Gemini" },
  sizeNote: { bg: "", en: "" },
  advantage: { bg: "", en: "" },
  ready: true,
  runtime: "cloud",
  routes: true,
};

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};

// Mock the proxy and classify each call by its shape:
//  - response_format present            → ROUTING call
//  - user content carries "Title:"      → NARRATION call (buildNarrationPrompt)
//  - otherwise                          → COMPACTION call (compactSummary; the
//    user content is the bare topic digest)
// Lets each test script all three halves independently and count compactions.
type MockOpts = {
  routeContent?: string;
  narrationContent?: string;
  compactionContent?: string;
  throwIt?: boolean;
};
// The user content each call received, so a test can assert the conversation
// context was actually assembled into the prompt; compactionCalls counts the
// (cached) LLM summarizations.
let lastRouteUser = "";
let lastNarrationUser = "";
let compactionCalls = 0;
const mockFetch =
  (opts: MockOpts) =>
  async (_url: string, init: { body: string }): Promise<unknown> => {
    if (opts.throwIt) throw new Error("network down");
    const body = JSON.parse(init.body) as {
      response_format?: unknown;
      messages?: { role: string; content: string }[];
    };
    const userContent =
      body.messages?.find((m) => m.role === "user")?.content ?? "";
    let content: string;
    if (body.response_format) {
      lastRouteUser = userContent;
      content = opts.routeContent ?? "";
    } else if (userContent.includes("Title:")) {
      lastNarrationUser = userContent;
      content = opts.narrationContent ?? "";
    } else {
      compactionCalls += 1;
      content = opts.compactionContent ?? "Резюме на разговора.";
    }
    return {
      ok: true,
      // call() reads res.headers.get("content-type") to detect SSE before
      // deciding stream vs json — a plain object would throw here. Report JSON
      // so the mock stays on the non-streaming path.
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1200, completion_tokens: 20 },
      }),
    };
  };
const setFetch = (f: unknown) => {
  (globalThis as unknown as { fetch: unknown }).fetch = f;
};

const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };

const run = async () => {
  console.log("=== [cloud] OpenRouterProvider (mocked proxy) ===");
  const p = new OpenRouterProvider(MODEL);

  // 1. model routes + narrates (BG prose accepted)
  setFetch(
    mockFetch({
      routeContent: '{"tool":"partyResult","args":{"party":"ГЕРБ"}}',
      narrationContent: "ГЕРБ получи най-много гласове на този избор.",
    }),
  );
  const r1 = await p.respond("кой спечели миналия път", ctx);
  assert(r1.tool === "partyResult", "model picks the tool (partyResult)");
  assert(!!r1.env?.facts.party, "the picked tool ran and produced an envelope");
  assert(
    r1.meta?.narratedBy === "model",
    "BG model prose is used (narratedBy=model)",
  );
  assert(
    r1.meta?.model.bg === "Gemini",
    "header credits the cloud model when it was actually used",
  );
  assert((r1.meta?.inputTokens ?? 0) > 0, "token usage is recorded");

  // 1b. the model emits a BARE-YEAR election arg ("2023") — it can't know the
  // exact ballot date. The answer must be for 2023, NOT the selected 2026 (the
  // reported bug, where "turnout in 2023" silently answered for 2026).
  setFetch(
    mockFetch({
      routeContent: '{"tool":"turnout","args":{"election":"2023"}}',
      narrationContent: "Избирателната активност беше 40,51%.",
    }),
  );
  const r1b = await p.respond("каква беше активността през 2023", ctx);
  assert(
    r1b.tool === "turnout" && /2023/.test(String(r1b.env?.facts.election)),
    "bare-year election arg resolves to that year, not the selected election",
  );

  // 2. wrong-script model prose -> template narration (numbers stay computed)
  setFetch(
    mockFetch({
      routeContent: '{"tool":"partyResult","args":{"party":"ГЕРБ"}}',
      narrationContent: "GERB got the most votes.",
    }),
  );
  const r2 = await p.respond("кой спечели", ctx);
  assert(
    r2.tool === "partyResult" && r2.meta?.narratedBy === "rules",
    "wrong-script prose -> falls back to the template narrator",
  );

  // 3. proxy/network down -> deterministic router still answers, never throws
  setFetch(mockFetch({ throwIt: true }));
  const r3 = await p.respond("Колко гласа взе ГЕРБ?", ctx);
  assert(r3.tool === "partyResult", "API down -> deterministic router answers");
  assert(
    r3.meta?.model.bg === "Без AI (офлайн)",
    "full fallback -> header credits Rules, NOT the cloud model",
  );

  // 4. model returns non-JSON garbage -> rules fallback (parse rejects it)
  setFetch(mockFetch({ routeContent: "sorry, I cannot help with that" }));
  const r4 = await p.respond("Колко гласа взе ГЕРБ?", ctx);
  assert(r4.tool === "partyResult", "invalid model output -> rules fallback");

  // 5. model picks an UNKNOWN tool -> parse rejects -> rules fallback
  setFetch(mockFetch({ routeContent: '{"tool":"does_not_exist","args":{}}' }));
  const r5 = await p.respond("Какви са резултатите от последните избори?", ctx);
  assert(
    r5.tool === "nationalResults",
    "unknown tool name -> rules fallback (no crash)",
  );

  // 6. conversation context is assembled into BOTH the routing and narration
  // prompts when prior history is supplied (the multi-turn-memory contract).
  lastRouteUser = "";
  lastNarrationUser = "";
  setFetch(
    mockFetch({
      routeContent: '{"tool":"budgetOverview","args":{}}',
      narrationContent: "Бюджетът е разпределен по функции.",
    }),
  );
  await p.respond("какъв е държавният бюджет", ctx, undefined, {
    history: [
      {
        question: "колко гласа взе ГЕРБ",
        tool: "partyResult",
        args: { party: "ГЕРБ" },
        gist: "ГЕРБ — votes: 634627",
      },
    ],
  });
  assert(
    lastRouteUser.includes("Разговор досега") &&
      lastRouteUser.includes("колко гласа взе ГЕРБ"),
    "routing prompt carries the conversation context",
  );
  assert(
    lastRouteUser.includes("Текущ въпрос: какъв е държавният бюджет"),
    "routing prompt labels the current question",
  );
  assert(
    lastNarrationUser.includes("ГЕРБ — votes: 634627"),
    "narration prompt carries the previous answer's gist",
  );

  // 7. a BARE follow-on skips the routing call (deterministic) but STILL gives
  // narration the prior gist — context without a wasted model route.
  lastRouteUser = "";
  lastNarrationUser = "";
  setFetch(mockFetch({ narrationContent: "ДПС получи 344 512 гласа." }));
  const r7 = await p.respond("а ДПС?", ctx, undefined, {
    prev: { tool: "partyResult", args: { party: "ГЕРБ" } },
    history: [
      {
        question: "колко гласа взе ГЕРБ",
        tool: "partyResult",
        args: { party: "ГЕРБ" },
        gist: "ГЕРБ — votes: 634627",
      },
    ],
  });
  assert(
    r7.tool === "partyResult" && /дпс/i.test(String(r7.args?.party)),
    "bare follow-on resolves deterministically to the new entity",
  );
  assert(lastRouteUser === "", "follow-on makes no routing call");

  // 8. multi-turn ACCUMULATION: as a conversation grows, each turn's routing
  // prompt carries the questions before it (the chat threads distilled history).
  setFetch(
    mockFetch({
      routeContent: '{"tool":"partyResult","args":{"party":"ГЕРБ"}}',
      narrationContent: "ок.",
    }),
  );
  const convo: TurnMemory[] = [];
  const turn = async (q: string) => {
    lastRouteUser = "";
    const res = await p.respond(q, ctx, undefined, { history: [...convo] });
    convo.push({
      question: q,
      tool: res.tool,
      args: res.args,
      gist: res.env ? gistOf(res.env) : undefined,
      lang: "bg",
    });
    return res;
  };
  await turn("колко гласа взе ГЕРБ");
  assert(
    !lastRouteUser.includes("Разговор досега"),
    "turn 1 sends a bare question (no conversation context yet)",
  );
  await turn("какво е положението в Бургас");
  assert(
    lastRouteUser.includes("колко гласа взе ГЕРБ"),
    "turn 2 routing prompt carries turn 1",
  );
  await turn("сравни последните избори");
  assert(
    lastRouteUser.includes("колко гласа взе ГЕРБ") &&
      lastRouteUser.includes("какво е положението в Бургас"),
    "turn 3 routing prompt accumulates both earlier turns",
  );

  // 9. LONG history → the older tail is compacted by ONE cached LLM call, and the
  // compacted summary reaches the routing prompt (replacing the raw digest).
  const longA: TurnMemory[] = Array.from({ length: 16 }, (_, i) => ({
    question: `сесия А въпрос ${i}`,
    gist: `Тема А ${i} — x: ${i}`,
  }));
  compactionCalls = 0;
  lastRouteUser = "";
  setFetch(
    mockFetch({
      routeContent: '{"tool":"nationalResults","args":{}}',
      narrationContent: "Резултати.",
      compactionContent: "Потребителят разглежда партии и резултати.",
    }),
  );
  await p.respond("какви са резултатите", ctx, undefined, { history: longA });
  assert(
    compactionCalls === 1,
    "a long older tail triggers exactly one LLM compaction",
  );
  assert(
    lastRouteUser.includes("Потребителят разглежда партии"),
    "the compacted summary reaches the routing prompt",
  );
  // re-running the SAME conversation reuses the cached summary (no second call)
  compactionCalls = 0;
  await p.respond("и пак", ctx, undefined, { history: longA });
  assert(
    compactionCalls === 0,
    "the same older digest is compacted once (cached)",
  );

  // 10. a DIFFERENT conversation with the SAME size must NOT be served the cached
  // summary — the cache is keyed by digest CONTENT, not by turn count (regression
  // for the cross-conversation stale-summary bug).
  const longB: TurnMemory[] = Array.from({ length: 16 }, (_, i) => ({
    question: `сесия Б друга тема ${i}`,
    gist: `Тема Б ${i} — y: ${i}`,
  }));
  compactionCalls = 0;
  await p.respond("какви са резултатите", ctx, undefined, { history: longB });
  assert(
    compactionCalls === 1,
    "a different conversation of the same size is re-compacted (cache keyed by content, not count)",
  );

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — cloud provider`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
