# TypeSafe (Jev) evaluation for AI chat tool routing — v1

Status: **evaluation complete; adopted for the AI mode (2026-09-18).** This is the
measurement record. What was built from it, and the decision, are in
`docs/plans/jev-chat-integration-v1.md`. In short: Jev picks the tool and Gemini
fills its parameters in the AI mode (off by default until the proxy's `systemone`
action is deployed). The No-AI mode keeps the keyword rules; a Jev-based No-AI lane
is built and measured but not in the chat. §5's two architectures map to those
outcomes: (b) was adopted, and (a) was built and measured but not put in the chat.

## 1. What Jev is

Jev (`jev-latest`, TypeSafe's "System One" model) is not a text-completion LLM. It
answers one or more typed **questions** against a `state` (string/JSON) and returns
typed, constrained answers — no free-text generation, ever. Three question types:

| primitive | answer space | returns |
| --- | --- | --- |
| **Choice** | an ENUMERATED set of options you supply | the winning option + a probability over every option + `confidence` |
| **Score** | an ordered rubric (≥2 levels) you supply | a probability-weighted scalar + `confidence` |
| **Noul** | yes/no | a 0–1 probability, no `confidence` |

All questions in one request run in parallel against the same `state`, at near-zero
added latency per extra question. `POST https://api.typesafe.ai/v1/systemone`,
`$42/Btok` input (output free), 250k tok/s and 1,200 req/min rate limits. Full
citations in `ai/llm/fcEval.jev.ts`'s header.

**The one fact everything else in this document follows from:** there is no
primitive that *generates* a value. Choice/Score/Noul only select from candidates
supplied in the request. An open-vocabulary value — an arbitrary person's name, a
company EIK, a free-text search string, an arbitrary date — cannot be produced by
Jev under any configuration. Only a value drawn from a candidate list the caller
already enumerated can come back.

## 2. Assessment 1 — `choice` for tool selection

Modeled as one Choice question per turn: `criteria` = the tool catalogue
(`{name: description}`) + a `no_tool` sentinel (Choice must pick something, so
"call nothing" needs an explicit option). Implemented in `ai/llm/fcEval.jev.ts`,
wired into the shared artifact pipeline (`ai/llm/fcEval.artifact.ts` → 
`data/ai/evals/fc_eval.json`, source `jev-live`).

| model | EN acc | BG acc | latency | tokens in/out | $/call |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.1 Flash-Lite (production router, live) | 97% | 96% | — | — | — |
| **Jev, full registry (236 options)** | 96% | 95% | 492ms mean | 11,582 / ~2,600 | $0.00049 |
| Jev, retrieved k=5 candidates (synthetic retriever — see caveat) | 99% | 97% | 329ms mean | 559 / 84 | $0.000023 |

n = 231 real registry cases (every tool's bilingual example + 2 irrelevance probes),
235-tool registry (2026-09-18 snapshot). **Jev matches production-router accuracy on
the real, current registry.** It structurally cannot hallucinate a tool name outside
the list (Gemini/Gemma can and occasionally do).

**Confidence is well-calibrated** — the standout property Gemini's router doesn't
give you at all:

| confidence bucket | n | accuracy |
| --- | --- | --- |
| 0.0–0.5 | 22 | 59% |
| 0.5–0.7 | 42 | 83% |
| 0.7–0.9 | 68 | 94% |
| 0.9–1.0 | 326 | 100% |

Mean confidence: 0.905 when correct, 0.547 when wrong. A threshold around 0.7-0.8
would catch nearly every routing error for escalation.

**Caveats**: the k=5 row is a *synthetic* retriever (`candidateTools()` always
includes the correct tool + 4 fixed distractors) — a ceiling given perfect retrieval,
not a prediction of an actual retrieval stage's end-to-end accuracy. Latency (492ms
full-registry) is well above the docs' advertised "~100ms" because a Choice answer
returns a probability for *every* candidate — with 236 options that's ~2,600 output
tokens (free to bill, not free in wall-clock).

## 3. Assessment 2 — additional parameters, and the direct answer to
   **"how reliable is Jev for tool-call parameters?"**

This is the load-bearing finding of the whole evaluation. The honest answer is not a
single number — it depends entirely on whether the parameter's value space is
closed or open, and those two cases don't just differ in accuracy, they differ in
*whether the question is even answerable*.

### Closed-vocabulary parameters (party, oblast, scope, a literal year, a bucketed
date window) — **100% at n=122. See §7 for the scaled suite.**

First probe was 6 hand-written cases → 5/6, with the one miss correctly flagged at
the lowest confidence in the batch. That probe has since been **superseded by a
122-call corpus derived from the real committed vocabularies** (§7): **100.0%,
EN and BG alike**, across all four parameter families.

One finding from the small probe survives and is worth keeping: **Jev has no notion
of "today" unless the app puts it in `state`.** Asked to identify "the most recent
election" among dated candidates with nothing anchoring the present, it picked an
older one (at appropriately low confidence). Actionable requirement for any
relative-date param: inject the current date / latest-known value into `state`
explicitly, never rely on Jev to infer recency. The scaled corpus names elections
by month+year rather than by relative recency, which is why it scores 100% — that
is a property of how the question is posed, not evidence the caveat went away.

### Open-vocabulary parameters (person names, company names/EIKs, free-text search
terms, arbitrary dates) — **not "unreliable," structurally impossible.**

Jev cannot ever fill these directly — there is no candidate list to draw from
until *something else* enumerates one. This isn't a tuning gap; see §1.

**What Jev CAN do here — arbitrate a candidate list someone else built:**

- A Noul "does this message name a specific person/company" gate: **100%** on 6
  cases (clean names, misspelled names, party/place/generic non-names), cleanly
  separated (noul 0.96-0.98 for real mentions vs 0.02-0.08 for non-mentions). This
  only gates whether a lookup is worth running — it never extracts or locates
  anything.
- A Choice "which of these fuzzy-search candidates (if any) does the sentence
  mean" disambiguator: **100% on 8 hand-picked cases** with real entity names and
  deliberate misspellings/decoys, including a correct "none of these" refusal.
- **Against REAL production fuzzy-search output** (not curated candidates): **4/8
  (50%)**. Decomposed: 3 of 4 misses were **retrieval failures** — the correct
  person wasn't even in the candidate list your `person-search` route returned
  under the typo, so Jev couldn't have picked it regardless. Among the 5 cases
  where the correct candidate WAS actually offered, Jev got **4/5 (80%)** right —
  consistent with the curated-candidate result. One concerning detail: on one
  retrieval-failure case, Jev **confidently (0.72) picked a different real
  person** instead of abstaining — confidence did not reliably protect against
  "garbage in" in that single instance (n too small to rate this, but it's exactly
  the failure shape a production system most needs guarded against).

**Conclusion: Jev's own disambiguation is genuinely good (~80-100% given a
candidate list that contains the right answer) — but end-to-end reliability for
name-shaped parameters is bounded by retrieval, not by Jev.** This is why §4 exists.

⚠️ The 50%/80% figures above are the **n=8 exploratory probe** and are superseded
by the 318-call frozen-fixture suite in §7 (**95.0% overall — 93.3% `present`,
96.4% `absent`**). The exploratory numbers are kept because the *reasoning* they
produced — separating retrieval failure from disambiguation failure — is what the
scaled suite is built on; the rates themselves were small-sample noise.

## 4. The retrieval-layer finding (independent of the Jev decision, but why §3's
   numbers look the way they do)

Standalone test, no Jev: does `person-search`'s trigram fuzzy match even surface the
right person under a realistic typo? 120 queries (40 real MPs × 3 typo kinds)
against the live production API, then validated at scale read-only against Cloud
SQL (597,346-row `person_search`, 900-2,100 queries per point, `SET
pg_trgm.word_similarity_threshold` — session-scoped, nothing persisted, proxy
stopped after each run).

**Baseline (current 0.6 default) — all three tiers converge on ~41-42% overall,
and it's wildly uneven by typo shape:**

| typo kind | tier P (small sample) | production API confirm |
| --- | --- | --- |
| duplicate a letter | 98-99% | matches |
| drop a letter | 13-19% | matches |
| transpose two letters | 9-13% | matches |

Mechanically: `pg_trgm` similarity is trigram-overlap based. Dropping/transposing a
letter shifts every trigram after that point, destroying most of a word's overlap
with itself; duplicating a letter only corrupts trigrams touching that one spot. Drop
and transpose are also the two most common real typing errors — this isn't a
contrived edge case.

**Widening `pg_trgm.word_similarity_threshold` fixes it, but the optimum is
tier-dependent — and there is a real accuracy cliff, not just a cost cliff, past
each tier's optimum:**

| threshold | tier P (63,649 rows) | tier V (85,286 rows) | tier N (448,411 rows) |
| --- | --- | --- | --- |
| 0.6 (current default) | 41% | 42% | 42% |
| 0.45 | — | 75% | 76% |
| **0.42** | — | **76%** | **79%** |
| 0.4 | 92% | 74% | 77% |
| 0.38 | — | 74% | 76% |
| 0.35 | 94% | 66% | 70% |
| **0.3** | **96%** | 48% ⬇ | 48% ⬇ |
| 0.25 | 85% | 28% | 24% |

**The tier-P optimum (0.3) is one of the WORST settings for tiers V/N.** Past each
tier's own peak, accuracy *reverses* — the query's `LIMIT 8` starts binding as more
loosely-matching rows qualify and out-rank the true match on `rank_static`, pushing
it out of the returned window. A flat, single threshold cannot be right for all
three tiers; a **per-tier threshold** (P≈0.3, V/N≈0.42) is architecturally cheap
because the route already issues three separate tier-scoped queries per search.

**Open**: V/N cap out at 76-79% even at their own optimum, well short of P's 96% —
unexplained (possibly `rank_static`'s formula, tier size, or name-distribution
differences). Company-name typo behavior wasn't tested at this scale (the 2 cases
tested in §3 both survived retrieval fine). This is real follow-up work, independent
of any Jev decision — fixing it improves every consumer of `person-search`, not
just a hypothetical Jev integration.

## 5. Assessing the two proposed architectures

### (a) Full replacement of the Non-AI (deterministic) provider

The Non-AI provider (`ai/llm/heuristicRoute.ts` → `ai/orchestrator/router.ts`) is a
keyword/regex router feeding the same fixed answer templates the AI provider's
tool-call results feed. This is close to Jev's best-fit use case: **Jev can plausibly
replace the routing step in full** — 96% tool-selection accuracy at the real 235-tool
registry (vs a heuristic router's brittleness to phrasing), PLUS a calibrated
confidence signal the current heuristic router has no equivalent of at all (today it
either matches a rule or doesn't — no graded "I'm not sure, escalate" state).

For **parameters**, the fit is good specifically *because* the deterministic
templates already require enumerable, template-fillable slots — a rule-based router
was never going to handle genuinely open-vocab free text either. Whatever the
current router does for name-shaped args (presumably its own regex/DB matching), the
architecture validated in §3 (fuzzy search → Jev Choice disambiguation, WITH the §4
retrieval fix) is a strict upgrade: same retrieval mechanism, plus a context-aware
arbiter instead of "first/best string match wins."

**Recommendation: Jev is a well-supported candidate for a full swap of the Non-AI
provider's routing + closed-vocab param filling**, contingent on (i) scaling the
small param/disambiguation probes (n=6-8) into a real regression suite before
committing, and (ii) shipping the §4 retrieval fix first, since Jev's disambiguation
step is bounded by it regardless of provider.

### (b) Gemini-flash chat: Jev as pre-selector + call/no-call/respond-only gate

Given §3's boundary, the natural three-way split is by **parameter shape**, not a
blanket rule:

1. **Tool needs no params, or only closed-vocab params** (party/oblast/scope/year-
   literal/etc.): Jev can do tool selection AND param filling end-to-end, with a
   confidence gate. Gemini's role shrinks to (optionally) phrasing the final
   response over the resolved result — or skip Gemini entirely and reuse the
   deterministic templates from (a).
2. **Tool needs an open-vocab param** (name/company/free-text/date range): Jev
   still pre-selects/confirms the TOOL (its structural strength), but genuinely
   cannot fill the param. Two sub-paths, chosen by a cheap Jev Noul gate (the §3
   "does this name a specific entity" probe, 100% clean in this sample):
   - **not name-shaped** → let Gemini pick the parameter itself (its native
     strength) and call the tool.
   - **name-shaped** → run fuzzy search → Jev disambiguation (§3/§4), skip
     Gemini's own extraction, and use Gemini only to narrate the final answer over
     the already-resolved entity.
3. Either way, Jev's `confidence` is the natural signal for "let this proceed
   automatically" vs "ask Gemini/the user to confirm" — matching TypeSafe's own
   documented routing pattern.

This operationalizes your proposal directly: Jev pre-selects the tool always; for
parameters, Jev only self-serves when the space is closed; otherwise the decision of
"who fills this param" is itself a fast, cheap Jev gate rather than a hardcoded rule.

## 6. What hasn't been validated, and should be before committing

- Jev's `Choice` picks exactly one option — no native multi-select. A turn needing
  2+ tools (a real case in a multi-domain chat) isn't covered by anything measured
  here.
- The §4 retrieval fix was validated read-only against real Cloud SQL data but
  never applied; V/N's ceiling below P's is unexplained; company-name typo
  behavior wasn't tested at scale.
- No end-to-end trial of the full proposed 3-way Gemini/Jev split — each piece was
  validated in isolation.
- The regression suite (§7) covers closed-vocab args and name disambiguation. It
  does NOT yet cover tool selection — that still lives in the `fc_eval.json`
  artifact pipeline, with no floors attached.

## 7. The regression suite (scaled from the §3 probes)

`npx tsx ai/llm/jevRegression.run.ts` — 440 calls, ~40 s, ~$0.01 a run. Exits
non-zero when a floor is breached, which is what makes it a regression gate rather
than another measurement script.

**Corpora are derived, not hand-authored:**

- **Closed-vocab args (61 cases × 2 langs)** — generated from the real committed
  vocabularies: all 13 elections (`src/data/json/elections.json`), 20 of 28
  provinces (`regions.json`), 20 of 25 parties (latest election's `nickName`s),
  the `?pscope` contract, plus deliberate **negative cases** that name no value
  (so a model that never abstains cannot score well).
- **Name disambiguation (159 cases × 2 langs)** — FROZEN in
  `ai/llm/jevRegression.fixtures/disambiguation.json`, captured from the live
  fuzzy-search routes by `jevRegression.capture.ts`. Ground truth is fixed
  mechanically (the correctly-spelled anchor query's #1 hit), and cases are split
  into two classes that are **scored separately and never averaged**:
  `present` (the intended entity survived retrieval → must pick it) and `absent`
  (it did not → must refuse with `none_of_these`).

**Freezing is the point**: §4 measured retrieval alone swinging between 41% and 96%
depending on a threshold. Replaying frozen candidates isolates *Jev*; re-capturing
is an explicit act that shows up as a fixture diff.

### Baseline, 2026-09-18 (`jev-latest`, artifact `data/ai/evals/jev_regression.json`)

| suite | n | accuracy | EN | BG |
| --- | --- | --- | --- | --- |
| closed-vocab args | 122 | **100.0%** | 100.0% | 100.0% |
| — election / party / scope / oblast | 28/42/10/42 | 100% each | | |
| disambiguation overall | 318 | **95.0%** | 94.3% | 95.6% |
| — `present` (must pick) | 150 | 93.3% | | |
| — `absent` (must refuse) | 168 | 96.4% | | |
| — company present / absent | 52 / 26 | 100% / 100% | | |
| — person present / absent | 98 / 142 | 89.8% / 95.8% | | |

Latency 310-365 ms/call; $0.000022-0.000033/call. Confidence stays calibrated at
scale: disambiguation mean confidence **0.826 when correct vs 0.405 when wrong**,
and **81.3% of wrong answers land below the 0.7 gate**.

**Residual risk, named**: the ~19% of wrong answers ABOVE the confidence gate. In
the run that found them, two `absent` person cases were confidently wrong
(0.70-0.82) — Jev named a real but different person when the intended one was not
retrievable. That is the one failure shape that publishes a wrong claim about a
named individual, and it is why `disambigAbsent` has its own floor rather than
being averaged into overall accuracy.

### A corpus defect scored as a model failure — the reason the CI test exists

The first full run reported 98.4% on args, with both misses on `arg_oblast_PDV-00`.
Investigation: `regions.json` carries **both** `PDV` ("обл. Пловдив", the province)
and `PDV-00` ("Пловдив", the seat city), and the generated question asked which
**region** the sentence named. **Jev answered the province — which was correct —
and the corpus called it wrong.** Excluding the `-NN` seat-city rows took the suite
to 100%.

`ai/llm/jevRegression.cases.test.ts` (17 tests, 183 ms, no network, no API key)
now guards the corpus in CI: expected answer must be on offer, no two candidates
may share a display label, both languages present, negative cases present, no
seat-city code in the region vocabulary, fixture `klass` labels must be derivable
from the frozen candidates, and the typo generators must be deterministic and
actually change the name. Note honestly: the duplicate-label assertion would NOT
have caught PDV-00 (the two labels differ — "обл. Пловдив" vs "Пловдив"); the
explicit seat-city assertion is what covers it. A corpus defect is
indistinguishable from a model regression in the final number, which is the whole
reason this file is free to run.

### Floors (ratchets, with slack for corpus noise)

`argAccuracy 0.85` · `disambigPresent 0.75` · `disambigAbsent 0.75` ·
`wrongAnswersFlagged 0.50` below a `confidenceGate` of `0.7`. They sit below the
measured baseline deliberately — these corpora are 122-318 calls, so a couple of
flips is noise. Raise a floor only after an improvement holds; never lower one to
turn a red run green without recording why here.

## Appendix — files from this evaluation

- `ai/llm/fcEval.jev.ts` — Jev adapter: tool selection, closed-vocab args, name gate,
  curated name disambiguation; wired into `fcEval.artifact.ts` (source `jev-live`).
- `ai/llm/fcEval.jev.realNames.ts` — real-registry disambiguation probe (live
  `person-search`/`company-search`, ground truth from the correctly-spelled anchor
  query).
- `ai/llm/personSearchTypoTest.ts` — standalone retrieval-only typo test, live API,
  no Jev.
- `ai/llm/personSearchThresholdTest.ts` — isolated throwaway-Postgres threshold
  sweep (no prod contact).
- `ai/llm/personSearchThresholdTest.cloud.ts` — read-only threshold sweep against
  real Cloud SQL `person_search`, tier-parameterized.
- `ai/llm/jevRegression.cases.ts` — derived closed-vocab corpus + fixture loader +
  shared typo generators (pure, offline).
- `ai/llm/jevRegression.capture.ts` — captures the frozen disambiguation fixture
  from live search (rare, explicit; backs off on 429).
- `ai/llm/jevRegression.run.ts` — the suite: scores both corpora, enforces floors,
  writes `data/ai/evals/jev_regression.json`.
- `ai/llm/jevRegression.cases.test.ts` — no-network corpus-integrity gate for CI.
- `ai/llm/jevRegression.fixtures/disambiguation.json` — 159 frozen cases.
- `data/ai/evals/jev_regression.json` — the suite's artifact.
- `data/ai/evals/fc_eval.json` — regenerated at the current 235-tool registry,
  Jev added as a permanent row; the two Gemma rows are marked stale (108-tool-era)
  pending a re-measure once the Gemini-API rate limit that blocked it clears.
