# Fine-tuning FunctionGemma-270M to route the Наясно tools (in-browser)

> Status: PLAN (2026-06-08). The fc-eval ladder on `/evals` proved the *mechanism*
> works on the UNTUNED community build — this doc is the path from ~37% to usable.
> Training itself needs a GPU (Colab/Unsloth); everything else here runs locally.

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
