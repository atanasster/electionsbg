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
  FORMAT_ANCHOR_TOOLS,
} from "../orchestrator/prompts";
import {
  proxyMessageBytes,
  routingMessages,
  withinBudget,
} from "./promptBudget";
import {
  preselectCandidates,
  prunePrefixToBudget,
} from "../orchestrator/toolPreselector";
import {
  extractEntities,
  fillMissingArgs,
  renderEntityHint,
} from "../orchestrator/entityExtraction";
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
import { matchesLang, stripControl } from "./lang";
import type { ModelOption } from "./models";
import {
  CALLS_PER_QUESTION,
  jevRoutingStep,
  parseSplit,
  splitPrompt,
  type AiTurnPlan,
} from "./jevAiLane";
import type { JevCredentials } from "./jevClient";
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
import { declinedAnswer, HeuristicProvider } from "./provider";

// Dev-only console trace of the assembled conversation context (for tuning).
const DEV = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;

type ChatMessage = { role: "system" | "user"; content: string };
type Completion = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

// `calls` counts the upstream calls THIS question has made, against the
// proxy's per-question reservation (`CALLS_PER_QUESTION`). It exists so the
// lane can drop an optional call (model narration, a split) instead of having
// the proxy reject it: over budget, the answer is worded from its template.
type Usage = { input: number; output: number; calls: number };

/**
 * Narrow the tool catalogue when — and ONLY when — the full-catalogue request would
 * exceed the client byte budget. `undefined` means "send everything", which is the
 * path every request takes today except the longest BG threads.
 *
 * Exported rather than inlined into the provider so the decision can be tested
 * directly: it is the one place the byte bound, the pre-selector and the prompt
 * builder meet, and a test of the pieces separately would not catch them being
 * composed wrongly (e.g. measuring a different request than the one sent).
 *
 * The pruner is the BINARY-SEARCH form: `fits` rebuilds the whole system prompt, so
 * the linear form would rebuild it ~200 times on the routing path.
 */
export const narrowCatalogueForBudget = (
  question: string,
  lang: Lang,
  userContent: string,
  // EVAL-ONLY. G1a must force the narrowed path on EVERY case to get a sample large
  // enough to judge it, which the real budget cannot do (it only forces a cut on
  // saturated BG threads). Production passes nothing, so `withinBudget` keeps ONE
  // definition of "fits" and this only lowers the threshold the caller narrows at.
  budgetOverride?: number,
): string[] | undefined => {
  const fits = (tools: readonly string[]) =>
    budgetOverride === undefined
      ? withinBudget(routingMessages(lang, tools, userContent))
      : proxyMessageBytes(routingMessages(lang, tools, userContent)) <=
        budgetOverride;
  if (
    withinBudget(routingMessages(lang, undefined, userContent)) &&
    budgetOverride === undefined
  )
    return undefined;
  // NO TOOL-COUNT CAP: the byte bound is the only constraint. A cap of 24 was
  // measured to do ALL of the pruning (the pre-selected set already fits at 203
  // tools / 83,343 B) while making the gold tool unreachable for 9.9% of the eval
  // corpus — 35.5% of non-verbatim calls — against 0.5% with the byte bound alone,
  // in exchange for an unmeasured "lost in the middle" benefit.
  const kept = prunePrefixToBudget(preselectCandidates(question), (tools) =>
    fits(tools),
  ).kept;
  // The prompt keeps two FEW_SHOT format anchors, so their tools must be LISTED or
  // its only worked examples name a tool its own instruction forbids (measured:
  // 401 of 468 anchor instances, 85.7% of narrowed prompts). Two tools cost ~700 B.
  return [...new Set([...kept, ...FORMAT_ANCHOR_TOOLS])];
};

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
    // OPTIONAL Jev pre-step. Absent (the default) means this lane behaves
    // exactly as it did before Jev existed — same calls, same order, same
    // answers. When supplied, one batched Choice/Noul call decides the tool,
    // whether the turn is compound, and what kind of message it is, before
    // Gemini is asked anything.
    //
    // ⚠️ Whatever it returns, this lane NEVER falls back to keyword routing:
    // a user who chose the model gets the full Gemini prompt when Jev cannot
    // answer, which is what `selectRoute` already does.
    private jevPlan?: (
      question: string,
      credentials: JevCredentials | undefined,
    ) => Promise<AiTurnPlan>,
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
    // Counted BEFORE the request: the proxy reserves the call whether or not it
    // succeeds, so a failed call still spends the budget.
    usage.calls += 1;
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
  /** Can this question still afford an upstream call? */
  private hasCallLeft(usage: Usage): boolean {
    return usage.calls < CALLS_PER_QUESTION;
  }

  /**
   * Route one question with Jev's plan: JEV PICKS THE TOOL, THE MODEL FILLS
   * ITS PARAMETERS (see `jevRoutingStep`).
   *
   * `fill` asks the model with a catalogue of ONE tool. If the model says that
   * tool does not fit, or answers with something unusable, the turn gets the
   * full routing prompt — never the rules — provided a call is left. Jev is
   * right on 94–97% of the turns it is confident about, so this second call is
   * the exception; when it happens, the narration is worded from the template
   * to stay inside the per-question budget.
   */
  private async routeWithPlan(
    question: string,
    ctx: ToolContext,
    usage: Usage,
    routingCtx: string,
    plan: AiTurnPlan | null,
  ): Promise<{ route: Route; byModel: boolean; byJev: boolean }> {
    const step = jevRoutingStep(plan);
    if (step.kind === "run")
      return {
        route: { tool: step.tool, args: {} },
        byModel: true,
        byJev: true,
      };
    if (step.kind === "fill") {
      const filled = await this.selectRoute(question, ctx, usage, routingCtx, [
        step.tool,
      ]);
      if (filled.byModel && filled.route?.tool === step.tool)
        return { ...filled, byJev: true };
      // Anything unusable — the model said the tool does not fit, or its reply
      // did not parse — gets the full prompt below. (A deterministic scope
      // override lands here too; re-running it costs no call, since that branch
      // of `selectRoute` never asks the model.)
      if (!this.hasCallLeft(usage)) return { ...filled, byJev: false };
    }
    return {
      ...(await this.selectRoute(question, ctx, usage, routingCtx)),
      byJev: false,
    };
  }

  /**
   * A freeform answer for a turn Jev classified as CONVERSATIONAL — a greeting,
   * a question about the assistant, something the corpus cannot answer. Today
   * the lane declines these; the tools genuinely have nothing to say, but a
   * decline is a poor answer to "здравей".
   *
   * ⚠️ THE GROUNDING GATE IS NOT BYPASSED — this is the path most likely to
   * produce an unsupported figure, precisely because no tool ran. A rejected
   * answer falls back to the ordinary decline.
   *
   * ⚠️ BUT KNOW WHAT IT DOES AND DOES NOT CATCH, because the obvious reading
   * ("only numbers from the question survive") is wrong in both directions:
   *  - STRICTER than expected: with empty facts the numeral-word and
   *    motivation/cause checks reject ordinary friendly phrasing too, so a
   *    perfectly innocuous reply can be declined after a billed call. That is
   *    the safe direction, and the prompt asks for no figures precisely to
   *    stay clear of it.
   *  - WEAKER than expected: bare 1–2 digit numbers pass unconditionally, and
   *    a NON-numeric false claim ("the mayor of Varna is X") is not checked at
   *    all — nothing here verifies prose against the world. That is why the
   *    prompt forbids specific facts outright rather than relying on this gate.
   */
  private async conversationalAnswer(
    question: string,
    ctx: ToolContext,
    usage: Usage,
  ): Promise<string | null> {
    if (!this.hasCallLeft(usage)) return null;
    const system =
      ctx.lang === "bg"
        ? "Отговори кратко и любезно на български. Ти си асистент за български обществени данни. НЕ посочвай числа, статистики или конкретни факти — ако въпросът иска такива, кажи че може да бъде зададен по-конкретно."
        : "Reply briefly and politely in English. You are an assistant for Bulgarian public data. Do NOT state any figures, statistics or specific facts — if the question wants those, say it can be asked more specifically.";
    try {
      const raw = await this.call(
        [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
        { maxTokens: 160, temperature: 0.2 },
        usage,
      );
      const text = stripControl(raw).trim();
      if (!text || !matchesLang(text, ctx.lang)) return null;
      // Empty facts: the ONLY numbers allowed are ones the question supplied.
      return semanticGrounded(text, {}, question) ? text : null;
    } catch {
      return null;
    }
  }

  /** Run the non-primary parts of a split request and render their facts as
   *  narration context. Deterministic routing only: these are extra tool runs
   *  on a turn that already spent a routing call, and a failure must cost the
   *  turn nothing — an unroutable or throwing part is simply omitted. */
  private async secondaryFacts(
    parts: string[],
    ctx: ToolContext,
  ): Promise<string> {
    const lines: string[] = [];
    for (const part of parts) {
      const r = pinElectionContext(route(part, ctx), ctx);
      if (!r) continue;
      try {
        lines.push(
          `${part}\n${narrate(await runTool(r.tool, r.args, ctx), ctx.lang)}`,
        );
      } catch {
        /* a part that cannot be answered is dropped, never guessed */
      }
    }
    if (!lines.length) return "";
    return ctx.lang === "bg"
      ? `Допълнителни въпроси в същото съобщение:\n${lines.join("\n")}`
      : `Additional questions in the same message:\n${lines.join("\n")}`;
  }

  /** Ask the model to break a compound request into atomic questions. Jev
   *  detected the compound shape; splitting needs generated text, which only
   *  the model can produce. A failure returns the original question, so the
   *  turn answers the primary ask rather than erroring. */
  private async splitRequest(
    question: string,
    ctx: ToolContext,
    usage: Usage,
  ): Promise<string[]> {
    if (!this.hasCallLeft(usage)) return [question];
    try {
      const raw = await this.call(
        [
          { role: "system", content: splitPrompt(ctx.lang) },
          { role: "user", content: question },
        ],
        { maxTokens: 160, temperature: 0 },
        usage,
      );
      return parseSplit(raw, question);
    } catch {
      return [question];
    }
  }

  private async selectRoute(
    question: string,
    ctx: ToolContext,
    usage: Usage,
    routingCtx: string,
    /** Jev's pick: route among THESE tools only. Absent = the catalogue,
     *  narrowed only if it would not fit the byte budget. */
    only?: readonly string[],
  ): Promise<{ route: Route; byModel: boolean }> {
    const deterministic = route(question, ctx);
    const fallback = () => ({ route: deterministic, byModel: false });
    // These explicit scopes are already resolved by the shared router. Do not
    // let an otherwise valid model call discard a named party/place or ballot.
    if (
      deterministic &&
      ([
        "rollcallQuery",
        "rollcallQuestion",
        "fundingQuery",
        "fundingQuestion",
        "procurementQuery",
        "procurementQuestion",
        "compareElections",
      ].includes(deterministic.tool) ||
        (["municipalityResults", "regionResults"].includes(
          deterministic.tool,
        ) &&
          deterministic.args.party))
    )
      return { route: deterministic, byModel: false };
    // Prepend the conversation context (when there is any) so the model can resolve
    // references the keyword router can't, then label the live question. Detected
    // entities ride along as a hint (plan C8): a slot the question plainly carries is
    // stated rather than left for the model to infer from prose. `fillMissingArgs`
    // below is the only place the extraction is allowed to CHANGE a call, and it may
    // only ADD what the model omitted.
    const entities = extractEntities(question);
    const entityHint = renderEntityHint(entities, ctx.lang);
    const labelled = routingCtx
      ? `${routingCtx}\n\n${ctx.lang === "bg" ? "Текущ въпрос" : "Current question"}: ${question}`
      : question;
    const userContent = entityHint ? `${labelled}\n\n${entityHint}` : labelled;
    // THE BYTE BUDGET (plan C3). The full catalogue serializes to 85,121 BG /
    // 56,632 EN bytes against a 96,000-byte proxy ceiling, and a saturated BG
    // conversation window pushes the request past the client budget — so this branch
    // runs today, not only after the registry grows. Narrowing happens ONLY when the
    // request would not fit; the full-catalogue prompt is otherwise byte-identical to
    // what every published eval baseline was measured against.
    const allowedCandidates =
      only ?? narrowCatalogueForBudget(question, ctx.lang, userContent);
    try {
      const content = await this.call(
        routingMessages(ctx.lang, allowedCandidates, userContent),
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
      // Enforce the SAME candidate set the prompt was narrowed to (plan C4).
      // Without it the narrowing is advisory: the model could name any of the 235
      // registered tools and it would still parse and execute. `undefined` (the
      // full-catalogue path) accepts any valid name, exactly as before.
      const parsed = parseModelRoute(
        content,
        userContent,
        allowedCandidates ? new Set(allowedCandidates) : undefined,
      );
      if (parsed)
        return {
          route: {
            ...parsed,
            args: fillMissingArgs(parsed.args ?? {}, entities),
          },
          byModel: true,
        };
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
    if (
      [
        "rollcallQuery",
        "rollcallQuestion",
        "fundingQuery",
        "fundingQuestion",
        "procurementQuery",
        "procurementQuestion",
      ].includes(env.tool)
    )
      return { text: template, fromModel: false };
    // Out of budget (a second routing attempt, a split or a summary spent it):
    // the template, rather than a narration call the proxy would reject.
    if (!this.hasCallLeft(usage)) return { text: template, fromModel: false };
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
    const usage: Usage = { input: 0, output: 0, calls: 0 };
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
    // The Jev pre-step, when wired. A confident pick skips the Gemini routing
    // call entirely; anything less falls through to it unchanged.
    // The hook is an ACCELERATOR, so it must not be able to take the turn down:
    // a throwing implementation degrades to "no plan", which is the full Gemini
    // prompt — exactly the behaviour without Jev wired at all.
    let plan: AiTurnPlan | null = null;
    if (this.jevPlan && !followOn) {
      // The Jev call is reserved against the same per-question budget, so it is
      // counted whether or not it answers.
      usage.calls += 1;
      try {
        plan = await this.jevPlan(question, this.credentials);
      } catch {
        plan = null;
      }
    }
    // A compound request is split by the MODEL — the one thing Jev cannot do,
    // since it generates no text.
    //
    // ⚠️ BUDGET-BOUNDED. A question reserves POLICY.calls (3) upstream calls,
    // and the Jev pre-step already claims one. Splitting adds another, so it is
    // only affordable when Jev's pick ALSO removes the routing call — otherwise
    // jev + split + route + narrate is 4 and the turn 429s on its own narration.
    // When it is not affordable the turn answers the primary ask un-split,
    // which is what the lane does today anyway.
    const parts =
      plan?.compound && !followOn && jevRoutingStep(plan).kind === "run"
        ? await this.splitRequest(question, ctx, usage)
        : [question];
    const primary = parts[0];
    const {
      route: selectedRoute,
      byModel: routedByModel,
      byJev,
    } = followOn
      ? { route: followOn, byModel: false, byJev: false }
      : await this.routeWithPlan(primary, ctx, usage, routingCtx, plan);
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
      // Jev picked the tool (the model filled its parameters) — named in the
      // answer band, as the No-LLM lane does.
      ...(byJev
        ? { routedBy: "jev" as const, routerConfidence: plan?.toolConfidence }
        : {}),
    });
    if (!r && plan?.kind === "conversational") {
      // Jev says this is conversation, not a data question. The tools have
      // nothing to say, but a decline is a poor answer to a greeting — so the
      // model answers, through the grounding gate (see conversationalAnswer).
      const text = await this.conversationalAnswer(primary, ctx, usage);
      if (text)
        return {
          text,
          env: null,
          meta: {
            model: this.label,
            durationMs: performance.now() - t0,
            inputTokens: usage.input || undefined,
            outputTokens: usage.output || undefined,
            narratedBy: "model",
          },
        };
    }
    if (!r) {
      // The cloud lane reaches a declined question too (the model abstained, or
      // returned something unusable). The SAME shared decision as the rules lane,
      // so a typo behaves identically whichever model is selected (plan C6). The
      // answer carries no model involvement, so `usedModel` is false and the label
      // is the rules label.
      const declined = declinedAnswer(question, ctx);
      // Deliberately NOT `baseMeta`: that would carry the routing call's token
      // counts onto an answer labelled "No AI" and containing no model output. The
      // tokens were spent on a call that produced nothing usable, so attributing
      // them to this answer contradicts its own label.
      return {
        ...declined,
        meta: {
          model: RULES_LABEL,
          durationMs: performance.now() - t0,
          narratedBy: "rules",
        },
      };
    }
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
      // A compound turn answers its PRIMARY ask visually (one envelope is the
      // UI contract) and folds the other asks' facts into the narration
      // context, so the prose addresses both rather than silently dropping one.
      // Secondary parts route DETERMINISTICALLY — no extra routing call — which
      // keeps a split turn inside the per-question call budget.
      const secondary = await this.secondaryFacts(parts.slice(1), ctx);
      const { text, fromModel, reject } = await this.narrateEnv(
        env,
        ctx.lang,
        usage,
        secondary ? `${narrationCtx}\n${secondary}` : narrationCtx,
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
    const usage: Usage = { input: 0, output: 0, calls: 0 };
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
