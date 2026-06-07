# M0 via Google Colab — build BgGPT-2.6B for the in-browser chat

Goal: produce the MLC artifacts WebLLM needs (q4f16_1 weights + `mlc-chat-config.json`)
for **BgGPT-2.6B** and host them on HuggingFace, so the chat can run a Bulgarian
model in-browser. BgGPT-2.6B is a `google/gemma-2-2b` fine-tune, so it **reuses
WebLLM's prebuilt Gemma-2 WebGPU wasm** — no Emscripten/compile, just
`convert_weight` + `gen_config` + `hf upload`. The only hard part is getting a
working `mlc_llm` toolchain.

> ## ⏸ STATUS: PARKED (2026-06-07) — upstream MLC is mid-refactor
> A full Colab attempt got the C++ toolchain to **compile** but could not get a
> clean `import mlc_llm` (details in "Field report" below). Root cause is upstream:
> the published nightlies are an ABI-mismatched pair, and the source tree is mid the
> tvm-ffi packaging migration. **The live Bulgarian path today is the cloud option**
> (Gemini/Gemma via the OpenRouter proxy) — it routes + narrates Bulgarian now, zero
> build. In-browser BgGPT only adds privacy/no-backend.
>
> **Cheapest unblock = wait for a matched nightly pair, then use the short pip
> recipe below (no source build).** Re-check periodically (compare dev numbers —
> do NOT test by importing, that crashes the kernel):
> ```bash
> for p in mlc_llm mlc_ai; do
>   echo -n "$p: "; curl -sL https://mlc.ai/wheels \
>     | grep -oE "${p}_nightly_cu124-0\.[0-9]+\.dev[0-9]+" | sort -uV | tr '\n' ' '; echo
> done
> ```
> When `mlc_llm`'s newest dev ≈ `mlc_ai`'s newest dev (currently dev162 vs dev1070
> — far apart), they've likely republished a matched pair and Path 1 works.

---

## Path 1 (preferred, once nightlies are fixed) — plain pip, no source build

Open https://colab.research.google.com → New notebook (CPU is fine).

```python
!pip install -q -U huggingface_hub
from huggingface_hub import login; login()    # paste a WRITE token

# only run this once the recheck above shows a MATCHED dev pair:
!pip install -q --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cu124 mlc-ai-nightly-cu124
import mlc_llm, tvm; print("toolchain OK", tvm.__version__)   # if this aborts the kernel, the pair is still broken -> Path 2
```

Then the **convert → upload → enable** steps (same as Path 2's Cells 3–4 below).

---

## Path 2 (source build) — FIELD REPORT, currently walls

This is the from-source route for when the nightlies are still broken. As of
2026-06-07 it **compiles** but the Python import walls (see the end). Documented so
a future attempt resumes here instead of rediscovering it.

### Cell 1 — HuggingFace login
Accept the Gemma license first (https://huggingface.co/INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0
→ "Agree and access"), or the download 401s.
```python
!pip install -q -U huggingface_hub
from huggingface_hub import login; login()    # WRITE token
```

### Cell 2 — build mlc_llm + TVM from source (~40 min) — WORKS
Lessons baked in: **LLVM 17** (Colab's apt llvm is 14; TVM needs ≥15), **Rust**
(tokenizers-cpp), **date-pin to the last good nightly era** (HEAD's `3rdparty/tvm`
has no installable `python/setup.py` — it's mid tvm-ffi migration), CPU-only
(convert needs no GPU). This cell compiled `libtvm.so`, `libmlc_llm.so`,
`libtvm_ffi.so` cleanly.
```python
import os
!pip -q uninstall -y mlc-llm-nightly-cu124 mlc-ai-nightly-cu124 mlc-llm-nightly mlc-ai-nightly tvm 2>/dev/null
!wget -q https://apt.llvm.org/llvm.sh && chmod +x llvm.sh && ./llvm.sh 17 >/dev/null 2>&1   # LLVM 17
!apt-get -qq install -y ninja-build cmake >/dev/null
!curl -sSf https://sh.rustup.rs | sh -s -- -y
os.environ["PATH"] = os.path.expanduser("~/.cargo/bin") + ":" + os.environ["PATH"]

%cd /content
!rm -rf mlc-llm
!git clone https://github.com/mlc-ai/mlc-llm.git
%cd /content/mlc-llm
!git checkout $(git rev-list -1 --before="2026-04-22 00:00" HEAD)   # last good-nightly era
!git submodule update --init --recursive
os.makedirs("build", exist_ok=True)
with open("build/config.cmake", "w") as f:
    f.write(
        "set(CMAKE_BUILD_TYPE RelWithDebInfo)\n"
        "set(USE_CUDA OFF)\nset(USE_METAL OFF)\nset(USE_VULKAN OFF)\nset(USE_OPENCL OFF)\n"
        'set(USE_LLVM "llvm-config-17 --link-static")\n'
        "set(HIDE_PRIVATE_SYMBOLS ON)\n"
    )
!cd build && cmake .. -G Ninja && cmake --build . --parallel
print("build done — libs in /content/mlc-llm/build")
```

### Cell 2b — wire up the Python packages — ⛔ WALLS HERE
HEAD/this-checkout has no installable `tvm` setup.py, so we wire `tvm`+`mlc_llm`
via PYTHONPATH and pip-install only `tvm_ffi` (for its compiled `core`). This is
where it currently fails:
```python
import os, sys
ROOT = "/content/mlc-llm"
# tvm_ffi needs its compiled core; install from the submodule
!pip install -q "$ROOT/3rdparty/tvm/3rdparty/tvm-ffi"
sys.path = [p for p in sys.path if "tvm-ffi" not in p]   # don't shadow the built core with source
roots = [f"{ROOT}/3rdparty/tvm/python", f"{ROOT}/python"]
os.environ["TVM_LIBRARY_PATH"]   = f"{ROOT}/build/tvm"
os.environ["MLC_LLM_SOURCE_DIR"] = ROOT
os.environ["TVM_SOURCE_DIR"]     = f"{ROOT}/3rdparty/tvm"
os.environ["PYTHONPATH"] = ":".join(roots)
for p in roots:
    if p not in sys.path: sys.path.insert(0, p)
import tvm_ffi   # ✅ works (site-packages, has core)
import tvm       # ⛔ FAILS: ValueError: Cannot find object type index for script.PrinterConfig
import mlc_llm
```

**Why it walls (diagnosed):**
1. **FFI registry split** — three `libtvm_ffi.so` exist (mlc-llm `build/lib/`, the
   tvm-ffi sub-build, and the pip wheel's `site-packages/tvm_ffi/lib/`). The wheel's
   `core` links the site-packages copy; our `libtvm.so` links `build/lib`. Separate
   instances ⇒ separate type registries.
2. **Python↔native skew** — worse, `strings build/tvm/libtvm.so | grep script.PrinterConfig`
   returns **0**: the compiled `libtvm.so` doesn't even contain the type the Python
   `tvm` tries to register. The 2026-04-20 commit is mid the tvm-ffi packaging
   migration, so the Python and C++ layers don't line up. Unifying the FFI libs
   would not fix this skew.

**Untried next step if resuming:** re-pin to a **pre**-tvm-ffi-refactor commit
(late 2025) where TVM's Python is the classic `python/setup.py` (no split). The
q4f16_1 output is still compatible with web-llm 0.2.84, so an older toolchain is
fine. If that also stalls, wait for Path 1.

### Cell 3 — convert + gen_config  (runs once Cell 2b prints a working `mlc_llm`)
```python
MLC_ID = "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC"
!hf download INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0 --local-dir bggpt
!python -m mlc_llm convert_weight bggpt --quantization q4f16_1 -o dist/$MLC_ID
!python -m mlc_llm gen_config bggpt --quantization q4f16_1 \
    --conv-template gemma_instruction --prefill-chunk-size 1024 \
    --context-window-size 4096 -o dist/$MLC_ID
!ls -la dist/$MLC_ID   # ~1.6 GB params + mlc-chat-config.json + tokenizer
```

### Cell 4 — upload to your HF account (public repo)
```python
!hf upload atanasster/$MLC_ID dist/$MLC_ID . --repo-type model
```

### Then enable it (back in this repo)
On the **BgGPT 2.6B** entry in `ai/llm/models.ts`: set `ready: true`, uncomment its
pre-filled `appConfig` (`atanasster/...` weights + the prebuilt Gemma-2 wasm pinned
to web-llm 0.2.84), set `sizeNote` to `~1.6 GB`. Then `npm run build:ai &&
npm run deploy:ai`. Smoke test (WebGPU browser): "Колко гласа взе ДПС на последните
избори?" → should route to `partyResult`.

## Part B — BgGPT 4B (Gemma 3) — DEPRIORITIZED
Multimodal, needs a WebGPU compile (no prebuilt gemma3-4b wasm), and Gemma-3 is
broken on ONNX/WebGPU. Prefer BgGPT-2.6B. See `ai/m0/PLAN.md`.
