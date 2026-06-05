// M3 — selectable in-browser models for the WebLLM provider.
//
// "prebuilt" models load straight from MLC's CDN and work today (used to prove
// the pipeline). BgGPT / EuroLLM are the on-brand Bulgarian-native targets but
// need a one-time MLC compile + HF hosting (the M0 spike); until their URLs are
// filled in they're shown as "needs build".

import type { AppConfig } from "@mlc-ai/web-llm";

export type ModelOption = {
  id: string; // WebLLM model_id
  label: { bg: string; en: string };
  sizeNote: { bg: string; en: string };
  ready: boolean; // false => requires the M0 compile before it can load
  appConfig?: AppConfig; // for custom (HF-hosted) models
};

export const MODELS: ModelOption[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 1.5B (тест)", en: "Qwen2.5 1.5B (test)" },
    sizeNote: { bg: "~1.1 GB сваляне", en: "~1.1 GB download" },
    ready: true,
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 3B (тест)", en: "Qwen2.5 3B (test)" },
    sizeNote: { bg: "~2 GB сваляне", en: "~2 GB download" },
    ready: true,
  },
  {
    // INSAIT BgGPT (Gemma-2-2.6B based). Fill in once compiled to MLC + hosted.
    id: "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    label: { bg: "BgGPT 2.6B", en: "BgGPT 2.6B" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    ready: false,
    // appConfig: {
    //   model_list: [{
    //     model: "https://huggingface.co/<you>/BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    //     model_id: "BgGPT-Gemma-2-2.6B-IT-q4f16_1-MLC",
    //     model_lib: "https://huggingface.co/<you>/.../gemma-2-2b-it-q4f16_1-ctx4k.wasm",
    //   }],
    // },
  },
  {
    id: "EuroLLM-1.7B-Instruct-q4f16_1-MLC",
    label: { bg: "EuroLLM 1.7B", en: "EuroLLM 1.7B" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    ready: false,
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const modelById = (id: string): ModelOption | undefined =>
  MODELS.find((m) => m.id === id);
