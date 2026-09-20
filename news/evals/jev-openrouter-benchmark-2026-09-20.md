# Phase 3.8–3.9 — Jev on live traffic, and the go/no-go (2026-09-20)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` §3.8–3.9 and the §8
go/no-go. Tool: `news/scripts/replay_jev_gate.py`. Replayed the Stage-A gate
over **600 articles already analysed and on disk**, against GLM's stored
answers — GLM is not re-run, so the comparison costs only the Jev calls:
**$0.016**.

Raw: `news/data/_perf/jev/replay-600.json` (gitignored). Every figure below
is reproducible from it.

## The answer: STOP AT SHADOW

**On the plan's own stopping rule, and by a wide margin.** §8: *"If the veto
leaves the gate less than ~10% of articles to terminate, record that and stop
at shadow — the saving would be under $2/mo and not worth a silent-failure
surface."*

| | |
| --- | --- |
| named-entity veto removes | **382 of 600 (63.7%)** — the gate never sees these |
| eligible for the gate | 218 (36.3%) |
| of those, articles whose TITLE carries a safe term | **3** |
| **would terminate at the shipped floor (0.98)** | **0 (0.0%)** |
| the most it could terminate at ANY threshold | **3 (0.5%)** |

The rule asks for ~10%. The gate's ceiling is **0.5%** — twenty times short,
and that is with the confidence threshold removed entirely.

## Why: two independent walls, and the model is not either of them

**1. The floor is above Jev's ceiling on this question.** The highest
`not_site_relevant` across 218 articles is **0.97**; the gate's floor is 0.98.
That floor is inherited from the paid path, where it is paired with a
verbatim-evidence check.

**2. The title-term check admits almost nothing.** `triage_one` requires the
article's own title to contain one of its subcategory's terms — „мач",
„футбол", „времето" and so on. That is a check on the **article**, not a claim
by the model, and it is the nearest thing to the evidence proof Jev cannot
supply (§3.7). Of 218 eligible articles, **3** pass it.

⚠️ **An earlier draft of this report measured the shadow's predicate instead
of the enforcing rule**, omitting that title check. It over-stated the gate's
reach seven-fold (34 articles against 5 in that sample) and invented the only
civic loss in the whole replay. The corrected replay applies the real rule.

Neither wall is a failure of Jev's judgement. It is *right* about these
articles — 15 sports pieces were correctly typed as sports, at
`not_site_relevant` 0.28–0.97 — it is simply never as certain as the gate
demands, about articles the gate would mostly refuse anyway.

## Civic recall: the bar is met everywhere, trivially

⚠️ **The §8 bar is ≥0.98, and it is the one number where a miss is not a cost
but a deletion** — a civic article dropped before anyone reads it.

| τ | terminated | % of corpus | civic lost | civic recall |
| ---: | ---: | ---: | ---: | ---: |
| 0.98 (shipped) | 0 | 0.0% | 0 | 1.0000 |
| 0.95 | 1 | 0.2% | 0 | 1.0000 |
| 0.90 | 2 | 0.3% | 0 | 1.0000 |
| 0.75 | 3 | 0.5% | 0 | 1.0000 |
| 0.50 (no threshold) | 3 | 0.5% | 0 | 1.0000 |

**Zero civic losses at every threshold**, over 131 site-relevant articles.
The gate is safe. It is also nearly inert, and the second fact is why it
should not ship.

## The economics settle it independently

Jev costs **$0.0000270 per corpus article** (only the 36.3% past the veto are
asked) — **$0.81/month** at 1,000 articles/day. GLM costs **$0.00127–0.00130
per saved analysis** (`analyze-yield-2026-09-19.md`'s two 100-article runs).

| τ | terminated | GLM saved/month |
| ---: | ---: | ---: |
| 0.98 (shipped) | 0.0% | **$0.00** |
| 0.95 | 0.2% | $0.06 |
| 0.90 | 0.3% | $0.13 |
| 0.50 (no threshold) | 0.5% | **$0.19** |

⚠️ **The comparison to make is marginal, not gross**, and an earlier draft got
this wrong by charging Jev's $0.81/month against enforcement alone. The
recommendation keeps the shadow, which makes the *same one call per article* —
so switching shadow→enforce costs nothing extra and saves whatever it
terminates. The honest framing is therefore not "enforcing loses money" but:

**the entire upside of enforcement is $0.19/month, at its theoretical
maximum, in exchange for a surface that can silently delete civic articles.**

That is the trade §8 exists to refuse, and it refuses it without needing the
accuracy argument at all.

## Agreement with GLM

60.1% on the eligible set — ⚠️ **not a quality measure, and it must not be
quoted as one.** It compares `would_suppress` against `not site_relevant`, and
those are different questions: the gate asks "is this *obviously* nothing but
sport or weather", GLM asks "is this site-relevant". An article that is
neither obviously-sport nor site-relevant — most local crime, most lifestyle —
is a disagreement by construction while both answers are right. The numbers
that matter are civic recall and termination share, above.

## What the veto alone tells us, which outlives this decision

**63.7% of live articles are un-gateable before any model is consulted** —
they name a person, party, institution or company, or carry no mention list at
all. Any future free-tier triage, Jev or otherwise, is bidding for a share of
the remaining 36.3%, and of that share only ~1.4% (3 of 218) satisfies the
title-term proof the gate requires. **That is a ceiling on the whole idea, not
a fact about Jev**, and it is worth knowing before anyone specifies another
gate.

## Acceptance

| criterion | status |
| --- | --- |
| 3.8 replay Stage A over live traffic beside GLM's stored answers | ✅ 600 articles, $0.016 |
| 3.8 share the gate would terminate **after the veto** | ✅ 0.0% at the shipped floor, 0.5% ceiling |
| 3.8 story-join replay | ⛔ blocked on §3.6, which needs ~200 hand-labelled pairs |
| 3.9 civic-recall curve against τ | ✅ above; 1.0000 at every τ |
| **§8 go/no-go for an enforcing Stage-A gate** | ⛔ **NO — stop at shadow** |

## What remains true, and what to do instead

Jev is not useless here. §3.3 measured it answering **topic** at 98.5%
accuracy on a third of articles — a +69-point lift over a constant. What fails
is specifically the *suppression gate*: the population is tiny after the veto,
the proof it demands is one Jev cannot give, and the money at stake is cents.

- **Keep the shadow** (`NEWS_JEV_GATE=shadow`, shipped in 3.7). $0.81/month,
  already wired, and it is what would show any of this changing.
- **Do not build an enforcing gate**, and do not re-litigate it by lowering τ.
  The termination ceiling, not the accuracy, is the argument.
- **The promising surface is topic assignment, not triage** (§7.6 F4). It
  needs its own §8 pass and has a far better measured case.
