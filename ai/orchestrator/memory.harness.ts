// Correctness harness for the conversation-memory layer (no model needed).
// Run: npx tsx ai/orchestrator/memory.harness.ts
//
// Covers the grounding-sensitive bits: gist distillation, exchange pairing,
// the sliding window + token-budget eviction, the bounded/de-duped older
// digest, and the rendered context blocks.

import type { Envelope } from "../tools/types";
import {
  buildContext,
  CLOUD_BUDGET,
  type ConversationContext,
  countExchanges,
  distill,
  gistOf,
  renderNarrationContext,
  renderRoutingContext,
  WEBLLM_BUDGET,
  type RawMsg,
} from "./memory";
import { estimateTokens } from "./tokens";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures += 1;
};

const env = (
  title: string,
  facts: Record<string, string | number>,
): Envelope => ({
  tool: "x",
  kind: "scalar",
  title,
  viz: "none",
  facts,
  provenance: ["t.json"],
});

// 1. gistOf: title + first 3 facts; title-only when there are none
ok(
  gistOf(env("T", { a: 1, b: 2, c: 3, d: 4 })) === "T — a: 1; b: 2; c: 3",
  "gistOf: title + first 3 facts (caps the rest)",
);
ok(gistOf(env("Solo", {})) === "Solo", "gistOf: title only when no facts");

// 2. distill: pairs each tool/env turn with its question; drops clarify turns
const transcript: RawMsg[] = [
  { role: "user", text: "results in 2022" },
  {
    role: "assistant",
    text: "...",
    tool: "electionResult",
    args: { election: "2022_10_02" },
    env: env("National results — Oct 2, 2022", { ГЕРБ: "25.3%", ПП: "20.2%" }),
  },
  { role: "user", text: "а ДПС?" },
  {
    role: "assistant",
    text: "...",
    tool: "partyResult",
    args: { party: "ДПС" },
    env: env("ДПС — 2022", { votes: "344,512" }),
  },
  { role: "user", text: "huh?" },
  { role: "assistant", text: "I'm not sure…", env: null }, // clarify → dropped
];
const turns = distill(transcript);
ok(turns.length === 2, "distill keeps only tool/env turns (clarify dropped)");
ok(turns[0].question === "results in 2022", "distill pairs the question");
ok(turns[1].tool === "partyResult", "distill carries the tool");
ok(
  turns[1].args?.party === "ДПС",
  "distill carries resolved args (for follow-on)",
);
ok(
  turns[0].gist === "National results — Oct 2, 2022 — ГЕРБ: 25.3%; ПП: 20.2%",
  "distill gist comes straight from the envelope",
);

// 3. sliding window: recent capped at the budget, older folds into the summary
const hist = Array.from({ length: 10 }, (_, i) => ({
  question: `q${i}`,
  gist: `T${i} — x: ${i}`,
}));
const c = buildContext(hist, CLOUD_BUDGET);
ok(c.recent.length === 6, "cloud window capped at 6 recent turns");
ok(
  c.recent[0].question === "q4" && c.recent[5].question === "q9",
  "recent = the last 6, in order",
);
ok(c.olderCount === 4, "olderCount counts the compacted tail");
ok(
  !!c.summary && c.summary.includes("q0") && c.summary.includes("q3"),
  "summary covers older topics",
);
ok(
  !!c.summary && !c.summary.includes("q9"),
  "summary excludes the recent window",
);
ok(
  buildContext(hist, WEBLLM_BUDGET).recent.length === 3,
  "webllm window capped at 3",
);
ok(
  buildContext([], CLOUD_BUDGET).recent.length === 0,
  "empty history → empty context",
);

// 4. token budget tightens the window below the turn cap
const tiny = buildContext(hist, { recentTurns: 6, tokens: 5 });
ok(tiny.recent.length < 6, "a tight token budget shrinks the window");
ok(tiny.recent.length >= 1, "the window never drops below one turn");

// 5. older digest: capped at 12 distinct topics, most-recent-kept, de-duplicated
const hist20 = Array.from({ length: 20 }, (_, i) => ({ question: `q${i}` }));
const big = buildContext(hist20, CLOUD_BUDGET);
const topics = (big.summary ?? "").split("; ");
ok(big.olderCount === 14, "older tail = 14 of 20");
ok(topics.length === 12, "older digest capped at 12 topics");
ok(
  topics[0] === "q2" && topics[topics.length - 1] === "q13",
  "digest keeps the most recent 12 older topics, oldest→newest",
);
ok(
  !topics.includes("q0") && !topics.includes("q1"),
  "oldest topics dropped past the cap",
);

const dup: { question: string }[] = [
  { question: "same" },
  { question: "same" },
  { question: "other" },
  { question: "same" },
  ...Array.from({ length: 6 }, (_, i) => ({ question: `r${i}` })),
];
ok(
  buildContext(dup, CLOUD_BUDGET).summary === "other; same",
  "digest de-duplicates repeated questions",
);

// 6. rendered blocks
const rc = renderRoutingContext(c, "en");
ok(rc.startsWith("Conversation so far:"), "routing block has the header");
ok(rc.includes("Earlier:"), "routing block includes the older summary");
ok(
  rc.includes("Q: q9") && rc.includes("A: T9 — x: 9"),
  "routing block lists recent Q/A",
);
ok(
  renderRoutingContext({ recent: [] }, "en") === "",
  "no history → empty routing block",
);
ok(
  renderRoutingContext(c, "bg").startsWith("Разговор досега:"),
  "routing block localizes to Bulgarian",
);

const nc = renderNarrationContext(c, "en");
ok(
  nc === "Previous answer: T9 — x: 9",
  "narration block = the most recent gist only",
);
ok(
  renderNarrationContext({ recent: [] }, "en") === "",
  "no recent → empty narration block",
);

// 7. countExchanges matches distill's count without building gists
ok(
  countExchanges(transcript) === distill(transcript).length,
  "countExchanges matches distill().length",
);
ok(
  countExchanges(transcript) === 2,
  "countExchanges counts completed exchanges",
);
ok(countExchanges([]) === 0, "countExchanges of empty transcript is 0");

// 8. narration context is dropped when the previous gist's language differs from
// the current one (a mid-thread EN/BG switch must not feed wrong-language prose)
const enThenBg: ConversationContext = {
  recent: [
    { question: "results", gist: "National results — a: 1", lang: "en" },
  ],
};
ok(
  renderNarrationContext(enThenBg, "en").includes("National results"),
  "narration context kept when languages match",
);
ok(
  renderNarrationContext(enThenBg, "bg") === "",
  "narration context dropped when the gist language differs",
);
ok(
  renderNarrationContext(
    { recent: [{ question: "q", gist: "T — a: 1" }] },
    "bg",
  ).includes("T — a: 1"),
  "untagged gist (back-compat) is kept regardless of language",
);

// 9. the older digest is counted against the routing token budget. With a tight
// budget the window tightens to make room for the digest (down to the 1-turn
// floor); the digest itself is capped, so it's a floor, not an overflow.
const longTopics = Array.from({ length: 30 }, (_, i) => ({
  question: `distinct question number ${i} about elections`,
}));
const budgeted = buildContext(longTopics, { recentTurns: 6, tokens: 40 });
const recentTokens = budgeted.recent.reduce(
  (n, t) => n + estimateTokens(t.gist ? `${t.question} ${t.gist}` : t.question),
  0,
);
ok(!!budgeted.summary, "a long tail still produces a summary digest");
ok(
  budgeted.recent.length === 1 ||
    recentTokens + estimateTokens(budgeted.summary ?? "") <= 40,
  "summary tokens are counted in the budget (window tightens to fit both)",
);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — conversation memory`,
);
process.exit(failures === 0 ? 0 : 1);
