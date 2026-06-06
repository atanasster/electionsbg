// Conversation memory for the chat — the layer that gives the assistant real
// multi-turn context WITHOUT letting history become a source of numbers.
//
// The chat is grounded: every figure comes from a tool's Envelope.facts, and the
// LLM only ever (a) picks {tool,args} and (b) narrates those facts. This module
// preserves that invariant. It distils each prior exchange into a structured
// `TurnMemory` whose `gist` is built straight from the Envelope — so the recent
// window carries grounded recall, while the older "summary" is reduced to bare
// TOPICS (the questions, never the figures). Compaction is a deterministic
// sliding window: the newest N exchanges stay verbatim; the rest fold into a
// one-line topic digest, and the window is then trimmed to a token budget. No
// LLM is required, it works offline, and it cannot hallucinate a number.

import type { Envelope, Lang, ToolArgs } from "../tools/types";
import { estimateTokens } from "./tokens";

// One prior exchange, distilled to what the next turn actually needs. `gist` and
// `args` come from the Envelope/route that produced the answer, so referencing
// them never invents data; numbers in `gist` stay tied to their title.
export type TurnMemory = {
  question: string; // the user's question that turn
  tool?: string; // tool that ran (undefined for clarify/error turns)
  args?: ToolArgs; // resolved args — lets a follow-on reuse the entity slot
  gist?: string; // "<title> — k1: v1; k2: v2", straight from the Envelope
  lang?: Lang; // the language the gist was generated in (env is localized)
};

// A windowed + compacted view of the conversation handed to a provider.
export type ConversationContext = {
  recent: TurnMemory[]; // sliding window, newest last (verbatim gists)
  summary?: string; // deterministic topic digest of everything older
  olderCount?: number; // how many exchanges the summary stands in for
};

// Per-provider context budgets. Cloud models have long context windows; the
// in-browser models are small with short windows, so they get a tighter budget
// and compact sooner.
export type ContextBudget = { recentTurns: number; tokens: number };
export const CLOUD_BUDGET: ContextBudget = { recentTurns: 6, tokens: 1200 };
export const WEBLLM_BUDGET: ContextBudget = { recentTurns: 3, tokens: 600 };

const MAX_GIST_FACTS = 3;

// Distil an Envelope to a one-line gist: its title + the first few facts. The
// title already names the subject/period (e.g. "National results — Oct 2,
// 2022"), so the gist conveys what was asked AND its headline figures, welded to
// their source. Kept short so the window stays within budget.
export const gistOf = (env: Envelope): string => {
  const facts = Object.entries(env.facts)
    .slice(0, MAX_GIST_FACTS)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return facts ? `${env.title} — ${facts}` : env.title;
};

// The minimal shape distill() needs from a chat message (structurally a Msg).
export type RawMsg = {
  role: "user" | "assistant";
  text: string;
  tool?: string;
  args?: ToolArgs;
  env?: Envelope | null;
  lang?: Lang;
};

// Turn the raw transcript into a flat list of completed exchanges (newest last).
// Each assistant turn that actually ran a tool is paired with the question that
// prompted it; clarify/error turns (no tool, no envelope) carry no context and
// are dropped. The in-flight turn must NOT be in `msgs` — callers pass only the
// history that precedes the current question.
export const distill = (msgs: ReadonlyArray<RawMsg>): TurnMemory[] => {
  const out: TurnMemory[] = [];
  let pendingQ: string | undefined;
  for (const m of msgs) {
    if (m.role === "user") {
      pendingQ = m.text;
      continue;
    }
    // an assistant turn closes the pending exchange
    if (pendingQ && (m.tool || m.env)) {
      out.push({
        question: pendingQ,
        tool: m.tool,
        args: m.args,
        gist: m.env ? gistOf(m.env) : undefined,
        lang: m.lang,
      });
    }
    pendingQ = undefined;
  }
  return out;
};

// Cheap count of completed exchanges — no gist building. The memory pill only
// needs the number, and it re-renders on every streaming token, so it must not
// re-run the full distill (which concatenates each Envelope's facts). Mirrors
// distill's pairing exactly.
export const countExchanges = (msgs: ReadonlyArray<RawMsg>): number => {
  let n = 0;
  let pending = false;
  for (const m of msgs) {
    if (m.role === "user") {
      pending = !!m.text;
      continue;
    }
    if (pending && (m.tool || m.env)) n += 1;
    pending = false;
  }
  return n;
};

const SUMMARY_CAP = 12; // distinct older topics kept in the digest
const TOPIC_MAXLEN = 60;

// A bounded, deterministic digest of older exchanges: the distinct topics the
// user already explored, ordered oldest→newest, capped. Only the QUESTIONS are
// kept — never the figures — so the summary can never reintroduce a stale number.
const summarize = (older: ReadonlyArray<TurnMemory>): string => {
  const seen = new Set<string>();
  const picked: string[] = [];
  // walk newest→oldest so the cap keeps the most recent topics, then reverse
  for (let i = older.length - 1; i >= 0; i--) {
    const q = older[i].question.trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    picked.push(
      q.length > TOPIC_MAXLEN ? `${q.slice(0, TOPIC_MAXLEN - 1)}…` : q,
    );
    if (picked.length >= SUMMARY_CAP) break;
  }
  return picked.reverse().join("; ");
};

const turnText = (t: TurnMemory): string =>
  t.gist ? `${t.question} ${t.gist}` : t.question;

// Build the windowed + compacted context. Deterministic: the newest exchanges
// stay verbatim (up to the turn cap), then the window is tightened one turn at a
// time until the recent gists PLUS the older-topic digest fit the token budget;
// everything outside the window folds into that digest. Counting the digest too
// keeps the rendered block honestly within budget (the digest is bounded, but a
// long tail of distinct topics still has a cost).
export const buildContext = (
  history: ReadonlyArray<TurnMemory>,
  budget: ContextBudget,
): ConversationContext => {
  if (!history.length) return { recent: [] };
  let keep = Math.min(history.length, budget.recentTurns);
  let summary = summarize(history.slice(0, history.length - keep));
  while (keep > 1) {
    const recentCost = history
      .slice(history.length - keep)
      .reduce((n, t) => n + estimateTokens(turnText(t)), 0);
    if (recentCost + estimateTokens(summary) <= budget.tokens) break;
    keep -= 1;
    // evicting a turn grows the older tail, so re-derive its digest
    summary = summarize(history.slice(0, history.length - keep));
  }
  const recent = history.slice(history.length - keep);
  const older = history.slice(0, history.length - keep);
  return older.length
    ? { recent, summary, olderCount: older.length }
    : { recent };
};

// Render the routing context block prepended to the model's user turn. Gives the
// router the thread so it can resolve references the keyword follow-on can't
// ("show the same for Plovdiv", "compare that to 2024"). Empty on the first turn
// — the provider then sends the bare question exactly as before.
export const renderRoutingContext = (
  ctx: ConversationContext,
  lang: Lang,
): string => {
  if (!ctx.recent.length && !ctx.summary) return "";
  const bg = lang === "bg";
  const lines: string[] = [bg ? "Разговор досега:" : "Conversation so far:"];
  if (ctx.summary) lines.push(`${bg ? "По-рано" : "Earlier"}: ${ctx.summary}`);
  for (const t of ctx.recent) {
    lines.push(`- ${bg ? "Въпрос" : "Q"}: ${t.question}`);
    if (t.gist) lines.push(`  ${bg ? "Отговор" : "A"}: ${t.gist}`);
  }
  return lines.join("\n");
};

// Render the (much shorter) narration context: only the immediately preceding
// answer's gist, so the prose can reference it for continuity ("higher than
// GERB's 25.3% above"). The grounding guard in the narration prompt still binds
// every number to the CURRENT facts, so this is for phrasing, not figures.
//
// The gist is dropped when it was generated in a different language than the
// current one: an Envelope's title + fact keys are localized, so feeding a
// Bulgarian gist into an English narration (after a mid-thread language switch)
// would read oddly — and cross-language continuity isn't expected anyway.
// Routing context keeps mixed-language turns: entity names there are robust and
// the reference is still worth resolving.
export const renderNarrationContext = (
  ctx: ConversationContext,
  lang: Lang,
): string => {
  const last = ctx.recent[ctx.recent.length - 1];
  if (!last?.gist || (last.lang && last.lang !== lang)) return "";
  return `${lang === "bg" ? "Предходен отговор" : "Previous answer"}: ${last.gist}`;
};
