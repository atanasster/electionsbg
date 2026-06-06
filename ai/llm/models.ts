// M3 — selectable in-browser models for the WebLLM provider.
//
// "prebuilt" models load straight from MLC's CDN and work today (used to prove
// the pipeline). BgGPT / EuroLLM are the on-brand Bulgarian targets but need a
// one-time MLC build + HF hosting — see ai/m0/README.md + ai/m0/build-model.sh.
// To enable one: run the build, host on HF, then set ready:true and paste the
// appConfig the script prints. Until then they show as "requires MLC build".
//
// ⚠ The unpinned MLC pip toolchain is currently ABI-broken; the reliable build
// is from source (or skip MLC and ship EuroLLM via transformers.js). Recommended
// first ship = BgGPT-2.6B (no compile). The two ranked execution paths + exact
// commands live in ai/m0/PLAN.md (research 2026-06-06).

import type { AppConfig } from "@mlc-ai/web-llm";

// Short capability tags surfaced as chips on each model card. The picker maps
// these to bilingual labels (ai/app/ModelPicker.tsx) so the registry stays
// language-neutral.
export type ModelTag =
  | "bg-native"
  | "routes"
  | "fast"
  | "test"
  | "multimodal"
  | "cloud";

export type ModelOption = {
  id: string; // WebLLM model_id, or (transformersjs) the HF ONNX repo path
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
  // needs an MLC build). "transformersjs" = @huggingface/transformers / ONNX Runtime
  // Web (in-browser, loads a HF ONNX repo). "cloud" = a hosted model reached via the
  // Firebase Function proxy → OpenRouter (NOT in-browser; the question is sent to a
  // server). `id` is the OpenRouter model id for cloud models.
  runtime?: "webllm" | "transformersjs" | "cloud";
  dtype?: string; // transformers.js quantization, e.g. "q4" (default "q4")
  appConfig?: AppConfig; // for custom (HF-hosted) WebLLM models
  // May this model SELECT tools? Only Bulgarian-capable models should. The Qwen
  // test models mis-route (e.g. a "compare elections" question -> machine-voting
  // series), so they narrate only and routing stays deterministic. BgGPT/EuroLLM
  // are trusted to fill routing gaps the rules decline. transformers.js models
  // narrate only (no grammar-constrained JSON decoding), so they stay false.
  routes?: boolean;
};

export const MODELS: ModelOption[] = [
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 1.5B (тест)", en: "Qwen2.5 1.5B (test)" },
    sizeNote: { bg: "~1.1 GB сваляне", en: "~1.1 GB download" },
    size: { bg: "~1.1 GB", en: "~1.1 GB" },
    vramNote: { bg: "~1.5 GB видео памет", en: "~1.5 GB video memory" },
    advantage: {
      bg: "Бърз, лек тестов модел · само разказ",
      en: "Fast, light test model · narration only",
    },
    tags: ["fast", "test"],
    ready: true,
    routes: false, // test model: narration only, deterministic routing
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: { bg: "Qwen2.5 3B (тест)", en: "Qwen2.5 3B (test)" },
    sizeNote: { bg: "~2 GB сваляне", en: "~2 GB download" },
    size: { bg: "~2 GB", en: "~2 GB" },
    vramNote: { bg: "~2.5 GB видео памет", en: "~2.5 GB video memory" },
    advantage: {
      bg: "По-плавен разказ · само разказ (без насочване)",
      en: "Smoother narration · narration only (no routing)",
    },
    tags: ["test"],
    ready: true,
    routes: false, // test model: narration only, deterministic routing
  },
  // ---- cloud models (hosted via the Firebase proxy → OpenRouter) -------------
  // These work TODAY and route + narrate well in Bulgarian. They are NOT
  // in-browser: the question is sent to a server. Keep ids in sync with the
  // ALLOWED_MODELS allowlist in functions/index.js.
  {
    id: "google/gemini-2.5-flash-lite",
    label: { bg: "Gemini 2.5 Flash-Lite", en: "Gemini 2.5 Flash-Lite" },
    sizeNote: { bg: "облак · OpenRouter", en: "cloud · OpenRouter" },
    advantage: {
      bg: "В облака · най-точен за български · избор на инструменти",
      en: "Cloud · most accurate Bulgarian · routes tools",
    },
    tags: ["cloud", "routes", "fast"],
    ready: true,
    runtime: "cloud",
    routes: true,
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: { bg: "Gemma 4 31B (безпл.)", en: "Gemma 4 31B (free)" },
    sizeNote: { bg: "облак · безплатно", en: "cloud · free" },
    advantage: {
      bg: "В облака · безплатен · отворен модел (Apache-2.0)",
      en: "Cloud · free · open model (Apache-2.0)",
    },
    tags: ["cloud", "routes"],
    ready: true,
    runtime: "cloud",
    routes: true,
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
    size: { bg: "~1.6 GB", en: "~1.6 GB" },
    vramNote: { bg: "~3 GB видео памет", en: "~3 GB video memory" },
    advantage: {
      bg: "Най-добър за български · по-естествени отговори",
      en: "Best for Bulgarian · more natural answers",
    },
    tags: ["bg-native", "routes"],
    recommended: true,
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
    // BgGPT 2.0 (a google/gemma-3-4b fine-tune) — DEPRIORITIZED (see ai/m0/PLAN.md).
    // Three strikes: (1) it's a MULTIMODAL image-text-to-text model (awkward for a
    // text-only chat); (2) no prebuilt gemma3-4b wasm, so M0 must COMPILE one
    // (mlc_llm compile --device webgpu, needs Emscripten — Colab Part B); (3) Gemma-3
    // is confirmed broken on ONNX/WebGPU (fp16 overflow), so the easy runtime is
    // closed too. ~2.7 GB download / ~4 GB VRAM. Prefer BgGPT-2.6B or EuroLLM.
    // Build: ai/m0/build-model.sh bggpt3 atanasster   (or Colab Part B).
    id: "BgGPT-Gemma-3-4B-IT-q4f16_1-MLC",
    label: { bg: "BgGPT 4B (Gemma 3)", en: "BgGPT 4B (Gemma 3)" },
    sizeNote: {
      bg: "изисква MLC компилация (M0)",
      en: "requires MLC build (M0)",
    },
    size: { bg: "~2.7 GB", en: "~2.7 GB" },
    vramNote: { bg: "~4 GB видео памет", en: "~4 GB video memory" },
    advantage: {
      bg: "Български, по-голям модел · мултимодален",
      en: "Bulgarian, larger model · multimodal",
    },
    tags: ["bg-native", "routes", "multimodal"],
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
    // EuroLLM-1.7B-Instruct via transformers.js / ONNX Runtime Web (NO MLC).
    // DISABLED: tested 2026-06-06 — the q4 ONNX (flackzz/EuroLLM-1.7B-Instruct-ONNX,
    // ~1.9 GB) downloads fully but ORT-Web OOMs creating the session
    // ("Can't create a session ... std::bad_alloc"): ORT-Web parses weights through
    // a memory-capped wasm heap and ~1.9 GB is over the limit; the file also exceeds
    // the browser Cache quota (re-downloads every visit). transformers.js is fine for
    // a SMALLER (≤~1 GB) ONNX model — the TransformersJsProvider + runtime plumbing
    // stay wired for that. For a Bulgarian model use web-llm/MLC instead (BgGPT 2.6B
    // above): it streams q4f16 into WebGPU buffers + caches in IndexedDB, so it
    // handles multi-GB models (the Qwen test models prove it). See ai/m0/PLAN.md.
    id: "flackzz/EuroLLM-1.7B-Instruct-ONNX",
    label: { bg: "EuroLLM 1.7B", en: "EuroLLM 1.7B" },
    sizeNote: {
      bg: "недостъпен (твърде голям за браузъра)",
      en: "unavailable (too large for the browser)",
    },
    vramNote: { bg: "~2 GB видео памет", en: "~2 GB video memory" },
    advantage: {
      bg: "Многоезичен европейски модел (вкл. български)",
      en: "Multilingual European model (incl. Bulgarian)",
    },
    ready: false,
    runtime: "transformersjs",
    dtype: "q4",
    routes: false, // transformers.js: narration only, deterministic routing
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const modelById = (id: string): ModelOption | undefined =>
  MODELS.find((m) => m.id === id);
