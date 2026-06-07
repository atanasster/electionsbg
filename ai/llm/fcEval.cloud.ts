// Cloud-model adapter + CLI for the EN/BG function-calling eval.
//
//   npx tsx ai/llm/fcEval.cloud.ts                          # gemini-3.1-flash-lite (console)
//   npx tsx ai/llm/fcEval.cloud.ts google/gemma-4-31b-it:free
//   FC_EVAL_DELAY_MS=4500 npx tsx ai/llm/fcEval.cloud.ts google/gemma-4-31b-it:free
//
// It hits the SAME Firebase proxy (/api/llm) the app uses, with NO Origin header
// (node) — which the proxy allows — so this is a faithful, repeatable measure of
// the production cloud routing path (JSON-mode + a tool-listing system prompt).
// makeCloudComplete()/runCloudModel() are imported by fcEval.artifact.ts.

import {
  buildJsonToolPrompt,
  candidateTools,
  runFcEval,
  type CompleteFn,
  type FcReport,
  type FcTool,
} from "./fcEval";

export const DEFAULT_PROXY_URL =
  process.env.FC_EVAL_PROXY_URL || "https://ai.electionsbg.com/api/llm";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A `complete` bound to one cloud model. Paces + retries on 429 (OpenRouter free
// tier = 16 req/min); set delayMs ~4500 for *:free models, 0 for paid.
export const makeCloudComplete = (
  model: string,
  opts: { proxyUrl?: string; delayMs?: number; maxRetries?: number } = {},
): CompleteFn => {
  const proxyUrl = opts.proxyUrl ?? DEFAULT_PROXY_URL;
  const delayMs = opts.delayMs ?? 0;
  const maxRetries = opts.maxRetries ?? 5;
  return async (query: string, tools: FcTool[]): Promise<string> => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildJsonToolPrompt(tools) },
        { role: "user", content: query },
      ],
      temperature: 0,
      max_tokens: 160,
      response_format: { type: "json_object" },
    });
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (delayMs) await sleep(delayMs);
      try {
        const res = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.status === 429) {
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
};

export const runCloudModel = (
  model: string,
  k = 5,
  opts: { proxyUrl?: string; delayMs?: number } = {},
): Promise<FcReport> =>
  runFcEval(makeCloudComplete(model, opts), {
    toolsForCase: (c, all) => candidateTools(c, all, k),
  });

// ---- CLI (console table) ---------------------------------------------------
const pct = (x: number) => `${Math.round(x * 100)}%`;

const main = async () => {
  const model = process.argv[2] || "google/gemini-3.1-flash-lite";
  const k = Number(process.env.FC_EVAL_K) || 5;
  const delayMs = Number(process.env.FC_EVAL_DELAY_MS) || 0;
  console.log(`\nEN/BG function-calling eval — model: ${model}`);
  console.log(`proxy: ${DEFAULT_PROXY_URL} · candidate-set k=${k}\n`);
  const report = await runCloudModel(model, k, { delayMs });
  const { en, bg } = report.perLang;
  const row = (label: string, l: typeof en) =>
    `${label.padEnd(4)} tool ${pct(l.toolAcc).padStart(4)} | args ${pct(l.argAcc).padStart(4)} | json ${pct(l.jsonValidRate).padStart(4)} | irrelevance ${l.irrelevanceAcc == null ? " n/a" : pct(l.irrelevanceAcc).padStart(4)}`;
  console.log(row("EN", en));
  console.log(row("BG", bg));
  console.log(
    `\nBG degradation vs EN — tool: ${pct(report.degradation.toolAcc)} | args: ${pct(report.degradation.argAcc)}  (positive = BG worse)\n`,
  );
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

// Run only when invoked directly (not when imported by fcEval.artifact.ts).
if (process.argv[1] && /fcEval\.cloud\.(ts|js)$/.test(process.argv[1])) main();
