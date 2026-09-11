import { expect, it, vi } from "vitest";
import { OpenRouterProvider } from "./openrouter";
import { WebLLMProvider } from "./webllm";
import { MODELS } from "./models";
import type { Envelope, Lang } from "../tools/types";
const env: Envelope = {
  tool: "fictional",
  title: "Fictional turnout",
  kind: "scalar",
  viz: "none",
  facts: { turnout_2024: "40%", turnout_2025: "30%" },
  provenance: ["fictional fixture"],
};
const bad = "Turnout fell by ten percentage points.",
  good = "Turnout fell from 40% in 2024 to 30% in 2025.";
type Result = { text: string; fromModel: boolean; reject?: string };
it("cloud narration never exposes rejected streamed text", async () => {
  const p = new OpenRouterProvider(MODELS[0]) as unknown as {
    call: (m: unknown, o: { onDelta?: (s: string) => void }) => Promise<string>;
    narrateEnv: (
      e: Envelope,
      l: Lang,
      u: { input: number; output: number },
      c: string,
      delta: (s: string) => void,
    ) => Promise<Result>;
  };
  const delta = vi.fn();
  const call = vi.spyOn(p, "call").mockImplementation(async (_m, o) => {
    o.onDelta?.(bad);
    return bad;
  });
  expect(
    await p.narrateEnv(env, "en", { input: 0, output: 0 }, "", delta),
  ).toMatchObject({ fromModel: false, reject: "grounding" });
  expect(delta).not.toHaveBeenCalled();
  call.mockResolvedValue(good);
  expect(
    (await p.narrateEnv(env, "en", { input: 0, output: 0 }, "", delta))
      .fromModel,
  ).toBe(true);
  expect(delta).toHaveBeenCalledExactlyOnceWith(good);
});
it("on-device narration also waits for the completed semantic check", async () => {
  let text = bad;
  const p = new WebLLMProvider(MODELS[0]) as unknown as {
    engine: unknown;
    narrateEnv: (
      e: Envelope,
      l: Lang,
      u: { input: number; output: number },
      delta: (s: string) => void,
    ) => Promise<Result>;
  };
  p.engine = {
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            yield { choices: [{ delta: { content: text } }] };
          })(),
      },
    },
  };
  const delta = vi.fn();
  expect(
    (await p.narrateEnv(env, "en", { input: 0, output: 0 }, delta)).fromModel,
  ).toBe(false);
  expect(delta).not.toHaveBeenCalled();
  text = good;
  expect(
    (await p.narrateEnv(env, "en", { input: 0, output: 0 }, delta)).fromModel,
  ).toBe(true);
  expect(delta).toHaveBeenCalledExactlyOnceWith(good);
});
