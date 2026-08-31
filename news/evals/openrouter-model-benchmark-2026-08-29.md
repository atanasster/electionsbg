# OpenRouter news-model benchmark — 2026-08-29

## Decision

Use `z-ai/glm-5.3-flash` as the initial production model for the complete news-analysis schema. It was the best speed/reliability/quality compromise: 21/22 valid responses, 8.95 s median latency, and an observed $0.000655 per ordinary article.

The later 1,487-article live batch supersedes this small-sample operating
budget: **$26.00/month for 1,000 accepted articles/day**, including probes,
schema retries, failures, and a 4,096-token recovery pass. At the measured
900–1,000 incoming articles/day, budget **$22.99–$25.55/month**. See
`openrouter-live-batch-2026-08-31.md`. The comparison tables below retain
their original benchmark figures so the model-to-model experiment stays
reproducible.

`upstage/solar-pro4` is the lowest-cost credible alternative: about **$7.64/month per 1,000 accepted articles/day** after measured retry overhead. It is much slower and less schema-reliable than GLM, but its field accuracy was generally better than similarly priced GPT-OSS 20B.

Do not surface party/person sentiment yet. Backlink/entity extraction is promising, but no tested model passed the party-tone release gate. Keep these fields experimental and hidden, as planned.

## Method

- Broad screen: 22 stratified articles selected from the repository's completed 240-article human-adjudicated gold set.
- Focused screen: all 6 gold articles containing party-tone labels.
- The production system prompt, entity candidates, and strict JSON schema were used.
- Requests were sequential with a 4,096-token output ceiling. The client permits up to three attempts on a transient 429/5xx/timeout; the reported valid rate is the final per-article outcome.
- Reasoning was disabled where supported and set to `low` for models that require reasoning.
- Cost is OpenRouter's returned `usage.cost`, so it reflects the requests actually billed rather than a list-price estimate.
- Broad articles averaged roughly 4.7k input and 0.6k output tokens. Political articles produced longer outputs.
- Latency is end-to-end from this machine through OpenRouter. Provider routing and load can change it.

Current list prices were captured from the official [OpenRouter model catalog](https://openrouter.ai/api/v1/models). The measured bill is the primary cost figure because routing, caching, and generated length matter.

## Broad result

There is deliberately no single accuracy score: topic, entity linking, political leaning, Russia stance, and AI-likelihood have different error costs and heavily imbalanced classes.

| Model | Valid | Median | Mean | $/response | Quality acc. | Topic top-1 | Mention precision | Leaning macro-F1 | Russia macro-F1 | AI macro-F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | 95.5% | 8.95 s | 10.98 s | $0.000655 | 0.905 | 0.750 | 0.921 | 0.544 | 0.500 | 0.815 |
| Qwen3 32B | 95.5% | 19.20 s | 24.05 s | $0.000692 | 0.857 | 0.750 | 0.927 | 0.468 | 0.325 | 0.884 |
| Gemma 4 31B | 86.4% | 15.38 s | 27.35 s | $0.000629 | 0.842 | 0.857 | 0.909 | 0.541 | 0.973 | 0.406 |
| Solar Pro 4 | 86.4% | 24.02 s | 24.15 s | $0.000220 | 0.895 | 0.714 | 0.919 | 0.517 | 0.315 | 0.782 |
| GPT-OSS 20B | 81.8% | 10.89 s | 15.66 s | $0.000212 | 0.889 | 0.538 | 0.912 | 0.389 | 0.667 | 0.419 |
| GPT-OSS 120B | 86.4% | 6.43 s | 6.46 s | $0.000739 | 0.842 | 0.571 | 0.923 | 0.432 | 0.324 | 0.865 |
| Nemotron 3.5 Lightning | 72.7% | 2.46 s | 4.50 s | $0.000498 | 0.750 | 0.667 | 0.931 | 0.295 | 0.484 | 0.407 |
| Nemotron 3 Super free | 90.9% | 6.97 s | 9.44 s | $0 | 0.900 | 0.438 | 0.946 | 0.402 | 0.324 | 0.740 |
| Dots 3 Note free | 63.6% | 12.73 s | 12.18 s | $0 | 0.929 | 0.636 | 0.966 | 0.383 | 0.308 | 0.334 |

Gemma's Russia result is based on a very small non-`not_applicable` support and must not be read as a settled ranking. Its 108.94 s broad p90 and 62.36 s focused median also make its throughput inconsistent.

## Cost projections

The one-pass figures multiply observed billed cost by the requested number of articles. The retry-adjusted column divides by the measured valid-response rate; it is the better operating budget if retries behave similarly.

| Model | 150/day, 30d | 250/day, 30d | 1,000/day, 30d | 1,500/day, 30d | 1,000/day retry-adjusted |
| --- | ---: | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | $2.95 | $4.91 | $19.65 | $29.47 | **$20.58** |
| Qwen3 32B | $3.11 | $5.19 | $20.76 | $31.14 | $21.74 |
| Gemma 4 31B | $2.83 | $4.72 | $18.87 | $28.30 | $21.84 |
| Solar Pro 4 | $0.99 | $1.65 | $6.60 | $9.90 | **$7.64** |
| GPT-OSS 20B | $0.95 | $1.59 | $6.36 | $9.54 | $7.78 |
| GPT-OSS 120B | $3.33 | $5.54 | $22.17 | $33.26 | $25.66 |
| Nemotron 3.5 Lightning | $2.24 | $3.73 | $14.94 | $22.41 | $20.55 |
| Nemotron 3 Super free | $0 | $0 | $0 | $0 | $0, no service guarantee |

These figures exclude VAT, payment/top-up fees, storage, and article acquisition bandwidth.

For political-heavy articles, the focused run measured:

| Model | Valid | Median | $/response | 1,000/day, 30d |
| --- | ---: | ---: | ---: | ---: |
| GLM 5.3 Flash | 100% | 10.55 s | $0.001166 | $34.98 |
| GPT-OSS 20B | 100% | 14.23 s | $0.000244 | $7.32 |
| Qwen3 32B | 83.3% | 38.28 s | $0.000986 | $29.58 before retries |
| Gemma 4 31B | 100% | 62.36 s | $0.001734 | $52.02 |

## Throughput on the Mac mini

OpenRouter performs inference remotely, so the Mac mini M4's CPU/GPU does not change model inference speed. The machine only downloads articles, builds prompts, validates JSON, and uploads results; 16 GB RAM is ample for several concurrent requests.

At 1,000 articles/day, sequential broad-run time projects to:

| Model | Sequential time/day | Idealized 4-worker time |
| --- | ---: | ---: |
| Nemotron 3.5 Lightning | 1.25 h | 19 min |
| GPT-OSS 120B | 1.79 h | 27 min |
| Nemotron 3 Super free | 2.62 h | 39 min, but unstable |
| GLM 5.3 Flash | 3.05 h | 46 min |
| Dots 3 Note free | 3.38 h | 51 min, but unreliable |
| GPT-OSS 20B | 4.35 h | 65 min |
| Qwen3 32B | 6.68 h | 100 min |
| Solar Pro 4 | 6.71 h | 101 min |
| Gemma 4 31B | 7.60 h | 114 min, with large tail latency |

Four workers are the recommended starting point. Increase only after observing OpenRouter rate limits and provider queueing; free endpoints should have a short timeout and paid fallback.

DeepSeek V4 Flash 0731 was sampled on 4 articles: 54.98 s median, 76.55 s mean, and $0.000175/response. Its projected token bill is only about $5.24/month at 1,000/day, but sequential runtime is about 21.3 hours/day, so it was removed from the throughput shortlist. MiniMax M2.7 did not complete its first low-reasoning request within the operational ceiling.

Llama 4 Scout had no route accepting the required strict parameters (22/22 rejected), while Gemini 2.5 Flash Lite rejected the production schema as too highly branched (22/22). Those are compatibility failures, not model-quality scores. The free Nemotron endpoint completed the broad set but did not complete the first long political record within the focused run's ceiling.

## Party-tone/backlink gate

The focused set is small because the gold corpus currently contains only 6 articles and 7 adjudicated party/article pairs. It is sufficient to reject unsafe candidates, not to certify a winner.

| Model | Valid | Party-pair precision | Recall | Tone macro-F1 | Unsupported evidence | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Gemma 4 31B | 6/6 | 1.000 | 1.000 | 0.709 | 4 | Best detection; fails tone/evidence gate |
| GLM 5.3 Flash | 6/6 | 0.857 | 0.857 | 0.667 | 5 | Best operational compromise; fails gate |
| Qwen3 32B | 5/6 | 0.833 | 0.833 | 0.400 | 5 | Reject |
| GPT-OSS 20B | 6/6 | 1.000 | 0.857 | 0.167 | 4 | Reject for tone |

All four produced exact entity mentions with 1.0 precision/recall on the valid focused records, so entity-only backlinks can be stored experimentally. Sentiment must remain hidden and excluded from public aggregates until the evidence validator passes and the gold set has substantially more party/person tone examples.

## Recommended operating shape

1. Run GLM 5.3 Flash with four workers for the complete analysis and one bounded retry on schema failure.
2. Validate evidence excerpts deterministically before storing any sentiment. Store entity backlinks separately from sentiment so a tone failure does not discard a correct entity link.
3. Keep model ID, prompt/schema version, confidence, and evidence with every analysis so later reprocessing does not erase history.
4. Keep a free model only as opportunistic triage; never make a free endpoint the sole scheduled path.
5. Re-run this benchmark on at least 100 political gold articles before exposing party/person sentiment. Repeat the cost benchmark after pinning an OpenRouter provider or changing concurrency, prompt size, or output schema.

If minimizing the last ~$13/month matters more than simplicity, route politically relevant articles to GLM and ordinary articles to Solar. At 1,000/day with a 20%/80% split, the measured retry-adjusted budget is roughly **$10.23/month**. For the first release, one GLM path is simpler and still extremely cheap.
