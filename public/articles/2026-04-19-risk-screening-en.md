---
keywords:
  - election risk index
  - section risk screening
  - Benford's law Bulgaria
  - 19 April 2026 election
  - composite risk score
  - polling accuracy
  - electionsbg.com
---
# Election risk screening — new tools and what they show for [19.04.2026](/elections/2026_04_19)

> **Note (May 2026).** The composite index has since been restructured: it now averages only the five process-integrity signals into the headline, with Benford / neighborhood swing / electoral volatility / polling error shown as separate context signals. The specific scores quoted below (composite 30, machine integrity 0, risk-neighborhoods 48) reflect the original methodology and no longer match the live page. The current methodology and the framework-comparison rationale are documented in [Rebuilding the Election Risk Index](/articles/2026-05-13-risk-index-restructure).

This is a follow-up to the [10 days earlier integrity analysis](/articles/2026-04-19-integrity), which surveyed every per-anomaly metric we publish for the 19.04.2026 election. Since that piece went out we have added three new aggregation layers on top of those raw metrics, all reachable from the new [`/risk-analysis`](/risk-analysis?elections=2026_04_19) dashboard:

1. A national **Composite Election Risk Index** (0–100, 4 bands) that averages eight independent screening signals into a single headline number, surfaced on the home page and at the top of `/risk-analysis`.
2. A **per-section risk score** ([`/risk-score`](/risk-score?elections=2026_04_19)) that runs the same kind of composite at section level — 12,705 sections each given a 0–100 score from six signals.
3. A **Benford-distribution test per party** ([`/benford`](/benford?elections=2026_04_19)), which the original article did not cover at all.

Same source data, same files in `/public/<date>/` — what's new is the aggregation, not the underlying observations.

> **Framing:** these are screening indices, not fraud determinations. A high score means a section, party, or election is statistically unusual along multiple axes and warrants a closer look. Each component has well-documented innocent explanations (small section size, demographic homogeneity, late registration drives, lawful recounts, range-bounded vote counts that fail Benford by construction). The original integrity article's bottom-line read — "**genuine but historically unusual surge** rather than a manipulated outcome" — is unchanged by what these tools surface.

---

## 1. Composite Election Risk Index — 04.2026 reads at **30 / 100 (Elevated)**

The index is the equally-weighted mean of eight 0–100 sub-scores. Six of the eight are **vote-weighted** (expressed as a share of national turnout, or of total machine votes for the machine-only signals), so the index reads as "what fraction of the result each signal touches" rather than "how many places are flagged." Components without data for a given election are excluded from the average so older cycles still produce a comparable result from the remaining signals.

| # | Component | What it measures | Calibration | 04.2026 value |
|---|---|---|---|---|
| 1 | Section screening | weighted share of national turnout sitting in sections with Elevated/High/Critical band (weights 0.2/0.5/1.0) | 5% of turnout = 100 | **38** (1.92% of turnout) |
| 2 | Benford 2BL | share of parties with ≥100 tested sections that show strong (MAD ≥ 0.08) second-digit deviation | rate-based, 0–100 | **8** (1 / 12 qualifying parties) |
| 3 | Machine integrity | sum of absolute per-party flash-vs-protocol drift / total machine votes, doubled and capped | 0.5% drift = 100 | **0** (0.18% of machine votes) |
| 4 | Missing flash auditability | machine votes in sections that ran machines but submitted no flash drive, as % of total machine votes | 1% of machine votes = 100 | **59** (0.59% of machine votes) |
| 5 | Geographic concentration | top-party votes in settlements where one party took ≥80% of valid vote, as % of turnout | 2% of turnout = 100 | **29** (0.59% of turnout) |
| 6 | Procedural anomalies | invalid ballots + additional voters in flagged settlements, as % of turnout | 2% of turnout = 100 | **18** (0.36% of turnout) |
| 7 | Risk neighborhoods | share of national turnout in the eight tracked communities | 2% of turnout = 100 | **48** (32,544 / 3,360,330 = 0.97%) |
| 8 | Polling error | mean MAE across pollsters, floor at 1.5 pp (international baseline), cap at 5 pp | offset/capped | **40** (mean MAE 2.91 pp) |

Average: **(38 + 8 + 0 + 59 + 29 + 18 + 48 + 40) ÷ 8 ≈ 30**, which lands in the **Elevated** band (60+ Critical, 40–60 High, 20–40 Elevated, <20 Calm).

The largest non-cap-saturated signals are exactly what the [original article §1 and §9](/articles/2026-04-19-integrity) flagged as the largest-vote-impact buckets: risk neighborhoods (0.97% of turnout — the single largest integrity-flagged vote bucket), missing-flash auditability (0.59% of machine votes), and the section-screening band-weighted total (1.92%). Concentration and procedural anomalies — which dominated under the previous count-based scoring — now read at 29 and 18 respectively because the affected vote totals (~0.4–0.6% of turnout) are modest in absolute terms.

Bands are intentionally asymmetric (Calm <20, Elevated <40, High <60, Critical 60+) because in the 2009–2026 backtest the realistic distribution is bottom-heavy — most clean cycles land in 0–25.

---

## 2. Per-section risk screening — 10 sections in Critical, 230 in High

The per-section risk score combines six independent signals — recount delta (weight 0.20), flash-memory mismatch (0.20), invalid-ballot share (0.15), additional-voters share (0.15), vote concentration (0.15), peer-outlier z-score on turnout and winner-share (0.15) — into a 0–100 score per section. Rows are banded as Low (<30), Elevated (<60), High (<80), Critical (≥80).

The 12,705 sections distribute as:

| band | count | share |
|---|---|---|
| Critical (≥80) | 10 | 0.08% |
| High (60–80) | 230 | 1.81% |
| Elevated (30–60) | 1,696 | 13.35% |
| Low (<30) | 10,769 | 84.76% |

The 10 Critical sections, all small in vote count (3–24 valid votes per section), all firing on **invalid ballots + additional voters** (with peer-outlier confirmation in 5 of 10):

| party | location | section | votes | score |
|---|---|---|---|---|
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Vratsa | [061000115](/section/061000115?elections=2026_04_19) | 24 | 94 |
| [ГЕРБ-СДС](/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1?elections=2026_04_19) | Yasna polyana, Primorsko, Burgas | [022700007](/section/022700007?elections=2026_04_19) | 5 | 92 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Goritsa, Pomorie, Burgas | [021700042](/section/021700042?elections=2026_04_19) | 8 | 86 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Sitovo, Rodopi, Plovdiv | [172600039](/section/172600039?elections=2026_04_19) | 7 | 85 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Pazardzhik | [131900095](/section/131900095?elections=2026_04_19) | 15 | 85 |
| [БСП-ОЛ](/party/%D0%91%D0%A1%D0%9F-%D0%9E%D0%9B?elections=2026_04_19) | Yambol | [312600105](/section/312600105?elections=2026_04_19) | 3 | 84 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Gabrovo | [070500119](/section/070500119?elections=2026_04_19) | 13 | 82 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Vishovgrad, Pavlikeni, V. Tarnovo | [042200034](/section/042200034?elections=2026_04_19) | 6 | 82 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Fatovo, Smolyan | [223100087](/section/223100087?elections=2026_04_19) | 9 | 82 |
| [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | Shumen | [303000095](/section/303000095?elections=2026_04_19) | 9 | 80 |

These are mostly very small sections — typical of mobile/hospital/small-village polling stations where 50%+ of the actual voters arriving on the day are added to the list on the spot AND a third or more of paper ballots come back invalid. The combination is the canonical fingerprint of broker-managed turnout (Stokes et al. 2013), but at 3–24 votes per section the absolute impact on the result is negligible. They are flagged for **process-level** review, not outcome-changing concern.

The full ranked table is on [`/risk-score`](/risk-score?elections=2026_04_19), with a per-section breakdown of which signals fired for each row.

---

## 3. Benford's law per party

The [Benford screen](/benford?elections=2026_04_19) tests whether the distribution of leading and second digits in each party's per-section vote counts matches Benford's expected distribution. The default test is **second-digit (2BL)**, recommended by [Mebane (2006)](https://www.umich.edu/~wmebane/inapB.pdf) for vote-count data because the first-digit test routinely fails on range-bounded electoral counts even in clean elections. Mean Absolute Deviation (MAD) is the headline metric: <0.04 close to expected, 0.04–0.08 moderate, ≥0.08 strong.

For 04.2026, four parties show 2BL MAD ≥ 0.04:

| party | MAD | sections (n) | bucket |
|---|---|---|---|
| [АКБ](/benford/64) | 0.092 | 109 | strong |
| [БМ](/benford/14) | 0.089 | 56 | strong |
| [СБ](/benford/8) | 0.077 | 180 | moderate |
| [ИТН](/benford/27) | 0.061 | 86 | moderate |

The composite index uses a stricter qualifying rule (n ≥ 100 sections) per Mebane's noise-floor recommendation, so for the headline number only АКБ (n=109) and СБ (n=180) count: 1 of 12 qualifying parties shows strong deviation, giving a component score of 8.

> **Caveat — Benford on vote counts.** Per-section party vote counts are bounded in a small range (most sections produce 0–500 votes per party), which violates one of Benford's preconditions (the data should span several orders of magnitude). Many clean electoral datasets fail the first-digit test. Treat any deviation here as a reason for a closer look at that party's section-level distribution, not as evidence of fraud. The full caveat banner on [`/benford`](/benford) makes this point on every visit.

The cleanest read is that no major parliamentary party (ГЕРБ-СДС, ПрБ, ПП-ДБ, ДПС, Възраждане, БСП-ОЛ) shows meaningful deviation. The strong-deviation parties (АКБ, БМ) are small parties whose section vote counts cluster in the 0–10 range — exactly where the Benford test is least reliable.

---

## 4. The risk-analysis dashboard

All of the above lives on a single page: [`/risk-analysis?elections=2026_04_19`](/risk-analysis?elections=2026_04_19). The page has a hero with the composite + 8-meter breakdown, then sections for each component (per-section screening top 10, Benford grid, machine drift table, suspicious settlements, polls vs result with historical baseline comparison, risk махали, historical trend), and a "related analyses" tile at the bottom linking out to the full underlying reports. The same hero (compact ribbon variant) is on the [home page](/) under the Anomalies section, so the index is visible at a glance without clicking through.

---

## Glossary additions

- **Composite Election Risk Index** — 0–100 average of eight equally-weighted signals (see §1). Bands: Calm (<20), Elevated (<40), High (<60), Critical (60+).
- **Per-section risk score** ([`/risk-score`](/risk-score?elections=2026_04_19)) — 0–100 weighted sum of six per-section signals; banded Low/Elevated/High/Critical. Methodology: [`/risk-score/methodology`](/risk-score/methodology?elections=2026_04_19).
- **Benford 2BL** ([`/benford`](/benford?elections=2026_04_19)) — Mean Absolute Deviation between observed and Benford-expected second-digit distribution of per-section party vote counts. Methodology: [`/benford/methodology`](/benford/methodology?elections=2026_04_19).
- **Peer outlier** — z-score of a section's turnout and winner-share against same-municipality peers, capped at 4σ. Used as one of the six per-section signals.

---

## Methodology and disclosure

This addendum was generated by **Claude Opus 4.7** (Anthropic, May 2026) from the same `/public/<date>/` datasets as the [original article](/articles/2026-04-19-integrity), plus three new files added since:

- `/2026_04_19/reports/section/risk_score.json` — full per-section scores (12,705 rows, ~12 MB)
- `/2026_04_19/reports/section/risk_score_summary.json` — band counts + top 10 critical (8 KB; the home page and dashboard tiles use this to avoid pulling the full file)
- `/2026_04_19/reports/benford.json` — per-party first- and second-digit distributions (28 KB)

The composite index is computed client-side in [`useRiskComposite.tsx`](https://github.com/atanasster/data-bg/blob/main/src/data/riskScore/useRiskComposite.tsx) — every formula and cap value lives in one file and is editable; no opaque server-side aggregation. Per-section scoring is in [`scripts/reports/risk_score.ts`](https://github.com/atanasster/data-bg/blob/main/scripts/reports/risk_score.ts). The Benford pipeline is in [`scripts/reports/benford.ts`](https://github.com/atanasster/data-bg/blob/main/scripts/reports/benford.ts).

No new survey, interview, or scraping work was performed for this addendum — like the original article, it is entirely a re-analysis of pre-existing public datasets through the lens of the international election-forensics literature.
