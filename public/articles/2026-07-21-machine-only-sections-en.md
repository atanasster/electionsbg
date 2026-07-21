---
keywords:
  - machine voting Bulgaria
  - paper vs machine ballots
  - Bulgarian parliamentary elections
  - electoral reform simulation
  - seat allocation Hare quota
  - voting method counterfactual
  - turnout drop-off
description: "An interactive what-if on Bulgaria's own election data: remove paper ballots in every large polling section, and watch national vote share and parliamentary seats recompute live."
---
# Machine-only voting: who wins and who loses

> **This article is interactive.** On the live page you can set a section-size threshold and a turnout drop-off, and the vote-share bars, the parliamentary seat allocation and a district-by-district map recompute instantly against the most recent election. What follows is the method and the headline findings.

Since 2021 every Bulgarian parliamentary section has recorded **machine votes and paper votes side by side** — the same electorate, on the same day, split only by the medium each voter chose. That split is a natural experiment: within a single section, machine-voters and paper-voters picked parties in measurably different proportions.

This lets us ask a concrete reform question. **What if paper ballots were removed in every "large" section — above some number of registered voters — forcing those voters onto the machine?**

This is not merely hypothetical. On 7 July 2026 the governing party, Progressive Bulgaria (ПрБ), submitted a bill to parliament proposing exactly this — fully machine voting, with paper kept only in sections under 300 voters (plus mobile, hospital and ship sections) — [as reported here](https://www.focus-news.net/novini/Bylgaria/Izcyalo-mashinno-glasuvane-s-izklyuchenie-na-malkite-sekcii-predlaga-Progresivna-Bulgariya-2992060). The interactive tool tests what that reform would have done to the most recent result; ПрБ's own bill draws the line at 300.

## The model

For each section above the chosen threshold that also has real machine votes, we treat the observed machine-voters as revealing that section's preference, and recast its paper-voters onto that same machine-vote distribution:

```
machineShare_p = machineVotes_p / Σ machineVotes
votes_p(d)     = machineVotes_p + (1 − d) · paperTotal · machineShare_p
```

The turnout dial **d** is the share of a section's paper-voters who *abstain* rather than switch to a machine. At `d = 0` turnout is held constant; at `d = 100%` every paper-voter in a large section stays home and only the original machine-voters count. Smaller sections — and the few large sections whose machine failed — are left exactly as recorded. We then re-aggregate nationally and run a Hare-quota seat allocation (4% threshold) on both the actual and the modelled totals, so the seat difference reflects only the vote shift.

## What we already excluded

Three parliamentary elections (July 2021, November 2021, October 2022) were **fully machine-only** — they have no paper votes to redistribute, so they are outside this exercise. The five elections in this analysis (April 2021, April 2023, June 2024, October 2024, April 2026) all had real voter choice between the two media; the live tool runs the scenario on the most recent of them.

## The headline finding

The direction is remarkably stable across every election: **machine voting favours urban/reform parties, paper voting favours ГЕРБ and ДПС.** Forcing large sections onto the machine consistently:

- **cuts ГЕРБ-СДС by roughly 4–6 points** and ДПС by 1–3 points;
- **lifts ПП-ДБ by roughly 4–6 points**, plus smaller gains for reform/protest parties;
- in 2023 and 2026 it flips the second-place finisher (ПП-ДБ overtakes ГЕРБ); in October 2024 it knocks a party below the 4% line.

The likely reason is who each group is: the machine is preferred by younger, urban voters, paper by older voters and people in smaller places — so removing paper amplifies the urban/reform vote. By district, ПП-ДБ's gain is biggest in Sofia and Plovdiv (up 5–7 points), and there is exactly one winner flip — Sofia's 23rd district, from ПрБ to ПП-ДБ. The regional map colours each district by its projected winner.

## What this is not

- It assumes paper-voters would vote like their section's machine-voters — it captures the selection skew between the groups, not any change caused by the medium itself.
- **The natural experiment is only as strong as machine adoption.** In April 2021 machine was a freely-chosen minority (~29% of affected voters), so its voters skew young/urban/early-adopter — read that election as the most aggressive extrapolation, not the most reliable.
- The turnout drop-off is a scenario dial, not an estimate (a plausible band is ~10–30%).
- Seats are allocated by the national Hare-Niemeyer quota with the 4% threshold — the same method Bulgaria uses to fix each party's national total (it reproduces the official result for every election since 2013). Bulgaria then spreads those totals across the 31 districts, which only changes where seats land, not how many each party wins; the meaningful figure is the actual-vs-model *difference*.

*Data: per-section protocols from the Central Election Commission, as processed by electionsbg.com. This is an analytical scenario, not a forecast.*
