// In-browser SEMANTIC tool retriever for the constrained small-model router.
//
// Replaces the lexical fuse.js retriever (ai/llm/retrieve.ts) on the
// constrainedRoute path. Measured 2026-06-17 (ai/m0/finetune/measure_recall*.ts):
// on the rules-declined residual the model actually sees, recall@8 lifts from
//   lexical 49%  →  multilingual-e5-base 87%  (gemini-embedding-001 cloud = 95%)
// — i.e. the retriever, not the 270M model, was the binding ceiling. See
// ai/m0/finetune_functiongemma.md + [[project_ai_chat_retriever_ceiling]].
//
// Tool-doc vectors are precomputed OFFLINE (buildToolVectors.ts → tool_vectors.json)
// and the QUERY is embedded in-browser with the SAME model (q8 ≈ fp32, ~110 MB,
// fetched + cached by transformers.js), so query and docs share one embedding
// space. The vectors JSON is a lazy chunk — loaded only when this path first runs
// (it's gated by model.constrainedRouter + localStorage["naiasno:fg-router"]),
// so it never weighs on the default bundle.

// type-only import (erased at build) — the library itself is dynamically
// imported in getPipe() so transformers.js + its onnxruntime-web wasm stay a
// lazy chunk, never weighing on the default bundle for users who don't enable
// the (gated, off-by-default) constrained router.
import { type FeatureExtractionPipeline } from "@huggingface/transformers";
import { TOOLS_BY_NAME } from "../tools/registry";

export const EMBED_MODEL = "Xenova/multilingual-e5-base";
export const EMBED_DTYPE = "q8" as const;
// the e5 family needs asymmetric instruction prefixes (doc vs query)
export const docPrefix = (s: string): string => `passage: ${s}`;
export const queryPrefix = (s: string): string => `query: ${s}`;

// The exact text embedded per tool. MUST match the offline precompute — both
// import this one function so they can never drift.
export const toolDocText = (name: string): string => {
  const t = TOOLS_BY_NAME[name];
  return [
    t.name,
    t.description.en,
    t.description.bg,
    ...(t.examples ?? []).flatMap((e) => [e.en, e.bg]),
  ].join(" · ");
};

type Vectors = {
  model: string;
  dtype: string;
  dim: number;
  vectors: { name: string; v: number[] }[];
};

const normalize = (v: number[]): number[] => {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

// Lazy singletons: the embedder pipeline (~110 MB, fetched once) and the doc
// vectors (a lazy JSON chunk). Both created on first call, reused after.
let pipePromise: Promise<FeatureExtractionPipeline> | null = null;
let docsPromise: Promise<{ name: string; v: number[] }[]> | null = null;

const getPipe = (): Promise<FeatureExtractionPipeline> =>
  (pipePromise ??= import("@huggingface/transformers").then(({ pipeline }) =>
    pipeline("feature-extraction", EMBED_MODEL, { dtype: EMBED_DTYPE }),
  ));

const getDocs = (): Promise<{ name: string; v: number[] }[]> =>
  (docsPromise ??= import("./tool_vectors.json").then((m) => {
    const data = (m.default ?? m) as unknown as Vectors;
    // re-normalize defensively (the stored values are rounded for size)
    return data.vectors.map((r) => ({ name: r.name, v: normalize(r.v) }));
  }));

const embedQuery = async (q: string): Promise<number[]> => {
  const pipe = await getPipe();
  const out = await pipe(queryPrefix(q), { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
};

// Top-k tool names by cosine similarity to the query. REJECTS if the embedder or
// vectors fail to load — the caller (constrainedRoute) catches and falls back to
// the lexical retriever, so a model-load failure never breaks routing.
export const retrieveToolNamesSemantic = async (
  question: string,
  k: number,
): Promise<string[]> => {
  const [qv, docs] = await Promise.all([embedQuery(question), getDocs()]);
  return docs
    .map((d) => ({ name: d.name, s: dot(qv, d.v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((d) => d.name);
};

export const retrieveToolsSemantic = async (question: string, k: number) =>
  (await retrieveToolNamesSemantic(question, k))
    .map((n) => TOOLS_BY_NAME[n])
    .filter(Boolean);

// Lets the UI warm the embedder while the user is typing (optional).
export const warmSemanticRetriever = (): void => {
  void getPipe();
  void getDocs();
};
