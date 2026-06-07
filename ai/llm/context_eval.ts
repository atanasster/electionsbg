// Real-model context eval — runs multi-turn scenarios through OpenRouterProvider
// against the LIVE /api/llm proxy to sanity-check routing-with-context QUALITY.
// The mocked harness (openrouter.harness.ts) locks the PLUMBING (context reaches
// the prompt, fallbacks hold); this checks the thing a mock can't — that a real
// model actually USES the conversation to resolve a reference ("а в Пловдив?",
// "compare that to 2024"). Read-only: it only asks questions.
//
// Run:   npx tsx ai/llm/context_eval.ts        (or: npm run ai:eval:context)
// Proxy: LLM_PROXY_URL env var, default https://ai.electionsbg.com/api/llm
// It costs a few cheap flash-lite calls; NOT wired into ai:test:all (network).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gistOf, type TurnMemory } from "../orchestrator/memory";
import { setFetcher } from "../tools/dataClient";
import type { Lang, ToolContext } from "../tools/types";
import { modelById } from "./models";
import { OpenRouterProvider } from "./openrouter";

// Tools read the local data tree (same as the other harnesses).
setFetcher(async (path: string) =>
  JSON.parse(
    await readFile(
      join(process.cwd(), "data", path.replace(/^\//, "")),
      "utf8",
    ),
  ),
);

// The provider posts to "/api/llm" (a relative path the browser resolves
// same-origin). In Node there's no origin, so rewrite it to the live proxy.
const PROXY = process.env.LLM_PROXY_URL || "https://ai.electionsbg.com/api/llm";
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === "string" ? url : url.toString();
  return realFetch(u.includes("/api/llm") ? PROXY : u, init);
}) as typeof fetch;

const model = modelById("google/gemini-3.1-flash-lite");
if (!model) throw new Error("cloud model not found in registry");

type Scenario = { lang: Lang; title: string; turns: string[] };
const SCENARIOS: Scenario[] = [
  {
    lang: "bg",
    title: "reference carry: party → place",
    turns: ["колко гласа взе ГЕРБ", "а в Пловдив?"],
  },
  {
    lang: "en",
    title: "comparison reference",
    turns: ["results of the 2022 election", "compare that to 2024"],
  },
  {
    lang: "bg",
    title: "topic switch after a carry",
    turns: ["каква беше активността през 2023", "а машинното гласуване?"],
  },
];

// nearest prior turn that ran a tool — the follow-on context (like Chat.tsx).
const lastTool = (h: TurnMemory[]) => {
  for (let i = h.length - 1; i >= 0; i--)
    if (h[i].tool) return { tool: h[i].tool as string, args: h[i].args ?? {} };
  return undefined;
};

const run = async () => {
  const provider = new OpenRouterProvider(model);
  console.log(`=== context eval vs ${PROXY} (${model.id}) ===\n`);
  let reachedModel = false;
  for (const sc of SCENARIOS) {
    console.log(`• ${sc.title}  [${sc.lang}]`);
    const history: TurnMemory[] = [];
    const ctx: ToolContext = { lang: sc.lang, election: "2024_10_27" };
    for (const q of sc.turns) {
      const res = await provider.respond(q, ctx, undefined, {
        history: [...history],
        prev: lastTool(history),
      });
      if (res.meta?.model.bg !== "Без AI (офлайн)") reachedModel = true;
      console.log(`  Q: ${q}`);
      console.log(
        `    → tool=${res.tool ?? "—"}  args=${JSON.stringify(res.args ?? {})}  narratedBy=${res.meta?.narratedBy}`,
      );
      console.log(
        `    "${(res.text || "").replace(/\s+/g, " ").slice(0, 110)}"`,
      );
      history.push({
        question: q,
        tool: res.tool,
        args: res.args,
        gist: res.env ? gistOf(res.env) : undefined,
        lang: sc.lang,
      });
    }
    console.log("");
  }
  if (!reachedModel)
    console.log(
      "NOTE: every turn fell back to the offline router — the proxy was unreachable,\n" +
        "so this run did NOT exercise the real model. Check LLM_PROXY_URL / deploy.",
    );
  else
    console.log(
      "Eyeball the 2nd turn of each scenario: its tool/args should reflect the reference\n" +
        "(place carried from the prior party question; the comparison; the topic switch).",
    );
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
