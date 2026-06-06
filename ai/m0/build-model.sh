#!/usr/bin/env bash
#
# M0 — produce the MLC artifacts a Bulgarian-native model needs for the
# in-browser chat (@mlc-ai/web-llm).
#
#   bggpt   : BgGPT v1.0 (google/gemma-2-2b fine-tune). NO compile — reuses
#             WebLLM's prebuilt Gemma-2 WebGPU library; you only convert + host
#             the quantized weights. (Emscripten NOT required.) ~1.6 GB.
#   bggpt3  : BgGPT 2.0 (google/gemma-3-4b fine-tune). Gemma-3 is WebGPU-capable
#             but has NO prebuilt 4b lib -> needs `mlc_llm compile` (Emscripten).
#             Host the compiled .wasm next to the weights on HF. ~2.7 GB.
#             DEPRIORITIZED (multimodal + Gemma-3 web issues — see PLAN.md).
#
# Usage:
#   source ai/m0/.venv/bin/activate    # (or the script auto-detects the venv)
#   ai/m0/build-model.sh bggpt   <HF_USER>   # no compile
#   ai/m0/build-model.sh bggpt3  <HF_USER>   # compile (Emscripten)

set -euo pipefail

MODEL_KEY="${1:-}"
HF_USER="${2:-<your-hf-username>}"
QUANT="q4f16_1"

ROOT="$(cd "$(dirname "$0")" && pwd)"
# prefer the local venv if present; mlc_llm is invoked as `python -m mlc_llm`
# (the wheels don't install a console script)
PY="python3"
[ -x "${ROOT}/.venv/bin/python" ] && PY="${ROOT}/.venv/bin/python"
HF="hf"
[ -x "${ROOT}/.venv/bin/hf" ] && HF="${ROOT}/.venv/bin/hf"

# WebLLM v0.2.84 prebuilt Gemma-2-2B WebGPU library (pinned to the installed
# @mlc-ai/web-llm version). BgGPT reuses this — no compile.
GEMMA2_LIB="https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm"

case "$MODEL_KEY" in
  bggpt)
    HF_SRC="INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0"
    MLC_ID="BgGPT-Gemma-2-2.6B-IT-${QUANT}-MLC"
    CONV_TEMPLATE="gemma_instruction"
    REUSE_LIB="$GEMMA2_LIB"      # <- skips compile
    ;;
  bggpt3)
    HF_SRC="INSAIT-Institute/BgGPT-Gemma-3-4B-IT"
    MLC_ID="BgGPT-Gemma-3-4B-IT-${QUANT}-MLC"
    CONV_TEMPLATE="gemma3_instruction"   # gemma3 (NOT gemma_instruction)
    REUSE_LIB=""                  # <- no prebuilt gemma3-4b lib -> compile (Emscripten)
    ;;
  *)
    echo "usage: $0 bggpt|bggpt3 [HF_USER]" >&2
    exit 1
    ;;
esac

"$PY" -c "import mlc_llm" >/dev/null 2>&1 || { echo "ERROR: mlc_llm not importable. macOS pip wheels are currently out-of-sync — use the Colab path (ai/m0/colab.md)." >&2; exit 1; }
command -v "$HF" >/dev/null 2>&1 || { echo "ERROR: hf (huggingface_hub) not found. See ai/m0/README.md." >&2; exit 1; }

SRC_DIR="${ROOT}/models/${MODEL_KEY}"
OUT_DIR="${ROOT}/dist/${MLC_ID}"
WASM="${MLC_ID}-webgpu.wasm"
mkdir -p "${SRC_DIR}" "${OUT_DIR}"

echo "==> model ${HF_SRC}  ->  ${MLC_ID}  (${QUANT}, ${CONV_TEMPLATE})"

# 0. fetch source model
if [ ! -f "${SRC_DIR}/config.json" ]; then
  echo "==> [0] download ${HF_SRC}"
  "$HF" download "${HF_SRC}" --local-dir "${SRC_DIR}"
fi

# 1. quantize weights
echo "==> [1] convert_weight"
"$PY" -m mlc_llm convert_weight "${SRC_DIR}" --quantization "${QUANT}" -o "${OUT_DIR}"

# 2. chat config + tokenizer. prefill-chunk-size 1024 matches the prebuilt
#    gemma-2 'cs1k' library so the reused lib is compatible.
echo "==> [2] gen_config"
"$PY" -m mlc_llm gen_config "${SRC_DIR}" \
  --quantization "${QUANT}" \
  --conv-template "${CONV_TEMPLATE}" \
  --prefill-chunk-size 1024 \
  --context-window-size 4096 \
  -o "${OUT_DIR}"

# 3. compile only when there's no prebuilt lib to reuse
if [ -z "${REUSE_LIB}" ]; then
  command -v emcc >/dev/null 2>&1 || { echo "ERROR: emcc (Emscripten) required to compile ${MODEL_KEY}. See ai/m0/README.md." >&2; exit 1; }
  echo "==> [3] compile (webgpu)"
  "$PY" -m mlc_llm compile "${OUT_DIR}/mlc-chat-config.json" --device webgpu -o "${OUT_DIR}/${WASM}"
  MODEL_LIB_URL="https://huggingface.co/${HF_USER}/${MLC_ID}/resolve/main/${WASM}"
else
  echo "==> [3] skipped — reusing prebuilt Gemma-2 library"
  MODEL_LIB_URL="${REUSE_LIB}"
fi

echo "==> done. Artifacts: ${OUT_DIR}"
echo
echo "Upload the weights to HuggingFace:"
echo "  ${HF} upload ${HF_USER}/${MLC_ID} ${OUT_DIR} . --repo-type model"
echo
echo "Then enable in ai/llm/models.ts (set ready:true + this appConfig):"
cat <<SNIPPET

    appConfig: {
      model_list: [
        {
          model: "https://huggingface.co/${HF_USER}/${MLC_ID}",
          model_id: "${MLC_ID}",
          model_lib: "${MODEL_LIB_URL}",
        },
      ],
    },
SNIPPET
