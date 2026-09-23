# Jev sentiment scales — Phase 0, measured (2026-09-23)

Plan: `docs/plans/news-jev-sentiment-scales-v1.md` §6 Phase 0. Harness:
`news/scripts/jev_sentiment_eval.py`. Pass: `news/scripts/jev_ask.py`, live
against `typesafe/jev-1.13-20260917`, in `shadow` — nothing published.

**Every figure below is read from the committed report,
`news/evals/jev-sentiment-phase0-2026-09-23.json`** — the rule
`jev-contract-2026-09-20.md` set after one of its own figures could not be
recomputed. Re-derive with
`python3 news/scripts/jev_sentiment_eval.py --out <file>`.

⚠️ **Agreement is not accuracy.** Every agreement figure compares Jev with
GLM, and where they differ nothing here says which is right. The report
carries the **50 sharpest disagreements** as a blinded worksheet (`worksheet`)
for `adjudicate_editorial_treatment.py`; until that read is done, a
disagreement is a question, not a GLM error.

## The run

9,845 answered records over 9,847 analyses. 16,896 calls, **$3.108 in total —
$0.000316 per article**, against the plan's predicted ≈$0.0005. p50 377 ms,
p95 495 ms. The pass itself reported 9,835 assessed, 2 failed, 0 crashed and
**0 payload bugs** (`our_bugs`) — nothing we sent was refused.

## The two contract questions — both settled, one against the plan

**§2.3 — is `score` fractional? Yes.** 22,747 of 33,286 score answers are
non-integral. It is the distribution's expected value in every case checked
by hand; the plan stores that expected value either way, so nothing depended
on the answer.

**§2.4 — is `confidence` the modal probability? No, and the plan said it
was.** The plan measured this on five answers from one article. Over the
corpus the reported `confidence` differs from max(p) on **18,784 of 33,286**
answers. They are two quantities.

Which one carries signal (`confidence_signal` — AUC for predicting agreement
with GLM, 0.5 = none):

| axis | n | reported | derived (max p) |
| --- | --- | --- | --- |
| leaning | 4,267 | 0.861 | 0.856 |
| russia_stance | 1,239 | **0.555** | **0.541** |

They tie. And on Russia **neither predicts anything** — a page printing
„увереност 94%" beside a Russia verdict would be decorating it. Decision: the
page draws the **distribution** (the plan's own Phase 4 wording) and prints no
confidence percentage; the stored field stays `confidence_derived`, which is a
property of the distribution the page draws.

## The complaint that started this — the neutral share (`neutral_share`)

The party archive, under each producer:

| | n | neutral | unfavorable | favorable | mixed |
| --- | --- | --- | --- | --- | --- |
| GLM, every tone emitted | 2,388 | 81.5% | 255 | 168 | 19 |
| **GLM, as the archive publishes it** | 2,091 | **93.0%** | 86 | 55 | 5 |
| **Jev, non-incidental parties** | 1,464 | **75.3%** | 279 + 49 strong | 30 + 3 strong | — |

The middle row is the page. The evidence gate is what made it read neutral:
of 255 unfavorable GLM tones, 86 survived it; of 168 favorable, 55. Jev, with
no quote requirement (plan §4), keeps a negative framing it can see in the
whole text.

Jev scores fewer party rows (1,464 against 2,091) because **614 parties are
`incidental`** (`jev_party_roles`) — mentioned in passing, so never asked for a
tone. Under GLM those were counted, overwhelmingly as neutral.

## Agreement with GLM (`agreement`, full-text GLM stratum)

| axis | n | exact | within one bucket | mean distance |
| --- | --- | --- | --- | --- |
| leaning | 3,677 | 84.0% | 99.5% | 0.17 |
| russia_stance | 932 | 65.2% | 99.1% | 0.36 |
| subject_tone | 1,176 | 80.4% | 99.7% | 0.20 |

Sign flips — the two sides of an axis swapped — are rare: leaning 14
(progressive↔conservative), russia 5, subject tone 4 (`favorable->unfavorable`).

The disagreements are directional, and in the direction of the reported
defects:

- **leaning** — 431 GLM-`neutral` articles move to a side (251 progressive,
  179 conservative, 1 strongly conservative); 113 move the other way.
- **subject tone** — 133 GLM-`neutral` → `unfavorable`, and **72 GLM-`favorable`
  → `neutral`**. The second is the Минчев shape: favourable words quoted from
  the subject's own people rather than the outlet's framing.
- **russia_stance** — mostly intensity: 119 `anti_russia` → `strong_anti_russia`,
  104 `neutral` → `anti_russia`.

The GLM-prefix stratum (GLM saw 6,000 characters, Jev saw the whole text)
agrees less on every axis — 70.7% / 57.0% / 74.7% exact — as expected when
one side read text the other did not. It is reported separately so it does
not pollute the table above.

## Calibration (`calibration`)

| axis | confidence ≥ | n | agreement | baseline in that slice | lift |
| --- | --- | --- | --- | --- | --- |
| leaning | 0.95 | 783 | 99.4% | 98.6% | +0.008 |
| leaning | all | 4,267 | 82.2% | 87.8% | −0.056 |
| russia_stance | 0.95 | 41 | 41.5% | 56.1% | **−0.146** |
| russia_stance | all | 1,239 | 63.0% | 56.0% | +0.069 |

High confidence on leaning is almost all confidently-neutral articles, where
a constant answer does as well. On Russia the most confident answers are the
ones that disagree with GLM most. Neither is a quality signal a page may lean
on — which is the same conclusion `confidence_signal` reaches independently.

## Applicability (`applicability`) — the question that governs most articles

| axis | group (GLM) | n | median `applies` | p10 | p90 |
| --- | --- | --- | --- | --- | --- |
| leaning | not_applicable | 5,576 | 0.04 | 0.01 | 0.32 |
| leaning | neutral | 3,748 | 0.45 | 0.14 | 0.87 |
| leaning | positioned | 519 | 0.84 | 0.51 | 0.93 |
| russia | not_applicable | 8,604 | 0.01 | 0.01 | 0.10 |
| russia | neutral | 278 | 0.97 | 0.89 | 0.98 |
| russia | positioned | 961 | 0.97 | 0.91 | 0.98 |

Separation vs GLM-neutral: **0.905** (leaning), **0.989** (russia). The Russia
gate is nearly perfect. On leaning, GLM's own `neutral` sits in the middle
(median 0.45) — the boundary between „takes no side" and „is not about sides"
is genuinely fuzzy, and any threshold will split that group.

## `mixed` (`mixed`) — weak, and too small to tune

GLM labelled 19 party tones `mixed`. The best τ (Youden) recovers **4 of 19
(21%)** at a 0.26% false-positive rate over 1,169 GLM-neutrals; the
provisional τ = 0.20 recovers the same 4 at 0.43%. With 19 positives this is
not a basis for fitting τ, and the derived `mixed` should not be presented as
catching what GLM's label caught.

## The two named regression articles (`regression_cases`)

- **pik.bg — „Гюро, скрий се!"** — `subject_present: false`. ПП-ДБ has **zero
  mentions** in the stored text, so it is not a subject and the Jev path
  publishes **no** ПП-ДБ tone for it.
- **actualno — Минчев** — ПП-ДБ is `incidental`, so no tone is asked and none
  is published.

Both reported defects are closed on the Jev path.

## What Phase 0 does NOT decide

- **Which is right where they differ.** The worksheet is prepared; the blinded
  read is not done. The plan recommends it as a gate on Phase 4 publication.
- **The applicability threshold** a chart uses to call a point absent — the
  distribution above is the input, not the choice.
- **τ for `mixed`** — 19 positives.

---

## Addendum (same day) — the subject cap, and one finding above that was wrong

Re-measured after two fixes, into
`news/evals/jev-sentiment-phase0-2026-09-23-cap18.json`. Figures in this
section are read from THAT file; the sections above describe the first run and
are left as they were measured.

**What was wrong.** A record scored at most six subjects — one call's question
budget — ranked by mentions, so on a crowded article a party named twice lost
its slot to people named twice. And `mention_pattern` treated „ПП-ДБ" and
„пп дб" as different words. Together they made the ПП-ДБ archive, once
published, label eight articles „not a subject" that name the party outright —
every one was a cap drop. The report above says of pik.bg that ПП-ДБ has
**zero mentions**; that was the counting defect, not the text. The party is
there, once, inside a quoted Facebook comment.

**The fixes.** Tone questions are asked in chunks of six across as many calls as
the subjects need, up to 18 (`jev_sentiment.MAX_SUBJECTS`); name separators —
hyphen, dashes, space, no-break space — match each other. A record also names
what it dropped past the cap, so „not in `subjects`" can no longer be read as
„not in the article". Both changes move the record key, so exactly the affected
records went stale: **1,181**, re-asked for **$1.056** (above the ≈$0.60
estimated — the crowded articles are also the long ones, and take two or three
subject calls).

**After** (9,936 answered records):

| | n | neutral |
| --- | --- | --- |
| GLM, as the archive publishes it | 2,123 | **92.9%** |
| Jev, non-incidental parties | 1,557 | **74.7%** |

Jev party roles: 255 primary, 1,302 secondary, **843 incidental** (614 before —
the parties the cap used to drop are mostly passing mentions, and are now
counted as such rather than missing). Subject-tone agreement with GLM on the
full-text stratum: 1,239 pairs, 79.8% exact, 99.7% within one bucket.

**Both regression articles:** ПП-ДБ is `subject_present: true`,
`subject_role: incidental`, no value — a passing mention, not scored either way.

**Spend.** The report's `spend` sums the calls on records now on disk
($3.534), which drops the cost of every record a re-ask overwrote. Money
actually billed today: $3.105 (first run) + $1.056 (re-ask) + $0.128 (the first
hourly `sentiment` stage) = **$4.289**.
