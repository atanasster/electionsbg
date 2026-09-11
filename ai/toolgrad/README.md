# ToolGrad-inspired civic chat pilot

This is an offline, answer-first dataset pilot for the existing one-tool chat.
It adapts ToolGrad's execution-before-question idea; it does not reproduce its
API-search algorithm or fine-tune the hosted model.

## Capture

```sh
node --import tsx ai/toolgrad/capture.run.ts data/ai/toolgrad/corpus.json
```

The 24 explicit workflows cover elections, procurement, people and municipal
data. Each runs in Bulgarian and English against real tool implementations,
local JSON files and the real DB route handlers on local PostgreSQL. DB queries
run in read-only transactions. PostgreSQL must already be populated. No ingest,
database migration or production write is performed.

Capture fails on invalid arguments, clarification, missing required facts or an
empty table/series. A genuine scalar zero remains valid. It writes only after all
48 executions pass, refuses to overwrite an existing artifact, and stores the
capture time, code commit, seed hash and input fingerprints. Per-capture `evidence`
lists fresh reads only. The shared `inputs` inventory includes all observed reads
across the run, including inputs reused by resolver/module caches on later calls;
it is deliberately not an exact per-call dependency graph. Re-capture to a new
path when code/data changes. Input hashes identify what was read; they do not
preserve the source bytes or make the multi-source capture atomic.

**Execution-verified is not independently fact-checked.** These checks establish
that the specified tool produces an answer with the required fields. A plausible
but incorrect source or aggregation still needs the existing data gates and
human interpretation review. Seed scope notes explicitly preserve distinctions
such as declared versus audited wealth, contracted versus paid money, and a
screening signal versus a finding of wrongdoing.

The captured corpus is a dated research artifact, not a source for live answers.
All runtime figures continue to come from tools.

Reference: [ToolGrad paper](https://arxiv.org/html/2508.04086v3) and
[official implementation](https://github.com/zhongyi-zhou/toolgrad).

## Question generation and review

```sh
node --env-file=.env.local --import tsx ai/toolgrad/generate.run.ts data/ai/toolgrad/corpus.json /tmp/toolgrad-new
# Resume into another new directory (prior successful completions are reused):
node --env-file=.env.local --import tsx ai/toolgrad/generate.run.ts data/ai/toolgrad/corpus.json /tmp/toolgrad-resumed /tmp/toolgrad-new
```

The operator client uses the production Gemini model and payload limits. Each
invocation has a maximum of 96 requests, with two attempts per unfinished batch.
`generation.json` retains raw responses, prompts, usage and failed validation.
The reservation ceiling is not a bill; absent provider cost remains unknown.

Only generic tool contracts and placeholder arguments go to Gemini. Captured
facts, names and identifiers stay local; placeholders are restored after generation.
This is a privacy-preserving adaptation of execution-first generation, not a full
ToolGrad textual-gradient reproduction. Local semantic critique corrects questions
against captured envelopes; no model training or remote fact-judging happens.

Committed artifacts: `questions.raw.json` preserves the final generation output;
`generation.json` consolidates all attempts from the three runs; `questions.json`
has 144 locally agent-reviewed questions (24 workflows × 2 languages × 3 styles).
`question-review.json` records every local correction and three authored replacements
for a rejected batch. This is agent review, not human sign-off or independent fact checking.
The non-typo styles favor ordinary language; proper names may remain in Cyrillic
inside English questions. Generated prose can reflect the catalogue's vocabulary.

The split was fixed before generation: 108 development questions and 36 held-out
questions from six entire workflows. Related paraphrases and language variants
never cross the split. Semantic curation may inspect held-out questions for validity;
prompt development must use development failures only. Existing hand-written
`ai/llm/currentEval.realistic.ts` cases provide a separate reference set, although
it predates this pilot and may already have influenced the production prompt.

## Evaluation and decision

```sh
node --env-file=.env.local --import tsx ai/toolgrad/evaluate.run.ts development baseline /tmp/tg-dev-base
# Freeze data/ai/toolgrad/candidate.json using development failures only, then:
node --env-file=.env.local --import tsx ai/toolgrad/evaluate.run.ts development candidate /tmp/tg-dev-candidate
node --env-file=.env.local --import tsx ai/toolgrad/evaluate.run.ts validation baseline /tmp/tg-val-base
node --env-file=.env.local --import tsx ai/toolgrad/evaluate.run.ts validation candidate /tmp/tg-val-candidate
node --env-file=.env.local --import tsx ai/toolgrad/narration.run.ts /tmp/tg-narration
```

Evaluation has no retries: model mistakes and API failures stay in the denominator.
Each invocation writes to a new directory with a request cap equal to suite size.
Reports preserve prompts, task/score hashes, outputs, token usage and request timings.
Development uses 108 questions; validation uses 36 held-out questions plus 80
language variants of pre-existing hand-written cases. Private entities are replaced
with explicit synthetic identities before transmission; this does not evaluate real
name resolution. Real corpus envelopes are never sent for evaluation.

Generated calls are compared in full after argument validation/defaults, including
supported date/place aliases; unknown raw keys are rejected before the production
parser can remove them. Reference scoring intentionally reuses the existing scorer
and its partial argument annotations. `toolCorrect` counts exact selected tool names;
reference `callCorrect` allows the production parser's narrow supported tool aliases,
so normalized call success can exceed exact tool-name success.

`rescore.run.ts <report.json> [...]` updates scores from retained model outputs without
new API calls; original/current scoring hashes and the reason remain in the artifact.
The committed reports were rescored to catch unknown raw argument keys, without
changing any labels or the resulting aggregate counts. `summarize.run.ts` regenerates
`summary.json` from the four completed reports and local narration review; it does not
promote anything. See [RESULTS.md](RESULTS.md) for this pilot's measured outcome and
limitations. The candidate is **not** imported by the production chat.
