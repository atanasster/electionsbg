import { PilotClient, type Message } from "../client";
export type Options = {
  json?: boolean;
  maxTokens: number;
  temperature: number;
  stream?: boolean;
};
export type Sample = {
  text: string;
  firstTokenMs: null;
  elapsedMs: number;
  stream: false;
  usage: { prompt_tokens?: number; completion_tokens?: number };
};
// Preserve production payload() limits, including stream:false. Do not bypass
// that policy to manufacture token-stream latency for a non-streaming service.
export class ReleaseClient {
  private client: PilotClient;
  constructor(key: string, maxCalls: number) {
    if (maxCalls > 128) throw new Error("Release evaluation cap is 128 calls");
    this.client = new PilotClient(key, maxCalls);
  }
  get calls() {
    return this.client.calls;
  }
  get reservationCeilingUSD() {
    return this.client.reservedCeilingUSD;
  }
  async complete(messages: Message[], opts: Options): Promise<Sample> {
    const result = await this.client.complete(messages, {
      json: opts.json,
      tokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    return { ...result, firstTokenMs: null, stream: false };
  }
}
