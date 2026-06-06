# M0 via Google Colab

> ## ⛔ The UNPINNED MLC pip path is BLOCKED as of 2026-06-06 — but build-from-source works. See [`PLAN.md`](./PLAN.md).
>
> The unpinned install grabs the newest of each package and they are
> **ABI-incompatible**:
> - `mlc-llm-nightly-cuXXX` → `0.20.dev162`, built **2026-04-21**
> - `mlc-ai-nightly-cuXXX`  → `0.20.dev1070`, built **2026-05-28**
>
> `mlc-llm`'s bundled `libmlc_llm.so` needs the symbol
> `tvm::runtime::detail::LogMessage::level_strings_`, which the newer `mlc-ai`
> runtime **removed**. So `import mlc_llm` fails — `libtvm.so: cannot open` on
> Linux/Colab, a missing-symbol error on macOS.
>
> **CORRECTION (deep research 2026-06-06):** "wait for upstream" is the wrong plan.
> Pinning a matched pair is *unavailable* on the platforms we build on — arm64-mac
> and Colab/Linux only publish the broken pair; the retained older wheels are
> Intel-mac-only. The reliable unblock is **build mlc_llm + TVM Unity from source**
> (a single matched checkout makes the Cell-3+ commands below work), or skip MLC
> and ship **EuroLLM via transformers.js**. Both paths, with commands, are in
> **[`PLAN.md`](./PLAN.md)**. The quick cells below assume a working `import
> mlc_llm` — source-build it first, then run them.
>
> Quick check (run locally) — if `mlc-llm`'s dev catches up to `mlc-ai`'s, the
> unpinned install may have self-healed:
> ```bash
> for p in mlc_llm mlc_ai; do
>   echo -n "$p: "; curl -sL https://mlc.ai/wheels \
>     | grep -oE "${p}_nightly_cu128-0\.20\.dev[0-9]+" | sort -u | tr '\n' ' '; echo
> done
> ```
> Or just re-run Cell 1 in Colab: if `import mlc_llm` succeeds, you're unblocked.
> Meanwhile the chat app ships fully functional on the rules engine + the Qwen
> test model — BgGPT is an enhancement, not a blocker.

The reliable path (once unblocked) is a **free Colab GPU**, where the CUDA wheels
are the maintained target.

There are two BgGPT targets (we ship **both** — light default + current model):

- **Part A — BgGPT 2.6B (Gemma 2):** the light default, **no compile** (reuses
  WebLLM's prebuilt Gemma-2 wasm). ~1.6 GB. Do this first — it's quick.
- **Part B — BgGPT 4B (Gemma 3):** the current INSAIT line, the heavier optional
  pick. Gemma-3's smallest BgGPT is 4B and there's **no prebuilt gemma3-4b wasm**,
  so this one **compiles** a WebGPU library (Emscripten) and hosts it next to the
  weights. ~2.7 GB.

Open https://colab.research.google.com → New notebook → Runtime → Change runtime
type → **T4 GPU**.

## Part A — BgGPT 2.6B (Gemma 2), no compile

### Cell 1 — install the MLC toolchain (CUDA, in-sync pair)

```python
!pip install -q -U "huggingface_hub"
!pip install -q --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cu124 mlc-ai-nightly-cu124
import mlc_llm, tvm   # must import cleanly; if it errors on libtvm, report back
print("mlc_llm + tvm OK")
```

### Cell 2 — log in to HuggingFace (paste a WRITE token)

```python
from huggingface_hub import login
login()   # token from https://huggingface.co/settings/tokens (write scope)
```

### Cell 3 — download + convert + gen_config (BgGPT, q4f16_1)

```python
MLC_ID = "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC"
!hf download INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 --local-dir bggpt
!python -m mlc_llm convert_weight bggpt --quantization q4f16_1 -o dist/$MLC_ID
!python -m mlc_llm gen_config bggpt --quantization q4f16_1 \
    --conv-template gemma_instruction --prefill-chunk-size 1024 \
    --context-window-size 4096 -o dist/$MLC_ID
!ls -la dist/$MLC_ID
```

### Cell 4 — upload the weights to your HF account

```python
!hf upload atanasster/$MLC_ID dist/$MLC_ID . --repo-type model
print("done -> https://huggingface.co/atanasster/" + MLC_ID)
```

### Then enable it (back in this repo)

In `ai/llm/models.ts`, on the **BgGPT 2.6B (Gemma 2)** entry: set `ready: true`,
uncomment its `appConfig` block (pre-filled with `atanasster/...` + the prebuilt
Gemma-2 `model_lib` URL pinned to web-llm 0.2.84), and change its `sizeNote` to
`~1.6 GB сваляне` / `~1.6 GB download`. Then:

```bash
npm run build:ai && npm run deploy:ai     # ships it to ai.electionsbg.com
```

Smoke test in a WebGPU browser: pick "BgGPT 2.6B (Gemma 2)", ask
"Колко гласа взе ДПС на последните избори?" → should route to `partyResult`.

## Part B — BgGPT 4B (Gemma 3), with compile

Same notebook (Cells 1–2 already done). This one **compiles** a `gemma3-4b`
WebGPU library because none is prebuilt, so it needs Emscripten.

### Cell B1 — install Emscripten (for the WebGPU compile)

```python
import os
!git clone https://github.com/emscripten-core/emsdk.git
!cd emsdk && ./emsdk install latest && ./emsdk activate latest
# put emcc on PATH for the rest of the notebook
emsdk = "/content/emsdk"
os.environ["PATH"] = f"{emsdk}:{emsdk}/upstream/emscripten:" + os.environ["PATH"]
os.environ["EMSDK"] = emsdk
!source emsdk/emsdk_env.sh && emcc --version   # should print a version, not "not found"
```

(The TVM/MLC wasm runtime the WebGPU target links against ships inside the
`mlc-ai-nightly-cu124` wheel installed in Cell 1 — no extra install needed.)

### Cell B2 — download + convert + gen_config + compile (gemma3-4b)

```python
MLC_ID4 = "BgGPT-Gemma-3-4B-IT-q4f16_1-MLC"
!hf download INSAIT-Institute/BgGPT-Gemma-3-4B-IT --local-dir bggpt4
!python -m mlc_llm convert_weight bggpt4 --quantization q4f16_1 -o dist/$MLC_ID4
!python -m mlc_llm gen_config bggpt4 --quantization q4f16_1 \
    --conv-template gemma3_instruction --prefill-chunk-size 1024 \
    --context-window-size 4096 -o dist/$MLC_ID4
# compile the WebGPU library (emcc must be on PATH from Cell B1)
!source emsdk/emsdk_env.sh && python -m mlc_llm compile \
    dist/$MLC_ID4/mlc-chat-config.json --device webgpu \
    -o dist/$MLC_ID4/$MLC_ID4-webgpu.wasm
!ls -la dist/$MLC_ID4
```

### Cell B3 — upload weights **and** the compiled .wasm together

```python
# uploading the whole dir publishes the wasm at .../resolve/main/<MLC_ID4>-webgpu.wasm
!hf upload atanasster/$MLC_ID4 dist/$MLC_ID4 . --repo-type model
print("done -> https://huggingface.co/atanasster/" + MLC_ID4)
```

### Then enable it (back in this repo)

In `ai/llm/models.ts`, on the **BgGPT 4B (Gemma 3)** entry: set `ready: true`,
uncomment its `appConfig` block (pre-filled — `model_lib` points at the compiled
wasm on your HF repo), and change its `sizeNote` to `~2.7 GB сваляне` /
`~2.7 GB download`. Rebuild + deploy as above. It appears as a second option in
the model dropdown next to the 2.6B.

## Part C — EuroLLM 1.7B (optional, lightest)

EuroLLM-1.7B-Instruct (utter-project) is a `LlamaForCausalLM` trained on all 24 EU
languages incl. Bulgarian — the **lightest** option (~1.1 GB). Not Bulgarian-native
like BgGPT, but small and fast. No prebuilt 1.7B lib, so it **compiles** too —
reuses the Emscripten install from **Cell B1** (run that first if you skipped Part
B). Chat format is **ChatML** → conv template `chatml`.

### Cell C1 — download + convert + gen_config + compile (EuroLLM)

```python
MLC_IDE = "EuroLLM-1.7B-Instruct-q4f16_1-MLC"
!hf download utter-project/EuroLLM-1.7B-Instruct --local-dir eurollm
!python -m mlc_llm convert_weight eurollm --quantization q4f16_1 -o dist/$MLC_IDE
!python -m mlc_llm gen_config eurollm --quantization q4f16_1 \
    --conv-template chatml --prefill-chunk-size 1024 \
    --context-window-size 4096 -o dist/$MLC_IDE
# compile the WebGPU library (emcc must be on PATH from Cell B1)
!source emsdk/emsdk_env.sh && python -m mlc_llm compile \
    dist/$MLC_IDE/mlc-chat-config.json --device webgpu \
    -o dist/$MLC_IDE/$MLC_IDE-webgpu.wasm
!ls -la dist/$MLC_IDE
```

### Cell C2 — upload weights + the compiled .wasm together

```python
!hf upload atanasster/$MLC_IDE dist/$MLC_IDE . --repo-type model
print("done -> https://huggingface.co/atanasster/" + MLC_IDE)
```

### Then enable it (back in this repo)

In `ai/llm/models.ts`, on the **EuroLLM 1.7B** entry: set `ready: true`, uncomment
its `appConfig` (pre-filled), and set `sizeNote` to `~1.1 GB сваляне` /
`~1.1 GB download`. Rebuild + deploy. If generation doesn't stop cleanly, check
that `chatml`'s `stop_token_ids` matches EuroLLM's `<|im_end|>` token id in the
generated `mlc-chat-config.json` and adjust.

---

Notes
- **CUDA tag:** the MLC index only publishes specific CUDA builds (as of
  2026-06: `cu124`, `cu128`, `cu130` — there is no `cu123`). `cu124` is the safe
  pick for a Colab T4. If Cell 1 ever fails with "No matching distribution found
  for mlc-llm-nightly-cuXXX", open https://mlc.ai/wheels and use a tag that's
  actually listed.
- Part A: ~5 GB source download + a few minutes to quantize on a T4. Output in
  `dist/<MLC_ID>` is ~1.6 GB q4f16_1 — that's what gets uploaded.
- Part B: the 4B source is larger and the compile adds a few minutes; the wasm is
  small (a few MB) and rides along in the same HF repo as the weights (~2.7 GB).
- If `mlc_llm compile` can't find the wasm runtime, run
  `!python -c "import mlc_llm, tvm; print(tvm.__file__)"` and confirm the
  cu124 wheels installed; the webgpu target ships with the nightly.
- If `import mlc_llm` fails in Cell 1 with a `libtvm` symbol error, the CUDA
  nightlies are temporarily out of sync; wait a day or pin to the last
  known-good dated pair from https://mlc.ai/wheels.
- Both recipes work locally once the macOS wheels are fixed:
  `ai/m0/build-model.sh bggpt atanasster` (no compile) and
  `ai/m0/build-model.sh bggpt3 atanasster` (needs a local Emscripten;
  auto-uses `ai/m0/.venv`).
