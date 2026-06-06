// Cloud-provider harness: exercises OpenRouterProvider against a MOCKED proxy
// (no network, no key) to lock the contract that matters — the model picks the
// tool + writes prose, but a bad/absent model never breaks the chat (it falls
// back to the deterministic router + template narrator). Run via npm run ai:test:all.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

// Mock the proxy: a request carrying response_format is the ROUTING call; any
// other is the NARRATION call. Lets each test script both halves independently.
type MockOpts = {
  routeContent?: string;
  narrationContent?: string;
  throwIt?: boolean;
};
const mockFetch =
  (opts: MockOpts) =>
  async (_url: string, init: { body: string }): Promise<unknown> => {
    if (opts.throwIt) throw new Error("network down");
    const body = JSON.parse(init.body) as { response_format?: unknown };
    const content = body.response_format
      ? (opts.routeContent ?? "")
      : (opts.narrationContent ?? "");
    return {
      ok: true,
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
    r3.meta?.model.bg === "Правила (офлайн)",
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

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — cloud provider`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
