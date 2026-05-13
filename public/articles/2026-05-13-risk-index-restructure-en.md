---
keywords:
  - election risk index
  - electoral integrity frameworks
  - Pedersen index
  - vote-buying screening
  - Bulgaria 2026 election
  - composite risk methodology
  - electionsbg.com
---
# Rebuilding the Election Risk Index — process integrity vs context

Why we split the composite into five process-integrity signals (the headline) and four context signals, how the international frameworks back the split, and what the new scheme reads for the [19.04.2026 election](/elections/2026_04_19) — 47 / 100 (High risk).

The composite Election Risk Index introduced in the [previous risk-screening article](/articles/2026-04-19-risk-screening) treated eight independent statistical signals as equal peers and averaged them into a single headline number. After a closer reading of the international electoral-integrity literature, the index was restructured. Process-integrity signals and context indicators are qualitatively different and should not be averaged together.

The headline is now the average of five process-integrity signals only; four context signals (Benford fingerprint, neighborhood swing, electoral volatility, polling error) are shown alongside but do not feed the headline. The 19.04.2026 election reads **47 / 100 (High risk)** on the new methodology, up from **30 / 100 (Elevated)** on the old.

---

## 1. Headline changes

| Indicator | Old (April 2026) | New (May 2026) |
|---|---|---|
| Headline components | 8, equally averaged | 5 process-integrity signals |
| Context signals | — | 4 (shown separately) |
| Neighborhood signal | Static demographic share | Cycle-on-cycle excess swing (vs national mean) |
| New component | — | Electoral volatility (Pedersen index) |
| Machine-drift cap | 0.5% (implementation bug) | 0.2% (corrected formula) |
| Polling error | In the headline | Moved to context |
| 19.04.2026 reading | 30 / Elevated | 47 / High |

The headline movement comes almost entirely from the machine-drift fix. The 0.18% disagreement between machine votes and the flash-memory record now scores 90 / 100. International standards (Mexico INE rules, US risk-limiting audits) trigger review well under 0.5%, which makes the new 0.2% cap better calibrated.

---

## 2. Alignment with the international frameworks

A survey of the leading electoral-integrity composites (Pippa Norris PEI, V-Dem EQI, Klimek PNAS) yields three consistent findings:

- **Separate process from context.** No mainstream framework averages process violations (audit-trail loss, protocol/flash disagreement) on equal footing with statistical inferences (Benford fingerprint).
- **Exclude pollster error.** Forecasting miss is treated as a forecast failure, not an integrity violation, and is therefore absent from the main composites.
- **Within-community dynamics, not static share.** The vote-buying literature (Stokes et al. 2013) emphasises that the diagnostic signal is the *volatility* (excess swing) in target communities relative to the national mean, not their static demographic share.

---

## 3. The five process-integrity signals (headline)

These measure direct disagreements between votes cast and the recorded result:

- **Section screening (38/100):** weighted share (1.92%) of national turnout in sections with elevated risk markers.
- **Machine integrity (90/100):** 0.18% drift between flash memory and protocol. The largest signal in this cycle.
- **Missing flash memory (59/100):** 0.59% of machine votes outside the end-to-end audit chain.
- **Concentration (29/100):** vote share in settlements where one party took ≥80% (0.59% of turnout).
- **Procedural anomalies (18/100):** invalid ballots + additional voters above 10% in specific settlements.

Process-integrity headline: (38 + 90 + 59 + 29 + 18) / 5 = **47 / 100 (High risk)**.

---

## 4. The four context signals

These describe the environment but do not contribute to the systemic integrity score:

- **Benford 2nd digit (8/100):** one of twelve qualifying parties shows deviation. Moved here because per-section party vote counts routinely violate the test's distributional precondition.
- **Neighborhood swing (39/100):** [ПрБ](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) shows +5.8 pp excess swing inside the eight tracked communities versus its national performance.
- **Electoral volatility (100/100):** Pedersen index 49.7, defining the election as *hyper-volatile* (>30% of the vote redistributed). This explains the intuition that the cycle was unusual without implying irregularity.
- **Polling error (40/100):** mean MAE 2.91 pp reflects methodology issues and late-deciding voters, not direct electoral violations.

---

## 5. Bottom line for 19.04.2026

The new methodology confirms that the most serious issue this cycle is the audit-chain weakness (machine integrity + missing flash). The remaining integrity signals (screening, concentration, procedural noise) are moderate. The enormous political realignment (Pedersen 49.7) is the context in which all the other anomalies should be read.

Takeaway: the signals of a compromised audit chain are real and warrant attention; the neighborhood excess swing is present but well below extreme levels.

---

## Methodology and sources

This article was drafted by **Claude Opus 4.7** (Anthropic, May 2026) from the same `/public/<date>/` files as the prior risk-screening article, plus the restructured composite logic in [`useRiskComposite.ts`](https://github.com/atanasster/data-bg/blob/main/src/data/riskScore/useRiskComposite.ts). The methodology page at [`/risk-analysis/methodology`](/risk-analysis/methodology) remains the quick reference for what each component measures.

References:

- Pedersen, M. (1979). *The Dynamics of European Party Systems*. European Journal of Political Research 7, 1–26.
- Norris, P. (2014). *Why Electoral Integrity Matters*. Cambridge UP.
- Mebane, W. (2006). *Election Forensics: The Second-Digit Benford's Law Test*.
- Klimek, P., Yegorov, Y., Hanel, R. & Thurner, S. (2012). *Statistical detection of systematic election irregularities*. PNAS 109(41).
- Stokes, S., Dunning, T., Nazareno, M. & Brusco, V. (2013). *Brokers, Voters, and Clientelism*. Cambridge UP.
- Mainwaring, S. & Zoco, E. (2007). *Political Sequences and the Stabilization of Interparty Competition*. Party Politics 13(2).
