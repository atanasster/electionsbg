// M3 — selectable in-browser models for the WebLLM provider.
//
// "prebuilt" models load straight from MLC's CDN and work today (used to prove
// the pipeline). BgGPT / EuroLLM are the on-brand Bulgarian-native targets but
// need a one-time MLC compile + HF hosting — see ai/m0/README.md +
// ai/m0/build-model.sh. To enable one: run the build, host on HF, then set
// ready:true and paste the appConfig the script prints. Until then they show as
// "requires MLC build".

import type { AppConfig } from "@mlc-ai/web-llm";

export type ModelOption = {
  id: string; // WebLLM model_id
  label: { bg: string; en: string };
  sizeNote: { bg: string; en: string };
  ready: boolean; // false => requires the M0 compile before it can load
  appConfig?: AppConfig; // for custom (HF-hosted) models
  // May this model SELECT tools? Only Bulgarian-capable models should. The Qwen
  // test models mis-route (e.g. a "compare elections" question -> machine-voting
  // series), so they narrate only and routing stays deterministic. BgGPT/EuroLLM
  // are trusted to fill routing gaps the rules decline.
  routes?: boolean;
};

export const MODELS: ModelOption[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 1.5B (тест)", en: "Qwen2.5 1.5B (test)" },
    sizeNote: { bg: "~1.1 GB сваляне", en: "~1.1 GB download" },
    ready: true,
    routes: false, // test model: narration only, deterministic routing
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 3B (тест)", en: "Qwen2.5 3B (test)" },
    sizeNote: { bg: "~2 GB сваляне", en: "~2 GB download" },
    ready: true,
    routes: false, // test model: narration only, deterministic routing
  },
  {
    // BgGPT v1.0 (a google/gemma-2-2b fine-tune) — the LIGHT default. Reuses
    // WebLLM's prebuilt Gemma-2 WebGPU library, so M0 only converts + hosts the
    // weights (NO compile, ~1.6 GB). After `hf upload`, flip ready:true,
    // uncomment appConfig, and set sizeNote to "~1.6 GB сваляне"/"~1.6 GB download".
    // Build: ai/m0/build-model.sh bggpt atanasster   (or Colab Part A).
    id: "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    label: { bg: "BgGPT 2.6B (Gemma 2)", en: "BgGPT 2.6B (Gemma 2)" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    ready: false,
    routes: true, // Bulgarian-capable -> may fill routing gaps the rules decline
    // appConfig: {
    //   model_list: [
    //     {
    //       model:
    //         "https://huggingface.co/atanasster/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    //       model_id: "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    //       model_lib:
    //         "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm",
    //     },
    //   ],
    // },
  },
  {
    // BgGPT 2.0 (a google/gemma-3-4b fine-tune) — the CURRENT line, heavier
    // optional pick. Gemma-3's arch IS WebGPU-supported (a gemma3-1b lib is
    // prebuilt) but there is NO prebuilt gemma3-4b wasm, so M0 must COMPILE one
    // (mlc_llm compile --device webgpu, needs Emscripten — Colab Part B) and host
    // it next to the weights on HF. ~2.7 GB download / ~4 GB VRAM. After upload,
    // flip ready:true, uncomment appConfig, set sizeNote to the download size.
    // Build: ai/m0/build-model.sh bggpt3 atanasster   (or Colab Part B).
    id: "BgGPT-Gemma-3-4B-IT-q4f16_1-MLC",
    label: { bg: "BgGPT 4B (Gemma 3)", en: "BgGPT 4B (Gemma 3)" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    ready: false,
    routes: true, // Bulgarian-capable -> may fill routing gaps the rules decline
    // appConfig: {
    //   model_list: [
    //     {
    //       model:
    //         "https://huggingface.co/atanasster/BgGPT-Gemma-3-4B-IT-q4f16_1-MLC",
    //       model_id: "BgGPT-Gemma-3-4B-IT-q4f16_1-MLC",
    //       model_lib:
    //         "https://huggingface.co/atanasster/BgGPT-Gemma-3-4B-IT-q4f16_1-MLC/resolve/main/BgGPT-Gemma-3-4B-IT-q4f16_1-MLC-webgpu.wasm",
    //     },
    //   ],
    // },
  },
  {
    // EuroLLM-1.7B-Instruct (utter-project) — LlamaForCausalLM, multilingual
    // across all 24 EU languages incl. Bulgarian. The LIGHTEST option (~1.1 GB).
    // ChatML format -> conv template "chatml". No prebuilt 1.7B lib, so M0 must
    // COMPILE a WebGPU wasm (Emscripten) and host it next to the weights — same
    // path as BgGPT 4B. After upload, flip ready:true, uncomment appConfig, set
    // sizeNote to the download size.
    // Build: ai/m0/build-model.sh eurollm atanasster   (or Colab Part C).
    id: "EuroLLM-1.7B-Instruct-q4f16_1-MLC",
    label: { bg: "EuroLLM 1.7B", en: "EuroLLM 1.7B" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    ready: false,
    routes: true, // Bulgarian-capable -> may fill routing gaps the rules decline
    // appConfig: {
    //   model_list: [
    //     {
    //       model:
    //         "https://huggingface.co/atanasster/EuroLLM-1.7B-Instruct-q4f16_1-MLC",
    //       model_id: "EuroLLM-1.7B-Instruct-q4f16_1-MLC",
    //       model_lib:
    //         "https://huggingface.co/atanasster/EuroLLM-1.7B-Instruct-q4f16_1-MLC/resolve/main/EuroLLM-1.7B-Instruct-q4f16_1-MLC-webgpu.wasm",
    //     },
    //   ],
    // },
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const modelById = (id: string): ModelOption | undefined =>
  MODELS.find((m) => m.id === id);
