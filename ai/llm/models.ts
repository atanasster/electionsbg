// Selectable models for the chat. Two runtimes:
//   - "cloud": hosted models via the Firebase → OpenRouter proxy. Work TODAY and
//     narrate/route Bulgarian well, but NOT in-browser (the question hits a server).
//   - "webllm": @mlc-ai/web-llm, fully in-browser (private, no backend). BgGPT is
//     the on-brand Bulgarian target but needs a one-time MLC build + HF hosting —
//     see ai/m0/README.md + ai/m0/build-model.sh. To enable: run the build, host on
//     HF, set ready:true, paste the appConfig. Until then it shows "requires MLC
//     build". (The Qwen test models that used to prove this path were removed.)
//
// ⚠ The unpinned MLC pip toolchain is currently ABI-broken; the reliable build
// is from source. Recommended first ship = BgGPT-2.6B (no compile). The ranked
// execution paths + exact commands live in ai/m0/PLAN.md (research 2026-06-06).

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

export const MODELS: ModelOption[] = [
  // ---- cloud models (hosted via the Firebase proxy → OpenRouter) -------------
  // These work TODAY and route + narrate well in Bulgarian. They are NOT
  // in-browser: the question is sent to a server. Keep ids in sync with the
  // ALLOWED_MODELS allowlist in functions/index.js.
  {
    id: "google/gemini-3.1-flash-lite",
    label: { bg: "Gemini 3.1 Flash-Lite", en: "Gemini 3.1 Flash-Lite" },
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
  // ---- TEST ENTRY (FunctionGemma-270M in-browser feasibility) ----------------
  // Probes whether Google's FunctionGemma (Gemma-3-270M, text-only, built for
  // tool calling) loads + runs in THIS app's web-llm 0.2.84 / WebGPU path.
  // Uses a ready-made community MLC build (weights + its own WebGPU wasm) so NO
  // local compile is needed — the parked m0 toolchain is bypassed entirely.
  //   - download ≈ 157 MB (151 MB q4f32_1 weights + 5.7 MB wasm) — ~10× smaller
  //     than the BgGPT builds; q4f32_1 sidesteps the Gemma-3 fp16-overflow bug.
  //   - it is a FOREIGN domain fine-tune ("txpilot"), NOT Bulgarian and NOT our
  //     tools, so routes:false (narration/runtime probe only). Real tool routing
  //     needs our own FunctionGemma fine-tune on the 75-tool registry.
  //   - WATCH on load: a `Cannot find required VM function` error == the wasm was
  //     compiled against a runtime newer than web-llm 0.2.84 (recompile needed).
  // Remove this entry once the feasibility question is answered.
  {
    id: "functiongemma-270m-it-q4f32_1-MLC",
    label: { bg: "FunctionGemma 270M (тест)", en: "FunctionGemma 270M (test)" },
    sizeNote: { bg: "~157 MB сваляне · тест", en: "~157 MB download · test" },
    size: { bg: "~157 MB", en: "~157 MB" },
    vramNote: { bg: "~0.5 GB видео памет", en: "~0.5 GB video memory" },
    advantage: {
      bg: "Тест: малък модел за инструменти в браузъра (Gemma-3-270M)",
      en: "Test: tiny in-browser tool-calling model (Gemma-3-270M)",
    },
    tags: ["fast"],
    ready: true,
    runtime: "webllm",
    routes: false,
    // Declares the constrained-router capability; stays inert until the operator
    // sets localStorage["naiasno:fg-router"]="1" (untuned accuracy ~37% is not
    // production-grade — see /evals ladder). Default UX: narration-only.
    constrainedRouter: true,
    appConfig: {
      model_list: [
        {
          model:
            "https://huggingface.co/conceptcodes/txpilot-functiongemma-270m-it-q4f32_1-mlc/resolve/main/mlc-q4f32_1",
          model_id: "functiongemma-270m-it-q4f32_1-MLC",
          model_lib:
            "https://huggingface.co/conceptcodes/txpilot-functiongemma-270m-it-q4f32_1-mlc/resolve/main/libs/functiongemma-270m-q4f32_1-webgpu.wasm",
          // Gemma-3 ships BOTH context_window_size (8192) AND sliding_window_size
          // (512) positive; web-llm requires exactly one. Verified live: keep the
          // 512 sliding window the wasm was compiled for (context_window_size:-1)
          // and set attention_sink_size:0. Without these the engine throws on init.
          overrides: { context_window_size: -1, attention_sink_size: 0 },
        },
      ],
    },
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
    // closed too. ~2.7 GB download / ~4 GB VRAM. Prefer BgGPT-2.6B.
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
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export const modelById = (id: string): ModelOption | undefined =>
  MODELS.find((m) => m.id === id);
