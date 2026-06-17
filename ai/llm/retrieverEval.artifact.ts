// Build the published RETRIEVER-recall comparison: data/ai/evals/retriever_recall.json
//
//   npx tsx ai/llm/retrieverEval.artifact.ts
//
// The constrained in-browser router routes the small model among the top-k tools
// a RETRIEVER hands it; if the right tool isn't in that top-k, no model can
// recover it — so retriever recall is the ceiling on end-to-end routing. This
// artifact publishes that ceiling across rankers, measured over the SAME held-out
// query set (750 novel Gemini-generated EN+BG queries, leakage-free; the model's
// real input is the "rules-declined residual" — the queries the deterministic
// rules router doesn't already answer). Reproducible source:
//   ai/m0/finetune/measure_recall.ts          (lexical + rules bucketing)
//   ai/m0/finetune/measure_recall_semantic.ts (gemini-embedding-001)
//   /tmp/embtest/measure.mjs                   (e5/MiniLM/bge via transformers.js)
//   ai/m0/finetune/finetune_embedder.py        (the fine-tuned e5-small)
// These rankers need GPUs / cloud APIs / local weights, so the numbers are RECORDED
// point-in-time measurements (2026-06-17), not re-run live — same pattern as the
// FunctionGemma capture rows in fcEval.artifact.ts.
//
// Output → data/ai/evals/ which `npm run bucket:sync` ships to the GCS data bucket;
// the /evals page fetches it via fetchData("/ai/evals/retriever_recall.json").

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Bi = { bg: string; en: string };
type Recall = { 1: number; 3: number; 5: number; 8: number };
type Row = {
  id: string;
  label: Bi;
  runtime: "cloud" | "webllm";
  size: Bi;
  method: Bi;
  ours?: boolean; // built/tuned by us
  shipped?: boolean; // currently wired behind the flag
  all: Recall; // recall over all 750 queries
  declined: Recall; // recall over the rules-declined residual (the model's real input)
};

const r = (a: number, b: number, c: number, d: number): Recall => ({
  1: a / 100,
  3: b / 100,
  5: c / 100,
  8: d / 100,
});

// Measured 2026-06-17 over the same 750-query / 163-declined held-out set.
const rows: Row[] = [
  {
    id: "lexical",
    label: {
      bg: "Лексикален (fuse.js) — текущ",
      en: "Lexical (fuse.js) — current",
    },
    runtime: "webllm",
    size: { bg: "0 — без модел", en: "0 — no model" },
    method: {
      bg: "съвпадение по думи в името + описанието",
      en: "keyword match over name + description",
    },
    all: r(24.3, 39.3, 48.7, 56.4),
    declined: r(22.7, 34.4, 44.2, 49.1),
  },
  {
    id: "minilm",
    label: { bg: "MiniLM-L12 (универсален)", en: "MiniLM-L12 (generic)" },
    runtime: "webllm",
    size: { bg: "~45 MB (q8)", en: "~45 MB (q8)" },
    method: { bg: "семантичен (вграждания)", en: "semantic (embeddings)" },
    all: r(35.5, 57.7, 67.9, 75.3),
    declined: r(35.0, 56.4, 67.5, 72.4),
  },
  {
    id: "e5-small",
    label: { bg: "e5-small (универсален)", en: "e5-small (generic)" },
    runtime: "webllm",
    size: { bg: "~45 MB (q8)", en: "~45 MB (q8)" },
    method: { bg: "семантичен (вграждания)", en: "semantic (embeddings)" },
    all: r(40.1, 62.4, 70.8, 77.2),
    declined: r(33.1, 61.3, 69.3, 76.7),
  },
  {
    id: "e5-base",
    label: { bg: "e5-base (универсален)", en: "e5-base (generic)" },
    runtime: "webllm",
    size: { bg: "~110 MB (q8)", en: "~110 MB (q8)" },
    method: { bg: "семантичен (вграждания)", en: "semantic (embeddings)" },
    shipped: true,
    all: r(46.0, 67.7, 77.6, 84.3),
    declined: r(40.5, 66.9, 79.1, 86.5),
  },
  {
    id: "bge-m3",
    label: { bg: "bge-m3 (универсален)", en: "bge-m3 (generic)" },
    runtime: "webllm",
    size: { bg: "~250–570 MB (q8)", en: "~250–570 MB (q8)" },
    method: { bg: "семантичен (вграждания)", en: "semantic (embeddings)" },
    all: r(50.8, 72.5, 81.1, 86.7),
    declined: r(49.7, 74.8, 83.4, 88.3),
  },
  {
    id: "gemini-embedding-001",
    label: {
      bg: "gemini-embedding-001 (облак)",
      en: "gemini-embedding-001 (cloud)",
    },
    runtime: "cloud",
    size: { bg: "облак", en: "cloud" },
    method: { bg: "семантичен (вграждания)", en: "semantic (embeddings)" },
    all: r(65.1, 84.7, 90.0, 94.7),
    declined: r(64.4, 88.3, 92.0, 95.1),
  },
  {
    id: "e5-small-naiasno",
    label: {
      bg: "e5-small, дообучен за Наясно",
      en: "e5-small, fine-tuned for Наясно",
    },
    runtime: "webllm",
    size: { bg: "~45 MB (q8)", en: "~45 MB (q8)" },
    method: {
      bg: "семантичен + контрастно дообучение",
      en: "semantic + contrastive fine-tune",
    },
    ours: true,
    all: r(81.6, 95.1, 98.3, 99.7),
    declined: r(77.3, 95.1, 96.9, 100.0),
  },
];

const artifact = {
  generatedAt: new Date().toISOString(),
  queries: { total: 750, declined: 163, langs: ["en", "bg"] },
  method: {
    en: "Each ranker scores the same 750 novel Gemini-generated EN+BG queries (held out from the registry's own examples, so no leakage). recall@k = share of queries whose CORRECT tool is in the ranker's top-k. The 'rules-declined residual' (163 queries) is the model's real input — the queries the deterministic rules router doesn't already answer.",
    bg: "Всеки модел оценява едни и същи 750 нови въпроса (EN+BG), генерирани от Gemini и изключени от примерите в регистъра (без изтичане). recall@k = делът на въпросите, чийто ПРАВИЛЕН инструмент е сред първите k. „Остатъкът след правилата“ (163 въпроса) е реалният вход за модела — въпросите, на които детерминистичните правила още не отговарят.",
  },
  caveat: {
    en: "The fine-tuned row's training and eval queries share a Gemini generator (different, deduped queries but a similar STYLE), so its absolute numbers are best-case; a truly independent test set (real logged or human-written queries) is the honest final gate.",
    bg: "При дообучения модел тренировъчните и тестовите въпроси идват от един и същ генератор (Gemini) — различни, дедуплицирани въпроси, но сходен СТИЛ — затова абсолютните стойности са в най-добрия случай; независим тестов набор (реални или човешки въпроси) е финалната честна проверка.",
  },
  rows,
};

const out = join(process.cwd(), "data/ai/evals/retriever_recall.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(artifact, null, 2) + "\n");
console.error(`wrote ${out}: ${rows.length} rankers`);
