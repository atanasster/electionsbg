// WebLLM-provider harness: exercises the in-browser provider's context threading
// against a FAKE engine (no WebGPU, no weights). The provider normally needs a
// GPU + a multi-GB model, so this is the only automated coverage of its
// routing/narration plumbing — in particular that the conversation context is
// assembled into the prompts and that a wrong-language gist is dropped from
// narration. Run via npm run ai:test:all.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../orchestrator/router";
import { setFetcher } from "../tools/dataClient";
import type { ToolContext } from "../tools/types";
import type { ModelOption } from "./models";
import { WebLLMProvider } from "./webllm";

// runTool reads the local data tree (same as the other harnesses).
setFetcher(async (path: string) =>
  JSON.parse(
    await readFile(
      join(process.cwd(), "data", path.replace(/^\//, "")),
      "utf8",
    ),
  ),
);

// A Bulgarian-capable model is the only kind trusted to ROUTE (fills gaps the
// rules decline); narration runs for any model.
const MODEL: ModelOption = {
  id: "test-routes",
  label: { bg: "Тест", en: "Test" },
  sizeNote: { bg: "", en: "" },
  advantage: { bg: "", en: "" },
  ready: true,
  routes: true,
};

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};

// Captures the user content of each engine call so a test can assert what the
// model actually saw. A request carrying response_format is the routing call.
const cap = { routeUser: "", narrationUser: "" };
type CreateReq = {
  messages: { role: string; content: string }[];
  response_format?: unknown;
};
const fakeEngine = {
  chat: {
    completions: {
      create: async (req: CreateReq) => {
        const u = req.messages.find((m) => m.role === "user")?.content ?? "";
        if (req.response_format) {
          cap.routeUser = u;
          return {
            choices: [
              {
                message: {
                  content: '{"tool":"partyResult","args":{"party":"ГЕРБ"}}',
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        }
        cap.narrationUser = u;
        return {
          choices: [{ message: { content: "ГЕРБ води по гласове." } }],
          usage: { prompt_tokens: 20, completion_tokens: 8 },
        };
      },
    },
  },
};

const ctx: ToolContext = { lang: "bg", election: "2026_04_19" };
const priorGerb = {
  question: "колко гласа взе ГЕРБ",
  tool: "partyResult",
  args: { party: "ГЕРБ" },
  gist: "ГЕРБ — votes: 634627",
  lang: "bg" as const,
};

const run = async () => {
  console.log("=== [webllm] WebLLMProvider context (fake engine) ===");
  const p = new WebLLMProvider(MODEL);
  // inject the fake engine (init() would need WebGPU + weights)
  (p as unknown as { engine: unknown }).engine = fakeEngine;
  (p as unknown as { state: string }).state = "ready";

  // 1. narration context: a rules-routable question still gets the prior gist in
  // its narration prompt (model narrates from the tool's facts + the thread).
  cap.narrationUser = "";
  const r1 = await p.respond("колко гласа взе ДПС", ctx, undefined, {
    history: [priorGerb],
  });
  assert(r1.tool === "partyResult", "rules route the question (partyResult)");
  assert(
    cap.narrationUser.includes("ГЕРБ — votes: 634627"),
    "narration prompt carries the previous answer's gist",
  );

  // 2. language guard on context: a gist generated in English is dropped from a
  // Bulgarian narration prompt (a mid-thread EN/BG switch never feeds wrong-
  // language prose into the model).
  cap.narrationUser = "";
  await p.respond("колко гласа взе ДПС", ctx, undefined, {
    history: [
      { question: "how did GERB do", gist: "GERB — votes: 1", lang: "en" },
    ],
  });
  assert(
    !cap.narrationUser.includes("GERB — votes: 1"),
    "a wrong-language gist is dropped from the narration context",
  );

  // 3. routing context: when the rules DECLINE a question, the trusted model is
  // consulted AND the conversation context is in its routing prompt.
  const unroutable = ["zxqw asdf", "qqq www eee", "blah nonsense xyz"].find(
    (q) => route(q, ctx) === null,
  );
  if (unroutable) {
    cap.routeUser = "";
    await p.respond(unroutable, ctx, undefined, { history: [priorGerb] });
    assert(
      cap.routeUser.includes("Разговор досега") &&
        cap.routeUser.includes("Текущ въпрос"),
      "routing prompt carries context when the model fills a rules gap",
    );
  } else {
    console.log("  ~ skipped routing-context test (no unroutable probe found)");
  }

  // 4. a model that does NOT route (test models narrate only) never reaches the
  // engine for routing — routing stays deterministic.
  const narrateOnly = new WebLLMProvider({ ...MODEL, routes: false });
  (narrateOnly as unknown as { engine: unknown }).engine = fakeEngine;
  (narrateOnly as unknown as { state: string }).state = "ready";
  cap.routeUser = "";
  if (unroutable) {
    const r4 = await narrateOnly.respond(unroutable, ctx, undefined, {
      history: [priorGerb],
    });
    assert(
      cap.routeUser === "" && !r4.tool,
      "a narrate-only model never makes a routing call",
    );
  }

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — webllm provider context`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
