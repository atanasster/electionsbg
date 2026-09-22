# Jev sentiment scales — v1

**Status**: plan only, nothing implemented. Every figure was measured on
2026-09-22 against the corpus on disk (8,925 analysis records, 13,809 saved
articles), quoted from a dated eval in `news/evals/`, or read out of the
captured Jev probe at `news/data/_perf/jev/20260920T024115Z/contract.json`.
Predictions are marked **(predicted)** and carry their arithmetic.

**Target**: sentiment becomes a **continuous measurement with a calibrated
probability distribution**, produced by Jev (`typesafe/jev-1.13-20260917`)
reading the **whole article**. The UI simplifies it to five buckets; the stored
value and the time-series chart keep the real number.

---

## 0. Revision note — two foundations changed after the first draft

| # | First draft | Decided | Consequence |
| --- | --- | --- | --- |
| 1 | Keep the verbatim-quote evidence gate; pair Jev's scale with a GLM quote (§3 option C) | **No quotes.** Sentiment is judged from the full article; the reader verifies at the source. „ПРОВЕРИМА ОЦЕНКА" is retired | §4 — this *dissolves* the defect in §1.4 rather than working around it |
| 2 | A 5-level ordinal per axis | **The score is the measurement.** Five *display* buckets, but the stored value and the chart carry a continuous number | §3 |

Everything in §1 is unchanged measurement and stands.

---

## 1. What is wrong with the current pass, measured

### 1.1 Four of the five assessments are not scales

One GLM call per article (`z-ai/glm-5.3-flash`, strict JSON schema) produces
`leaning` and `russia_stance` (5 labels + `not_applicable`), `party_tones[]`
and `person_tones[]` (`favorable · neutral · unfavorable · mixed`), and
`ai_generated`. `mixed` is not a midpoint — it means "spans in both directions
exist" — so the party and person axes cannot be averaged, ranked or plotted.
`ToneBar` can only stack counts.

### 1.2 Confidence exists on every axis and gates nothing

Self-reported, in [0,1]. Measured across 8,925 records:

| axis | n | mean | distinct values | modal |
| --- | ---: | ---: | ---: | --- |
| `russia_stance` | 8,925 | 0.915 | 16 | 0.95 (3,732), 0.98 (2,334) |
| `leaning` | 8,925 | 0.853 | 22 | 0.95 (2,595), 0.85 (2,203) |
| `ai_generated` | 8,925 | 0.714 | 22 | 0.70 (3,359) |
| `party_tone` favorable | 153 | 0.676 | 12 | 0.70 (44), 0.60 (43) |

Round numbers clustered on 0.6/0.7/0.8/0.85/0.95 — self-report, not
probability. `data.ts:2688` says so already. It gates nothing, weights nothing
and sorts nothing; it renders once behind a `<details>`.

### 1.3 The model sees 6,000 characters; 9.93% of articles are longer

`build_prompts.MAX_BODY_CHARS = 6000`. Over 13,809 saved articles: p50 **1,962**,
p90 **5,987**, p95 7,976, p99 14,119, max 152,509. **1,371 articles (9.93%)
exceed the prefix**, and on those `rollup_eligible` excludes the analysis from
the party rollups entirely — computed, stored, never counted.

### 1.4 The evidence gate is why every page reads neutral

A positioned label must produce a verbatim quote locatable in the hashed
snapshot; `neutral` passes with **no evidence by construction**.

| | neutral | unfavorable | favorable | mixed |
| --- | ---: | ---: | ---: | ---: |
| what the model wrote | 1,766 (81.4%) | 231 | 153 | 19 |
| what reaches a reader | 1,766 (**94.0%**) | 66 | 41 | 5 |

291 positioned tones withheld; **275 (94.5%) are legacy v2 records** the
migration left span-less by design, held in **192 articles**. Records analyzed
under v3 supply spans at **128/128** — GLM asked the v3 question answers it.
For ПП-ДБ the model wrote 24 neutral / **12 unfavorable** / 2 favorable; the
page publishes 21 / 1 / 1.

### 1.5 `voice` is recorded and never checked

**23 of 112 published positioned tones (21%) rest solely on quoted speech** —
including the actualno/Минчев row, where the quoted speaker is ПП-ДБ's own MEP
and the rationale says "рамката следва неговите оценки". The same statement at
lupa.bg scored `neutral`.

### 1.6 Party tone has no prominence dimension

`person_tones.py` has `subject_role` (`primary · secondary · incidental`) and
gives an incidental mention **no tone**. Party tone has no equivalent, so
"спомената само в цитат на Борисов" counts as a full assessment.

### 1.7 ⚠️ `not_applicable` is the majority verdict on both ordinal axes

| | not_applicable | neutral | positioned |
| --- | ---: | ---: | ---: |
| `leaning` | **5,099 (57.1%)** | 3,355 (37.6%) | 471 (5.3%) |
| `russia_stance` | **7,825 (87.7%)** | 216 (2.4%) | 884 (9.9%) |

This is the finding that shapes §3.3. `not_applicable` is **not a position on
the scale** — it means the question does not arise — so it cannot be a level,
and averaging it as a zero would drag 87.7% of articles onto "neutral on
Russia" when they are silent about Russia.

---

## 2. Prior art — `brainstormity/Jev-X-Sentiment-Analysis`

A shipped Jev sentiment app (crypto/X). Read 2026-09-22.

### 2.1 What transfers

1. **Mixed primitives in ONE call.** Four typed questions on one state:
   `Choice` (trade action, 6 options), **`Score` (sentiment spectrum)**,
   `Noul` (squeeze risk probability), `Score` (catalyst significance). Exactly
   the batching our own contract probe measured at a 56% saving.
2. **Their sentiment Score uses FIVE levels**, with descriptive anchors:
   `Extreme Panic / Capitulation · Cautious / Bearish · Neutral / Mixed ·
   Optimistic / Bullish · Euphoric / Greedy`. A shipped product with an
   explicitly continuous sentiment readout chose five anchors, not twenty-four —
   which is the evidence behind §3.2.
3. **Structured state, with the questions naming its fields.** The state is a
   JSON object (`market`, `social_stats`, `representative_tweets`) and each
   instruction references those paths by name — *"Rate the prevailing social
   mood in `social_stats` and `representative_tweets`"*. This is how one call
   asks about several things without repeating the text, and it is what makes
   the per-subject design in §5.2 work.
4. **Deterministic pre-processing first.** Tier 1 computes engagement velocity,
   author diversity and keyword polarity in Python, and Jev is given the
   *derived statistics* plus a stratified 50-tweet extract — never the raw 500.
   Jev is asked only what needs judgement.
5. **`Noul` for a probability** rather than forcing a yes/no onto a scale —
   §3.3 uses this for `not_applicable`.
6. Cost: **~$0.0008 per 4-question call** on a large state, consistent with our
   §1.5 arithmetic.

### 2.2 ⚠️ What must NOT transfer

`_build_decision_output` **fabricates a probability distribution** when Jev
returns fewer than two probabilities — it spreads `[0.4, 0.3, 0.15, 0.1, 0.05]`
across the remaining actions and fudges the rounding so it sums to 100 — and
`_deterministic_decision` returns hard-coded confidences (88.5, 81.0, 86.0)
through the *same field shape*, distinguished only by an `is_mock` flag. Every
`getattr(ans, "score", 2.0)` / `getattr(ans, "confidence", 0.75)` turns a
missing answer into a confident neutral.

**This project publishes about named parties and named people.** A manufactured
distribution or a defaulted confidence is a number nobody measured, wearing the
shape of one that was. **Refusal 6 in §7.**

### 2.3 ⚠️ Is `score` fractional? Their code says yes; our probe says no

Their code is written as if `Score.score` is continuous —
`int(round(sentiment_score_val))` to get an index, `round(float(score), 2)` to
store it, defaults of `2.0` / `0.0`, and `catalyst_score >= 2.0` comparisons.
None of that is needed for an integer.

Our own captured probe returned an **integer**:

```json
"q_score": {"type": "score", "score": 3,
            "legend": {"0": "изобщо не е отразен", …, "4": "двете страни са цитирани дословно"},
            "probabilities": {"0": 0, "1": 0.01, "2": 0, "3": 0.98, "4": 0.01},
            "confidence": 0.98}
```

Note the expected value over that distribution is **2.99**, so a rounded
continuous score and an argmax are indistinguishable in this one sample.
**Phase 0 probe #1 settles it** — and the plan does not depend on the answer,
because §3.1 stores the expected value, which is continuous either way.

### 2.4 Measured: `confidence` == max(probabilities)

On **all five** non-`noul` answers in the captured probe, `confidence` equals
the largest probability exactly (1.0/1.0, 0.98/0.98, …), and the probabilities
sum to 1. So **confidence is the modal probability, not independent
information** — the distribution strictly dominates it.

Two consequences: store the whole distribution and derive confidence from it,
never the reverse; and **a confident answer is not a strong one** — confidence
0.98 on "neutral" is a confident zero. The chart in §6.3 must therefore plot the
value and render confidence as a band, never fold one into the other.

*(n = 5, one article. Phase 0 confirms at scale — if it ever diverges, that is
itself the finding.)*

---

## 3. The scales

### 3.1 The stored value is continuous; the levels are only anchors

Per axis and per subject we store:

```
level          the raw `score` Jev returned                    (int or float — §2.3)
probabilities  {level → p}, summing to 1                       the primary record
value          E = Σ pᵢ·vᵢ   over signed level values          ← THE MEASUREMENT
spread         SD = √(Σ pᵢ·(vᵢ−E)²)                            dispersion
confidence     max(pᵢ)                                          derived, §2.4
```

`value` is continuous regardless of how many levels the rubric has, because it
is an expectation over the distribution. A 5-anchor question whose answer is
`{−2: 0.05, −1: 0.30, 0: 0.50, +1: 0.15, +2: 0}` yields `value = −0.25`, not
"neutral". **That is what makes the line chart carry a number on every
article.** (The arithmetic has one home —
`test_value_is_continuous_where_the_level_is_not` — because this worked
example was wrong in two places at once on the first draft.)

Observed probabilities are rounded to 2 decimals, so `value` has a resolution
of roughly ±0.01–0.04 on a ±2 range — far finer than five buckets and honest
about not being finer than the model reports.

### 3.2 Five anchors, not twenty-four

The API allows 24 levels. Five is recommended, for three reasons that are
evidence rather than taste:

- the shipped sentiment product in §2.1 chose five;
- continuity comes from `value`, so extra levels buy resolution we already have,
  at a cost — level descriptions are **billed input** (§1.5 arithmetic);
- every additional anchor must be a *distinguishable sentence in Bulgarian*.
  `_score_criteria` rejects an empty level, so 24 levels means writing 24
  distinct rubric sentences, and the human-agreement gate
  (`editorial_treatment_baseline.py`, weighted κ ≥ 0.80 per axis) gets harder
  with every one.

⚠️ **The counter-evidence is real and is why this is a Phase 0 question, not a
settled one.** `jev-benchmark-2026-09-20.md` finding 2: *more* options made the
**coarse** answer **better** — flat (103 options) beat multilabel (26) by
**+15.3 points** on category and was far better calibrated (98.5% vs 77.0% in
the ≥0.95 bucket). If that generalises from classification to judgement, 7 or 9
anchors may beat 5. **Phase 0 runs 5 against 9 on the same articles and reports
both.** Nothing else in the design changes with the answer.

### 3.3 `not_applicable` becomes a `Noul`, not a level

§1.7: 57.1% of articles have no political leaning and 87.7% say nothing about
Russia. That is a question about whether the axis *arises*, not a position on
it, and putting it on the scale would corrupt every mean.

So each article axis is **two questions**:

```
leaning_applies   Noul   "Заема ли материалът позиция по вътрешнополитически спор?"  → probability
leaning           Score  5 anchors, progressive ↔ conservative                       → value
```

`Noul` returns a probability, so applicability is itself continuous: the chart
can weight by it or threshold it, and "the article is silent" stops being the
same event as "the article is balanced" — which is exactly what
`storyDivergence.ts` already warns about (`not_applicable` is not a position on
either count).

Subject tone needs no such gate: a subject is in the article or it is not.

### 3.4 The scales

| question | type | anchors |
| --- | --- | --- |
| `leaning_applies` | Noul | — |
| `leaning` | Score | strong_progressive → progressive → neutral → conservative → strong_conservative |
| `russia_applies` | Noul | — |
| `russia_stance` | Score | strong_pro_russia → … → strong_anti_russia |
| `subject_tone` (per subject) | Score | враждебен → неблагоприятен → неутрален → благоприятен → апологетичен |
| `primary_subject` | Choice | the subjects in the state, + „никой" |

Level vocabulary for the two article axes is **unchanged**, so the new `value`
is comparable against all 8,925 records already on disk — which is what makes
Phase 0's agreement measurement possible at all.

### 3.5 ⚠️ `mixed` is derived from the distribution, never stored

There is no place for "both directions" on an ordinal. Today it is a label the
model picks, under a rubric that has to plead *"Не използвай `mixed` само защото
не си сигурен"* — an instruction nothing can enforce. On a distribution it is a
measurement:

```
both_directions  ⇔  p(v ≤ −1) ≥ τ  AND  p(v ≥ +1) ≥ τ
```

So "the model was torn" (high `spread`, `value` ≈ 0) becomes distinguishable
from "the article is genuinely even-handed" (low `spread`, `value` ≈ 0) — two
states that are the same word today. **τ is fitted in Phase 0** against the 19
existing `mixed` and 1,766 `neutral` records, and the ROC is reported rather
than a chosen number.

### 3.6 The display bucketing has one definition

`value` → five buckets for chips, bars and the existing label vocabulary, so
`ToneBar`, the rollups, `storyDivergence` and their tests keep working:

```
value ≤ −1.5 │ −1.5 < value ≤ −0.5 │ −0.5 < value < 0.5 │ 0.5 ≤ value < 1.5 │ value ≥ 1.5
```

⚠️ **One definition, one file**, with a TypeScript twin in `labels.ts` and a
vector fixture both read — the `shlyoRules.ts` / `141_shlyo_query_fold.sql`
pattern. A rule hand-copied into two languages is how the bar and the number
stop agreeing.

**The twin is GENERATED, not hand-written, and Python is the source.** The
cited pattern is a generator (`npm run gen:shlyo-sql`) gated by a test that
fails when the two drift, and copying the four edges by hand would reproduce
exactly the defect the citation is meant to prevent. Until the generator
exists the obligation is recorded in `jev_scales.BUCKET_EDGES`' own comment.

⚠️ **The five subject-tone buckets are a vocabulary EXTENSION, and the TS side
had to move first.** The site's `Tone` union was four nominal labels
(`favorable · unfavorable · neutral · mixed`) with no strong/plain split, so
the ordinal form emits `strongly_favorable` / `strongly_unfavorable`, which
appeared in **no `.ts` file at all** — `toneMeta()` returned `undefined` and
the chip rendered blank, while a guard that checked the label COUNT passed. A
count is not a vocabulary: the gate reads `labels.ts` and asserts every
display label exists in it.

### 3.7 `subject_role` — mostly deterministic, one question for the rest

§2.1's Tier-1 lesson: compute what can be computed, ask Jev only what needs
judgement. `incidental` is largely mechanical — a subject named once, not in the
title, is incidental — so it is derived in Python from mention counts and title
presence, `primary` comes from one `Choice`, and everything else is `secondary`.
`incidental` ⇒ **no tone at all**, carrying `person_tones`' refusal 4 across to
parties and fixing §1.6.

The derivation is checked against the 52 model-assigned roles already in
`news/data/analysis/person_tones/` — a small set, reported as such, not a gate.

---

## 4. Removing the evidence gate — what it costs and what it releases

Decision 1 in §0. Stated plainly because it is the largest change here.

### 4.1 What it releases

The gate is the sole cause of §1.4. With it gone, every assessed subject
publishes: the corpus stops being **94.0% neutral** and becomes whatever the
model actually reads. The 192-article v3 backlog becomes moot — those 275
positioned tones were only ever withheld for missing quotes.

It also removes a large subsystem from the sentiment path: `evidence_spans`,
`located`, `start`/`end`, `article_content_hash`,
`party_tone_evidence_gate_version`, `party_tone_spans_support`,
`locate_evidence_spans`, `gate_axis_evidence`, and the review routing keyed on
them. **They are not deleted** — legacy GLM records keep them on disk for audit,
and they stay in force for anything outside sentiment — but nothing about a
published sentiment depends on them.

### 4.2 What it costs, and the one defect it re-opens

The article page loses „ПРОВЕРИМА ОЦЕНКА" and the quote block beneath each
party row. The claim changes from *"here is the sentence"* to *"a model read the
whole article; the source is one click away"*. The product consequence is
accepted; §6.2 covers the copy.

⚠️ **§1.5 becomes undetectable mechanically.** The Минчев defect — a favourable
verdict resting entirely on the party's own MEP being quoted — was findable
*because* a span carried `voice: quoted_speaker`. With no spans there is no
field to check, so the control moves **into the anchor text**, which must say
that quoted praise or a quoted attack is not the outlet's own framing. That is a
rubric control, not a gate, and Phase 0 must include the two known cases
(pik.bg/Гюров, actualno/Минчев) as **named regression articles** — the only
mechanism left that can catch it.

This cuts the other way too, and it is the stronger half: Jev reads the whole
article, so it sees that ПИК's hostility is aimed at **Гюров** and that ПП-ДБ
appears once, inside a commenter's quote. A span-based gate can never see that —
it judges a sentence with no idea what surrounds it.

---

## 5. The calls

### 5.1 Two calls per article

Measured subject counts (parties + people): **28.5% of articles have none**,
71.5% have ≥1, **89.0% have ≤6**.

| call | when | questions |
| --- | --- | --- |
| **A** — article axes | always | `leaning_applies`, `leaning`, `russia_applies`, `russia_stance` — 4 of 8 |
| **B** — subjects | 71.5% of articles | `primary_subject` + up to 6 `subject_tone` — 7 of 8 |

Splitting them keeps both inside the 8-question limit with headroom, and keeps
one call's failure from taking the other's answers with it. The state is billed
per call, so B costs a second copy of the article: at p50 (1,962 chars) that is
**(predicted)** ~$0.00015. `state_chars` is 24,000 against GLM's 6,000 — **56
articles (0.41%)** exceed it, against 1,371 (9.93%) today.

The 11% with >6 subjects are capped exactly as `person_tones` caps them, with
`targets_total` / `targets_dropped` **recorded**: a subject this pass never
looked at must not be indistinguishable from one it assessed and found nothing
to say about.

### 5.2 State shape

Per §2.1-3, a structured state whose fields the instructions name:

```json
{"title": "...", "body": "...",
 "subjects": [{"i": 0, "name": "ПП-ДБ", "kind": "party", "mentions": 1, "in_title": false}, ...]}
```

`mentions` / `in_title` are Tier-1 facts we already compute, and they feed §3.7
as well as giving the model the prominence signal without a question.

### 5.3 Operational rules, all already established

- `ask()` never raises and never hangs; a falsy outcome carries its reason.
  A `report_worthy` skip (`invalid_request`) is **our bug** — it must fail the
  run, not fall through to a default (§2.2).
- `max_tokens_exceeded` is its own class: neither bug nor outage, and the
  slowest to discover (it tokenizes first — 811 ms).
- Concurrency 8: measured **6.9× wall-clock**, accuracy unchanged within noise,
  zero 429s. Expect a slow first call per session (1,614 ms, then ~400 ms).
- Cost **(predicted)**, at 0.92 tok/char and ~1,000 chars per question:
  call A at p50 ≈ $0.00023, call B ≈ $0.00036 → **≈$0.0005/article**, or
  **~$15/month** at 1,000 articles/day. GLM is $0.00127–0.00130 ($38–39/month).

### 5.4 ⚠️ This does not retire GLM, but it does shrink it

Summaries, topics, entities, quality and story membership still need GLM.
What leaves its prompt is the whole of §6 (the tone rubric), the evidence-span
contract and the axis evidence blocks — which should make its remaining job
cheaper and more reliable. **Measure the GLM prompt's before/after on the same
articles; do not assume the reduction is free.**

---

## 6. Phases

### Phase 0 — shadow: measure, publish nothing

Run both calls over the 8,925 records on disk, store beside them, change no
page. Deliverable is a dated eval in `news/evals/`, answering:

1. **Probe #1, first and cheapest: is `score` fractional?** (§2.3) Send a
   deliberately balanced article and read the raw body. Also confirm
   `confidence == max(p)` at scale (§2.4).
2. **5 anchors vs 9**, same articles, both scored (§3.2).
3. **Agreement with GLM** per axis, after §3.6 bucketing: confusion matrix and
   the **off-by-one rate** — an ordinal disagreement of one bucket is not the
   same event as a sign flip, and an accuracy figure cannot tell them apart.
4. **Calibration**: agreement inside each confidence bucket, with the
   **in-bucket baseline recomputed** — the `jev-benchmark` report's own rule,
   broken once already, which made its quality gate look 4× better than it was.
5. **The 1,371 truncated articles as their own stratum.** Jev saw the whole text
   and GLM saw 6,000 characters, so disagreement there is evidence *for* Jev.
   Reported separately or it pollutes item 3.
6. **The `mixed` separation** (§3.5): does the `both_directions` test recover
   the 19 `mixed` without capturing the 1,766 `neutral`? Report τ and the ROC.
7. **Applicability** (§3.3): does `leaning_applies` separate the 5,099
   `not_applicable` from the 3,355 `neutral`? This is the single most
   load-bearing new question, because it governs 57.1% and 87.7% of articles.
8. **The two named regression articles** (§4.2): does Jev, reading the whole
   text, score ПП-ДБ near zero on pik.bg/Гюров and on actualno/Минчев?
9. **Cost and latency actually billed**, against §5.3.

⚠️ **Agreement is not accuracy.** Where Jev and GLM differ, one is wrong and
nothing here says which. Phase 0 also emits **the 50 sharpest disagreements as a
blinded worksheet** for `adjudicate_editorial_treatment.py`, which already
exists and already hides the outlet, the URL and both models' answers. Half a
day, and it is the only step that converts "they differ" into "which is right".
Recommended as a gate on Phase 4, not on Phases 1–3.

### Phase 1 — contract and store

`news/scripts/jev_sentiment.py`, modelled on `person_tones.py` — the newest and
cleanest of the three producers.

- `RUBRIC_VERSION = "jev-sentiment-v1"`; cache key
  `sha256(rubric_version, aa.evidence_snapshot(article).digest, subject
  identities at identity_version)`, so a re-extracted article invalidates its
  own scores rather than silently re-pointing them.
- Sidecar store `news/data/analysis/sentiment/<url-sha256[:16]>.json`, one file
  per article. **No change to the 8,925 analysis records** — the whole phase is
  reversible by deleting a directory.
- Stored per axis/subject: the §3.1 five fields, plus `anchors` (the legend Jev
  echoed), `applies` where §3.3 applies, `model`, `rubric_version`,
  `state_chars`, `truncated`, `targets_total`, `targets_dropped`, `assessed_at`.
- `text_scope` stamped from what was **actually sent**, via `aa.text_scope_of`,
  so a 24,000-char truncation can never wear a `full` badge.

### Phase 2 — the ask

§5. Both calls, the deterministic Tier-1 state, the §5.3 rules.
`NEWS_JEV_SENTIMENT=off|shadow|live`, default `shadow`.

### Phase 3 — rollups

`party_rollups.py` / `person_rollups.py` carry `value`, `spread`, `confidence`
and the §3.6 bucket. Every existing count surface keeps working through the
bucket. New per-subject series: `(period, subject) → mean value, n, SE`.

### Phase 4 — UI

- `/party/:id`: a **position** (`SpectrumBar`, already built) beside the
  existing counts, **the per-outlet breakdown that started this**, and the
  **sentiment line chart** (§6.3 below).
- Article page: the distribution replaces the bare confidence percentage;
  „ПРОВЕРИМА ОЦЕНКА" is replaced by copy that says a model read the full text
  and puts the source link where the quote block used to be.
- Methodology: the scale, the anchors, applicability, the derived `mixed` test
  and the bucketing rule, stated for a reader.

### ⚠️ 6.3 The line chart — what it may and may not plot

x = time; y = mean `value` for one subject; band = ±1 SE; **n annotated on every
point**, because a weekly mean over two articles is not a trend. Confidence is a
band, never folded into the value (§2.4). Incidental mentions excluded by
default (§3.7), toggleable. For `leaning` / `russia_stance`, points below an
applicability threshold are **absent, not zero** (§3.3).

### Phase 5 — publication

Flipped per axis, never all at once, and only for axes Phase 0 cleared.
Rollback is one environment variable.

---

## 7. Refusals

1. **No leaderboard.** A continuous scale makes parties sortable for the first
   time. `party_rollups.py`'s Refusal 3 stands: ordered by how much coverage the
   corpus holds, never by how favourably it reads. ⚠️ This is the largest new
   risk the change introduces and it is a product risk, not a technical one.
2. **A party's tone is never inferred from a person's, nor the reverse.** The
   pik.bg/Гюров row is exactly this defect; subjects are scored independently and
   the anchors must say so. It is a named Phase 0 regression case.
3. **No stored `mixed`.** Derived from the distribution or it does not exist.
4. **No single context-free number for an outlet.** A per-subject series over
   time is a description of coverage and is what §6.3 draws; a scalar labelled
   "pik.bg: −1.8" is a rating of a publication and this project does not publish
   one. *(This narrows the first draft's refusal, which would have forbidden the
   chart as well.)*
5. **Nothing is re-analyzed to make Jev look right.** The 8,925 GLM records stay
   as they are through Phase 0; Jev is measured against them, not merged in.
6. **No fabricated distribution and no defaulted confidence** (§2.2). A missing
   answer is a missing answer — recorded with its reason, never a neutral at
   0.75. There is no `is_mock` flag, because a field that is sometimes measured
   and sometimes invented is worse than an absent one.

---

## 8. Open questions

1. **Five anchors or nine?** Phase 0 item 2 decides; §3.2 has the evidence both
   ways.
2. **The 50-row blinded read before Phase 4** — in or out? It is the only thing
   here that distinguishes "Jev disagrees with GLM" from "Jev is right".
3. **Does GLM keep the axes as a shadow** after Jev goes live, so disagreement
   stays measurable, or is it removed from the prompt entirely (§5.4)?
4. **The 192-article v3 backlog** is now moot under decision 1 — confirm it can
   simply be dropped rather than run.

---

## 9. Not in scope

`ai_generated`, topics, entities, quality, story membership, summaries, headline
comparison, image rights. The Jev topic configuration measured **+53 points** in
`jev-benchmark-2026-09-20.md` and is a separate, stronger case — deliberately
out of scope so a sentiment result and a topic result cannot be confused.
