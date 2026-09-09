// Operator-only live comparison. Never bypasses authorization on the public proxy.
// Run: node --env-file=.env.local --import tsx ai/llm/modelUpgrade.eval.ts
// Uses a local OpenRouter key; <=40 calls, <=$1.24 reserved at production ceilings.
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  buildToolSystemPrompt,
  buildNarrationPrompt,
} from "../orchestrator/prompts";
import { parseToolCall } from "../orchestrator/toolSchema";
import type { Envelope, Lang } from "../tools/types";
import { numbersGrounded } from "./grounding";
import { matchesLang } from "./lang";
const { payload, POLICY, MODEL } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
const models = ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"];
const cases: {
  tool: string;
  args: Record<string, string[]>;
  bg: string;
  en: string;
}[] = [
  {
    tool: "turnout",
    args: { election: ["2023", "2023_04_02"] },
    bg: "Каква беше активността през 2023?",
    en: "What was voter turnout in 2023?",
  },
  {
    tool: "partyResult",
    args: { party: ["ГЕРБ", "GERB"] },
    bg: "Колко гласа получи ГЕРБ?",
    en: "How many votes did GERB receive?",
  },
  {
    tool: "machineVoteSeries",
    args: { n: ["5"] },
    bg: "Какъв е делът на машинното гласуване в последните 5 избора?",
    en: "Machine voting share in the last 5 elections?",
  },
  {
    tool: "compareElections",
    args: { a: ["2022_10_02"], b: ["2024_10_27"] },
    bg: "Сравни изборите през октомври 2022 и октомври 2024",
    en: "Compare the October 2022 and October 2024 elections",
  },
  {
    tool: "localTaxes",
    args: { place: ["Русе", "Ruse"] },
    bg: "Какви са местните данъци в Русе?",
    en: "What are the local taxes in Ruse?",
  },
  {
    tool: "budgetOverview",
    args: {},
    bg: "Покажи общия държавен бюджет",
    en: "Show the state budget overview",
  },
  {
    tool: "agencyProfile",
    args: { agency: ["Алфа Рисърч", "Alpha Research"] },
    bg: "Колко точна е Алфа Рисърч?",
    en: "How accurate is Alpha Research?",
  },
  {
    tool: "localMunicipality",
    args: { place: ["Пловдив", "Plovdiv"] },
    bg: "Кой е кметът на Пловдив?",
    en: "Who is the mayor of Plovdiv?",
  },
];
const key = process.env.OPENROUTER_API_KEY;
if (!key)
  throw new Error("OPENROUTER_API_KEY missing; no evaluation performed");
const rows: Record<string, unknown>[] = [];
let requests = 0;
async function complete(
  model: string,
  messages: { role: string; content: string }[],
  narration = false,
) {
  if (++requests > 40) throw new Error("evaluation request cap");
  const base = payload({
    model: MODEL,
    messages,
    max_tokens: narration ? 420 : 120,
    temperature: narration ? 0.3 : 0,
    ...(!narration ? { response_format: { type: "json_object" } } : {}),
  });
  const started = Date.now();
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...base, model }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(`provider HTTP ${response.status}; evaluation aborted`);
  const data = await response.json();
  if (data.error || !data.choices?.[0]?.message?.content)
    throw new Error("provider returned no completion; evaluation aborted");
  return {
    raw: String(data.choices[0].message.content),
    ms: Date.now() - started,
    usage: data.usage,
  };
}
for (const model of models) {
  for (const lang of ["bg", "en"] as Lang[]) {
    for (const c of cases) {
      const result = await complete(model, [
        { role: "system", content: buildToolSystemPrompt(lang) },
        { role: "user", content: c[lang] },
      ]);
      const parsed = parseToolCall(result.raw);
      const ok =
        parsed?.tool === c.tool &&
        Object.entries(c.args).every(([k, values]) =>
          values.some(
            (v) =>
              String(parsed.args[k]).toLocaleLowerCase() ===
              v.toLocaleLowerCase(),
          ),
        );
      rows.push({
        model,
        lang,
        kind: "routing",
        query: c[lang],
        expected: c.tool,
        expectedArgs: c.args,
        parsed,
        ok,
        ...result,
      });
      console.log(`${model} ${lang} ${c.tool}: ${ok ? "PASS" : "FAIL"}`);
    }
    for (const prior of [undefined, "Earlier answer: 999 people, 99%."]) {
      // Synthetic fixture: no claims about real elections are published.
      const env: Envelope = {
        tool: "turnout",
        kind: "scalar",
        viz: "none",
        title:
          lang === "bg"
            ? "Тестови данни за активност"
            : "Synthetic turnout data",
        facts: { previous: 42.7, current: 38.2 },
        provenance: ["synthetic-evaluation-fixture"],
      };
      const p = buildNarrationPrompt(env, lang, prior);
      const result = await complete(
        model,
        [
          { role: "system", content: p.system },
          { role: "user", content: p.user },
        ],
        true,
      );
      const ok =
        matchesLang(result.raw, lang) &&
        numbersGrounded(result.raw, p.user.replace(prior ?? "", ""));
      rows.push({ model, lang, kind: "narration", prior, ok, ...result });
      console.log(`${model} ${lang} narration: ${ok ? "PASS" : "FAIL"}`);
    }
  }
}
const artifact = {
  createdAt: new Date().toISOString(),
  scope:
    "Small smoke comparison; not a representative accuracy benchmark. Narration checks language and numerical grounding, not full factual entailment.",
  maxReservedUSD: (requests * POLICY.callReserve) / 1e6,
  rows,
};
await writeFile(
  "ai/llm/modelUpgrade.results.json",
  JSON.stringify(artifact, null, 2) + "\n",
);
console.log("Saved ai/llm/modelUpgrade.results.json");
