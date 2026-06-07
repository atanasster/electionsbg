# M0 — execution plan to ship a Bulgarian in-browser model (research 2026-06-06)

> Deep research + live checks + a full Colab build attempt (2026-06-06/07) settled
> it. **STATUS: PARKED.** The pip nightlies are an ABI-mismatched pair (and no
> matched pair is pinnable on Colab/Linux); a from-source build *compiles* but can't
> produce a clean `import mlc_llm` because the source tree is mid the tvm-ffi
> packaging migration (full field report in `colab.md`). Path B (EuroLLM via
> transformers.js) was tried and **removed** (OOMs). So **the live Bulgarian path
> today is the cloud option** (Gemini/Gemma via the OpenRouter proxy). In-browser
> BgGPT is deferred until MLC republishes a matched nightly pair — then it's a
> ~5-min pip + convert (no source build); re-check the dev numbers per `colab.md`.

## TL;DR — in-browser target (currently DEFERRED) is BgGPT-2.6B via MLC/web-llm

| | **BgGPT-2.6B via MLC/web-llm** |
|---|---|
| BG quality | Best (Bulgarian-native, Gemma-2 base) |
| Runtime | existing `@mlc-ai/web-llm` (streams q4f16 → WebGPU buffers, caches in IndexedDB) |
| No compile | reuses the prebuilt `gemma-2-2b-it-q4f16_1` wasm — only `convert_weight`+`gen_config` needed |
| Model artifact | we build + host on a public HF repo (Gemma license) |
| Download | ~1.6 GB |
| **Status** | **blocked on the MLC toolchain** — pip nightlies broken; source build compiles but the Python import walls (`colab.md`). Unblocks to a ~5-min pip+convert when a matched nightly pair ships. |

**Path B (EuroLLM-1.7B via transformers.js/ONNX) was REMOVED** — see the retired
section below. Today's working Bulgarian model is the **cloud** option; the rules
engine stays the always-on default, so a failed model load never breaks the chat.

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

## Path A — BgGPT-2.6B via MLC (deferred; field report)

BgGPT-2.6B reuses the prebuilt `gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm` in web-llm
v0.2.84, so there is **NO Emscripten / no `compile`** — you only need a working
`mlc_llm` to run `convert_weight` + `gen_config`. The blocker is getting that
toolchain. What the Colab attempt (2026-06-07) established, so the next try resumes
from here (full cells in `colab.md`):

1. **Source build — COMPILES.** Pin the checkout to the last good-nightly era
   (`git checkout $(git rev-list -1 --before="2026-04-22" HEAD)` + recursive
   submodules), install **LLVM 17** (Colab's apt llvm is 14; TVM needs ≥15) +
   **Rust** (tokenizers-cpp) + ninja, `config.cmake` with `USE_LLVM
   "llvm-config-17"` + `USE_CUDA OFF` (CPU is enough). This builds `libtvm.so`,
   `libmlc_llm.so`, `libtvm_ffi.so` cleanly.
2. **Python import — WALLS.** `import tvm` fails with `Cannot find object type
   index for script.PrinterConfig`. Two causes: (a) the FFI registry is split
   across three `libtvm_ffi.so` copies (build/lib vs the pip-wheel's
   site-packages); (b) worse, `strings libtvm.so | grep script.PrinterConfig` = 0
   — the compiled lib doesn't contain the type the Python layer registers, i.e. a
   Python↔native skew because the 2026-04-20 commit is mid the tvm-ffi packaging
   migration. Unifying the FFI libs would not fix the skew.
   - **Untried resume option:** re-pin to a **pre**-tvm-ffi-refactor commit (late
     2025) with the classic `python/setup.py` layout; q4f16_1 output still loads in
     web-llm 0.2.84. If that stalls too, wait for Path 1 (matched nightly).
3. **Convert + config + host** (works once `import mlc_llm` succeeds — unchanged
   from `build-model.sh bggpt` / colab):
   ```bash
   MLC_ID=BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC
   hf download INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 --local-dir bggpt
   python -m mlc_llm convert_weight bggpt --quantization q4f16_1 -o dist/$MLC_ID
   python -m mlc_llm gen_config bggpt --quantization q4f16_1 \
     --conv-template gemma_instruction --prefill-chunk-size 1024 \
     --context-window-size 4096 -o dist/$MLC_ID
   hf upload atanasster/$MLC_ID dist/$MLC_ID . --repo-type model
   ```
4. **Enable** in `ai/llm/models.ts`: on the BgGPT-2.6B entry set `ready:true`,
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
