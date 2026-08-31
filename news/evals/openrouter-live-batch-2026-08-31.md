# OpenRouter live acquisition batch reconciliation — 2026-08-31

## Operating result

The 1,487-article live batch cost **$1.266215** and produced 1,461 accepted
analyses: **98.25% final coverage** at **$0.000867 per accepted analysis**.
This is the best production cost calibration because it includes the schema
probe, validator retries, malformed responses, token-ceiling failures, and the
separate 4,096-token recovery pass—not only responses that became saved rows.

Use **$26.00/month per 1,000 accepted articles/day** as the current GLM 5.3
Flash API budget. Applied to the measured 900–1,000 newly acquired articles
per day, the incoming-volume budget is **$0.77–$0.85/day**, or
**$22.99–$25.55 per 30-day month**. These figures exclude VAT, OpenRouter
top-up/payment fees, acquisition bandwidth, GCS, and electricity.

The prior 100-political-article projection was $23.39/month per 1,000 accepted
articles/day. The live result is 11.2% higher, close enough to validate the
model choice but large enough that the live figure now supersedes it for
operating budgets.

## Sources and boundary

- Source of truth for billing: the operator-provided OpenRouter activity CSV
  exported 2026-08-31, filtered to app `Naiasno news analysis`.
- Live-run boundary: 2026-08-30 23:30:14 through 2026-08-31 01:11:31 in the
  CSV's timestamps. The earlier rows in the export are benchmark traffic and
  are excluded.
- Local counters: the two `analyze_local.py` final reports and the saved
  `analysis_provenance` records under `news/data/analysis/articles/`.
- The screenshot is corroborating UI evidence, not a machine-readable source.

## Exact request reconciliation

| Pass | Queue | Schema retries | Probe | OpenRouter generations | Saved | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,048-token first pass | 1,487 | 59 | 1 | **1,547** | 1,331 | **$1.136489** |
| 4,096-token recovery | 156 | 21 | 1 | **178** | 130 | **$0.129726** |
| Total | — | — | 2 | **1,725** | **1,461** | **$1.266215** |

The counts close exactly: `1,487 + 59 + 1 = 1,547` and
`156 + 21 + 1 = 178`. The first pass covered 89.51% of the source articles;
the recovery pass raised that to 98.25%.

The OpenRouter CSV reports 8,821,705 prompt tokens, 1,484,002 completion
tokens, and 339,072 reasoning tokens. It marks 6,646,144 prompt tokens as
cached—75.34% of all prompt tokens. `cost_total` is the actual charge used
above; the CSV's separate negative cache-adjustment field is not subtracted a
second time.

## Timing

- Local end-to-end analysis time: **100m 44.86s** for both passes.
- Equivalent live throughput: **67.8 minutes per 1,000 incoming articles**
  with four workers, including the recovery pass.
- OpenRouter generation latency across all 1,725 requests: **10.07s median**,
  **22.61s p90**.
- The earlier 100-article benchmark projected 42 minutes per 1,000 accepted
  articles under idealized four-worker scaling. Provider tail latency and the
  recovery pass make the measured live number the safer capacity estimate.

At an even 1,000 articles/day, analysis averages about 2.8 minutes of work per
hour. Acquisition—especially browser fallbacks—remains the dominant wall-time
stage in an hourly transaction.

## What local logging captured and missed

Saved per-article provenance is internally consistent:

- 1,461 accepted records retain 1,495 unique OpenRouter generation IDs,
  including successful schema-retry attempts.
- Every one of those IDs exists in the OpenRouter export.
- Their precise response-time `usage.cost` sums to $1.009059831. The CSV shows
  $1.008308 for the same rows because it rounds each row's cost to six decimal
  places.

That provenance is an article audit trail, not a run bill. It necessarily
omits 230 generations that produced no saved record. Those omitted generations
account for **$0.257907**, or **20.37% of the live bill**, and include all 136
`length` finishes plus malformed, rejected, and probe responses.

The runner now meters every decoded provider response in memory before it is
parsed or validated and emits a `billing` block in the analyzer/nightly stage
result. It includes response count, cost coverage, prompt/completion/cached/
reasoning tokens, provider mix, finish reasons, and median/p90 transport
latency. No prompt, article body, answer, API key, or chain-of-thought is added
to operational logging. Per-article provenance remains unchanged.

## Provider and output-ceiling findings

| Provider | Requests | Share | `length` finishes | Length rate | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Modal | 1,555 | 90.14% | 37 | 2.38% | $1.039935 |
| DigitalOcean | 58 | 3.36% | 55 | 94.83% | $0.085718 |
| Wafer | 43 | 2.49% | 41 | 95.35% | $0.059631 |
| All other routes | 69 | 4.00% | 3 | 4.35% | $0.081931 |

DigitalOcean and Wafer handled only 5.86% of requests but caused 70.59% of all
token-ceiling finishes. That is a routing-quality signal, not proof that they
are always bad: do a controlled pinned-Modal comparison before disabling
fallbacks, because provider capacity and pricing can change.

The 2,048-token pass had 126 length finishes in 1,547 generations; 125 ended
at exactly 2,048 completion tokens. The harder 4,096-token retry had only 10
length finishes in 178 generations; 9 ended at exactly 4,096. Mean billed
request cost was effectively unchanged ($0.000735 versus $0.000729) because a
ceiling is not a prepaid token reservation. The standalone and hourly defaults
therefore move to **4,096 max output tokens**. Keep 4 workers and one bounded
schema retry.

## Next measurement

After the next ordinary hourly run, compare its emitted `billing` block with a
same-window OpenRouter export. The response count should close exactly. The
sum of local `usage.cost` may be microscopically higher than a CSV sum because
the API response preserves sub-microdollar precision while the CSV rounds each
row.
