---
keywords:
  - election risk index
  - electoral integrity frameworks
  - Pedersen index
  - section risk screening
  - Benford's law Bulgaria
  - 19 April 2026 election
  - electionsbg.com
---
# Election risk screening — new tools for the 19.04.2026 vote

Composite index (47/100, High risk) from five process-integrity signals, plus four context signals (Benford, neighborhood swing, electoral volatility, polling error). Per-section risk screening (10 Critical out of 12,705) and per-party Benford 2BL.

This is a follow-up to the [integrity analysis published ten days earlier](/articles/2026-04-19-integrity) covering the [19.04.2026 election](/elections/2026_04_19). Since then we have added three new aggregation layers on top of the raw metrics:

- **National composite index** — five process-integrity signals (the headline) and four context signals (shown separately).
- **[Per-section risk score](/risk-score?elections=2026_04_19)** — 12,705 sections each given a 0–100 score from six signals.
- **[Per-party Benford test](/benford?elections=2026_04_19)** — statistical distribution of digits in per-section vote counts.

The 19.04.2026 election reads **47 / 100 (High risk)** under the new methodology. These are screening tools, not fraud determinations. The original integrity article's bottom-line read — "genuine but historically unusual surge rather than a manipulated outcome" — is unchanged.

---

## 1. Why we split process integrity from context

A survey of the leading electoral-integrity composites (Norris PEI, V-Dem EQI, Klimek PNAS, IFES) yields three consistent principles:

- **Separate process from context:** process violations (audit-trail loss) are not averaged with statistical inferences (Benford fingerprint).
- **Exclude pollster error:** forecasting miss is a forecast failure, not an electoral violation.
- **Within-community dynamics:** the diagnostic signal is volatility (excess swing), not the static demographic share.

---

## 2. The five process-integrity signals (headline)

These measure disagreements between votes cast and the recorded result:

- **Section screening (38/100):** weighted share (1.92%) of national turnout in risk-flagged sections.
- **Machine integrity (90/100):** 0.18% drift between flash memory and protocol. The strongest signal this cycle.
- **Missing flash memory (59/100):** 0.59% of machine votes outside the end-to-end audit chain.
- **Concentration (29/100):** 0.59% of turnout in settlements where one party took ≥80%.
- **Procedural anomalies (18/100):** 0.36% of turnout from invalid ballots and additional voters above 10%.

Headline: **47 / 100 (High risk)** on the scale <20 Calm, 20–40 Elevated, 40–60 High, 60+ Critical.

---

## 3. The four context signals

These describe the environment but do not contribute to the systemic risk score:

- **Benford 2nd digit (8/100):** one of twelve qualifying parties shows strong deviation (MAD ≥ 0.08). The test is a prompt to look closer, not a verdict.
- **Neighborhood swing (39/100):** [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) shows +5.8 pp excess swing inside the tracked communities versus its national performance.
- **Electoral volatility (100/100):** Pedersen index 49.7 — the cycle is *hyper-volatile* (>30% of the vote redistributed). Typically marks a new entrant.
- **Polling error (40/100):** 2.91 pp mean MAE, reflecting methodology issues and late deciders.

---

## 4. Per-section risk screening

Combines six signals including recount adjustments and peer-outlier z-scores.

| Band | Sections | Share |
|---|---|---|
| Critical (≥80) | 10 | 0.08% |
| High (60–80) | 230 | 1.81% |
| Elevated (30–60) | 1,696 | 13.35% |
| Low (<30) | 10,769 | 84.76% |

The 10 Critical sections (3–24 votes each) are mostly driven by invalid ballots and additional voters. The full ranked table is on [`/risk-score`](/risk-score?elections=2026_04_19).

---

## 5. Benford's law per party

We test the second-digit (2BL) distribution. Four parties show MAD ≥ 0.04, but only two ([АКБ](/benford/64) and [СБ](/benford/8)) have enough sections (n ≥ 100) to be meaningful.

- [АКБ](/benford/64): 0.092 (strong)
- [БМ](/benford/14): 0.089 (strong)
- [СБ](/benford/8): 0.077 (moderate)
- [ИТН](/benford/27): 0.061 (moderate)

**Important:** none of the major parliamentary parties shows meaningful deviation.

---

## 6. Bottom line for 19.04.2026

The most serious issue is the audit-chain weakness (machine integrity 90 and missing flash 59). The enormous political realignment (Pedersen 49.7) is the context for all other anomalies. The neighborhood excess swing for ПрБ (+5.8 pp) is noticeable but moderate.

Takeaway: signals of a compromised audit chain are real and warrant attention; the neighborhood realignment is noticeable but moderate; the political reshuffle is enormous but not by itself anomalous.

---

## Methodology and sources

All data and methodology live on [`/risk-analysis`](/risk-analysis?elections=2026_04_19). The composite is computed client-side in [`useRiskComposite.ts`](https://github.com/atanasster/data-bg/blob/main/src/data/riskScore/useRiskComposite.ts) — every formula and threshold lives in a single file and is auditable. The page [`/risk-analysis/methodology`](/risk-analysis/methodology) remains the quick reference for what each component measures.

References:

- Pedersen, M. (1979). *[The Dynamics of European Party Systems: Changing Patterns of Electoral Volatility](https://doi.org/10.1111/j.1475-6765.1979.tb01267.x)*. European Journal of Political Research 7, 1–26.
- Norris, P. (2014). *[Why Electoral Integrity Matters](https://doi.org/10.1017/CBO9781107280861)*. Cambridge UP.
- Mebane, W. (2006). *[Election Forensics: The Second-Digit Benford's Law Test and Recent American Presidential Elections](https://www.umich.edu/~wmebane/inapB.pdf)*.
- Klimek, P., Yegorov, Y., Hanel, R. & Thurner, S. (2012). *[Statistical detection of systematic election irregularities](https://doi.org/10.1073/pnas.1210722109)*. PNAS 109(41).
- Stokes, S., Dunning, T., Nazareno, M. & Brusco, V. (2013). *[Brokers, Voters, and Clientelism](https://doi.org/10.1017/CBO9781107324909)*. Cambridge UP.
- Cantú, F. (2019). *[The Fingerprints of Fraud: Evidence from Mexico's 1988 Presidential Election](https://doi.org/10.1017/S0003055419000285)*. American Political Science Review 113(3).
- Mainwaring, S. & Zoco, E. (2007). *[Political Sequences and the Stabilization of Interparty Competition](https://doi.org/10.1177/1354068807073852)*. Party Politics 13(2).

This analysis is not a new survey but a re-analysis of existing public datasets through the lens of the international election-forensics literature.
