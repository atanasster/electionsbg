#!/usr/bin/env bash
#
# M0 — compile a Bulgarian-native model to MLC (WebGPU) for the in-browser chat.
#
# Produces the quantized weights + the WebGPU `.wasm` model library that
# @mlc-ai/web-llm loads. Run on a machine with the MLC toolchain installed
# (see ai/m0/README.md). The compile/convert run on your side — this repo only
# ships the recipe.
#
# Usage:
#   ai/m0/build-model.sh bggpt   [HF_USER]
#   ai/m0/build-model.sh eurollm [HF_USER]
#
# HF_USER (optional) is your HuggingFace username, used only to print the upload
# command + the models.ts snippet at the end.

set -euo pipefail

MODEL_KEY="${1:-}"
HF_USER="${2:-<your-hf-username>}"
QUANT="q4f16_1"
CTX="4096"

case "$MODEL_KEY" in
  bggpt)
    HF_SRC="INSAIT-Institute/BgGPT-Gemma-2-2.6B-IT-v1.0"
    MLC_ID="BgGPT-Gemma-2-2.6B-IT-${QUANT}-MLC"
    # BgGPT is Gemma-2 based -> the gemma chat template
    CONV_TEMPLATE="gemma_instruction"
    ;;
  eurollm)
    HF_SRC="utter-project/EuroLLM-1.7B-Instruct"
    MLC_ID="EuroLLM-1.7B-Instruct-${QUANT}-MLC"
    # EuroLLM is Llama-architecture; confirm/adjust the template vs the model card
    CONV_TEMPLATE="llama-3"
    ;;
  *)
    echo "usage: $0 bggpt|eurollm [HF_USER]" >&2
    exit 1
    ;;
esac

command -v mlc_llm >/dev/null 2>&1 || {
  echo "ERROR: mlc_llm not found. See ai/m0/README.md for installation." >&2
  exit 1
}

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="${ROOT}/models/${MODEL_KEY}"        # local HF checkout
OUT_DIR="${ROOT}/dist/${MLC_ID}"             # MLC artifacts (weights + config + wasm)
WASM="${MLC_ID}-webgpu.wasm"

echo "==> model:        ${HF_SRC}"
echo "==> mlc id:       ${MLC_ID}"
echo "==> quantization: ${QUANT}  template: ${CONV_TEMPLATE}  ctx: ${CTX}"
mkdir -p "${SRC_DIR}" "${OUT_DIR}"

# 0. fetch the source model (skips if already present)
if [ ! -f "${SRC_DIR}/config.json" ]; then
  echo "==> [0/4] downloading ${HF_SRC} ..."
  huggingface-cli download "${HF_SRC}" --local-dir "${SRC_DIR}"
fi

# 1. quantize/convert weights -> MLC format
echo "==> [1/4] convert_weight ..."
mlc_llm convert_weight "${SRC_DIR}" --quantization "${QUANT}" -o "${OUT_DIR}"

# 2. generate the chat config + copy tokenizer
echo "==> [2/4] gen_config ..."
mlc_llm gen_config "${SRC_DIR}" \
  --quantization "${QUANT}" \
  --conv-template "${CONV_TEMPLATE}" \
  --context-window-size "${CTX}" \
  -o "${OUT_DIR}"

# 3. compile the WebGPU model library (.wasm)
echo "==> [3/4] compile (webgpu) ..."
mlc_llm compile "${OUT_DIR}/mlc-chat-config.json" \
  --device webgpu \
  -o "${OUT_DIR}/${WASM}"

echo "==> [4/4] done. Artifacts in ${OUT_DIR}"
echo
echo "Next:"
echo "  # upload weights + wasm to a HuggingFace model repo"
echo "  huggingface-cli upload ${HF_USER}/${MLC_ID} ${OUT_DIR} . --repo-type model"
echo
echo "Then enable it in ai/llm/models.ts (set ready:true, add appConfig):"
cat <<SNIPPET

  {
    id: "${MLC_ID}",
    label: { bg: "${MODEL_KEY}", en: "${MODEL_KEY}" },
    sizeNote: { bg: "локален модел", en: "on-device model" },
    ready: true,
    appConfig: {
      model_list: [
        {
          model: "https://huggingface.co/${HF_USER}/${MLC_ID}/resolve/main",
          model_id: "${MLC_ID}",
          model_lib:
            "https://huggingface.co/${HF_USER}/${MLC_ID}/resolve/main/${WASM}",
        },
      ],
    },
  },
SNIPPET
