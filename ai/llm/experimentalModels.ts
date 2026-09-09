import type { ModelOption } from "./models";

export const EXPERIMENTAL_MODELS: ModelOption[] = [
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

export const experimentalModelById = (id: string) =>
  EXPERIMENTAL_MODELS.find((model) => model.id === id);
