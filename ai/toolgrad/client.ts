// Operator-only research client; uses production payload limits, not public auth bypasses.
import { createRequire } from "node:module";
const { payload, MODEL, POLICY } = createRequire(import.meta.url)(
  "../../functions/llm_security.js",
);
export const PILOT_MODEL: string = MODEL;
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Completion = {
  text: string;
  elapsedMs: number;
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  finishReason: string | null;
};
export class PilotClient {
  calls = 0;
  constructor(
    private key: string,
    readonly maxCalls: number,
  ) {
    if (!key) throw new Error("GEMINI_API_KEY required; no calls performed");
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000)
      throw new Error("Pilot budget must be 1–1000 calls");
  }
  get reservedCeilingUSD(): number {
    return (this.calls * POLICY.callReserve) / 1e6;
  }
  async complete(
    messages: Message[],
    options: { json?: boolean; tokens?: number; temperature?: number } = {},
  ): Promise<Completion> {
    if (this.calls >= this.maxCalls)
      throw new Error("Pilot request cap reached");
    const body = payload({
      model: MODEL,
      messages,
      max_tokens: options.tokens ?? 512,
      temperature: options.temperature ?? 0,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    });
    this.calls++;
    const start = performance.now();
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!res.ok) throw new Error(`Model request failed: HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw new Error("Empty model completion");
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    if (finishReason === "length")
      throw new Error("Truncated model completion");
    return {
      text,
      finishReason,
      elapsedMs: performance.now() - start,
      usage: data.usage ?? {},
    };
  }
}
