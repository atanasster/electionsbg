import { parseModelRoute } from "../orchestrator/routeScope";
// Cloud provider — a hosted model (via the Firebase Function proxy → Gemini API)
// drives tool selection AND narration. It implements the same LLMProvider
// interface as the rules + WebGPU providers, so it's just another option in the
// model dropdown; the rules engine stays the default. Every model step falls
// back to the deterministic router / template narrator, so a network or API
// failure never breaks the chat. The model only ever picks {tool, args} and
// writes prose from the tool's facts — the numbers are always computed.

import {
  buildContext,
  CLOUD_BUDGET,
  renderNarrationContext,
  renderRoutingContext,
} from "../orchestrator/memory";
import { narrate } from "../orchestrator/narrate";
import {
  buildNarrationPrompt,
  buildToolSystemPrompt,
} from "../orchestrator/prompts";
import {
  followOnScopeNotice,
  pinElectionContext,
  resolveFollowOn,
  route,
  type Route,
} from "../orchestrator/router";
import { runTool } from "../tools/registry";
import type { Lang, ToolArgs, ToolContext } from "../tools/types";
import { semanticGrounded } from "./semanticGrounding";
import { clarify, matchesLang, stripControl } from "./lang";
import type { ModelOption } from "./models";
import type {
  ChatResponse,
  LLMProvider,
  NarrationReject,
  ProviderStatus,
  RespondOpts,
  ResponseMeta,
} from "./provider";

import {
  PROXY_URL,
  questionAccess,
  setAiNotice,
  type QuestionAccess,
} from "./session";
import { HeuristicProvider } from "./provider";

// Dev-only console trace of the assembled conversation context (for tuning).
const DEV = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;

type ChatMessage = { role: "system" | "user"; content: string };
type Completion = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

type Usage = { input: number; output: number };

// Shown in the answer header when the cloud model contributed NOTHING (both the
// routing and narration calls failed/declined) — so a fallback answer is never
// mislabelled as model-generated. Mirrors HeuristicProvider.label.
const RULES_LABEL = { bg: "Без AI", en: "No AI" };

// Past this many older (already-windowed-out) exchanges, the deterministic topic
// digest is rewritten into one natural sentence by a cheap model call — only
// then is the extra call worth it. Cached on the instance so a long session pays
// for it at most once per growth step.
const LLM_COMPACT_THRESHOLD = 8;

export class OpenRouterProvider implements LLMProvider {
  id: string;
  label: { bg: string; en: string };
  private model: ModelOption;
  private state: ProviderStatus = "ready";
  // Memoized LLM-compacted summary, keyed by the exact digest it was built from
  // (NOT a turn count — the instance outlives "New chat", so a count key would
  // serve a stale summary to a different conversation that reached the same size).
  private summaryCache?: { key: string; text: string };

  private credentials?: { sessionToken: string; questionId: string };
  private busy = false;

  constructor(
    model: ModelOption,
    private access: QuestionAccess = questionAccess,
  ) {
    this.model = model;
    this.id = `cloud:${model.id}`;
    this.label = model.label;
  }

  status(): ProviderStatus {
    return this.state;
  }

  // Cloud models need no weights; init is a no-op so selecting one is instant.
  async init(): Promise<void> {
    this.state = "ready";
  }

  private async call(
    messages: ChatMessage[],
    opts: {
      json?: boolean;
      maxTokens: number;
      temperature: number;
      stream?: boolean;
      onDelta?: (partial: string) => void;
    },
    usage: Usage,
  ): Promise<string> {
    if (!this.credentials) throw new Error("verification_required");
    const res = await fetch(PROXY_URL, {
      signal: AbortSignal.timeout(40000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        ...this.credentials,
        model: this.model.id,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        ...(opts.stream ? { stream: true } : {}),
      }),
    });
    if (!res.ok) {
      // surface the upstream reason (key/policy/model error) so a failed cloud
      // call is diagnosable in the console rather than a bare status code,
      // before the silent fallback to the rules engine kicks in.
      const body = await res.text().catch(() => "");
      console.warn(`[cloud] /api/llm ${res.status}: ${body.slice(0, 300)}`);
      let code = "ai_unavailable";
      try {
        code = JSON.parse(body).error || code;
      } catch {
        /* non-JSON failure */
      }
      setAiNotice(code);
      throw new Error(`proxy ${res.status}`);
    }
    // Streaming path — only when we asked AND the proxy actually returns SSE
    // (an older deployed function would return plain JSON, handled below).
    const ctype = res.headers.get("content-type") ?? "";
    if (opts.stream && res.body && ctype.includes("text/event-stream"))
      return this.readStream(res.body, usage, opts.onDelta);

    const data = (await res.json()) as Completion;
    if (data.error)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : (data.error.message ?? "model error"),
      );
    usage.input += data.usage?.prompt_tokens ?? 0;
    usage.output += data.usage?.completion_tokens ?? 0;
    return data.choices?.[0]?.message?.content ?? "";
  }

  // Parse an OpenRouter SSE stream, surfacing the prose token-by-token via
  // onDelta and accumulating token usage from the final chunk.
  private async readStream(
    body: ReadableStream<Uint8Array>,
    usage: Usage,
    onDelta?: (partial: string) => void,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // keep the trailing partial line
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as Completion & {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            onDelta?.(stripControl(text));
          }
          if (json.usage) {
            usage.input += json.usage.prompt_tokens ?? 0;
            usage.output += json.usage.completion_tokens ?? 0;
          }
        } catch {
          /* keepalive / partial line — ignore */
        }
      }
    }
    return text;
  }

  // Model-first routing (a strong hosted model handles paraphrase + arg
  // extraction far better than keywords). The deterministic router is the
  // fallback when the model errors or returns something unusable.
  private async selectRoute(
    question: string,
    ctx: ToolContext,
    usage: Usage,
    routingCtx: string,
  ): Promise<{ route: Route; byModel: boolean }> {
    const deterministic = route(question, ctx);
    const fallback = () => ({ route: deterministic, byModel: false });
    // These explicit scopes are already resolved by the shared router. Do not
    // let an otherwise valid model call discard a named party/place or ballot.
    if (
      deterministic &&
      (deterministic.tool === "compareElections" ||
        (["municipalityResults", "regionResults"].includes(
          deterministic.tool,
        ) &&
          deterministic.args.party))
    )
      return { route: deterministic, byModel: false };
    // Prepend the conversation context (when there is any) so the model can
    // resolve references the keyword router can't, then label the live question.
    const userContent = routingCtx
      ? `${routingCtx}\n\n${ctx.lang === "bg" ? "Текущ въпрос" : "Current question"}: ${question}`
      : question;
    try {
      const content = await this.call(
        [
          { role: "system", content: buildToolSystemPrompt(ctx.lang) },
          { role: "user", content: userContent },
        ],
        { json: true, maxTokens: 120, temperature: 0 },
        usage,
      );
      // An explicit abstention is a decision, not a parser/API failure. Falling
      // back here could turn "delete contracts" into a procurement data answer.
      try {
        const decision = JSON.parse(content);
        if (decision && decision.tool === null)
          return { route: null, byModel: true };
      } catch {
        /* malformed output still uses the deterministic fallback */
      }
      const parsed = parseModelRoute(content, userContent);
      if (parsed) return { route: parsed, byModel: true };
      // A rejected ranking capability is a clarification, not permission to
      // replace it with the keyword router's guessed metric.
      try {
        if (
          [
            "rankPlaces",
            "personWealth",
            "personProfile",
            "personConnections",
            "turnoutSeries",
            "machineVoteSeries",
          ].includes(JSON.parse(content)?.tool)
        )
          return { route: null, byModel: true };
      } catch {
        /* malformed response retains transport-style fallback */
      }
      return fallback();
    } catch {
      return fallback();
    }
  }

  // Rewrite the deterministic topic digest into one natural sentence (no
  // numbers — the digest carries only past questions). Cached by turn count and
  // falls back to the deterministic digest on any error, so it never blocks.
  private async compactSummary(
    digest: string,
    lang: Lang,
    usage: Usage,
  ): Promise<string> {
    if (this.summaryCache?.key === digest) return this.summaryCache.text;
    try {
      const system =
        lang === "bg"
          ? "Обобщи в едно кратко изречение на български за какво е питал потребителят досега. Без числа, без измислици — само темите."
          : "Summarize in one short English sentence what the user has been asking about so far. No numbers, no invention — just the topics.";
      const text = stripControl(
        await this.call(
          [
            { role: "system", content: system },
            { role: "user", content: digest },
          ],
          { json: false, maxTokens: 80, temperature: 0.2 },
          usage,
        ),
      );
      if (text && matchesLang(text, lang)) {
        this.summaryCache = { key: digest, text };
        return text;
      }
    } catch {
      /* fall back to the deterministic digest */
    }
    return digest;
  }

  private async narrateEnv(
    env: Parameters<typeof narrate>[0],
    lang: Lang,
    usage: Usage,
    narrationCtx: string,
    onDelta?: (partial: string) => void,
  ): Promise<{ text: string; fromModel: boolean; reject?: NarrationReject }> {
    const template = narrate(env, lang);
    try {
      const { system, user } = buildNarrationPrompt(
        env,
        lang,
        narrationCtx || undefined,
      );
      const raw = await this.call(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        {
          json: false,
          maxTokens: 420,
          temperature: 0.3,
          stream: true,
          // Buffer until every narration gate passes.
        },
        usage,
      );
      const text = stripControl(raw);
      // Validate before exposing prose: language, numeric support and the
      // conservative semantic checks share the deterministic template fallback.
      const reject: NarrationReject | undefined =
        text.length === 0
          ? "empty"
          : !matchesLang(text, lang)
            ? "language"
            : !semanticGrounded(
                  text,
                  env.facts,
                  [env.title, ...env.provenance].join(" "),
                )
              ? "grounding"
              : undefined;
      if (reject) {
        if (DEV)
          console.debug(
            `[chat] narration rejected (${reject}) — using template`,
          );
        return { text: template, fromModel: false, reject };
      }
      onDelta?.(text);
      return { text, fromModel: true };
    } catch {
      return { text: template, fromModel: false, reject: "error" };
    }
  }

  private async authorized(
    run: () => Promise<ChatResponse>,
    fallback: () => Promise<ChatResponse>,
  ): Promise<ChatResponse> {
    if (this.busy) return fallback();
    this.busy = true;
    try {
      try {
        this.credentials = await this.access.start();
      } catch {
        return await fallback();
      }
      return await run();
    } finally {
      if (this.credentials)
        await this.access.finish(this.credentials).catch(() => {});
      this.credentials = undefined;
      this.busy = false;
    }
  }

  respond(
    question: string,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
    opts?: RespondOpts,
  ): Promise<ChatResponse> {
    if (followOnScopeNotice(question, opts?.prev, ctx.lang))
      return new HeuristicProvider().respond(question, ctx, undefined, opts);
    return this.authorized(
      () => this.respondAuthorized(question, ctx, onDelta, opts),
      () => new HeuristicProvider().respond(question, ctx, undefined, opts),
    );
  }

  runChoice(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse> {
    return this.authorized(
      () => this.runChoiceAuthorized(tool, args, ctx, onDelta),
      () => new HeuristicProvider().runChoice(tool, args, ctx),
    );
  }

  private async respondAuthorized(
    question: string,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
    opts?: RespondOpts,
  ): Promise<ChatResponse> {
    const t0 = performance.now();
    const usage: Usage = { input: 0, output: 0 };
    // Window + compact the conversation into a context the model can use to
    // resolve references. Past a threshold the older topic digest is rewritten
    // into one natural sentence by a cheap (cached) call.
    const mem = buildContext(opts?.history ?? [], CLOUD_BUDGET);
    if (mem.summary && (mem.olderCount ?? 0) > LLM_COMPACT_THRESHOLD) {
      // Include every billed call in this question's reported usage.
      const sumUsage = usage;
      mem.summary = await this.compactSummary(mem.summary, ctx.lang, sumUsage);
    }
    const routingCtx = renderRoutingContext(mem, ctx.lang);
    const narrationCtx = renderNarrationContext(mem, ctx.lang);
    if (DEV && routingCtx) console.debug("[chat ctx]\n" + routingCtx);
    // A bare follow-on ("а ДПС?") reuses the previous tool deterministically —
    // no routing call needed (and the keyword swap is reliable for ellipsis).
    const followOn = resolveFollowOn(question, opts?.prev);
    const { route: selectedRoute, byModel: routedByModel } = followOn
      ? { route: followOn, byModel: false }
      : await this.selectRoute(question, ctx, usage, routingCtx);
    const r = pinElectionContext(selectedRoute, ctx);
    // `usedModel` = the cloud model produced the route OR the prose. When false
    // (both fell back), the answer IS the rules engine, so label it as such —
    // never claim the cloud model on a fallback/error.
    const baseMeta = (
      narratedBy: ResponseMeta["narratedBy"],
      usedModel: boolean,
    ): ResponseMeta => ({
      model: usedModel ? this.label : RULES_LABEL,
      durationMs: performance.now() - t0,
      inputTokens: usage.input || undefined,
      outputTokens: usage.output || undefined,
      narratedBy,
    });
    if (!r)
      return {
        text: clarify(ctx.lang),
        env: null,
        meta: baseMeta("rules", false),
      };
    try {
      const env = await runTool(r.tool, r.args, ctx);
      // A chooser env needs no prose — show its prompt (template narration) and
      // let the UI pop the disambiguation modal; skip the wasted model call.
      if (env.clarify)
        return {
          text: narrate(env, ctx.lang),
          env,
          tool: r.tool,
          args: r.args,
          meta: baseMeta("rules", routedByModel),
        };
      const { text, fromModel, reject } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        narrationCtx,
        onDelta,
      );
      const m = baseMeta(
        fromModel ? "model" : "rules",
        routedByModel || fromModel,
      );
      if (reject) m.narrationReject = reject;
      return { text, env, tool: r.tool, args: r.args, meta: m };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: baseMeta("rules", routedByModel),
      };
    }
  }

  // A disambiguation pick: run the pinned tool (no routing) and let the model
  // narrate the result, falling back to the template on any failure.
  private async runChoiceAuthorized(
    tool: string,
    args: ToolArgs,
    ctx: ToolContext,
    onDelta?: (partial: string) => void,
  ): Promise<ChatResponse> {
    args = pinElectionContext({ tool, args }, ctx)!.args;
    const t0 = performance.now();
    const usage: Usage = { input: 0, output: 0 };
    const meta = (
      narratedBy: ResponseMeta["narratedBy"],
      usedModel: boolean,
    ): ResponseMeta => ({
      model: usedModel ? this.label : RULES_LABEL,
      durationMs: performance.now() - t0,
      inputTokens: usage.input || undefined,
      outputTokens: usage.output || undefined,
      narratedBy,
    });
    try {
      const env = await runTool(tool, args, ctx);
      if (env.clarify)
        return {
          text: narrate(env, ctx.lang),
          env,
          tool,
          args,
          meta: meta("rules", false),
        };
      const { text, fromModel, reject } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        "",
        onDelta,
      );
      const m = meta(fromModel ? "model" : "rules", fromModel);
      if (reject) m.narrationReject = reject;
      return { text, env, tool, args, meta: m };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        text:
          ctx.lang === "bg"
            ? `Възникна грешка при изпълнението: ${msg}`
            : `Something went wrong running that: ${msg}`,
        env: null,
        meta: meta("rules", false),
      };
    }
  }
}
