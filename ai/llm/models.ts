import type { AppConfig } from "@mlc-ai/web-llm";

// Short capability tags surfaced as chips on each model card. The picker maps
// these to bilingual labels (ai/app/ModelPicker.tsx) so the registry stays
// language-neutral.
export type ModelTag = "bg-native" | "routes" | "fast" | "multimodal" | "cloud";

export type ModelOption = {
  id: string; // WebLLM model_id (in-browser), or the OpenRouter model id (cloud)
  label: { bg: string; en: string };
  // The full size/availability note. For downloadable models it's a one-time
  // download size; for unavailable ones it's the reason ("requires MLC build").
  sizeNote: { bg: string; en: string };
  // The bare download size ("~1.1 GB") shown on the Download button + card. Only
  // set for models that can actually load today; omit for unavailable ones.
  size?: { bg: string; en: string };
  // Approximate WebGPU memory the loaded model needs — shown so a user on a
  // weaker machine knows what they're committing to before downloading.
  vramNote?: { bg: string; en: string };
  // One-line "what it's good at", shown under the title on the card.
  advantage: { bg: string; en: string };
  tags?: ModelTag[];
  // Flags the on-brand default once it's loadable — gets a "Recommended" ribbon.
  recommended?: boolean;
  ready: boolean; // false => requires the M0 compile before it can load
  // Which engine runs this model. "webllm" (default) = @mlc-ai/web-llm (in-browser,
  // needs an MLC build). "cloud" = a hosted model reached via the Firebase Function
  // proxy → OpenRouter (NOT in-browser; the question is sent to a server). `id` is
  // the OpenRouter model id for cloud models.
  runtime?: "webllm" | "cloud";
  appConfig?: AppConfig; // for custom (HF-hosted) WebLLM models
  // May this model SELECT tools? Only Bulgarian-capable models should — BgGPT and
  // the cloud models are trusted to fill routing gaps the rules decline. A model
  // with routes:false narrates only and routing stays deterministic (small generic
  // models mis-route, e.g. "compare elections" -> a machine-voting series).
  routes?: boolean;
  // EXPERIMENTAL — small constrained tool-router (off by default). When set, a gap
  // the rules decline is routed by: retrieve top-k candidate tools (ai/llm/retrieve.ts)
  // → compact declarations that fit the 512-tok window → grammar-constrain the output
  // to {"name": <one of the k>}. The fc-eval ladder (/evals) shows an UNTUNED FG-270M
  // reaches ~37% this way (k=3, vs ~33% chance) — proof-of-mechanism, NOT yet usable,
  // so activation ALSO requires the runtime flag localStorage["naiasno:fg-router"]="1".
  // Intended to light up once a domain fine-tune lands. See [[project_inbrowser_bg_model]].
  constrainedRouter?: boolean;
};

// The public chat exposes one hosted assistant. Historical browser models and
// evaluation captures remain available to development tools, not the picker.
export const MODELS: ModelOption[] = [
  {
    id: "google/gemini-3.5-flash-lite",
    label: { bg: "Gemini 3.5 Flash-Lite", en: "Gemini 3.5 Flash-Lite" },
    sizeNote: { bg: "В облака", en: "Cloud" },
    advantage: {
      bg: "Въпроси и обяснения по данните",
      en: "Questions and explanations grounded in the data",
    },
    ready: true,
    runtime: "cloud",
    routes: true,
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const modelById = (id: string): ModelOption | undefined =>
  MODELS.find((m) => m.id === id);
