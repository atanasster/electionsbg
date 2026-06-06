// An MLC-free in-browser model provider built on transformers.js (ONNX Runtime
// Web, WebGPU). It runs a small multilingual model (EuroLLM-1.7B, Llama arch)
// straight from a HuggingFace ONNX repo — no MLC convert/compile toolchain. Like
// the WebLLM provider it implements LLMProvider and every model step is wrapped
// so any failure falls back to the deterministic router / template narrator —
// the chat never breaks.
//
// Routing stays deterministic (model.routes is false): transformers.js has no
// grammar/JSON-schema constrained decoding like web-llm, so the model only
// NARRATES the computed facts (1–2 sentences), it never selects tools or emits
// numbers. See ai/m0/PLAN.md (Path B).

import { narrate } from "../orchestrator/narrate";
import { buildNarrationPrompt } from "../orchestrator/prompts";
import { route } from "../orchestrator/router";
import { runTool } from "../tools/registry";
import type { Lang, ToolContext } from "../tools/types";
import { clarify, matchesLang } from "./lang";
import type { ModelOption } from "./models";
import type { ChatResponse, LLMProvider, ProviderStatus } from "./provider";
import { webgpuSupported } from "./webllm";

// transformers.js streams generated tokens through a TextStreamer; this is the
// minimal shape of the text-generation pipeline we use.
type Generator = {
  tokenizer: unknown;
  (
    messages: { role: string; content: string }[],
    opts: Record<string, unknown>,
  ): Promise<{ generated_text: { role: string; content: string }[] }[]>;
};

// Strip any ChatML control tokens that leak into the decoded text.
const stripControl = (s: string): string =>
  s
    .replace(/<\|im_(start|end)\|>/g, "")
    .replace(/<\/?s>/g, "")
    .trim();

export class TransformersJsProvider implements LLMProvider {
  id: string;
  label: { bg: string; en: string };
  private model: ModelOption;
  private gen: Generator | null = null;
  private state: ProviderStatus = "loading";

  constructor(model: ModelOption) {
    this.model = model;
    this.id = `transformersjs:${model.id}`;
    this.label = model.label;
    if (!webgpuSupported()) this.state = "unsupported";
  }

  status(): ProviderStatus {
    return this.state;
  }

  async init(onProgress?: (pct: number, note: string) => void): Promise<void> {
    if (!webgpuSupported()) {
      this.state = "unsupported";
      throw new Error("WebGPU not available in this browser");
    }
    this.state = "loading";
    try {
      const tjs = await import("@huggingface/transformers");
      // Single-threaded wasm fallback so we never require SharedArrayBuffer /
      // cross-origin isolation (COOP+COEP); the GPU path runs on WebGPU anyway.
      const wasm = tjs.env.backends?.onnx?.wasm;
      if (wasm) wasm.numThreads = 1;
      // Per-file download progress -> one overall percentage for the header bar.
      const files = new Map<string, { loaded: number; total: number }>();
      const pipe = await tjs.pipeline("text-generation", this.model.id, {
        dtype: (this.model.dtype ?? "q4") as "q4",
        device: "webgpu",
        progress_callback: (p: {
          status?: string;
          file?: string;
          loaded?: number;
          total?: number;
        }) => {
          if (p.status === "progress" && p.file && p.total) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
          }
          let loaded = 0;
          let total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          onProgress?.(pct, p.file ?? p.status ?? "");
        },
      });
      this.gen = pipe as unknown as Generator;
      this.state = "ready";
    } catch (e) {
      this.state = "error";
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
    onDelta?: (partial: string) => void,
  ): Promise<string> {
    const template = narrate(env, lang);
    if (!this.gen) return template;
    try {
      const { system, user } = buildNarrationPrompt(env, lang);
      const messages = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      const tjs = await import("@huggingface/transformers");
      let acc = "";
      const streamer = new tjs.TextStreamer(this.gen.tokenizer as never, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (t: string) => {
          acc += t;
          // only surface tokens once it's clearly the right language, so we
          // never stream wrong-language text the guard would later discard
          if (onDelta && matchesLang(acc, lang)) onDelta(stripControl(acc));
        },
      });
      const out = await this.gen(messages, {
        max_new_tokens: 160,
        do_sample: false, // greedy: narrate the facts, don't improvise
        streamer,
      });
      const raw = out?.[0]?.generated_text?.at(-1)?.content ?? acc;
      const text = stripControl(raw);
      // Language guard: the template is always in the right language, so if the
      // model drifted to the wrong script, fall back to it.
      return text.length > 0 && matchesLang(text, lang) ? text : template;
    } catch {
      return template;
    }
  }

  async respond(
    question: string,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse> {
    // Deterministic router only (model.routes is false) — the model narrates.
    const r = route(question, ctx);
    if (!r) return { text: clarify(ctx.lang), env: null };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      const text = await this.narrateEnv(env, ctx.lang, onDelta);
      return { text, env, tool: r.tool };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
      };
    }
  }
}
