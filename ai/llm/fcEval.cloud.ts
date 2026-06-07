// Node runner for the EN/BG function-calling eval against the CLOUD models.
//
//   npx tsx ai/llm/fcEval.cloud.ts                         # gemini-3.1-flash-lite
//   npx tsx ai/llm/fcEval.cloud.ts google/gemma-4-31b-it:free
//   FC_EVAL_PROXY_URL=https://electionsbg-ai.web.app/api/llm npx tsx ai/llm/fcEval.cloud.ts
//
// It hits the SAME Firebase proxy (/api/llm) the app uses, with NO Origin header
// (node) — which the proxy allows — so this is a faithful, repeatable measure of
// the production cloud routing path (JSON-mode + a tool-listing system prompt).
// Costs a little OpenRouter usage per run (22 calls per model).

import {
  buildJsonToolPrompt,
  candidateTools,
  runFcEval,
  type FcTool,
} from "./fcEval";

const PROXY_URL =
  process.env.FC_EVAL_PROXY_URL || "https://ai.electionsbg.com/api/llm";
const MODEL = process.argv[2] || "google/gemini-3.1-flash-lite";
const K = Number(process.env.FC_EVAL_K) || 5;
// Pace + retry for free-tier models (OpenRouter free = 16 req/min). Set
// FC_EVAL_DELAY_MS=4500 for *:free models; default 0 for paid.
const DELAY_MS = Number(process.env.FC_EVAL_DELAY_MS) || 0;
const MAX_RETRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const complete = async (query: string, tools: FcTool[]): Promise<string> => {
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: buildJsonToolPrompt(tools) },
      { role: "user", content: query },
    ],
    temperature: 0,
    max_tokens: 160,
    response_format: { type: "json_object" },
  });
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (DELAY_MS) await sleep(DELAY_MS);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.status === 429) {
        // back off through the per-minute window and retry
        const wait = 6000 * (attempt + 1);
        console.error(`  [429] rate-limited, waiting ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error(`  [proxy ${res.status}] ${t.slice(0, 160)}`);
        return "";
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { code?: number } | string;
      };
      if (data.error) {
        const code =
          typeof data.error === "object" ? data.error.code : undefined;
        if (code === 429) {
          const wait = 6000 * (attempt + 1);
          console.error(
            `  [429] upstream rate-limited, waiting ${wait / 1000}s…`,
          );
          await sleep(wait);
          continue;
        }
        console.error(
          `  [model error] ${JSON.stringify(data.error).slice(0, 160)}`,
        );
        return "";
      }
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      console.error(`  [fetch error] ${String(e).slice(0, 160)}`);
      return "";
    }
  }
  console.error("  [gave up after retries]");
  return "";
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

const main = async () => {
  console.log(`\nEN/BG function-calling eval — model: ${MODEL}`);
  console.log(`proxy: ${PROXY_URL} · candidate-set k=${K}\n`);
  const report = await runFcEval(complete, {
    toolsForCase: (c, all) => candidateTools(c, all, K),
  });
  const { en, bg } = report.perLang;
  const row = (label: string, l: typeof en) =>
    `${label.padEnd(4)} tool ${pct(l.toolAcc).padStart(4)} | args ${pct(l.argAcc).padStart(4)} | json ${pct(l.jsonValidRate).padStart(4)} | irrelevance ${l.irrelevanceAcc == null ? " n/a" : pct(l.irrelevanceAcc).padStart(4)}`;
  console.log(row("EN", en));
  console.log(row("BG", bg));
  console.log(
    `\nBG degradation vs EN — tool: ${pct(report.degradation.toolAcc)} | args: ${pct(report.degradation.argAcc)}  (positive = BG worse)\n`,
  );
  // per-case detail, EN/BG side by side
  const byId = new Map<
    string,
    { en?: (typeof report.scores)[number]; bg?: (typeof report.scores)[number] }
  >();
  for (const s of report.scores) {
    const e = byId.get(s.id) ?? {};
    e[s.lang] = s;
    byId.set(s.id, e);
  }
  console.log("per-case (tool ok? / args ok?):");
  for (const [id, { en: e, bg: b }] of byId) {
    const mark = (s?: (typeof report.scores)[number]) =>
      !s ? "  -  " : `${s.toolOk ? "T" : "·"}${s.argsOk ? "A" : "·"}`;
    const got = (s?: (typeof report.scores)[number]) =>
      s?.gotTool ?? (s?.expectedTool === null ? "(none)" : "null");
    console.log(
      `  ${id.padEnd(28)} EN ${mark(e)}  BG ${mark(b)}   exp=${e?.expectedTool ?? "(none)"}  gotEN=${got(e)}  gotBG=${got(b)}`,
    );
  }
  console.log("");
};

main();
