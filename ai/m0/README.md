# M0 — compile BgGPT / EuroLLM to MLC (WebGPU) for the in-browser chat

The M3 chat already runs an in-browser model through `@mlc-ai/web-llm`. The
generic test models (Qwen2.5) work today but route Bulgarian poorly. This step
produces **Bulgarian-native** model builds — **BgGPT** (INSAIT, Gemma-2-2.6B) and
**EuroLLM-1.7B** — in the MLC/WebGPU format WebLLM needs, hosts them on
HuggingFace, and wires them into the model picker.

This runs **on your machine** (needs a GPU for a comfortable convert/compile, a
HuggingFace account, and the MLC toolchain). The app repo only ships the recipe.

---

## 1. Prerequisites

```bash
# Python 3.11 env (conda or venv)
conda create -n mlc python=3.11 -y && conda activate mlc

# MLC-LLM + TVM nightly (pick the wheel for your platform):
#   CUDA 12.3:
python -m pip install --pre -U -f https://mlc.ai/wheels \
  mlc-llm-nightly-cu123 mlc-ai-nightly-cu123
#   Apple Silicon (Metal):
#   python -m pip install --pre -U -f https://mlc.ai/wheels mlc-llm-nightly mlc-ai-nightly
#   CPU only (slow convert; compile still fine):
#   python -m pip install --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cpu mlc-ai-nightly-cpu

python -m pip install -U "huggingface_hub[cli]"
huggingface-cli login   # needs a token with read (download) + write (upload)
```

Compiling the **WebGPU `.wasm`** also needs **Emscripten**:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh   # do this in the same shell you run the build from
cd -
```

Sanity check: `mlc_llm --help` and `emcc -v` both work.

> BgGPT is a gated model on some mirrors — accept the license on the
> [model page](https://huggingface.co/INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0)
> first so `huggingface-cli download` succeeds.

## 2. Build

```bash
# from the repo root, with the mlc env + emsdk_env.sh sourced:
ai/m0/build-model.sh bggpt   <your-hf-username>
ai/m0/build-model.sh eurollm <your-hf-username>
```

Each run does: download source → `convert_weight` (q4f16_1) → `gen_config`
(chat template) → `compile --device webgpu` (the `.wasm`). Artifacts land in
`ai/m0/dist/<MLC_ID>/` (gitignored — these are large).

## 3. Host on HuggingFace

The script prints the exact command; e.g.:

```bash
huggingface-cli upload <you>/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC \
  ai/m0/dist/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC . --repo-type model
```

HF hosting is free and is where WebLLM expects MLC model repos, so serving the
weights costs the project nothing.

## 4. Enable in the app

In `ai/llm/models.ts`, set the model's `ready: true` and add the `appConfig`
block (the script prints a ready-to-paste snippet). Then:

```bash
npm run build:ai          # confirms it still builds
npm run dev:ai            # pick "BgGPT 2.6B" in the header on a WebGPU browser
```

Smoke test in the browser:
- the model downloads once (progress bar), then caches in IndexedDB
- ask "Колко гласа взе ДПС на последните избори?" — a Bulgarian-native model
  should now route to `partyResult` (the Qwen test model mis-routed this)
- ask "машинно гласуване в последните 7 избора" — should render the line chart

If routing is still shaky, that's the cue for **M5** (LoRA fine-tune on synthetic
`question → {tool,args}` pairs from the registry), which makes a small model
reliable for this fixed tool surface.

## Troubleshooting

- **`emcc not found` during compile** — `emsdk_env.sh` isn't sourced in this shell.
- **OOM on convert** — use a smaller `--quantization` is not the issue (q4f16_1 is
  already 4-bit); convert on a box with more RAM/VRAM, or use the CPU wheel.
- **Wrong chat template / garbled output** — check the model card's chat template.
  BgGPT → `gemma_instruction`; EuroLLM → try `llama-3`, else inspect its
  `tokenizer_config.json` `chat_template` and pick the closest MLC conv-template
  (`mlc_llm gen_config --help` lists them).
- **404 loading in the browser** — the `model_lib` URL must point at the exact
  `.wasm` filename in your HF repo (use the `…/resolve/main/<file>.wasm` form).
- **Model too big / slow first load** — prefer EuroLLM-1.7B as the lighter default
  and offer BgGPT-2.6B as the higher-quality option.

## Files

- `build-model.sh` — the parameterized convert/compile recipe (bggpt | eurollm)
- `dist/` — build output (gitignored)
- `models/` — local source checkouts (gitignored)
