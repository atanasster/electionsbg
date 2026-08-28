# OpenRouter free-model news-analysis pilot — 2026-08-28

## Decision

Do not move the unattended news-analysis job to any tested OpenRouter free
endpoint yet. The final, fully verified configuration produced only 5 valid
records from 9 requests and its leaning macro-F1 against the existing
reference was 0.222.

The local `gemma4:12b` follow-up was operationally reliable (9/9 valid) and
free of API charges, but slow on this host: 99.52 s median, 131.39 s p90 and
17.10 minutes for nine articles, or about 31.6 articles/hour. Its agreement
was mixed: stronger than the best OpenRouter pilot on political leaning, but
weaker on quality, topics and AI-generation assessment. It is a useful gold-set
candidate, not yet a demonstrated production replacement.

Use the free endpoints for experimentation or overflow only. For production,
keep the current reviewed GLM-5.3 analyses while completing the 240-article
stratified gold set, then compare a stable low-cost paid endpoint and the local
model against independently adjudicated reference records.

## What is configured today

- Existing analysis records: 333 `GLM-5.3`, 29 `GLM-5.3 (pilot)`, 3 local
  `gemma-4-12b-it-Q4_K_M.gguf`.
- The unattended runner defaults to
  `http://127.0.0.1:8080/v1/chat/completions` and model `local-model` unless
  `NEWS_LLM_URL` / `NEWS_LLM_MODEL` override them.
- Temperature 0.2; thinking disabled; strict GBNF locally and strict JSON
  Schema on hosted APIs; article body capped at 6,000 characters; output cap
  previously 2,048 tokens.
- This benchmark uses OpenRouter's strict JSON Schema request, requires a
  provider that supports the requested parameters, requests reasoning effort
  `none`, and records the model ID OpenRouter actually served.

## Live free-model catalog

The OpenRouter catalog returned 21 zero-priced model IDs on 2026-08-28. The
pilot selected six text models advertising `response_format` and/or
`structured_outputs`, covering a near-baseline GLM, a large general model, a
multilingual Gemma, a small speed floor, and two additional structured-output
candidates. Audio-generation and content-safety-specialist endpoints were
excluded because they do not perform this task; the `openrouter/free` router
was excluded because changing the underlying model between articles would
make accuracy and latency uninterpretable.

## Frozen pilot set

Nine already-analysed articles, deliberately spanning: `too_short`,
`non_article`, political neutral/progressive/conservative, Russia
anti/neutral/pro, and `ai_generated: unclear`. The list is versioned in
`news/evals/openrouter_pilot.json`.

The existing analyses are an **agreement reference, not human gold**. Their
skew and earlier rubric errors make them unsuitable for a real accuracy claim.
Resolved mentions are not scored because those reference records predate the
mentions block.

## Results

| model / setting | valid | median wall time | p90 | useful agreement signal |
| --- | ---: | ---: | ---: | --- |
| GLM-5.2 free, 2,048 | 2/9 | 7.45 s* | 8.92 s* | Both valid rows matched, but n=2; 7 upstream 429 failures |
| Nemotron 3 Super free, 2,048 | 2/9 | 28.75 s | 41.69 s | Quality 1/2; topics 0/2; seven malformed or reasoning-prose replies |
| Gemma 4 26B free, 2,048 | 0/9 | 6.64 s | 6.83 s | All requests exhausted retries on upstream 429 |
| LFM 2.5 2.6B free, 2,048 | 0/9 | 6.75 s | 9.35 s | Spent the full output budget on reasoning and returned empty content |
| Dots3 Note free, 2,048 | 3/9 | 19.24 s | 20.18 s | Mostly reasoning-budget exhaustion; quality agreement 1/3 |
| MiniMax M3 free, 2,048 | 0/9 | 16.34 s | 20.04 s | Ignored schema or emitted malformed JSON |
| Dots3 Note free, 4,096, pre-payload-fix | 6/9 | 19.46 s | 36.29 s | quality 0.833; topic top-1 0.333; leaning macro-F1 0.617; Russia macro-F1 0.630; AI macro-F1 1.000 |
| **Dots3 Note free, 4,096, verified controls** | **5/9** | **14.24 s** | **17.31 s** | quality 0.800; topic top-1 0.750 (n=4); leaning macro-F1 0.222 / κ 0.000 (n=2 positioned); Russia macro-F1 1.000 (n=2 positioned); AI macro-F1 0.571 |
| **Local Gemma 4 12B Q4_K_M, 2,048** | **9/9** | **99.52 s** | **131.39 s** | quality 0.667; topic top-1 0.625 (n=8); leaning macro-F1 0.709 / κ 1.000 (n=3 positioned); Russia macro-F1 0.667 / κ 0.800 (n=3 positioned); AI macro-F1 0.470 |

`*` The first run recorded the final successful attempt rather than full wall
time for successful retries. That instrumentation defect is fixed; do not use
the GLM-5.2 latency row for capacity planning. Failed-request timings and the
later runs already measured complete wall time.

The first three run groups encoded their JSON body before adding the new
OpenRouter provider/reasoning controls, so those controls were not actually on
the wire. A payload-level regression test caught the ordering bug. Their
model/availability results remain measurements of strict `response_format`
requests, but only the last Dots row verifies `provider.require_parameters`
and `reasoning: {effort: none, exclude: true}` end to end.

Every OpenRouter response reported cost `0`. That does not make the service
operationally free: upstream 429s and invalid records reduce throughput, and
retrying them consumes the nightly window.

The local run used Docker Model Runner at
`http://127.0.0.1:12434/v1/chat/completions`, requested
`docker.io/ai/gemma4:12b`, and every response reported the served artifact
`gemma-4-12b-it-Q4_K_M.gguf`. The full GBNF + JSON Schema constraint passed a
preflight canary and all nine replies passed the cross-field validator. Local
inference has no per-request API bill; host electricity and hardware time are
not measured here.

## Artifacts

- Four-model run: `news/data/evals/20260828T133041Z/`
- Dots + MiniMax run: `news/data/evals/20260828T134012Z/`
- Dots 4,096-token run: `news/data/evals/20260828T134611Z/`
- Dots 4,096-token run with verified provider/reasoning controls:
  `news/data/evals/20260828T135203Z/`
- Local Gemma 4 12B run: `news/data/evals/20260828T140027Z/`

These directories are local and gitignored because they contain copied corpus
records and raw model replies. Each has `summary.json`; each model directory
has a full `report.json`, raw replies, and only schema-valid analyses.

## Next accuracy gate

1. Independently adjudicate the existing 240-article stratified selection in
   `news/data/gold/gold_set.json`; repeat 50 records to measure reference
   self-agreement.
2. Evaluate models per field, never as one score: quality recall by class,
   topic top-1, mention precision/recall, leaning/Russia macro-F1 and ordinal
   weighted kappa.
3. Add operational gates before quality comparison: at least 98% transport
   completion, at least 99% schema validity, and report p50/p90 wall time plus
   actual provider-reported cost.
4. Use field routing: a cheap model may own quality/topics while political and
   Russia framing goes to the stronger judge or review queue.
