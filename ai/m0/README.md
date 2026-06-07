# M0 — build BgGPT for the in-browser chat

Produces the MLC artifacts WebLLM needs and hosts them on HuggingFace so the
model picker can run a **Bulgarian-native** model fully in the browser. Runs on
your machine.

**We ship two BgGPT variants** (light default + current model):

| target | base | compile? | size | notes |
|--------|------|----------|------|-------|
| `bggpt`  | BgGPT v1.0 = `google/gemma-2-2b` fine-tune | **no** — reuses WebLLM's prebuilt Gemma-2 wasm | ~1.6 GB | light default; build this first |
| `bggpt3` | BgGPT 2.0 = `google/gemma-3-4b` fine-tune | **yes** — `mlc_llm compile --device webgpu` (Emscripten) | ~2.7 GB | current INSAIT line; no prebuilt gemma3-4b wasm exists, so we compile one and host it next to the weights |

INSAIT's Gemma-3 line starts at **4B** (no 1B/2B), so the Gemma-3 path can't reuse
the prebuilt `gemma3-1b` lib (wasm libs are shape-specific). In this app the model
only **routes to a tool + narrates** — it never produces numbers — so the lighter
2.6B is genuinely sufficient; the 4B is a deprioritized option (multimodal + needs
a compile — see PLAN.md). Build `bggpt` (2.6B) first; it needs no compile.

> **⛔ As of 2026-06-06 the unpinned MLC pip path is BLOCKED.** The install grabs
> the newest of each unpinned package and they are ABI-incompatible:
> `mlc-llm-nightly` = `0.20.dev162` (built 2026-04-21) needs a TVM symbol
> (`...LogMessage::level_strings_`) that `mlc-ai-nightly` = `0.20.dev1070`
> (built 2026-05-28) removed. So `import mlc_llm` fails (`libtvm.so: cannot open`
> on Linux/Colab, missing-symbol on macOS).
>
> Worse, on Colab `import mlc_llm, tvm` doesn't fail gracefully — the dev162/dev1070
> mismatch throws a C++ `tvm::ffi::Error` (`__ffi_repr__ already registered`) that
> aborts the kernel ("Session crashed"), uncatchable by `try/except`. **Do not run
> the pip-nightly cell.**
>
> **STATUS: PARKED (2026-06-07).** Pinning an older matched pair is unavailable on
> the platforms we build on (arm64-mac and Colab/Linux only publish the broken
> pair; the retained older wheels are Intel-mac-only). A full from-source Colab
> build was attempted: it **compiles** (`libtvm.so`/`libmlc_llm.so` build with LLVM
> 17 + a date-pinned checkout) but can't produce a clean `import mlc_llm` — the
> source tree is mid the **tvm-ffi packaging migration** (FFI registry split +
> Python↔native type skew). Full field report + resume notes in
> **[`ai/m0/colab.md`](./colab.md)** and **[`ai/m0/PLAN.md`](./PLAN.md)**.
>
> **What to do now:** the live in-browser/no-backend Bulgarian path is deferred.
> The chat ships a working Bulgarian model via the **cloud** option (Gemini/Gemma
> through the OpenRouter proxy) plus the always-on rules engine.
> When MLC republishes a **matched** nightly pair, BgGPT becomes a ~5-min
> `pip install` + `convert_weight` + `gen_config` (no source build) — re-check the
> dev numbers per `colab.md` before trying.

## 0. One-time setup (already done on this machine)

A Python venv with the MLC toolchain + HF CLI lives at `ai/m0/.venv` (gitignored):

```bash
python3 -m venv ai/m0/.venv
ai/m0/.venv/bin/pip install -U "huggingface_hub"
ai/m0/.venv/bin/pip install --pre -U -f https://mlc.ai/wheels \
  mlc-llm-nightly-cpu mlc-ai-nightly-cpu     # macOS arm64 (Metal) wheels
```

Activate it for the session:

```bash
source ai/m0/.venv/bin/activate
```

## 1. Log in to HuggingFace

Confirm your account email first (HF won't let you push otherwise), then create a
**write** token at https://huggingface.co/settings/tokens and:

```bash
hf auth login          # paste the write token
```

## 2a. Build BgGPT 2.6B (Gemma 2) — no compile

```bash
ai/m0/build-model.sh bggpt atanasster
```

Downloads BgGPT v1.0, runs `convert_weight` (q4f16_1) + `gen_config`
(`gemma_instruction`, prefill-chunk 1024 to match the prebuilt lib), and prints
the upload command + the `models.ts` snippet. Output → `ai/m0/dist/<MLC_ID>/`
(gitignored). ~10–20 min, mostly download + quantize; CPU/Metal.

Host it (HF is free and is where WebLLM expects MLC repos):

```bash
hf upload atanasster/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC \
  ai/m0/dist/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC . --repo-type model
```

## 2b. Build BgGPT 4B (Gemma 3) — needs Emscripten

Gemma-3's smallest BgGPT is 4B and no prebuilt gemma3-4b wasm exists, so this
target compiles a WebGPU library. Install Emscripten once, then build:

```bash
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh && cd -
ai/m0/build-model.sh bggpt3 atanasster   # convert + gen_config + compile (gemma3_instruction)
```

Host the weights **and** the compiled `.wasm` together (the upload publishes the
wasm at `.../resolve/main/<MLC_ID>-webgpu.wasm`, which is the `model_lib` URL):

```bash
hf upload atanasster/BgGPT-Gemma-3-4B-IT-q4f16_1-MLC \
  ai/m0/dist/BgGPT-Gemma-3-4B-IT-q4f16_1-MLC . --repo-type model
```

> On macOS the local build is currently blocked by the out-of-sync MLC wheels
> (see the warning above) — use **Colab Part B** in [`colab.md`](./colab.md), which
> installs Emscripten + the CUDA wheels in one notebook.

## 3. Enable in the app

In `ai/llm/models.ts`, on each entry you built: set `ready: true`, uncomment its
`appConfig` (pre-filled — the 2.6B reuses the prebuilt Gemma-2 lib; the 4B points
at your HF-hosted compiled wasm), and set its `sizeNote` to the real download size
(`~1.6 GB` / `~2.7 GB`). Then:

```bash
npm run build:ai
npm run dev:ai        # pick "BgGPT 2.6B (Gemma 2)" or "BgGPT 4B (Gemma 3)"
```

Smoke test (WebGPU browser): ask "Колко гласа взе ДПС на последните избори?" —
BgGPT should route to `partyResult`. Then deploy: `npm run deploy:ai`.

> EuroLLM-1.7B was evaluated and **removed** (2026-06-06): every EuroLLM ONNX
> export is ~1.7–1.9 GB, which OOMs ORT-Web's wasm heap (`std::bad_alloc`), and the
> MLC route needs a compile. For an in-browser Bulgarian model, BgGPT-2.6B (above)
> is the pick. See `ai/m0/PLAN.md`.

## Troubleshooting

- **`hf: command not found`** — activate the venv (`source ai/m0/.venv/bin/activate`).
- **download 401/403 on BgGPT** — accept the license on the model page while
  logged in, then retry.
- **WebLLM "model lib mismatch" in the browser** — for the 2.6B the
  prefill-chunk-size / quant must match the prebuilt lib (q4f16_1, cs1k=1024); for
  the 4B the wasm is your own, so just make sure `gen_config` and `compile` used
  the same config. Rebuild with the flags above.
- **OOM during convert** — close other apps; q4f16_1 is already 4-bit.
- If the prebuilt Gemma-2 lib URL 404s, bump the `v0_2_84` segment to the
  installed `@mlc-ai/web-llm` version.
- **4B is sluggish / OOM in the browser** — it needs ~4 GB VRAM; on weaker GPUs
  prefer the 2.6B. The chat always falls back to the deterministic router, so a
  failed model load never breaks answers.

## Files

- `build-model.sh` — convert/(compile)/host recipe (`bggpt` | `bggpt3`)
- `colab.md` — Colab notebook (Part A = 2.6B no-compile; Part B = 4B, deprioritized)
- `.venv/`, `dist/`, `models/` — toolchain + build output + source (gitignored)
