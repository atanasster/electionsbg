# M0 — build BgGPT (and optionally EuroLLM) for the in-browser chat

Produces the MLC artifacts WebLLM needs and hosts them on HuggingFace so the
header model picker can run a **Bulgarian-native** model instead of the Qwen test
model. Runs on your machine.

**Key shortcut:** BgGPT is a `google/gemma-2-2b` fine-tune, so it **reuses
WebLLM's prebuilt Gemma-2 WebGPU library** — you only convert + host the weights.
**No Emscripten, no GPU compile.** (EuroLLM has no prebuilt lib and would need a
compile; do BgGPT first.)

> **⚠️ As of 2026-06, the macOS MLC pip wheels are out-of-sync upstream**
> (`mlc-ai` and `mlc-llm` nightlies built against different TVM ABIs →
> `import mlc_llm` fails with a `libtvm.dylib` symbol error). **Use the Colab
> path: [`ai/m0/colab.md`](./colab.md)** — free GPU, in-sync CUDA wheels, ~15 min.
> The local steps below work once the mac wheels are fixed (`ai/m0/.venv` is
> already set up).

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

## 2. Build BgGPT (no compile)

```bash
ai/m0/build-model.sh bggpt atanasster
```

This downloads BgGPT, runs `convert_weight` (q4f16_1) + `gen_config`
(`gemma_instruction`, prefill-chunk 1024 to match the prebuilt lib), and prints
the upload command + the `models.ts` snippet. Output → `ai/m0/dist/<MLC_ID>/`
(gitignored). Takes ~10–20 min, mostly the download + quantize; runs on
CPU/Metal.

## 3. Host the weights on HuggingFace

```bash
hf upload atanasster/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC \
  ai/m0/dist/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC . --repo-type model
```

HF hosting is free and is where WebLLM expects MLC repos — zero serving cost.

## 4. Enable it in the app

In `ai/llm/models.ts`, on the BgGPT entry: set `ready: true` and uncomment the
`appConfig` (already pre-filled with your repo + the prebuilt Gemma-2 `model_lib`
URL pinned to web-llm 0.2.84). Then:

```bash
npm run build:ai
npm run dev:ai        # pick "BgGPT 2.6B" in the header (WebGPU browser)
```

Smoke test: ask "Колко гласа взе ДПС на последните избори?" — BgGPT should route
to `partyResult` (the Qwen test model mis-routed this). Then deploy:
`npm run deploy:ai`.

## EuroLLM (optional, needs Emscripten)

EuroLLM-1.7B has no prebuilt lib, so it needs a `mlc_llm compile --device webgpu`,
which requires Emscripten:

```bash
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh && cd -
ai/m0/build-model.sh eurollm atanasster   # convert + gen_config + compile
hf upload atanasster/EuroLLM-1.7B-Instruct-q4f16_1-MLC ai/m0/dist/EuroLLM-1.7B-Instruct-q4f16_1-MLC . --repo-type model
```

Then wire its entry in `models.ts` (the script prints the snippet, with the local
compiled `.wasm` as `model_lib`).

## Troubleshooting

- **`hf: command not found`** — activate the venv (`source ai/m0/.venv/bin/activate`).
- **download 401/403 on BgGPT** — accept the license on the model page while
  logged in, then retry.
- **WebLLM "model lib mismatch" in the browser** — the prefill-chunk-size / quant
  must match the prebuilt lib (q4f16_1, cs1k=1024). Rebuild with the flags above.
- **OOM during convert** — close other apps; q4f16_1 is already 4-bit.
- If the prebuilt Gemma-2 lib URL 404s, bump the `v0_2_84` segment to the
  installed `@mlc-ai/web-llm` version.

## Files

- `build-model.sh` — convert/(compile)/host recipe (`bggpt` | `eurollm`)
- `.venv/`, `dist/`, `models/` — toolchain + build output + source (gitignored)
