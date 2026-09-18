# Jev in the Наясно chat — integration plan v1

Status (2026-09-18): **all five tiers built; the AI-mode lane is the one chosen
for the chat.** Measurements this builds on are in
`docs/plans/jev-typesafe-eval-v1.md` (the evaluation record); this file is the
"what we would actually build" half. Results for every lane are on the chat's
`/evals` page.

What was decided, and where it lives:

- **AI mode — adopted.** Jev picks the tool, and Gemini fills its parameters from a
  one-tool prompt (`jevRoutingStep`, `ai/llm/jevAiLane.ts`). On a Jev failure or
  low confidence, the question goes to Gemini with the whole catalogue, never to
  keyword rules. The compound split (§4) and the conversational answer (§5) are in
  `ai/llm/openrouter.ts`. Measured against Gemini alone on the same 474 questions
  and the same day: parameters 94.3% / 90.6% vs 83.0% / 77.4% (EN / BG), and an
  average prompt of 3,697 vs 16,150 tokens. It is also better on typos, rewording
  and Latin script. **Off by default** until the proxy's `systemone` action is
  deployed (`functions/README.md`). Then `VITE_JEV_ROUTING=1` switches it on for
  everyone (`ai/llm/useModelEngine.ts`).
- **No-AI mode — built and measured, not adopted.** `JevProvider` (`ai/llm/jev.ts`)
  does T1-T3, plus a stage this plan did not have: parameters read from the
  question by type (`ai/llm/jevParamExtract.ts`), and a clarifying question instead
  of the rules' tool when one cannot be filled. On the robustness questions it is
  far ahead of the rules: with typos, 75% / 67% right vs 28% / 34%. The public
  No-AI mode still uses the keyword rules, because Jev is called through our
  server and that mode is designed not to depend on it.
- **§8's three-lane comparison was dropped from the page.** The main question bank
  is 91% sentences the rules were built from, so comparing Jev with the rules on it
  was biased toward the rules. Those runs are in `ai/evals-internal/`. The page
  compares the methods on typos, rewording and Latin script instead.

## 0. What we know going in

From the evaluation, the three numbers that decide the shape of everything below:

| capability | measured | n |
| --- | --- | --- |
| tool selection, full 235-tool registry | 96% EN / 95% BG, 492 ms, $0.0005/call | 231 |
| closed-vocab parameter selection | **100%** EN and BG | 122 |
| name disambiguation over real fuzzy-search candidates | 95.0% (present 93.3% / refuse 96.4%) | 318 |
| **open-vocab parameter generation** | **structurally impossible** | — |

Plus: confidence is calibrated (100% accuracy above 0.9; 81% of wrong answers
land below 0.7), and Jev has no notion of "today" unless `state` says so.

## 1. Goal and scope

Use Jev as the **routing and constrained-decision layer** of the chat, in two
lanes:

- **Non-AI lane** — replace the keyword router (`ai/orchestrator/router.ts` via
  `heuristicRoute.ts`) with Jev, keep the deterministic answer templates
  (`narrate()`) exactly as they are. No LLM writes prose in this lane, before or
  after.
- **AI (Gemini Flash) lane** — Jev pre-selects the tool and decides *who fills
  the parameters*; Gemini either still makes the tool call with its own
  arguments, or is handed already-executed tool results and only writes the
  user-facing text.

Out of scope for v1: replacing the retriever, multi-tool turns beyond the
compound-splitting path in §4, anything that changes `narrate()` templates.

## 2. Architecture

A new `JevProvider implements LLMProvider` (`ai/llm/jev.ts`), sitting beside
`HeuristicProvider`. It **reuses the same tools and the same `narrate()`
templates** — only the routing and argument-filling steps change. That keeps
`narratedBy: "rules"` truthful and leaves the answer panel's trust line
("Figures are computed from official data, not generated") literally true.

One turn, one `POST /v1/systemone` call, several questions **batched in
parallel** (adding questions barely moves latency — the whole reason the
smart-home demo batches upfront instead of asking sequentially):

```
questions: {
  tool:        Choice  over the tool catalogue + `no_tool`
  is_compound: Noul    "asks for more than one distinct thing"   (§4)
  kind:        Choice  data-question | conversational | off-topic (§5)
}
```

Then, in code:

1. `confidence < GATE` → treat as no route, and degrade **within the user's
   lane** exactly as §6 requires (Non-AI: near-miss chooser / `clarify()`;
   AI: hand the turn to the full Gemini prompt). Low confidence and an
   unavailable Jev take the same exit for the same reason.
2. Resolve arguments (§3) — a second Jev call only when a param needs it.
3. Run the tool, narrate from templates (Non-AI) or hand results to Gemini (AI).

**Tool-set size**: v1 sends the **full registry** (96%, 492 ms, one call, no
dependency on retriever recall) rather than the k=5 retrieved set. The k=5
figure (99%) came from a *synthetic* retriever that always contained the gold
answer, so it is a ceiling, not a prediction — §6 measures the retrieved variant
through the real retriever before we consider it an optimization.

## 3. Arguments — a per-parameter dispatch, not one strategy

This is where the evaluation's hard boundary lands. Each registry param gets one
of three fill strategies, declared in the registry rather than inferred:

| param shape | filler | evidence |
| --- | --- | --- |
| **closed vocab** (election, party, oblast, scope, CPV division, sector id…) | Jev `Choice` over the enumerated set | 100% (n=122) |
| **name-shaped** (person, company) | existing trigram search → Jev `Choice` over real candidates + `none_of_these` | 95.0% (n=318) |
| **open vocab** (free-text `q`, arbitrary dates, EIK, numbers) | **deterministic extraction as today**; in the AI lane, Gemini | Jev cannot generate values |

New registry metadata is required: `param.enumerate?: (ctx) => Record<string, string|null>`
for the closed-vocab set, and a `param.entity?: "person" | "company"` marker for
the name-shaped set. Params with neither keep today's deterministic parsing
untouched — **the conservative default is "nothing changes"**.

Two rules that come straight out of the measurements:

- **Inject "today" into `state`.** Jev picked an older election when asked for
  "the most recent" with nothing anchoring the present. Any relative-time param
  (`последните избори`, "this year") gets the current date and the latest
  election date passed in `state` explicitly.
- **A name-shaped param must be allowed to refuse.** `none_of_these` is always
  an option; a refusal routes to the existing disambiguation chooser
  (`clarifyEnvelope`), never to a guess. The `absent` class scored 96.4%, and
  the residual failures are the ones that would name the wrong human.

## 4. Splitting a compound user request

Mirrors the TypeSafe smart-home demo: a `Noul` in the same batched call asks
whether the request contains more than one distinct ask. Above threshold, the
lanes diverge — deliberately:

- **AI lane**: Gemini splits the request into atomic questions, each is routed
  by Jev independently (parallel), each tool runs, and Gemini narrates one
  combined answer over the combined results. This is the demo's pattern exactly,
  and it is the only place an LLM is allowed to do the splitting.
- **Non-AI lane**: there is no LLM to split with, and inventing a regex splitter
  would be a new brittle parser of exactly the kind Jev is replacing. So the
  Non-AI lane **answers the highest-probability intent and offers the other as a
  follow-up suggestion chip** (the chat already renders suggestion chips). It
  never silently drops the second ask, and it never fabricates a second answer.

`Choice`'s single-pick nature is the constraint here: it returns one tool, so
multi-intent handling has to come from splitting the *request*, not from asking
for multiple tools.

## 5. Falling back to a conversational LLM

The batched `kind` Choice separates three cases:

- **data-question** → the tool path above.
- **conversational / general-knowledge** → AI lane hands it to Gemini for a
  freeform answer; Non-AI lane keeps today's behaviour (near-miss chooser, else
  `clarify()`), because a lane with no LLM has nothing to generate prose with.
- **off-topic** → `no_tool`, today's decline path in both lanes.

⚠️ **Any Gemini prose on this path still goes through the existing
grounded-number gate.** The conversational fallback is the most likely place for
an ungrounded figure to appear, precisely because no tool ran — the gate must not
be bypassed just because the turn was classified "conversational".

## 6. Degrading when Jev is down or rate-limited

Non-negotiable: **the chat must never fail, or hang, because an external
classifier is unavailable.**

⚠️ **The fallback is LANE-PRESERVING — it never changes what the user chose.**
Jev is a routing accelerator inside a lane, not a bridge between lanes:

| user selected | Jev unavailable / can't process → falls back to |
| --- | --- |
| **Non-AI** | the deterministic router (`selectHeuristicRoute()`) — **never** an LLM |
| **AI** | the **full Gemini prompt**: Gemini does its own tool selection and its own arguments, i.e. exactly today's AI behaviour — **never** the deterministic router |

Getting this backwards in either direction is a product bug, not a tuning
detail: degrading the Non-AI lane into an LLM call breaks the promise that lane
exists for, and degrading the AI lane into keyword routing silently downgrades a
user who asked for the model to a weaker answer than they'd have got without Jev
in the path at all.

The ladder, in order:

1. Jev call with a hard timeout (**1200 ms**; measured p95 is ~656 ms at full
   registry, so this is ~2× headroom, not a guess).
2. On timeout / 429 / 529 / 5xx / malformed answer → fall through **to that
   lane's own fallback** per the table above, in the same turn. The user sees an
   answer, not an error.
3. **Circuit breaker**: after N consecutive failures, skip Jev entirely for M
   seconds so an outage costs one timeout, not one per turn. Half-open retry
   after the window. While the breaker is open each lane simply runs its own
   fallback — which, for the AI lane, is precisely today's production path.
4. The response records what actually ran (§7) — a degraded turn must not be
   labelled as Jev-routed.

Note this makes the AI lane's worst case **strictly no worse than today**: with
Jev down it is today's pipeline, plus at most one 1200 ms timeout on the first
turn before the breaker opens. The Non-AI lane's worst case is likewise exactly
today's deterministic behaviour.

Retry policy inside step 1 is deliberately **one attempt, no backoff-retry** in
the request path: the SDK-style exponential backoff belongs in offline/eval
runs, not in a turn a human is waiting on.

## 7. Chat UI — showing when Jev routed the answer

The answer panel already renders a "how this was produced" band
(`MetaLine` in `ai/render/AnswerView.tsx`): `{model} · {duration}` plus a hover
tooltip with tokens and the trust line.

Changes:

- `ResponseMeta` gains `routedBy?: "rules" | "jev"`, `routerConfidence?: number`
  and `routerDegraded?: boolean`.
- The band renders the router as its own segment — `Без AI · Jev · 0,4 с` /
  `No AI · Jev · 0.4 s`.
- **On a degraded turn the band shows whatever actually answered, per lane**
  (§6): the deterministic router in the Non-AI lane, `Gemini Flash` alone in the
  AI lane. The Jev segment simply disappears — it must never appear on a turn
  Jev did not route.
- The tooltip gains the routing confidence and, when degraded, one line saying
  Jev was unavailable and naming what answered instead.
- `model` keeps its current meaning (who wrote the prose). In the Non-AI lane
  that stays the templates, so `narratedBy: "rules"` is unchanged.

⚠️ **The "Без AI / No AI" label needs rethinking, and this is an honesty issue,
not a copy tweak.** Today that label means "no model, no external call". Routing
through Jev makes it an external model API call — cheap, constrained and
non-generative, but a model call nonetheless. Options: rename the lane
(«Без LLM» / "No LLM"), or render it as two segments so the model is visible
(«Без LLM · Jev»). What we must not ship is a turn that says "No AI" while a
hosted model chose the tool. Decide this before Tier 1 ships, with BG copy that
reads naturally rather than word-for-word from English.

## 8. Evals — the three-way comparison on the chat evals page

**One bank, three lanes.** All three must be scored by the SAME scorer over the
SAME cases, or the comparison is meaningless — scoring the same question two
ways by lane is a trap this repo has hit before (see `nonAiEval.ts`'s
`normalizeRoute` comment).

- Bank: the existing **841 cases** (`NON_AI_CASES` — registry 402, starter 367,
  challenge 20, realistic 24, clarification 8, conversation 8, holdout 6,
  unsupported 6), EN + BG.
- Lane A — **Non-AI (deterministic)**: `data/ai/evals/non_ai.json`, exists.
- Lane B — **Gemini Flash**: the `current_*.json` runs, exist, indexed by
  `data/ai/evals/index.json`.
- Lane C — **Jev**: NEW `data/ai/evals/current_jev.json`, written by a new
  `ai/llm/jevLane.run.ts` that reuses `nonAiEval`'s row shape and metric
  definitions verbatim (tool accuracy, call accuracy, argument accuracy, per
  language, per group).

Cost/time for lane C: 841 × 2 = **1,682 calls ≈ $0.85 and ~3 minutes** at
concurrency 8. Cheap enough to re-run on every registry change.

Two reporting requirements:

- **Report the escalation rate as a first-class metric, not a footnote.** Jev is
  the only lane that can say "I'm not sure" (confidence gate). A lane that
  abstains 20% of the time and is right 99% of the rest is a different product
  from one that always answers at 96% — the page must show both numbers or the
  comparison flatters Jev.
- **Keep `jev_regression.json` separate.** That artifact is the *gate* (floors,
  frozen fixtures, exits non-zero); this is the *comparison*. Merging them would
  make a corpus change look like a model change.

Page work: `ai/app/EvalsScreen.tsx` gains a three-lane comparison view; the
manifest (`evalsIndex.ts`) already picks up any `current_*.json`, so lane C
appears without editing the page's filenames — and `evalsIndex.test.ts` keeps
the index honest.

## 9. Sequencing

| tier | scope | gate to proceed |
| --- | --- | --- |
| **T1** | `JevProvider`: batched tool Choice + confidence gate + §6 degradation ladder + §7 UI. Arguments stay deterministic. | Lane-C eval ≥ Non-AI lane on tool accuracy, both languages; **unit tests pin the lane-preserving fallback in BOTH directions** (Non-AI never reaches an LLM; AI never falls to keyword routing) — a stubbed-failing Jev must produce today's behaviour per lane |
| **T2** | Closed-vocab argument filling (§3, registry `enumerate` metadata) | argument accuracy ≥ Non-AI lane; `jevRegression` floors hold |
| **T3** | Name-shaped params: fuzzy search → Jev disambiguation (§3) | `absent`-class refusal rate holds ≥ floor on the frozen fixture |
| **T4** | AI lane: compound splitting (§4) + conversational fallback (§5) | grounded-number gate still passes on every generated answer |
| **T5** | Three-lane comparison view on `/evals` (§8) | `evalsIndex.test.ts` green |

T3 has a **hard prerequisite**: the person-search trigram threshold work from
`jev-typesafe-eval-v1.md` §4. At today's 0.6 default the right person survives a
dropped/transposed letter only 9-19% of the time, so a disambiguation layer on
top of it is arbitrating a list that usually lacks the answer.

## 10. Risks and open questions

- **External dependency in the request path.** Even with §6, the Non-AI lane
  stops being self-contained. The degradation ladder plus the honest label (§7)
  is the mitigation; the residual risk is a slow-but-not-timed-out Jev adding
  latency to every turn.
- **Multi-tool turns are unmeasured.** §4 is a design, not a measured result —
  no eval in this repo currently covers a turn needing two tools.
- **The retrieved-k variant is unvalidated end to end.** Measure through the
  real retriever (§2) before trading the full-registry call for it.
- **Confidence above the gate can still be wrong.** ~19% of wrong answers sat
  above 0.7; two `absent` cases were confidently wrong and named a real but
  different person. Name-shaped params are where this bites, which is why §3
  routes a refusal to the chooser rather than to a guess.
- **Jev version drift.** `jev-latest` moves when TypeSafe ships; confidence
  thresholds tuned against one version can shift under another. Pin the
  versioned id (`jev-1.13.0`) in production and move deliberately, per their
  docs' own advice.
