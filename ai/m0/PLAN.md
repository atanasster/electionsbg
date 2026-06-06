# M0 — execution plan to ship a Bulgarian in-browser model (research 2026-06-06)

> Deep research + live checks (2026-06-06/07) settled it: **pinning a matched
> wheel pair is unavailable on the platforms we use; the reliable unblock is
> build-from-source.** The transformers.js/ONNX alternative (Path B, EuroLLM) was
> tried and **removed** — it OOMs in the browser (see the retired section). So
> there is one live path: **BgGPT-2.6B via MLC/web-llm.** Step-by-step: `colab.md`.

## TL;DR — the live path is BgGPT-2.6B via MLC/web-llm

| | **BgGPT-2.6B via MLC/web-llm** |
|---|---|
| BG quality | Best (Bulgarian-native, Gemma-2 base) |
| Runtime | existing `@mlc-ai/web-llm` (streams q4f16 → WebGPU buffers, caches in IndexedDB) |
| Toolchain | build mlc_llm + TVM from source (pip nightlies are ABI-broken), then `convert_weight`+`gen_config` only — **NO Emscripten/compile** |
| Model artifact | we build + host on a public HF repo (Gemma license) |
| Download | ~1.6 GB |
| Effort | one Colab source build (~30–45 min) + host + flip flags |

**Path B (EuroLLM-1.7B via transformers.js/ONNX) was REMOVED** — see the retired
section below. The rules engine stays the always-on default and a cloud option
exists, so a failed model load never breaks the chat (`ai/llm/webllm.ts` fallback).

## Status of the blocker (corrected)

- MLC's install (`pip install --pre -U ... mlc-llm-nightly mlc-ai-nightly`) has
  **no version pins**, so it always grabs the newest of each — currently the
  ABI-mismatched `mlc_llm 0.20.dev162` (2026-04-21) + `mlc_ai 0.20.dev1070`
  (2026-05-28). `import mlc_llm, tvm` fails — on macOS a `libtvm` missing-symbol
  error (`LogMessage::level_strings_`); **on Colab a C++ `tvm::ffi::Error`
  (`__ffi_repr__ already registered for type index 130`) that ABORTS the kernel**
  — uncatchable by `try/except` ("Session crashed", confirmed 2026-06-07). The
  docs publish **no compatibility table**.
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
- **Pre-converted MLC weights on HF** — none exist for BgGPT (only an unrelated
  `shirman/SmolLM2-1.7B-...-MLC-WEBGPU` as a layout example).

### Cheap pre-checks before any build (60 sec)
1. Re-run the wheel check; if `mlc_llm`'s dev caught up to `mlc_ai`'s, the
   original simple pip install works again and the whole blocker is gone:
   ```bash
   for p in mlc_llm mlc_ai; do echo -n "$p: "; curl -sL https://mlc.ai/wheels \
     | grep -oE "${p}_nightly_cu128-0\.[0-9]+\.dev[0-9]+" | sort -uV | tr '\n' ' '; echo; done
   ```
2. Do NOT "just try importing" the nightlies on Colab to test — the mismatch
   aborts the kernel (C++ FFI error). Judge from the version strings in step 1;
   only if the devs clearly match should you try the pip path.

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

## Path B — EuroLLM-1.7B via transformers.js — RETIRED (removed 2026-06-06)

Built, tested, and **removed** (commit `b74e5947d`). EuroLLM-1.7B via
transformers.js / ONNX Runtime Web downloaded fully (0→100%) but **OOMs creating
the ORT-Web session** (`Can't create a session ... std::bad_alloc`): ORT-Web
parses weights through a memory-capped wasm heap, and every EuroLLM ONNX export is
~1.7–1.9 GB (the 128k vocab keeps even int4 large) — all over the limit. The
~1.9 GB file also exceeds the browser Cache quota (re-downloads every visit). The
`TransformersJsProvider`, the `transformersjs` runtime + `dtype` field, and the
`@huggingface/transformers` dep were all deleted.

transformers.js could still host a **smaller (≤~1 GB) ONNX** model if one is ever
wanted, but for a Bulgarian model web-llm/MLC (Path A) is the route — it streams
q4f16 into WebGPU buffers and caches in IndexedDB, so it handles multi-GB models
without the OOM.

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
- Re-run the wheel check (status moves); the pip path may have self-healed — but
  don't test by importing on Colab (it crashes the kernel); compare version
  strings instead.
- Building from source on Colab: the build cell (LLVM + Rust + ~40 min) is the
  fragile part; confirm it still builds cleanly (TVM mainline churn). `emsdk
  install 3.1.56` is only needed if you ever add the deprioritized 4B compile.
- After upload: flip `ready:true` + uncomment `appConfig` on the BgGPT-2.6B entry,
  then smoke-test routing/narration in a WebGPU browser before deploying.
