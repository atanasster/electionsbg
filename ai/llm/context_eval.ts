// Operator-only live context smoke test, using the current public model.
// Run: node --env-file=.env.local --import tsx ai/llm/context_eval.ts
// Uses the local OpenRouter key directly; never bypasses the public proxy.
// At most 20 calls at the same payload/price caps as production.

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gistOf, type TurnMemory } from "../orchestrator/memory";
import { setFetcher } from "../tools/dataClient";
import type { Lang, ToolContext } from "../tools/types";
import { DEFAULT_MODEL_ID, modelById } from "./models";
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

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY missing; no live evaluation");
const PROXY = "https://openrouter.ai/api/v1/chat/completions";
const { payload } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
const realFetch = globalThis.fetch.bind(globalThis);
let calls = 0;
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
  if (String(url) !== "/api/llm") return realFetch(url, init);
  if (++calls > 20) throw new Error("Evaluation call cap reached");
  return realFetch(PROXY, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload(JSON.parse(String(init?.body)))),
  });
}) as typeof fetch;
const model = modelById(DEFAULT_MODEL_ID);
if (!model) throw new Error("cloud model not found in registry");

type Scenario = {
  lang: Lang;
  title: string;
  turns: string[];
  expected: { tool: string; args: Record<string, string>; clarify?: boolean }[];
};
const SCENARIOS: Scenario[] = [
  {
    lang: "bg",
    title: "reference carry: party → place",
    turns: ["колко гласа взе ГЕРБ", "а в Пловдив?"],
    expected: [
      { tool: "partyResult", args: { party: "герб", election: "2024_10_27" } },
      {
        tool: "municipalityResults",
        args: { party: "герб", place: "пловдив", election: "2024_10_27" },
      },
    ],
  },
  {
    lang: "en",
    title: "comparison reference",
    turns: ["results of the 2022 election", "compare that to 2024"],
    expected: [
      { tool: "nationalResults", args: { election: "2022" } },
      {
        tool: "compareElections",
        args: { a: "2022", b: "2024" },
        clarify: true,
      },
    ],
  },
  {
    lang: "bg",
    title: "topic switch after a carry",
    turns: ["каква беше активността през 2023", "а машинното гласуване?"],
    expected: [
      { tool: "turnout", args: { election: "2023" } },
      { tool: "machineVoteShare", args: { election: "2023" } },
    ],
  },
];

// nearest prior turn that ran a tool — the follow-on context (like Chat.tsx).
const lastTool = (h: TurnMemory[]) => {
  for (let i = h.length - 1; i >= 0; i--)
    if (h[i].tool) return { tool: h[i].tool as string, args: h[i].args ?? {} };
  return undefined;
};

const run = async () => {
  const provider = new OpenRouterProvider(model, {
    start: async () => ({ sessionToken: "operator", questionId: "operator" }),
    finish: async () => {},
  });
  console.log(`=== context eval vs ${PROXY} (${model.id}) ===\n`);
  let reachedModel = false;
  let checked = 0;
  let failures = 0;
  for (const sc of SCENARIOS) {
    console.log(`• ${sc.title}  [${sc.lang}]`);
    const history: TurnMemory[] = [];
    const ctx: ToolContext = { lang: sc.lang, election: "2024_10_27" };
    for (const [index, q] of sc.turns.entries()) {
      const res = await provider.respond(q, ctx, undefined, {
        history: [...history],
        prev: lastTool(history),
      });
      if (res.meta?.model.bg === model.label.bg) reachedModel = true;
      console.log(`  Q: ${q}`);
      console.log(
        `    → tool=${res.tool ?? "—"}  args=${JSON.stringify(res.args ?? {})}  narratedBy=${res.meta?.narratedBy}`,
      );
      console.log(
        `    "${(res.text || "").replace(/\s+/g, " ").slice(0, 110)}"`,
      );
      const expected = sc.expected[index];
      const same = (got: unknown, want: string) => {
        const value = String(got ?? "").toLowerCase();
        // A single-ballot year and its exact date are equivalent here.
        return (
          value === want ||
          (want === "2022" && value === "2022_10_02") ||
          (want === "2023" && value === "2023_04_02")
        );
      };
      const ok =
        res.tool === expected.tool &&
        Object.entries(expected.args).every(([k, v]) =>
          same(res.args?.[k], v),
        ) &&
        (!expected.clarify ||
          (!!res.env?.clarify && res.text === res.env.clarify.prompt));
      checked++;
      if (!ok) failures++;
      console.log(`    scope check: ${ok ? "PASS" : "FAIL"}`);
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
  if (!reachedModel) {
    process.exitCode = 1;
    console.log(
      "NOTE: every turn fell back to the offline router — the proxy was unreachable,\n" +
        "so this run did NOT exercise the real model. Check the operator key/provider.",
    );
  } else {
    console.log(
      `${checked - failures}/${checked} scope checks passed; ${calls} model calls attempted.`,
    );
    if (failures) process.exitCode = 1;
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
