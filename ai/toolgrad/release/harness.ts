import { runTool } from "../../tools/registry";
import { buildNarrationPrompt } from "../../orchestrator/prompts";
import {
  buildContext,
  CLOUD_BUDGET,
  renderNarrationContext,
} from "../../orchestrator/memory";
import { clarify } from "../../llm/lang";
import { OpenRouterProvider } from "../../llm/openrouter";
import { MODELS } from "../../llm/models";
import type { Message } from "../client";
import type { Options, Sample } from "./client";
import type { ReleaseCase } from "./cases";
import type { Lang } from "../../tools/types";
import { installFixtures } from "./fixtures";
import { matchesExpected } from "../defaults/routingEval";
export async function evaluateQuestion(
  c: ReleaseCase,
  lang: Lang,
  complete: (m: Message[], o: Options) => Promise<Sample>,
) {
  const history = c.prev
    ? [
        {
          question: lang === "bg" ? "Предишен въпрос" : "Previous question",
          tool: c.prev.tool,
          args: c.prev.args,
        },
      ]
    : [];
  installFixtures();
  const expectedEnv = c.tool
    ? await runTool(
        c.tool,
        Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, v[0]])),
        { lang, election: "2024_10_27" },
      )
    : null;
  const context = renderNarrationContext(
    buildContext(history, CLOUD_BUDGET),
    lang,
  );
  const expectedPrompt = expectedEnv
    ? buildNarrationPrompt(expectedEnv, lang, context || undefined)
    : null;
  const requests = installFixtures();
  let blockedNarration = false;
  const provider = new OpenRouterProvider(MODELS[0], {
    start: async () => ({
      sessionToken: "local-test-only",
      questionId: "local-test-only",
    }),
    finish: async () => {},
  });
  const calls: Array<{
    messages: Message[];
    options: Options;
    sample?: Sample;
    error?: string;
    startedMs: number;
  }> = [];
  const started = performance.now();
  // Operator-only transport seam. Production authentication/proxy are not exercised.
  (
    provider as unknown as {
      call: (
        m: Message[],
        o: Options,
        u: { input: number; output: number },
      ) => Promise<string>;
    }
  ).call = async (m, o, u) => {
    const record: (typeof calls)[number] = {
      messages: m,
      options: o,
      startedMs: performance.now() - started,
    };
    calls.push(record);
    if (
      !o.json &&
      (!expectedPrompt ||
        m.length !== 2 ||
        m[0].role !== "system" ||
        m[0].content !== expectedPrompt.system ||
        m[1].role !== "user" ||
        m[1].content !== expectedPrompt.user)
    ) {
      blockedNarration = true;
      record.messages = [];
      record.error = "Unfrozen narration payload withheld before transport";
      throw new Error(record.error);
    }
    try {
      const sample = await complete(m, o);
      record.sample = sample;
      u.input += sample.usage.prompt_tokens ?? 0;
      u.output += sample.usage.completion_tokens ?? 0;
      return sample.text;
    } catch (e) {
      record.error = String(e);
      throw e;
    }
  };
  const deltas: Array<{ atMs: number; text: string }> = [];
  const rawResponse = await provider.respond(
    c[lang],
    { lang, election: "2024_10_27" },
    (text) => deltas.push({ atMs: performance.now() - started, text }),
    c.prev
      ? {
          prev: c.prev,
          history: [
            {
              question: lang === "bg" ? "Предишен въпрос" : "Previous question",
              tool: c.prev.tool,
              args: c.prev.args,
            },
          ],
        }
      : undefined,
  );
  const response = blockedNarration
    ? { ...rawResponse, text: "[Nonfixture response withheld]", env: null }
    : rawResponse;
  return {
    blockedNarration,
    expectedEnv,
    id: `${c.id}:${lang}`,
    split: c.split,
    group: c.group,
    question: c[lang],
    lang,
    response,
    requests,
    calls,
    deltas,
    elapsedMs: performance.now() - started,
    routePass:
      !blockedNarration &&
      (c.tool !== null ||
        (requests.length === 0 && response.text === clarify(lang))) &&
      matchesExpected(
        c,
        response.tool
          ? { tool: response.tool, args: response.args ?? {} }
          : null,
      ),
  };
}
