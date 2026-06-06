# M0 — execution plan to ship a Bulgarian in-browser model (research 2026-06-06)

> This supersedes the "pinning cannot fix it, wait for upstream" framing in
> `README.md` / `colab.md`. Deep research + live checks on **2026-06-06**
> corrected the picture: **pinning is not just unverified, it is unavailable on
> the platforms we use; the reliable unblock is build-from-source — or skip MLC
> entirely via transformers.js.** Pick ONE path below and execute.

## TL;DR — two live paths, pick one

| | **Path A — BgGPT-2.6B via MLC/web-llm** | **Path B — EuroLLM-1.7B via transformers.js** |
|---|---|---|
| BG quality | Best (Bulgarian-native, Gemma-2 base) | Good (multilingual, not BG-native) |
| Runtime | existing `@mlc-ai/web-llm` engine | NEW engine — ONNX Runtime Web (`@huggingface/transformers`) |
| Needs the broken MLC pip? | yes, but only `convert_weight`+`gen_config` (no Emscripten) | **no — bypasses MLC entirely** |
| Model artifact | we build + host on HF (Gemma license) | **already public** (`flackzz/...`, Apache-2.0, q4) |
| Download | ~1.6 GB | ~1.9 GB (q4) |
| First-ship effort | medium — one Colab source build + host + flip flags | medium — one new provider file + a dep; no Python at all |

The rules engine stays the always-on default; a model is an enhancement, so a
failed model load never breaks the chat (see `ai/llm/webllm.ts` fallback).

## Status of the blocker (corrected)

- MLC's install (`pip install --pre -U ... mlc-llm-nightly mlc-ai-nightly`) has
  **no version pins**, so it always grabs the newest of each — currently the
  ABI-mismatched `mlc_llm 0.20.dev162` (2026-04-21) + `mlc_ai 0.20.dev1070`
  (2026-05-28). `import mlc_llm` fails (`libtvm` missing symbol
  `LogMessage::level_strings_`). The docs publish **no compatibility table**.
  Refs: <https://llm.mlc.ai/docs/install/mlc_llm>,
  <https://github.com/mlc-ai/mlc-llm/issues/3382> (lead confirms project is
  active, WebGPU supported — it's the TVM-refactor churn that broke the wheels).

### Dead paths — do not spend time here
- **Pinned matched wheel pair.** Verified at the index: for **macOS arm64** AND
  **Linux/Colab x86_64**, only the broken `dev1070`+`dev162` pair is published.
  The retained older wheels (`mlc_ai dev562`, `mlc_llm dev95`) are **macOS Intel
  x86_64 only** — unreachable natively on this Mac or on Colab. So pinning is both
  unverified (ABI) and unavailable on every platform we'd build on.
- **Docker / conda matched toolchain** — no verified working tag found.
- **Pre-converted MLC weights on HF** — none exist for BgGPT or EuroLLM (only an
  unrelated `shirman/SmolLM2-1.7B-...-MLC-WEBGPU` as a layout example).

### Cheap pre-checks before any build (60 sec)
1. Re-run the wheel check; if `mlc_llm`'s dev caught up to `mlc_ai`'s, the
   original simple pip install works again and the whole blocker is gone:
   ```bash
   for p in mlc_llm mlc_ai; do echo -n "$p: "; curl -sL https://mlc.ai/wheels \
     | grep -oE "${p}_nightly_cu128-0\.[0-9]+\.dev[0-9]+" | sort -uV | tr '\n' ' '; echo; done
   ```
2. (low confidence) empirically try the pinned install once; if `import mlc_llm`
   succeeds you got lucky and can skip the source build.

## Path A — BgGPT-2.6B via MLC (best Bulgarian)

Same as the old "Part A", with the **toolchain fixed to build-from-source**.
BgGPT-2.6B reuses the prebuilt `gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm` already
in web-llm v0.2.84, so there is **NO Emscripten / no `compile` step** — you only
need a working `mlc_llm` to run `convert_weight` + `gen_config`.

1. **Build a matched mlc_llm + TVM Unity from source** (Colab T4, ~30–60 min).
   Follow the official from-source build (a single checkout keeps TVM ↔ mlc_llm
   ABI matched): <https://github.com/mlc-ai/mlc-llm/blob/main/docs/install/tvm.rst>
   and <https://llm.mlc.ai/docs/compilation/compile_models.html>. Export
   `TVM_SOURCE_DIR=.../3rdparty/tvm` and `MLC_LLM_SOURCE_DIR=.../mlc-llm`. Verify
   with `python -c "import mlc_llm, tvm; print('ok')"`. (Emscripten NOT needed for
   2.6B — skip the wasm build env.)
2. **Convert + config + host** (unchanged from `build-model.sh bggpt` / colab
   Part A):
   ```bash
   MLC_ID=BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC
   hf download INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 --local-dir bggpt
   python -m mlc_llm convert_weight bggpt --quantization q4f16_1 -o dist/$MLC_ID
   python -m mlc_llm gen_config bggpt --quantization q4f16_1 \
     --conv-template gemma_instruction --prefill-chunk-size 1024 \
     --context-window-size 4096 -o dist/$MLC_ID
   hf upload atanasster/$MLC_ID dist/$MLC_ID . --repo-type model
   ```
3. **Enable** in `ai/llm/models.ts`: on the BgGPT-2.6B entry set `ready:true`,
   uncomment the (already pre-filled) `appConfig` (weights = your HF repo,
   `model_lib` = the pinned prebuilt Gemma-2 wasm), set `sizeNote` to `~1.6 GB`.
   Then `npm run build:ai && npm run deploy:ai`. Smoke test in a WebGPU browser:
   "Колко гласа взе ДПС на последните избори?" → should route to `partyResult`.

License/hosting: BgGPT is **`gemma`** license — re-hosting a quantized derivative
is permitted; attach the Gemma Terms (<https://ai.google.dev/gemma/terms>) on the
HF repo. Source is public + ungated; your conversion must be a **public** HF repo
(the browser fetches weights with no auth).

## Path B — EuroLLM-1.7B via transformers.js (fastest, MLC-free)

No Python, no Colab, no HF re-hosting. The artifact already exists:
**`flackzz/EuroLLM-1.7B-Instruct-ONNX`** — Apache-2.0, public, ungated,
transformers.js layout (`config.json`+`tokenizer.json` at root, `onnx/model_q4.onnx`,
`onnx/chat_template.jinja`). Llama arch, so it is NOT hit by the Gemma-3 WebGPU
bug. All work is in-app:

1. **Add the dep:** `@huggingface/transformers` (v3) in the ai build. Confirm Vite
   serves the ORT-Web wasm/worker assets (may need to allowlist `.onnx`/`.wasm`
   in `vite.config.ai.ts` and not prune them).
2. **New provider** `ai/llm/transformersjs.ts` implementing the same
   `LLMProvider` interface as `ai/llm/webllm.ts` (mirror its structure exactly —
   deterministic `route()` first, `runTool()`, `narrate()` template, language
   guard, streaming `onDelta`). Init:
   ```ts
   import { pipeline } from "@huggingface/transformers";
   const gen = await pipeline("text-generation",
     "flackzz/EuroLLM-1.7B-Instruct-ONNX",
     { dtype: "q4", device: "webgpu", progress_callback });
   ```
   Build ChatML messages, apply the chat template, generate with **stop on
   `<|im_end|>`** (set `eos_token_id` explicitly — the card's `fp16` example is
   wrong; there is no fp16 file, use `q4`).
3. **Wire it into the picker:** add a `runtime: "webllm" | "transformersjs"`
   discriminator to `ModelOption` in `models.ts` and branch in `App.tsx` provider
   construction (WebLLMProvider vs TransformersJsProvider). Add the EuroLLM entry
   with `ready:true`, `routes:false` to start (narration-only) — promote to
   `routes:true` once routing quality is confirmed. WebGPU-gate it like the others.

Gotchas: ChatML stop token (above); `q4` is ~1.9 GB (heavier than an ideal
`q4f16`, which this repo does not ship); first load compiles ORT-Web shaders
(slow first run, cached after). EuroLLM is Apache-2.0 → no redistribution
constraints.

## Deprioritized — BgGPT-4B (Gemma-3)

Three strikes, do not pursue for this task: (a) it is a **multimodal
`image-text-to-text`** model (text-only use is awkward); (b) needs a full
Emscripten WebGPU `compile` (no prebuilt gemma3-4b wasm); (c) **Gemma-3 is
confirmed broken on ONNX/WebGPU** — fp16 activation overflow → garbage output,
JSEP crash (<https://github.com/microsoft/onnxruntime/issues/26732>,
<https://github.com/huggingface/transformers.js/issues/1469>), so the easy
runtime is closed to it too. ~2.7 GB / ~4 GB VRAM.

## Future model-eval candidates (not needed now)
- **BgGPT-3** shipped (<https://models.bggpt.ai/blog/bggpt-3-release-en/>).
- **Tucan 2.6B**, a Bulgarian model (<https://ollama.com/s_emanuilov/tucan:2.6b>).
- Newer **Gemma 4** carries Apache-2.0. Re-evaluate when one has a web-ready
  q4f16 ONNX or a prebuilt web-llm wasm.

## Open items to verify at execution time
- Re-run the wheel check (status moves); the original pip path may have self-healed.
- If building from source on Colab: confirm the current `docs/install/tvm.rst`
  steps still build cleanly (TVM mainline churn); pin `emsdk install 3.1.56` only
  if you ever add the 4B/EuroLLM-on-MLC compile.
- Path B: confirm `@huggingface/transformers` v3 + ORT-Web WebGPU actually runs
  `flackzz` `q4` in the target browsers; validate EuroLLM Bulgarian narration
  quality on a few real questions before flipping `routes:true`.
