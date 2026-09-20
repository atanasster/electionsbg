# Phase 3.3–3.5 — is Jev accurate, fast and cheap enough? (2026-09-20)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` §3.3–3.5. Tool:
`news/scripts/eval_jev_benchmark.py`. Corpus: the 240-article gold set, whose
reference labels were adjudicated by a **different model family**, so this is
not a model grading itself. 230 scored; 10 skipped for empty stored text
(counted, never scored as a miss — a corpus gap is not Jev's fault).

Raw: `news/data/_perf/jev/benchmark-full.json` and `benchmark-c8.json`
(gitignored). **Every Jev call in Phase 3, including the 3.1 contract probes
and four pilots, cost $0.270 in total.**

⚠️ **TWO DIFFERENT DENOMINATORS SIT IN THE TABLES BELOW.** The gate answers
about every article (n=230). The topic configurations are scored only against
articles the reference gives a topic at all — **n=193–194**, which is exactly
the `quality: ok` set; all 36 excluded are too_short / non_article / paywall /
JS-shell, and every one is `site_relevant: false`. That is not a bias in the
measurement (an article with no reference topic has no right answer to score
against), but it means a topic coverage figure is a share of 194, not of the
corpus.

## Accuracy, each against its own baseline

| configuration | accuracy | baseline | lift | n | calls | $/article |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **gate** — site_relevant | 0.583 | 0.678 | **−0.096** | 230 | 1 | $0.000126 |
| **gate** — quality | 0.913 | 0.843 | +0.070 | 230 | (same call) | — |
| **flat** — 103 category:subcategory in one choice | **0.725** | 0.192 | **+0.534** | 193 | 1 | $0.000257 |
| flat — category **and** subcategory both right | 0.642 | — | — | 193 | 1 | — |
| **hierarchy** — category then subcategory | 0.580 | 0.197 | +0.383 | 193 | 2 | $0.000245 |
| hierarchy — both right | 0.466 | — | — | 193 | 2 | — |
| **multilabel** — primary | 0.572 | 0.196 | +0.376 | 194 | 1 | $0.000136 |

⚠️ **Accuracy is meaningless here without the baseline.** 84.3% of gold
articles are `quality: ok` and 67.8% are `site_relevant: true`, so a constant
answer scores well on both. The topic baseline is 19.2%, so the same model
that looks mediocre on the gate is doing real work on topics.

## Four findings

**1. The two-call hierarchy is WORSE than one flat choice, at twice the calls
and twice the latency.** 0.580 against 0.725 on category — the same question,
differing only in whether the 103 options are presented at once or narrowed
in two steps. The reason is structural: a wrong category in call one is
unrecoverable, and call two can only pick a subcategory inside it, so the
hierarchy turns a near-miss into a certain miss. On category+subcategory
together it is 0.466 against 0.642. **Do not build the hierarchy.** This was
the configuration the plan expected to win.

**2. More options made the coarse answer BETTER, which is the opposite of
what you would guess.** `flat` (103 options) and `multilabel` (26 options)
ask the same underlying question and differ only in granularity, and the
finer one is **+15.3 points more accurate on category** (0.725 vs 0.572) and
far better calibrated (98.5% vs 77.0% in its ≥0.95 bucket). Offering the
subcategory appears to force a more specific decision that the coarse label
then falls out of. Worth keeping in mind before "simplifying" a question set.

**3. The Stage-A gate does not work as specified, and it was the one that
would have paid for itself.** `site_relevant` scores 0.583 against a 0.678
constant — **worse than answering "yes" every time**. It decides whether GLM
is called at all, so a negative lift is not a small disappointment: routing on
it would discard site-relevant articles to save a call. It is mis-calibrated
toward the discarding branch, predicting 120 relevant / 110 not against a
reference 156 / 74. The fault is more likely the question than the model —
"does this concern Bulgarian public life" is a judgement the reference
adjudicator made with the full taxonomy in view, and one sentence of criteria
is not that — but as written, **it must not be shipped as a gate.**

**4. Jev knows when it is right — and the size of that finding depends
entirely on which field you ask about.**

⚠️ **The baseline has to be recomputed INSIDE each confidence bucket.** The
high-confidence bucket is not a random sample: it is the easy articles, so
the majority class is stronger there too. An earlier draft of this report
published the accuracy column alone — the exact error this document's own
rule forbids — and it made the quality gate look four times better than it is.

| threshold | quality: coverage → accuracy (in-bucket baseline, lift) | topic: coverage → accuracy (in-bucket baseline, lift) |
| --- | --- | --- |
| ≥0.95 | 70.4% → 99.4% (92.0%, **+7.4**) | 33.7% → 98.5% (29.2%, **+69.2**) |
| ≥0.90 | 78.7% → 99.4% (92.8%, +6.6) | 40.9% → 94.9% (26.6%, +68.4) |
| all | 100% → 91.3% (84.3%, +7.0) | 100% → 72.5% (19.2%, +53.4) |

So the two halves of the same call are worth completely different things:

- **Topic is where Jev earns its keep.** At ≥0.95 it answers a third of the
  topical articles at 98.5% where a constant would get 29.2% — a +69-point
  lift, and the best single number in this report.
- **Quality is a +7-point lift on a 92% constant.** Real, cheap, and much
  less than the raw 99.4% suggests: a constant "ok" already answers that same
  bucket at 92.0% for nothing. Worth shipping at $3.80/month, but it is not
  the "near-perfect gate" the accuracy column alone implies.

## 3.4 Speed

Client-measured. Zero 429s at any concurrency — the beta rate limits the plan
worried about did not appear.

| | p50 | p95 | p99 | max | wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| flat, serial (230 calls) | 411 ms | 556 ms | 699 ms | 795 ms | 107.1 s |
| **flat, concurrency 8** | 398 ms | 841 ms | 1,781 ms | 1,889 ms | **13.8 s** |
| gate, serial (230 calls) | 373 ms | 468 ms | 569 ms | 597 ms | 87.6 s |
| hierarchy, serial (459 calls) | 742 ms | 871 ms | 1,010 ms | 2,802 ms | 183.1 s |

Concurrency 8 is a **6.9× wall-clock speedup** with p50 flat and the tail
roughly tripled; accuracy is unchanged within run-to-run noise (0.727 against
0.725). Two transient `timeout` skips occurred across the serial runs (1 in
flat, 1 in hierarchy) and are reported rather than retried.

The serial case matters for §6.9's join, which runs single-threaded inside
`save_attempt()`: at **2.1 articles/second serial** the save loop's capacity
is far above any completion rate this pipeline produces, so the expected
added wall-clock is one join at the tail rather than k × per-call latency, as
the plan predicts.

## 3.5 Cost

`usage.cost` equals `input_tokens × $0.042/M` exactly on all 1,148 calls.
Output tokens are billed at nothing — established in 3.1 against responses
that recorded them; this benchmark records input tokens and cost only.

| configuration | $/article | at 1,000 articles/day |
| --- | ---: | ---: |
| gate (2 questions, 1 call) | $0.000126 | $0.13/day, **$3.80/month** |
| flat topic | $0.000257 | $0.26/day, $7.80/month |
| multilabel | $0.000136 | $0.14/day, $4.10/month |
| hierarchy | $0.000245 | — (do not build) |

For comparison, GLM costs **$0.00127–0.00130 per saved analysis**
(`analyze-yield-2026-09-19.md`'s 100-article runs), i.e. **~$34–39/month** at
900–1,000 articles/day. ⚠️ An earlier draft of this table quoted "$41–45",
which is the provisional $0.0015 figure that same report explicitly
superseded — overstating the incumbent by ~15%, in Jev's favour.

⚠️ The plan budgeted ~$1 for this phase; everything cost **$0.27**, because
real Bulgarian articles average ~2 KB, not the 24 KB the state cap allows.

## Acceptance (plan §3.3–3.5)

| criterion | status |
| --- | --- |
| 3.3 four configurations over the gold set | ✅ 230 of 240 (10 have no stored text) |
| 3.4 p50/p95/p99 serial **and** at concurrency, 429s recorded | ✅ serial + concurrency 8; **zero 429s** |
| 3.5 per-request tokens and cost, 1-question vs batched | ✅ above; batching measured in 3.1 (56% saving) |

## What this settles for 3.6+

- **Build `flat`, not `hierarchy`.** One call, +14.5 points of accuracy, half
  the latency, and a far better-calibrated confidence.
- **Do not ship `site_relevant` as a gate** on this prompt — it is worse than
  a constant. Re-specify it with the taxonomy in view, or gate on `quality`,
  which works.
- **Route on confidence, and expect different value per field.** ≥0.95 is the
  defensible first threshold: on topic it is a +69-point lift over a
  constant, on quality +7.4. Everything below goes to GLM.
- Concurrency 8 is safe and is what makes a full-corpus pass affordable in
  wall-clock.
