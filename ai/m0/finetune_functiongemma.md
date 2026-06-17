# Fine-tuning FunctionGemma-270M to route the Наясно tools (in-browser)

> Status: PLAN (2026-06-08). The fc-eval ladder on `/evals` proved the *mechanism*
> works on the UNTUNED community build — this doc is the path from ~37% to usable.
> Training itself needs a GPU (Colab/Unsloth); everything else here runs locally.

## MEASURED 2026-06-17 — the retriever, not the model, is the bottleneck (re-prioritize)

Two zero-GPU measurements (`ai/m0/finetune/measure_recall.ts` +
`measure_recall_semantic.ts`) over **750 NOVEL Gemini-generated queries** (EN+BG,
forbidden from reusing the indexed `examples`, so leakage-free; cached in
`recall_queries.json`). Verdict: **do NOT fine-tune first.** Fix retrieval first.

1. **The lexical fuse.js retriever is the binding ceiling, and it's low.** True
   recall (not the example-leaked ~100%): all-queries **@5 48.7% / @8 56.4%**; on
   the rules-DECLINED residual the model actually sees, **@5 44% / @8 49%**. A
   *perfect* fine-tune is capped there. `constrainedRoute` uses k=5 → ~44% ceiling.
2. **Swapping to a SEMANTIC retriever lifts the ceiling ~2×.** Cosine over
   `gemini-embedding-001` (asymmetric doc/query taskType): declined-residual
   **@5 92% / @8 95%** (all-queries @5 90% / @8 95%). It rescues the exact tools
   lexical missed 100% — `municipalityResults` 100%→0% miss@8, `settlementResults`
   100%→33%, `agencyPolls`/`macroIndicator` 100%→17% — because the embedding
   generalizes over the place-name slot ("who won in Dupnitsa") even though the
   entity isn't in the doc. The earlier "entity names need NER not embeddings"
   worry was REFUTED for these.
3. **Don't blindly hybridize.** RRF(lexical, semantic) = **78% @8**, WORSE than
   pure semantic (95%) — lexical is so weak it drags fusion down. Pure semantic
   (or a heavily semantic-weighted blend) wins.
4. **A surprise side-finding: the deterministic rules router returns a WRONG tool
   50.4% of the time on these novel phrasings** (correct 27.9%, declined 21.7%),
   and it wins unconditionally (`webllm.ts:158` returns any non-null rule before
   the model is consulted). So on the dominant failure mode the model is never even
   asked. Caveats: queries are synonym-forced (pessimistic vs easy real traffic),
   and "wrong" is single-label (some sibling tools are acceptable alternates) — so
   50% is an upper bound on true error, but the brittleness + "rules win when
   wrong" structural liability is real.

**Re-ordered roadmap (supersedes the stage list below):**
- **P1 — semantic retriever. ✅ SHIPPED behind the flag 2026-06-17.**
  `ai/llm/semanticRetrieve.ts` (e5-base q8 via transformers.js, dynamic-imported
  lazy chunk) + offline precompute `ai/llm/buildToolVectors.ts` →
  `ai/llm/tool_vectors.json` (125×768, ~790 KB lazy chunk). Wired into
  `webllm.ts:constrainedRoute` (semantic top-k=8, lexical fallback on load
  failure). VERIFIED through the production module: declined-residual recall@8
  **84.7%** (vs lexical 49%); `verify_semantic.ts`. Still gated by
  `model.constrainedRouter` + `localStorage["naiasno:fg-router"]="1"`, so default
  users download none of transformers.js/ORT/vectors. Remaining P1 polish:
  optional UI warm-up (`warmSemanticRetriever`), and live in-browser e2e with the
  FunctionGemma selector (needs WebGPU + both model downloads).
- **P1b — EMBEDDER fine-tune. ✅ PROVEN 2026-06-17 (the headline win).**
  Contrastively fine-tuned `intfloat/multilingual-e5-small` (MNR loss, 2495
  HELD-OUT training queries from `gen_train_data.ts`, 4 epochs on MPS ~5.5 min) →
  `ai/m0/finetune/finetune_embedder.py`, model saved to `ai/m0/finetune/e5-small-naiasno/`.
  Held-out recall (declined residual) jumped **76% → 100% @8** and **68% → 96.9%
  @5** (+23.9pt @8) — so the ~45 MB tuned SMALL model now BEATS generic e5-base
  (87%) AND cloud gemini-embedding-001 (95%) on our 125-tool domain. The retriever
  is no longer the ceiling. CAVEAT: train + eval queries share a Gemini generator
  (different, deduped queries, same STYLE), so the absolute 100% is best-case; a
  truly independent set (real logged / human-written queries) is the honest final
  gate. DEPLOY: ONNX export (optimum) → q8 → host on a public HF repo → point
  `EMBED_MODEL` in `semanticRetrieve.ts` at it (drops e5-base ~110 MB → ~45 MB).
  Retrain when the registry changes (gen_train_data + buildToolVectors + finetune).
  ORIGINAL P1 plan was: Precompute tool-doc vectors offline (ship a static
  JSON); embed only the query at runtime. IN-BROWSER needs a SMALL multilingual
  embedding model (query+docs must share one model). MEASURED 2026-06-17 via
  transformers.js (`/tmp/embtest`, harness in `_export_for_embed.ts`):
  **multilingual-e5-small lands in the MIDDLE** — declined-residual @5 69% / @8 77%
  (vs lexical 44/49, vs gemini-embedding-001 92/95). Two facts: **q8 ≈ fp32**
  (the ~45MB shippable artifact loses ~nothing vs full precision), and a small
  generic embedder leaves an ~18pt gap to cloud. MiniLM-L12 slightly worse (68/72).
  → So the in-browser path is VIABLE (~77%@8 recall, big lift over today) but
  caps end-to-end at ~60–73% (× selector acc), NOT the ~90% cloud delivers. To
  close the gap, the highest-leverage move is **fine-tuning the EMBEDDER**
  (contrastive on the same synthetic query→tool pairs — a 118M encoder is trivial
  to tune and can rival a large generic model), and/or stepping to a bigger generic
  model — MEASURED declined-residual: **e5-base** (~110MB q8) @5 79% / @8 **87%**,
  **bge-m3** (~250–570MB q8) @5 83% / @8 88%. e5-base is the sweet spot (most of the
  gain at ~⅓ the size; bge-m3's +1–4pt isn't worth its download next to the 157MB
  selector). Also free: enrich tool-doc text with the synthetic paraphrases.
  The CLOUD path needs no new model (Gemini already routes well end-to-end).
  NOTE: there are now TWO fine-tune targets — the embedder (lifts recall, the
  binding ceiling) and the FunctionGemma selector (lifts pick-given-recall). Recall
  is the constraint, so the embedder tune is likely higher-leverage than P3.
- **P2 — rules-router confidence gate.** Let low-confidence rule matches yield to
  retrieval+model instead of winning. Bigger end-to-end win than the tune.
- **P3 — the FunctionGemma fine-tune** below — now worth it, because P1 lifts its
  ceiling from ~44% to ~92%. Train candidates from the P1 retriever (not the
  modular-arithmetic distractors in `gen_seed_data.ts`) so train==inference.

## Why (what the eval ladder established)

The `/evals` page now publishes four runs of the **same** untuned
`conceptcodes/txpilot-functiongemma-270m-it-q4f32_1-mlc` build (captures in
`ai/llm/fcEval.captures/`, harness `ai/llm/fcEval.browser.ts`):

| Variant | Routing acc | What it isolates |
|---|---|---|
| k=8, full decl, **free** (baseline) | **0%** | 68% wasm KV-cache traps + 32% garbage |
| k=3, full decl, free | ~1% | traps gone (prompt fits 512-tok window); still garbage |
| k=3, **grammar** (name∈candidates) | **37%** | constrained decode → real picks (vs ~33% chance) |
| k=8 compact + grammar | **18%** | route-among-8 (vs ~12.5% chance); EN 23% > BG 13% |

Conclusion: an untuned 270M already beats chance once you (1) fit the prompt and
(2) constrain decoding — but 37% is **not** shippable, it routes wrong >half the
time, and a real EN>BG gap opens at higher k. The remaining gap is *model
knowledge of our tools*, which is exactly what fine-tuning fixes. Small FC models
routinely reach 80–95% on a fixed tool set after tuning.

The infra to consume a better model is already in the tree:
- retrieval — `ai/llm/retrieve.ts` (`retrieveTools`, fuse.js top-k)
- constrained routing — `WebLLMProvider.constrainedRoute` in `ai/llm/webllm.ts`,
  gated by `ModelOption.constrainedRouter` + `localStorage["naiasno:fg-router"]`
- the eval as an acceptance gate — `run({k, grammar, compact})` in `fcEval.browser.ts`

So the only missing piece is the tuned weights.

## Pipeline (4 stages)

### 1. Synthetic data (local; this repo)

Target: per tool, dozens of EN+BG query paraphrases → the correct call. The
registry already seeds this — each tool has `description` + `examples` (EN/BG) +
typed `params`. Scaffold: `ai/m0/finetune/gen_seed_data.ts` (emits one seed row
per tool/lang in the FunctionGemma chat format). Expand it with:
- **Paraphrase expansion** — for each seed, ask a strong model (Gemini, via the
  existing `GEMINI_API_KEY` / `loadGeminiEnv` pattern) for 10–20 natural EN+BG
  rephrasings, including colloquial Bulgarian and entity-substituted variants
  (party/region/year swaps drawn from real registry values).
- **Hard negatives** — pair each query with the semantically-adjacent tools the
  eval showed it confuses (`nationalResults`↔`machineVoteSeries`,
  `regionWinners`↔`turnoutSeries`, the whole `budget*` cluster) so the model
  learns the boundaries, not just the easy cases.
- **Irrelevance / abstention** — off-topic queries → a `no_tool` sentinel (add it
  to the candidate enum; the eval showed hard-constraining kills abstention).
- **Args** — include `arguments` in the target (the eval measured name-only; the
  app needs args). Validate every synthetic call **executes** against the real
  `runTool` (APIGen-style: drop any example whose target call throws) so the data
  is grounded, not hallucinated.

Format the target as FunctionGemma's native `<start_function_call>{...}<end_function_call>`.

### 2. Train (Colab GPU; Unsloth/LoRA)

270M is tiny — full fine-tune or a small LoRA both fit a free T4. Keep the
native FunctionGemma chat template. Train EN+BG mixed (the EN>BG gap means BG
needs equal or heavier weight). ~3–5 epochs, eval each epoch against stage 3.

### 3. Eval-in-the-loop (this repo, in-browser)

Reuse `fcEval.browser.ts` as the acceptance gate — convert the candidate to MLC
(stage 4), load it, and run `run({k:8, compact:true, grammar:true})`. Ship gate:
routing **≥ ~80% at k=8** AND EN−BG gap **< ~5pt** AND abstention restored
(irrelevance ≥ ~90%). Hold out a NOVEL-phrasing test set (not paraphrases of the
training seeds) — and separately measure **retriever recall on novel queries**:
`retrieveToolNames` currently scores 100% recall on the eval cases, but that's
inflated because the eval queries are the indexed examples. Real recall on unseen
phrasings is the live ceiling and must be measured before trusting the path.

### 4. Convert + host (local; ~5 min, NO recompile)

The community wasm is **config-specific, not weights-specific** (see
`[[project_inbrowser_bg_model]]`), so ANY FunctionGemma-270M weights converted to
MLC `q4f32_1` reuse the EXISTING
`libs/functiongemma-270m-q4f32_1-webgpu.wasm` — no Emscripten compile:

```bash
mlc_llm convert_weight ./ft-functiongemma-270m --quantization q4f32_1 -o ./out
mlc_llm gen_config      ./ft-functiongemma-270m --quantization q4f32_1 \
    --conv-template gemma_instruction -o ./out
# upload ./out + reuse the existing wasm URL; host on HF
```

Keep the `overrides: { context_window_size: -1, attention_sink_size: 0 }` (the
512-token sliding window the wasm was compiled for). If novel-recall or
route-among-many needs more context, the alternative is recompiling the wasm with
a larger `context_window_size` (needs the MLC toolchain — parked, see `PLAN.md`);
compact declarations + retrieval are the cheaper route and likely suffice.

## Integration (this repo; one entry)

Add the HF-hosted tuned build to `MODELS` in `ai/llm/models.ts` (new `model_id`
+ `appConfig`), set `routes: true` and `constrainedRouter: true`, and add the
`no_tool` sentinel to the enum in `WebLLMProvider.constrainedRoute`. The retrieval
+ constrained-decode path then lights up; flip
`localStorage["naiasno:fg-router"]="1"` to A/B it against the rules router before
making it the default gap-filler.

## Open risks

- **Retriever recall on novel queries** (unmeasured — example leakage inflates it).
- **Args extraction** quality (the eval only scored tool selection).
- **512-token window** caps how many candidates/how much description fits — keep
  declarations compact (`buildCompactUser` in `fcEval.browser.ts` is the template).
- **BG parity** — train with ≥ equal Bulgarian weight; gate on the EN−BG gap.
