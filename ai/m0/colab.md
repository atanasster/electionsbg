# M0 via Google Colab — build BgGPT-2.6B for the in-browser chat

Produces the MLC artifacts WebLLM needs (quantized weights + `mlc-chat-config.json`)
and hosts them on HuggingFace so the chat's model picker can run **BgGPT-2.6B**
(Bulgarian-native) in the browser. BgGPT-2.6B is a `google/gemma-2-2b` fine-tune,
so it **reuses WebLLM's prebuilt Gemma-2 WebGPU library** — there is **NO compile**
(no Emscripten). You only `convert_weight` + `gen_config` + `hf upload`.

> ## ⛔ Do NOT use the pip nightly path — it crashes the Colab kernel
> The unpinned install grabs `mlc-llm-nightly` (`0.20.dev162`, 2026-04-21) +
> `mlc-ai-nightly` (`0.20.dev1070`, 2026-05-28). These two halves are
> **ABI-incompatible** and `import mlc_llm, tvm` aborts the process:
> ```
> terminate called after throwing an instance of 'tvm::ffi::Error'
>   what():  TypeAttr `__ffi_repr__` is already registered for type index 130 ...
> ```
> It's a C++ `terminate()` (hard SIGABRT), so a Python `try/except` can NOT catch
> it — the whole kernel dies ("Session crashed"). **Confirmed on Colab T4,
> 2026-06-07.** Pinning a matched pair is *not possible* here either: Colab/Linux
> publishes only the broken pair on every CUDA/CPU tag (the retained older wheels
> are Intel-mac-only).
>
> **The fix is to build mlc_llm + TVM from one matched source checkout** (Cell 2
> below). A `git clone --recursive` is internally consistent by construction (the
> pinned TVM submodule matches mlc_llm), so it sidesteps the dev162/dev1070 break.
>
> Optional re-check (the nightlies are a moving target): compare the published
> dev numbers WITHOUT importing — if `mlc-llm`'s dev has caught up to `mlc-ai`'s,
> upstream may have republished a matched pair and the pip path could work again:
> ```bash
> for p in mlc_llm mlc_ai; do
>   echo -n "$p: "; curl -sL https://mlc.ai/wheels \
>     | grep -oE "${p}_nightly_cu124-0\.[0-9]+\.dev[0-9]+" | sort -uV | tr '\n' ' '; echo
> done
> ```

The chat ships fully functional without BgGPT (rules engine + Qwen test model +
the cloud option), so this is an enhancement, not a blocker.

Open https://colab.research.google.com → New notebook. Runtime type: **CPU is
fine** — we don't compile and `convert_weight`/`gen_config` don't need a GPU.

## Part A — BgGPT 2.6B (Gemma 2), no compile

### Cell 1 — log in to HuggingFace (paste a WRITE token)

First **accept the Gemma license** on the source page while logged in
(https://huggingface.co/INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 → "Agree and
access"), or the download 401s. Create a **write** token at
https://huggingface.co/settings/tokens, then:

```python
!pip install -q -U huggingface_hub
from huggingface_hub import login
login()   # paste the WRITE token
```

### Cell 2 — build mlc_llm + TVM from source (~30–45 min)

Do NOT run a `pip install ... mlc-llm-nightly` cell — it crashes the kernel (see
the warning above). Build from source instead. CPU-only is enough. Keep the tab
active (Colab disconnects idle tabs).

```python
import os
# remove any broken nightlies if a previous cell installed them
!pip -q uninstall -y mlc-llm-nightly-cu124 mlc-ai-nightly-cu124 mlc-llm-nightly mlc-ai-nightly tvm 2>/dev/null
# build deps: LLVM (TVM codegen) + Rust/cargo (tokenizers-cpp) + ninja
!apt-get -qq update && apt-get -qq install -y llvm-dev cmake ninja-build >/dev/null
!curl -sSf https://sh.rustup.rs | sh -s -- -y
os.environ["PATH"] = os.path.expanduser("~/.cargo/bin") + ":" + os.environ["PATH"]

%cd /content
!rm -rf mlc-llm
!git clone --recursive https://github.com/mlc-ai/mlc-llm.git
os.makedirs("/content/mlc-llm/build", exist_ok=True)
with open("/content/mlc-llm/build/config.cmake", "w") as f:
    f.write(
        "set(CMAKE_BUILD_TYPE RelWithDebInfo)\n"
        "set(USE_CUDA OFF)\nset(USE_METAL OFF)\nset(USE_VULKAN OFF)\nset(USE_OPENCL OFF)\n"
        'set(USE_LLVM "llvm-config --link-static")\n'
        "set(HIDE_PRIVATE_SYMBOLS ON)\n"
    )
!cd /content/mlc-llm/build && cmake .. -G Ninja && ninja

os.environ["MLC_LLM_SOURCE_DIR"] = "/content/mlc-llm"
os.environ["TVM_SOURCE_DIR"] = "/content/mlc-llm/3rdparty/tvm"
!cd /content/mlc-llm/3rdparty/tvm/python && pip install -q -e .
!cd /content/mlc-llm/python && pip install -q -e .
import mlc_llm, tvm
print("✅ SOURCE BUILD OK — tvm", tvm.__version__)
```

### Cell 3 — download + convert + gen_config (BgGPT, q4f16_1)

`prefill-chunk-size 1024` matches the prebuilt `gemma-2-2b-it ... cs1k` wasm the
app reuses, so the lib stays compatible.

```python
MLC_ID = "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC"
!hf download INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 --local-dir bggpt
!python -m mlc_llm convert_weight bggpt --quantization q4f16_1 -o dist/$MLC_ID
!python -m mlc_llm gen_config bggpt --quantization q4f16_1 \
    --conv-template gemma_instruction --prefill-chunk-size 1024 \
    --context-window-size 4096 -o dist/$MLC_ID
!ls -la dist/$MLC_ID   # ~1.6 GB params + mlc-chat-config.json + tokenizer files
```

### Cell 4 — upload the weights to your HF account (public repo)

```python
!hf upload atanasster/$MLC_ID dist/$MLC_ID . --repo-type model
print("done -> https://huggingface.co/atanasster/" + MLC_ID)
```

### Then enable it (back in this repo)

In `ai/llm/models.ts`, on the **BgGPT 2.6B (Gemma 2)** entry: set `ready: true`,
uncomment its `appConfig` block (pre-filled with `atanasster/...` + the prebuilt
Gemma-2 `model_lib` URL pinned to web-llm 0.2.84), and set its `sizeNote` to
`~1.6 GB сваляне` / `~1.6 GB download`. Then:

```bash
npm run build:ai && npm run deploy:ai     # ships it to ai.electionsbg.com
```

Smoke test in a WebGPU browser: pick "BgGPT 2.6B (Gemma 2)", ask
"Колко гласа взе ДПС на последните избори?" → should route to `partyResult`.

## Part B — BgGPT 4B (Gemma 3) — DEPRIORITIZED

Not recommended (see `ai/m0/PLAN.md`): the 4B is a **multimodal** image-text model,
it has **no prebuilt gemma3-4b wasm** so it needs a WebGPU **compile** (Emscripten),
and Gemma-3 is broken on the easy ONNX/WebGPU runtimes. If you still want it: after
Cell 2 (source build), additionally install Emscripten, then convert with
`--conv-template gemma3_instruction` and run `python -m mlc_llm compile
dist/<id>/mlc-chat-config.json --device webgpu -o dist/<id>/<id>-webgpu.wasm`
(needs `emcc` on PATH and the wasm runtime from the source build), and upload the
weights **and** the `.wasm` together. Prefer BgGPT-2.6B.

---

Notes
- **Why source build, not pip:** the published nightlies are a mismatched pair
  (dev162 vs dev1070) and importing them aborts the kernel. A single recursive
  checkout is matched by construction. Re-check the dev numbers (snippet at top)
  before building — if upstream republished a matched pair, plain
  `pip install --pre -f https://mlc.ai/wheels mlc-llm-nightly-cu124 mlc-ai-nightly-cu124`
  may work again and you can skip Cell 2.
- **Build cell is the fragile part:** ~30–45 min on free Colab (2 vCPU). It pulls
  LLVM + Rust + ninja. If `cmake`/`ninja` errors, it's usually a missing apt dep or
  an LLVM version mismatch — paste the output and adjust `config.cmake`.
- **convert is cheap:** ~5 GB source download + a few minutes to quantize on CPU.
  Output in `dist/<MLC_ID>` is ~1.6 GB q4f16_1 — that's what gets uploaded.
- **`hf` vs `huggingface-cli`:** recent `huggingface_hub` ships the `hf` CLI used
  above; on older versions use `huggingface-cli download/upload` instead.
- **Local build** is also possible once `cmake`/`rustc`/`llvm` are installed on the
  machine (the macOS pip wheels remain ABI-broken): same source-build recipe, then
  `ai/m0/build-model.sh bggpt atanasster` for the convert + host steps.
