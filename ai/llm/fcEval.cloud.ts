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

// A `complete` bound to a Gemma model on the Google Gemini API (generative
// language). Gemma there supports ONLY generateContent — no system role and no
// function-calling tools — so the JSON tool-list prompt + the query go in one
// user part, and we parse the returned text. Used to measure Gemma without the
// OpenRouter free-tier rate limit (needs a GEMINI_API_KEY).
export const makeGeminiComplete = (
  model: string,
  apiKey: string,
  opts: { delayMs?: number; maxRetries?: number } = {},
): CompleteFn => {
  const delayMs = opts.delayMs ?? 0;
  // Ride out Gemini-API 429s so no call gives up (a give-up would score as a
  // miss and taint the result), since Gemma's RPM limit is low for big prompts.
  const maxRetries = opts.maxRetries ?? 8;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return async (query: string, tools: FcTool[]): Promise<string> => {
    const body = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${buildJsonToolPrompt(tools)}\n\n${query}` }],
        },
      ],
      // Gemma chain-of-thoughts before the JSON (it ignores "JSON only"), and
      // the reasoning is longer in Bulgarian (it translates first). Give enough
      // budget for the CoT + the final tool-call object, else BG truncates and
      // scores as a false failure.
      generationConfig: { temperature: 0, maxOutputTokens: 640 },
    });
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (delayMs) await sleep(delayMs);
      // Per-call timeout: the Gemini API can hang on a big (~100-tool) prompt,
      // and a hung fetch never resolves → it would stall the whole run. Abort
      // after 45s and RETRY (don't give up — that would taint the score).
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 45000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: ctrl.signal,
        });
        if (res.status === 429) {
          const wait = 6000 * (attempt + 1);
          console.error(
            `  [429] gemini rate-limited, waiting ${wait / 1000}s…`,
          );
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          console.error(`  [gemini ${res.status}] ${t.slice(0, 160)}`);
          return "";
        }
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          error?: unknown;
        };
        if (data.error) {
          console.error(
            `  [gemini error] ${JSON.stringify(data.error).slice(0, 160)}`,
          );
          return "";
        }
        const parts = data.candidates?.[0]?.content?.parts;
        return Array.isArray(parts)
          ? parts.map((p) => p.text ?? "").join("")
          : "";
      } catch (e) {
        // AbortError (timeout) or transient network error → back off and retry,
        // so a single stalled call can't hang the run or taint the score.
        const wait = 3000 * (attempt + 1);
        console.error(
          `  [gemini timeout/err] ${String(e instanceof Error ? e.message : e).slice(0, 80)} — retry in ${wait / 1000}s`,
        );
        await sleep(wait);
        continue;
      } finally {
        clearTimeout(to);
      }
    }
    console.error("  [gemini gave up after retries]");
    return "";
  };
};

export const runGeminiModel = (
  model: string,
  apiKey: string,
  k = 5,
  opts: { delayMs?: number } = {},
): Promise<FcReport> =>
  runFcEval(makeGeminiComplete(model, apiKey, opts), {
    toolsForCase: (c, all) => candidateTools(c, all, k),
  });

// ---- CLI (console table) ---------------------------------------------------
const pct = (x: number | null) =>
  x == null ? " n/a" : `${Math.round(x * 100)}%`;

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
