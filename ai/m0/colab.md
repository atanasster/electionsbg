# M0 via Google Colab (recommended)

The macOS MLC pip wheels are currently out-of-sync upstream (the `mlc-ai` and
`mlc-llm` nightlies are built against different TVM ABIs, so `import mlc_llm`
fails with a `libtvm.dylib` symbol error). The reliable path is a **free Colab
GPU**, where the CUDA wheels are the maintained, in-sync target.

Convert BgGPT once, host the weights on HuggingFace, then wire `models.ts`. No
Emscripten — BgGPT reuses WebLLM's prebuilt Gemma-2 WebGPU library.

Open https://colab.research.google.com → New notebook → Runtime → Change runtime
type → **T4 GPU**. Then run these cells.

### Cell 1 — install the MLC toolchain (CUDA, in-sync pair)

```python
!pip install -q -U "huggingface_hub"
!pip install -q --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cu123 mlc-ai-nightly-cu123
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

### Then, back in this repo

In `ai/llm/models.ts`, on the BgGPT entry: set `ready: true` and uncomment the
`appConfig` block (already pre-filled with `atanasster/...` + the prebuilt
Gemma-2 `model_lib` URL pinned to web-llm 0.2.84). Then:

```bash
npm run build:ai && npm run deploy:ai     # ships BgGPT to ai.electionsbg.com
```

Smoke test in a WebGPU browser: pick "BgGPT 2.6B", ask
"Колко гласа взе ДПС на последните избори?" → should route to `partyResult`.

---

Notes
- ~5 GB source download + a few minutes to quantize on a T4. The output in
  `dist/<MLC_ID>` is small (~1.6 GB q4f16_1) — that's what gets uploaded.
- If `import mlc_llm` fails in Cell 1 with the same `libtvm` symbol error, the
  CUDA nightlies are temporarily out of sync too; wait a day or pin to the last
  known-good dated pair from https://mlc.ai/wheels.
- Same recipe works locally once the macOS wheels are fixed:
  `ai/m0/build-model.sh bggpt atanasster` (auto-uses `ai/m0/.venv`).
