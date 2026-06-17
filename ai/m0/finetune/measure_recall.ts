// Measure the TRUE (leakage-free) retriever recall of the constrained-router
// candidate retriever (ai/llm/retrieve.ts).
//
// WHY: the fc-eval ladder routes among the top-k candidates the retriever hands
// the model. If the correct tool is NOT in that top-k, no amount of fine-tuning
// can recover it — retriever recall is the HARD CEILING on end-to-end routing
// (see ai/m0/finetune_functiongemma.md, "retriever recall is the binding
// ceiling"). The recall number you'd get by testing on the registry `examples`
// is INFLATED: those exact strings are indexed into the fuse haystack, so they
// score ~100% by leakage.
//
// This script removes the leakage by testing on NOVEL queries: for each tool it
// asks Gemini for short, real-user-style EN+BG phrasings that are DIFFERENT from
// the indexed examples, then measures where the production retriever ranks the
// correct tool. The generated queries are cached to recall_queries.json so the
// API cost is paid once; re-runs (and the recall math) are then free + offline.
//
//   npx tsx ai/m0/finetune/measure_recall.ts            # generate (if needed) + measure
//   npx tsx ai/m0/finetune/measure_recall.ts --no-gen   # measure from cache only (offline)
//   npx tsx ai/m0/finetune/measure_recall.ts --n 4      # queries per lang per tool (default 3)
//   npx tsx ai/m0/finetune/measure_recall.ts --model gemini-3.1-flash-lite
//
// Outputs: ai/m0/finetune/recall_queries.json (cache) + recall_report.json (result).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Fuse from "fuse.js";
import { loadGeminiEnv } from "../../../scripts/council/lib/gemini_ocr";
import { route } from "../../orchestrator/router";
import { TOOLS } from "../../tools/registry";
import type { Lang } from "../../tools/types";

const ELECTION = "2024_10_27"; // any valid election; routing barely depends on it

const HERE = join(process.cwd(), "ai/m0/finetune");
const CACHE = join(HERE, "recall_queries.json");
const REPORT = join(HERE, "recall_report.json");

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 3);
const MODEL = arg("--model") ?? "gemini-3.5-flash";
const NO_GEN = process.argv.includes("--no-gen");
const KS = [1, 3, 5, 8] as const;

// ---- retriever: rebuild the EXACT fuse index from ai/llm/retrieve.ts so we can
// read raw ranks (retrieveToolNames pads to k, which would mask true recall).
// KEEP THIS CONFIG IN SYNC WITH retrieve.ts.
type Row = { name: string };
const fuse = new Fuse<Row>(
  TOOLS.map((t) => ({
    name: t.name,
    haystack: [
      t.name,
      t.description.en,
      t.description.bg,
      ...(t.examples ?? []).flatMap((e) => [e.en, e.bg]),
    ].join(" "),
  })),
  {
    keys: ["haystack", "name"],
    threshold: 0.6,
    ignoreLocation: true,
    minMatchCharLength: 2,
  },
);
// 0-based rank of `tool` in fuse's ranked hits for `query`; Infinity if absent.
const rankOf = (query: string, tool: string): number => {
  const hits = fuse.search(query);
  const r = hits.findIndex((h) => h.item.name === tool);
  return r < 0 ? Infinity : r;
};
const topN = (query: string, n: number): string[] =>
  fuse
    .search(query)
    .slice(0, n)
    .map((h) => h.item.name);

// ---- query generation (Gemini), cached per tool -----------------------------
type ToolQueries = { en: string[]; bg: string[] };
type Cache = Record<string, ToolQueries>;

const genForTool = async (
  apiKey: string,
  tool: (typeof TOOLS)[number],
): Promise<ToolQueries> => {
  const examples = (tool.examples ?? [])
    .flatMap((e) => [e.en, e.bg])
    .map((s) => `  - ${s}`)
    .join("\n");
  const prompt = `You generate realistic search/chat queries for ONE tool of a Bulgarian elections & public-data site.

TOOL: ${tool.name}  (domain: ${tool.domain})
WHAT IT ANSWERS (EN): ${tool.description.en}
WHAT IT ANSWERS (BG): ${tool.description.bg}
EXISTING phrasings (DO NOT reuse or lightly reword these — invent genuinely different ones):
${examples || "  (none)"}

Write ${N} English and ${N} Bulgarian queries a REAL user would type to get THIS tool's answer.
Rules: short (most under 10 words), natural, varied — mix full questions with terse keyword style.
Use synonyms and colloquial wording, NOT the description's vocabulary. Bulgarian must be natural, not translated-sounding.
Each query must be answerable specifically by THIS tool, not a sibling tool.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.95,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            en: { type: "ARRAY", items: { type: "STRING" } },
            bg: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["en", "bg"],
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok)
    throw new Error(
      `gemini ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = JSON.parse(text) as ToolQueries;
  // drop any accidental echo of an indexed example (keeps the test leakage-free)
  const indexed = new Set(
    (tool.examples ?? [])
      .flatMap((e) => [e.en, e.bg])
      .map((s) => s.trim().toLowerCase()),
  );
  const clean = (xs: string[] = []) =>
    xs.map((s) => s.trim()).filter((s) => s && !indexed.has(s.toLowerCase()));
  return { en: clean(parsed.en), bg: clean(parsed.bg) };
};

// tiny concurrency pool (no deps)
const pool = async <T, R>(
  items: T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
};

const main = async () => {
  const cache: Cache = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, "utf8"))
    : {};

  const missing = TOOLS.filter(
    (t) =>
      !cache[t.name] ||
      (cache[t.name].en.length === 0 && cache[t.name].bg.length === 0),
  );
  if (missing.length && !NO_GEN) {
    loadGeminiEnv();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      throw new Error(
        "GEMINI_API_KEY not set (check .env.local). Use --no-gen to measure from cache.",
      );
    console.error(
      `generating queries for ${missing.length}/${TOOLS.length} tools via ${MODEL} (concurrency 6)…`,
    );
    let done = 0;
    await pool(missing, 6, async (t) => {
      try {
        cache[t.name] = await genForTool(apiKey, t);
      } catch (e) {
        console.error(
          `  ! ${t.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
        cache[t.name] = { en: [], bg: [] };
      }
      if (++done % 10 === 0) {
        writeFileSync(CACHE, JSON.stringify(cache, null, 2)); // checkpoint
        console.error(`  …${done}/${missing.length}`);
      }
    });
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  } else if (missing.length && NO_GEN) {
    console.error(
      `--no-gen: ${missing.length} tools have no cached queries; they are skipped.`,
    );
  }

  // ---- measure ----
  type Acc = { n: number; hit: Record<number, number>; rankSum: number };
  const fresh = (): Acc => ({
    n: 0,
    hit: Object.fromEntries(KS.map((k) => [k, 0])),
    rankSum: 0,
  });
  const all = fresh();
  const byLang = { en: fresh(), bg: fresh() };
  const declined = fresh(); // retriever recall on the rules-DECLINED residual (model's real regime)
  const perTool: Record<
    string,
    {
      n: number;
      missAt8: number;
      worstRank: number;
      confusedWith: Record<string, number>;
    }
  > = {};
  const misses: {
    tool: string;
    lang: string;
    query: string;
    rank: number;
    got: string[];
  }[] = [];
  // What the deterministic rules router does with each novel query (the model
  // only ever sees the DECLINED bucket; "wrong" never reaches it because rules
  // win even when wrong — webllm.ts:158).
  const rules = { correct: 0, wrong: 0, declined: 0 };

  for (const t of TOOLS) {
    const q = cache[t.name];
    if (!q) continue;
    perTool[t.name] = { n: 0, missAt8: 0, worstRank: -1, confusedWith: {} };
    for (const lang of ["en", "bg"] as const) {
      for (const query of q[lang] ?? []) {
        const rank = rankOf(query, t.name);
        all.n++;
        byLang[lang].n++;
        perTool[t.name].n++;
        for (const k of KS)
          if (rank < k) {
            all.hit[k]++;
            byLang[lang].hit[k]++;
          }
        if (Number.isFinite(rank)) {
          all.rankSum += rank;
          byLang[lang].rankSum += rank;
        }
        perTool[t.name].worstRank = Math.max(
          perTool[t.name].worstRank,
          Number.isFinite(rank) ? rank : 999,
        );
        if (rank >= 8) {
          perTool[t.name].missAt8++;
          const got = topN(query, 3);
          for (const g of got)
            perTool[t.name].confusedWith[g] =
              (perTool[t.name].confusedWith[g] ?? 0) + 1;
          misses.push({
            tool: t.name,
            lang,
            query,
            rank: Number.isFinite(rank) ? rank : -1,
            got,
          });
        }
        // rules bucket + declined-residual recall
        const rTool =
          route(query, { lang: lang as Lang, election: ELECTION })?.tool ??
          null;
        if (rTool === t.name) rules.correct++;
        else if (rTool === null) {
          rules.declined++;
          declined.n++;
          for (const k of KS) if (rank < k) declined.hit[k]++;
          if (Number.isFinite(rank)) declined.rankSum += rank;
        } else rules.wrong++;
      }
    }
  }

  const recall = (a: Acc) =>
    Object.fromEntries(
      KS.map((k) => [k, a.n ? +(a.hit[k] / a.n).toFixed(3) : null]),
    );
  const report = {
    model: MODEL,
    queriesPerLangPerTool: N,
    totalQueries: all.n,
    toolsMeasured: Object.values(perTool).filter((p) => p.n > 0).length,
    toolsTotal: TOOLS.length,
    recallAll: recall(all),
    recallEn: recall(byLang.en),
    recallBg: recall(byLang.bg),
    meanRankAll: all.n ? +(all.rankSum / all.n).toFixed(2) : null,
    rulesRouter: {
      correct: rules.correct,
      wrong: rules.wrong,
      declined: rules.declined,
      correctPct: +(rules.correct / all.n).toFixed(3),
      wrongPct: +(rules.wrong / all.n).toFixed(3),
      declinedPct: +(rules.declined / all.n).toFixed(3),
    },
    // The ceiling that actually constrains the fine-tuned model: retriever recall
    // measured ONLY on queries the rules declined (the model's real input).
    recallOnDeclined: recall(declined),
    declinedQueries: declined.n,
    worstTools: Object.entries(perTool)
      .filter(([, p]) => p.n > 0)
      .map(([name, p]) => ({
        name,
        ...p,
        missRate: +(p.missAt8 / p.n).toFixed(2),
      }))
      .sort((a, b) => b.missRate - a.missRate || b.worstRank - a.worstRank)
      .slice(0, 25),
    missesSample: misses.slice(0, 60),
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));

  // ---- print ----
  const pct = (x: number | null) =>
    x === null ? " n/a" : `${(x * 100).toFixed(1)}%`;
  console.log(
    `\n=== Retriever recall (leakage-free, ${all.n} novel queries, ${report.toolsMeasured}/${TOOLS.length} tools) ===`,
  );
  console.log(`            recall@1   @3      @5      @8`);
  const line = (label: string, r: Record<number, number | null>) =>
    console.log(
      `  ${label.padEnd(8)}  ${pct(r[1]).padStart(7)} ${pct(r[3]).padStart(7)} ${pct(r[5]).padStart(7)} ${pct(r[8]).padStart(7)}`,
    );
  line("all", report.recallAll);
  line("EN", report.recallEn);
  line("BG", report.recallBg);
  console.log(`  mean rank of correct tool: ${report.meanRankAll}`);
  console.log(`\n  Deterministic rules router on the SAME ${all.n} queries:`);
  console.log(
    `    correct ${pct(report.rulesRouter.correctPct)}   wrong ${pct(report.rulesRouter.wrongPct)}   declined ${pct(report.rulesRouter.declinedPct)}`,
  );
  console.log(
    `  Retriever recall on the rules-DECLINED residual (${declined.n} queries = the model's real input):`,
  );
  line("declined", report.recallOnDeclined);
  console.log(
    `\n  Top tools the retriever MISSES at k=8 (the ceiling-limiters):`,
  );
  for (const w of report.worstTools.slice(0, 12)) {
    const conf = Object.entries(w.confusedWith)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => n)
      .join(", ");
    console.log(
      `    ${w.name.padEnd(26)} miss ${(w.missRate * 100).toFixed(0).padStart(3)}%  → got: ${conf}`,
    );
  }
  console.log(`\n  full report → ${REPORT}\n  query cache → ${CACHE}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
