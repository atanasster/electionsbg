# Analyze yield — Phase 1 report (2026-09-19)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` Phase 1. Model
`z-ai/glm-5.3-flash` via OpenRouter throughout. Raw data:
`news/data/_perf/2026-09-19.jsonl` (the perf log) and
`news/data/_perf/diagnose/2026-09-19T193333Z/` (diagnosis answers), both
archive-excluded and gitignored.

## Before — run `2026-09-02T145946Z-16095`

| | |
| --- | --- |
| queued → answered → saved | 100 → 82 → **69** |
| `parse_failed` / validator-rejected | **26** / 6 |
| providers | NextBit 99 of 109 responses |
| cost | $0.09237 → **$0.00134 per saved** |
| transport latency | median 17.99 s, p90 30.64 s |
| stage | 1,530 s, of which **772 s with no output** (one request hung under 300 s × 3) |

## 1.2 Diagnosis — the 26 lost articles, each provider pinned, no fallback

`news/scripts/diagnose_yield.py`; "accepted" means `record_from` accepts it.
429s are rate limits from pinning at 10-way concurrency, not quality.

| provider | accepted / answered | syntax failures | p50 / p90 | other |
| --- | ---: | --- | --- | --- |
| **NextBit** | **9 / 17** | **8, all `bg_quote_closed_ascii`**¹ | 8.8 / 12.0 s | **9 timeouts at 120 s** |
| Parasail | 23 / 26 | 0 (3 truncated at 4,096 tokens) | 6.3 / 10.7 s | — |
| Together | 21 / 23 | 0 (2 truncated) | 9.0 / 22.7 s | 3 × 429 |
| DeepInfra | 10 / 11 | 0 (1 truncated) | 46.5 / 75.1 s | 15 × 429 |
| Fireworks | — | — | — | 26 × 429 |

¹ `result.json` labels these 6 `unescaped_quote` + 2 `other_json_error`: the
run used the first classifier. Re-classifying the saved raw answers offline
with the committed classifier (`bg_quote_closed_ascii` was added from exactly
these 8) puts all 8 in that class; no new calls were made.

**Hypothesis confirmed:** NextBit accepts `response_format: json_schema,
strict` and does not enforce it. Every one of its syntax failures is the same
shape — a Bulgarian quotation opened with `„` and closed with an ASCII `"`
(`„Frognews"`, `„скалъпена присъда"`), which ends the JSON string. No other
provider produced a quote failure.

## 1.3 Fixes

| | fix | commit |
| --- | --- | --- |
| a | `NEWS_LLM_PROVIDER_IGNORE=NextBit`, `NEWS_LLM_PROVIDER_ORDER=Parasail,Together` (fallbacks on) | `1205d1f4f9`, config |
| b | local repair of the `„…"` shape → `„…“`, only after a failed parse, one quote at the error position; all **8 of 8** real NextBit failures parse after it; stamped `analysis_provenance.json_repair` | `1205d1f4f9` |
| c | one in-run retry for a syntax failure | `1205d1f4f9` |
| d | canary aborts after 5 consecutive unusable answers (was unbounded) | `1205d1f4f9` |
| e | hosted transport 60 s × 2 (was 300 s × 3), stage deadline `NEWS_ANALYZE_DEADLINE_S=1500` with a hard exit | `1205d1f4f9` |
| — | a wrong-shaped answer or any worker exception is one failed article, never a dead stage | `bd8c1f9344` |
| — | `grammar_is_enforced` is not made per-provider: the probe now inherits the same routing as the run, and `diagnose_yield.py` is the per-provider tool — probing every provider every hour would cost more than the answers it protects | — |

⚠️ **Excluding NextBit alone was not enough.** The 23:00 scheduled run
(`2026-09-19T200007Z-67048`) routed across 8 unmeasured providers, and one
answered `"quality": "ok"` — a string where an object is required. It raised
past every handler and killed the stage after 5 saves. Hence the provider
preference and the shape/worker guards.

## After — live check `manual-check-2026-09-19T200952Z` (12 articles)

⚠️ **Small and narrow sample**: 12 articles, all from dir.bg and vesti.bg (the
head of the day-ordered queue). One more failure would read 0.83. It shows the
fixes work; it does not establish a rate — the 100-article scheduled runs do.

| | before (09-02, 100 articles) | after (12 articles) |
| --- | ---: | ---: |
| saved / queued | 69 / 100 (0.69) | 11 / 12 (0.92) |
| parse failures | 26 | **0** (1 truncation recovered by the in-run retry) |
| validator rejections | 6 | 1 |
| providers | NextBit 99/109 | Parasail 15/15 |
| latency, article calls (p50 / p90) | 17.99 / 30.64 s | **17.55 / 37.31 s** — unchanged (n=14; excludes the 14-token grammar probe) |
| cached share of prompt tokens | 63.9% | 6.6% |
| cost per response | $0.000847 | $0.00110 (+30%) |
| cost per saved | $0.00134 | **$0.0015** (+12%) |
| intra-stage gap > 65 s | 772 s | none (largest 36.7 s) |

**Stage timeline** (perf log `analyze` events): canary 34.0 s (serial, one
call) → pool 80.0 s — bounded by its longest call, a 60.3 s answer truncated
at 4,096 tokens (the 11 pool calls total 203 s, ~51 s ÷ 4 workers) → retry
wave 37.6 s. The three phases account for 151.6 of the 152.7 s measured.

**What the fixes bought is yield and bounded time, not latency or price.**
Per response the price rose ~30%: Parasail served 6.6% of prompt tokens from
cache where NextBit's cache affinity served 63.9%. Per *saved* analysis the
rise is only 12%, because far fewer paid answers are thrown away. (The
August batch's $0.000867 per accepted is not explained by caching — the
2026-09-02 run had the same 64% cache and still cost $0.00134 per saved; its
yield did.) The figure adopted for budgeting is **~$0.0015 per saved, ~$41–45
per month at 900–1,000 articles/day**, pending the 100-article runs. Two
levers remain, neither taken here: a cache-friendly provider order (measure
`cached_prompt_tokens` per provider from the perf log), and the 4,096-token
truncations, each costing ~2.5× a normal answer.

## Acceptance (plan Phase 1)

| criterion | status |
| --- | --- |
| saved/queued ≥ 0.90 on a 100-article run, validator rejections separate | ⏳ **not yet met as stated** — 0.92 on a 12-article check; the criterion needs a 100-article scheduled run (addendum below) |
| $ per saved within 15% of $0.000867, or a new figure adopted with a reason | ✅ adopted provisionally: ~$0.0015, reason above; confirm on the 100-article runs |
| stage-time breakdown sums to wall-clock within 10% | ✅ 151.6 of 152.7 s |
| no intra-stage gap > ~65 s | ✅ largest 36.7 s |
| 1.5 hidden-tab pause shipped with a test | ✅ `fb7b4e0992` (reaches readers on the next newsapp deploy) |
| 1.5 gzip at rest verified on one release with `curl -sI` | ✅ on release `2026-09-19T230006Z-47633` — see the addendum |

⚠️ **Plan correction (§0.3 V2).** `gsutil cp -z` *appends* `no-transform` to
`Cache-Control` (`gslib/utils/copy_helper.py`), which switches off GCS
decompressive transcoding. The plan's "`-z` is a one-flag change" was
therefore incomplete: `0f44b41354` adds a `setmeta` scope that resets the
immutable policy on the version tree before the manifest can point at it.

## Addendum — 100-article runs (2026-09-20)

**The scheduled runs found a third yield defect, and it was the largest.**
The 00:00 (`2026-09-19T210004Z-72772`) and 01:00 (`2026-09-19T220002Z-63626`)
runs each saved **0 of 100**: the model put subcategory `fuel` under category
`energy` on the article at the head of the queue — a taxonomy rule the JSON
schema cannot express — and the canary's "the first record must validate or
abort" rule ended the run. Mid-queue the same rejection costs one article (the
2026-09-02 run had 6 and kept going), and because a rejected article stays
unanalysed it stays at the head: both runs died on the same one. Fixed in
`b6e89a68d1` and `7a7c85f724` — a rejection now counts toward the canary's
bound of 5 unusable answers instead of ending the run.

Two 100-article runs on the live corpus, same configuration as the scheduled
runs (workers 4, schema-retries 1, `--limit 100`):

| | A `yield-100` (00:10) | B `yield-100b` (00:45, after the second fix) |
| --- | ---: | ---: |
| saved / queued | **97 / 100 (0.97)** | **96 / 100 (0.96)** |
| validator rejections | 3 | 2 |
| parse failures | 0 | 2 (truncations the retry did not recover) |
| parse retries | 3 attempted, 3 recovered | 3 attempted, 1 recovered |
| providers | Parasail 109/109 | Parasail 107/107 |
| cost per saved | **$0.00127** | $0.00130 |
| latency p50 / p90 | 5.66 / 9.47 s | 8.78 / 17.87 s |
| stage wall | **189 s** | 351 s |
| aborted / abandoned | none | none |

Against the 2026-09-02 baseline (69/100, $0.00134 per saved, 1,520 s with a
772 s stall): **yield 0.69 → 0.96–0.97, stage 1,520 s → 189–351 s, cost per
saved −3 to −5%.** The 12-article check's +12% cost was a small-sample
artefact; at 100 articles the extra prompt caching (Parasail served 1.8–3.9%
of prompt tokens, against NextBit's 63.9%) is outweighed by the answers no
longer thrown away.

**Every rejection in both runs is the same taxonomy class** (`fuel` under
`energy`, `local-administration` under `local-news`) — a prompt/taxonomy
issue, not a transport one, and the right subject for a later phase.

**Follow-up found here, not fixed:** `grammar_is_enforced` cannot prove
enforcement on this endpoint — the probe's 8-token budget is spent on
reasoning and returns no answer, so `constraint_probe` reads
`probe skipped: reasoning_only …` on every run. Raising the probe's budget (or
setting `NEWS_LLM_REASONING_EFFORT=none` for it) would make the check
conclusive again; nothing depends on it now that the bound is
probe-independent.

### gzip at rest, verified on release `2026-09-19T230006Z-47633`

| check | result |
| --- | --- |
| stored encoding | `x-goog-stored-content-encoding: gzip` |
| size | **1,089,591 B stored** against 4,358,382 B raw — **4.0×** |
| `Cache-Control` | `public,max-age=31536000,immutable` — **no `no-transform`**, so the `setmeta` scope worked |
| non-gzip client (`Accept-Encoding: identity`) | GCS transcoded: **4,930,667 B of valid JSON** (the corpus has grown since the raw figure above) |
| manifest | untouched: stored `identity`, `no-cache,max-age=0,must-revalidate` |

| acceptance criterion | status |
| --- | --- |
| saved/queued ≥ 0.90 on a 100-article run | ✅ **0.97 and 0.96** manual, **0.99 on the 02:00 scheduled run**; rejections reported separately |
| $ per saved | ✅ $0.00127–0.00130 — within 5% of the 09-02 baseline, better than it; the provisional $0.0015 from the 12-article check is superseded |
| stage breakdown within 10% of wall-clock | ✅ (12-article check) |
| no intra-stage gap > ~65 s | ✅ |
