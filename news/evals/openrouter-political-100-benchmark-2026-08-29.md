# OpenRouter 100-article political benchmark — 2026-08-29

## Decision

Use `z-ai/glm-5.3-flash` as the default complete-schema analyzer. On this
political set it returned 94 valid records, had an 8.44 s median, and cost
$0.000733 per billed response. At 1,000 accepted articles/day the measured
valid-rate-adjusted budget is **$0.78/day or $23.39/month**.

Use `openai/gpt-oss-20b` only when minimizing token spend matters more than
political-field quality. Its adjusted budget is **$0.27/day or $8.13/month**
at 1,000 accepted articles/day, but its leaning macro-F1 was 0.124 and its
topic top-1 agreement was 0.581.

`openai/gpt-oss-120b` was fastest, but not better: it had a 3.88 s median and
92% valid rate, while leaning macro-F1 was 0.192 and every matched unfavorable
party tone was misclassified. The free Nemotron route was slow and only 67%
valid. Solar Pro 4 hit the operational stop-loss after more than an hour and
was not allowed to hold the benchmark open for another hour.

Do **not** surface party/person sentiment. None of the completed models passed
the party-tone gate, every model produced unsupported tone evidence, and this
100-article slice contains only five tone-labelled articles (six party/article
pairs). Entity backlinks may remain hidden and experimental; the sentiment
field is not release-ready.

## Frozen set and method

- The generator found 148 eligible records in the completed human-adjudicated
  gold set using `quality=ok`, `site_relevant=true`, and
  `leaning!=not_applicable`.
- It selected 100 proportionally by primary category across 21 categories,
  with seed `political-gold-v1-20260829`.
- Selection SHA-256:
  `c73703e45344ade567a8ec2234fcea4d646d63d9f2e8b1abbf5ae62543a7a0dd`.
- The config freezes a SHA-256 for every article and reference record. The
  benchmark refuses to run if any input drifts.
- The completed 2026-08-29 result directories predate the manifest repair and
  cannot be resumed by the repaired harness. Future output directories carry
  an immutable manifest covering the exact config, prompt/schema/grammar/
  taxonomy hashes, per-article user-prompt hashes, requested model, exact
  request-body digest, endpoint, routing, reasoning, token ceiling,
  temperature, timeout, and retry limit. `--resume` refuses legacy, copied, or
  mismatched raw data.
- Requests used the production system prompt, deterministic entity candidates,
  strict JSON Schema, a 4,096-token output ceiling, and low reasoning effort.
- Requests were sequential so latency is comparable. The production analyzer
  uses four workers.
- Cost is OpenRouter's returned `usage.cost`, not a catalog-price estimate.
  Provider routes and pricing can change.

The set deliberately excludes bad-quality and out-of-scope records, so its
all-`ok` quality label is not a useful quality-gate test. It is a political
judgment and operational-cost test.

## Result

There is no combined score. Topic selection, leaning, Russia stance,
AI-generation assessment, party-pair detection, tone, and evidence grounding
have different error costs.

| Model | Valid | Median | P90 | $/billed response | Topic top-1 | Leaning macro-F1 | Russia macro-F1 | AI macro-F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | 94/100 | 8.44 s | 14.30 s | $0.000733 | 0.713 | **0.287** | 0.452 | **0.547** |
| GPT-OSS 20B | 86/100 | 7.88 s | 13.23 s | $0.000233 | 0.581 | 0.124 | **0.453** | 0.323 |
| GPT-OSS 120B | 92/100 | **3.88 s** | **8.27 s** | $0.000791 | **0.717** | 0.192 | 0.355 | 0.320 |
| Nemotron 3 Super 120B free | 67/100 | 34.81 s | 65.13 s | $0 | 0.687 | 0.224 | 0.326 | 0.323 |
| Solar Pro 4 | stopped | 66.16 s* | 118.89 s* | $0.000513* | — | — | — | — |

\* Solar figures cover its 21 returned responses. Only 13 validated, and the
ordered run had traversed at least 53 articles when the operator stopped it
after more than one hour. This is an operational rejection, not a field-quality
ranking.

The 1.0 mention precision/recall shown in machine reports is **not a model
score**. Entity candidates are produced by the deterministic resolver and
injected into the evaluated record. It verifies that the benchmark preserved
the resolver output; it does not show that the model discovered or linked
entities.

## Daily and monthly API cost

The table divides mean billed cost by the measured valid rate, then multiplies
by the requested number of accepted results. It therefore budgets a simple
same-model retry/fallback workload rather than pretending every response is
usable. Dollar figures exclude VAT, OpenRouter top-up/payment fees, acquisition
bandwidth, GCS storage/operations, and Mac mini electricity.

| Model | 150/day | 250/day | 1,000/day | 1,500/day |
| --- | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | $0.12/day · $3.51/mo | $0.19/day · $5.85/mo | **$0.78/day · $23.39/mo** | $1.17/day · $35.09/mo |
| GPT-OSS 20B | $0.04/day · $1.22/mo | $0.07/day · $2.03/mo | **$0.27/day · $8.13/mo** | $0.41/day · $12.19/mo |
| GPT-OSS 120B | $0.13/day · $3.87/mo | $0.21/day · $6.45/mo | **$0.86/day · $25.79/mo** | $1.29/day · $38.69/mo |
| Nemotron free | $0 API · no SLA | $0 API · no SLA | $0 API · no SLA | $0 API · no SLA |

Free Nemotron is not “free throughput.” Its 67% valid rate and 38.73 s mean
consume queue time and require a paid fallback for 33% of attempted records.
The table intentionally does not assign a dollar value to that fallback,
because it depends on which paid model is selected.

## Hourly schedule and Mac mini M4

OpenRouter performs inference remotely. A Mac mini M4 with 16 GB RAM is ample
for acquisition, prompt construction, four concurrent HTTP requests, schema
validation, bundle generation, and upload; remote latency and rate limits are
the bottlenecks.

Using measured mean latency, measured valid rate, and an idealized four-worker
queue, 1,000 accepted articles/day projects to:

| Model | Four-worker analysis/day | Average 42-article hourly batch |
| --- | ---: | ---: |
| GPT-OSS 120B | 25 min | 1.1 min |
| GLM 5.3 Flash | 42 min | 1.8 min |
| GPT-OSS 20B | 46 min | 1.9 min |
| Nemotron free | 4.0 h | 10.0 min |

These are inference-queue estimates, not whole-pipeline timings. Browser
acquisition, source timeouts, bundle generation, and GCS upload add wall time.
The hourly runner must therefore be incremental, retain a backlog, and use an
overlap lock. Cron frequency does not multiply token cost: already analyzed
articles are skipped, so spend follows newly accepted article volume.

## Party-tone gate

| Model | Pair precision | Pair recall | Tone macro-F1 | Lowest represented-tone recall | Unsupported evidence | Passed |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| GLM 5.3 Flash | 0.750 | 1.000 | **0.667** | 0.500 | 8 | No |
| GPT-OSS 20B | 0.455 | 0.833 | 0.400 | 0.250 | 10 | No |
| GPT-OSS 120B | 0.364 | 0.667 | 0.000 | 0.000 | 11 | No |
| Nemotron free | 0.714 | 1.000 | 0.584 | 0.333 | 5 | No |

The release gate requires pair precision >=0.95, pair recall >=0.90, tone
macro-F1 >=0.80, every represented tone recall >=0.70, zero wrong canonical
links, and zero unsupported evidence. The tiny tone-labelled subset can reject
models but cannot certify one. Before surfacing sentiment, add substantially
more independently adjudicated party/person pairs, include favorable and mixed
examples, and rerun this same frozen-input harness.

## Operating recommendation

1. Run GLM 5.3 Flash with four workers and one bounded schema retry.
2. Keep the proof-only free triage from the earlier step optional. Any political
   entity, malformed result, timeout, or uncertain classification goes to GLM.
3. Store deterministic entity backlinks independently from sentiment so an
   unsafe tone does not discard a correct link.
4. Retain model ID, served model, prompt/schema hashes, attempts, token usage,
   cost, confidence, and evidence with every analysis.
5. Schedule acquire → analyze → bundle → upload every hour, with one process
   lock and backlog reporting. Rebenchmark after pinning providers or changing
   concurrency, prompt size, schema, or routing.
