# Election Integrity Analysis — [19.04.2026](/elections/2026_04_19) vs prior cycles

**Dataset:** 12 elections, 2009-07-05 through 2026-04-19. All metrics extracted from `/public/<date>/` — national summary, problem sections, suspicious settlements, section reports and polls.

**Glossary of indicators used below:**

- **"Protocol below flash memory" discrepancy** ([`suemg_removed`](/reports/section/flash_memory_removed?elections=2026_04_19)) — sections where the official paper protocol records **fewer** votes than what the machine flash drive logged.
- **"Protocol above flash memory" discrepancy** ([`suemg_added`](/reports/section/flash_memory_added?elections=2026_04_19)) — the inverse: the protocol records **more** votes than the flash drive.
- **Missing flash memory** ([`suemg_missing_flash`](/reports/section/missing_flash_memory?elections=2026_04_19)) — sections that ran machines but submitted no flash drive at protocol time.
- **Reallocated votes between flash and protocol** ([`suemg`](/reports/section/flash_memory?elections=2026_04_19)) — sections where the flash drive and the protocol agree on the total machine vote, but the per-party split differs (votes moved between parties).
- **"Support no one" votes** ([`supports_noone`](/reports/section/supports_no_one?elections=2026_04_19)) — valid votes for the "I support no one" option (protest vote).
- **Additional voters** ([`additional_voters`](/reports/section/additional_voters?elections=2026_04_19)) — voters added to the supplementary list on Election Day.
- **Vote concentration** ([`concentrated`](/reports/section/concentrated?elections=2026_04_19)) — top party's share in a section/settlement.
- **Problem sections** ([`problemSections`](/reports/section/problem_sections?elections=2026_04_19)) — sections in the eight tracked risk neighborhoods.

---

## 1. Headline numbers

| metric | [27.10.2024](/elections/2024_10_27) | [19.04.2026](/elections/2026_04_19) | delta | 04.2026 votes impacted |
|---|---|---|---|---|
| [Voter turnout](/reports/section/turnout?elections=2026_04_19) | 38.81% | **50.70%** | **+11.89 pp** (largest jump in the series) | — |
| Actual voters | 2,568,992 | 3,360,330 | +791k | — |
| Registered voters | 6,619,877 | 6,627,747 | +8k (rolls essentially unchanged) | — |
| Machine vote share | 38.04% | 47.61% | +9.57 pp | — |
| Top party | [GERB-SDS](/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1?elections=2024_10_27) 26.39% / 66 seats | [**PB**](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) 44.59% / 131 seats | first single-party majority in the series | — |
| New entrant top finish | — | [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) (zero in prior election) | first time a new party wins outright | — |
| Sections with at least one anomaly | 3,353 | 3,331 | -22 | — |
| Sections with ["protocol **above** flash"](/reports/section/flash_memory_added?elections=2026_04_19) discrepancy | 126 | 88 | -38 | 190 (vs 330 in 10.2024) |
| Sections with ["protocol **below** flash"](/reports/section/flash_memory_removed?elections=2026_04_19) discrepancy | 2,685 | **3,077** | +392 (all-time high) | **11,979** (vs 9,050; +2,929) |
| [Sections with reallocated votes between flash and protocol](/reports/section/flash_memory?elections=2026_04_19) | 158 | 226 | +68 | 338 (vs 194; +144) |
| [Sections with completely missing flash drive](/reports/section/missing_flash_memory?elections=2026_04_19) | 33 | 62 | +29 | **9,104** (vs 3,146; **×2.9**) |
| [Sections in risk neighborhoods](/reports/section/problem_sections?elections=2026_04_19) | 137 | 138 | +1 | **32,544** (vs 25,191; +7,353) |
| Suspicious settlements — [concentration >80%](/reports/settlement/concentrated?elections=2026_04_19) | 218 | **145** | -73 (lowest since 2017) | 18,537 top-party (vs 38,719; -20,182) |
| Suspicious settlements — [invalid >10%](/reports/settlement/invalid_ballots?elections=2026_04_19) | 57 | 87 | +30 | 1,670 invalid ballots (vs 814; +856) |
| Suspicious settlements — [additional voters >10%](/reports/settlement/additional_voters?elections=2026_04_19) | 225 | **429** | **+204 (series high)** | **9,666** day-of additions (vs 5,346; +4,320) |

Sections in [risk neighborhoods](/reports/section/problem_sections?elections=2026_04_19) are the **single largest integrity-flagged bucket — 32,544 votes, ~0.97% of national turnout** — even though the section count (138) is one of the smallest in the table. The next-largest buckets are settlements where the [top party took >80% of the vote](/reports/settlement/concentrated?elections=2026_04_19) (18,537 top-party votes — though down from 38,719 in 2024, the biggest absolute drop on the board) and the ["protocol below flash"](/reports/section/flash_memory_removed?elections=2026_04_19) discrepancy (11,979 votes — only ~0.37% of turnout despite affecting 24.2% of machine sections, much smaller than the section share suggests).

Two flags grew faster in vote terms than in the count of affected sections and settlements: [**completely missing flash drive**](/reports/section/missing_flash_memory?elections=2026_04_19) tripled (3,146 → 9,104 votes, ×2.9) on a doubling of sections (33 → 62), meaning the affected sections are larger on average; [**day-of list additions >10%**](/reports/settlement/additional_voters?elections=2026_04_19) added 9,666 votes (vs 5,346, +81%) on roughly double the settlement count. By contrast, [reallocated votes between flash and protocol](/reports/section/flash_memory?elections=2026_04_19) is essentially negligible in vote terms — 338 votes across 226 sections — a real but cosmetic signal.

Section-share-wise, the ["protocol below flash"](/reports/section/flash_memory_removed?elections=2026_04_19) trend is monotonic since flash-drive auditing began — share of all machine-running sections:

- [04.2023](/reports/section/flash_memory_removed?elections=2023_04_02) → 13.4%
- [06.2024](/reports/section/flash_memory_removed?elections=2024_06_09) → 14.8%
- [10.2024](/reports/section/flash_memory_removed?elections=2024_10_27) → 20.8%
- [**04.2026**](/reports/section/flash_memory_removed?elections=2026_04_19) → **24.2%**

The vote impact translates this into ~12,000 votes in 2026 — a process-quality issue worth investigating, but well below outcome-changing thresholds for any party in the result.

---

## 2. Section-level anomaly history

| election | total | [protocol above flash](/reports/section/flash_memory_added?elections=2026_04_19) | [protocol below flash](/reports/section/flash_memory_removed?elections=2026_04_19) | [missing flash](/reports/section/missing_flash_memory?elections=2026_04_19) | [problem sections](/reports/section/problem_sections?elections=2026_04_19) |
|---|---|---|---|---|---|
| 2009 - 04.2021 | 125-136 | 0 | 0 | 0 | 125-136 |
| [07.2021](/elections/2021_07_11) | 188 | 0 | 1 | 53 | 135 |
| [11.2021](/elections/2021_11_14) | 177 | 9 | 7 | 27 | 135 |
| [10.2022](/elections/2022_10_02) | 154 | 0 | 0 | 19 | 135 |
| [04.2023](/elections/2023_04_02) | 2,148 | 288 | 1,710 | 37 | 135 |
| [06.2024](/elections/2024_06_09) | 2,432 | 309 | 1,917 | 92 | 137 |
| [10.2024](/elections/2024_10_27) | 3,353 | 126 | 2,685 | 33 | 137 |
| [**04.2026**](/elections/2026_04_19) | **3,331** | 88 | **3,077** | **62** | 138 |

Pre-2023 zeroes are *absence of comparable flash-drive data*, not absence of anomalies — CIK began publishing comparable flash datasets only from 2023.

> **International context:** Bulgaria's machine-flash-vs-paper-protocol reconciliation is a *direct* audit trail. Most countries lack the equivalent and have to rely on statistical fingerprints — the Klimek-Yegorov-Hanel-Thurner method ([PNAS 2012](https://www.pnas.org/doi/10.1073/pnas.1210722109)) plots section-level turnout against winning-party share looking for clusters near 100%/100%, which appear in elections widely flagged as fraudulent (Russia 2011-12, Uganda) but not in clean ones (Switzerland, Finland, Spain). The Bulgarian flash audit is more granular than that statistical signature — and a 24% protocol-vs-flash mismatch rate is the kind of process-quality indicator most democracies cannot even measure.

### Who lost votes in "protocol below flash" in 2026?

| party | sections where it is the biggest single loser | net votes lost in those sections (protocol − flash) |
|---|---|---|
| [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) (winner) | 1,418 | **−4,156** |
| [PP-DB](/party/%D0%9F%D0%9F-%D0%94%D0%91?elections=2026_04_19) | 614 | −1,582 |
| [GERB-SDS](/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1?elections=2026_04_19) | 234 | −350 |
| [MECh](/party/%D0%9C%D0%95%D0%A7?elections=2026_04_19) | 165 | −197 |
| [Vazrazhdane](/party/%D0%92%D1%8A%D0%B7%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD%D0%B5?elections=2026_04_19) | 117 | −136 |
| [DPS](/party/%D0%94%D0%9F%D0%A1?elections=2026_04_19) | 80 | −125 |

The [winning party](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) is the **largest net loser** from the protocol-vs-flash reconciliation. The pattern tracks machine vote share: machine-heavy parties get shaved proportionally. PB's 4,156-vote shave is 0.29% of its 1,444,920 total — far from outcome-changing, and the **wrong direction** for any "fraud favouring the winner" hypothesis.

**Largest single-section discrepancies in 2026:**

- [**Section 192700162**](/section/192700162?elections=2026_04_19) (Ruse 27): -102 votes (-47.4% of machine votes); PB loses 101 votes.
- [**Section 234608012**](/section/234608012?elections=2026_04_19) (Sofia-23, obsh. 08): -90 votes; PP-DB loses 90 votes.
- [**Section 234616046**](/section/234616046?elections=2026_04_19) (Sofia-23, obsh. 16): -69 votes; PP-DB loses 34 votes.

All three discrepancies hit the parties that *won* the section — direction-wrong for any fraud hypothesis.

---

## 3. Turnout integrity

| election | mean section turnout | sections >100% | >95% | >90% | <5% |
|---|---|---|---|---|---|
| [2017](/reports/section/turnout?elections=2017_03_26) | 67.34% | 628 | 830 | 916 | 5 |
| [11.2021](/reports/section/turnout?elections=2021_11_14) | 84.89% | 1,275 | 1,516 | 1,617 | 55 |
| [04.2023](/reports/section/turnout?elections=2023_04_02) | 99.05% | 1,117 | 1,336 | 1,402 | 30 |
| [06.2024](/reports/section/turnout?elections=2024_06_09) | 110.91% | 1,087 | 1,334 | 1,400 | 49 |
| [10.2024](/reports/section/turnout?elections=2024_10_27) | 126.70% | 1,039 | 1,250 | 1,319 | 30 |
| [**04.2026**](/reports/section/turnout?elections=2026_04_19) | 75.34% | **987** | **1,228** | **1,321** | 19 |

Despite a +11.89 pp [national turnout](/?elections=2026_04_19) rise, sections with [turnout above 100%](/reports/section/turnout?elections=2026_04_19) **fell** to 987 — the lowest since 10.2022. A fabrication scheme would normally show the opposite pattern.

> **International context:** the [Klimek et al. (PNAS 2012)](https://www.pnas.org/doi/10.1073/pnas.1210722109) "election fingerprint" methodology treats section-level turnout >95% combined with high winning-share as the canonical ballot-stuffing signature — present in Russia 2011-12 and Uganda 2011, absent in Switzerland, Finland, Spain. In Bulgaria these high-turnout sections have stable, structural explanations (mobile sections, hospitals, abroad sections with day-of registration, small remote villages). The fact that the >95% section count *decreased* from 1,250 to 1,228 while national turnout *rose* by 11.89 pp moves Bulgaria 2026 farther from the Klimek fraud signature, not closer.

[**Settlement-level day-of additions**](/reports/settlement/additional_voters?elections=2026_04_19) partially contradict this: 429 settlements with additional voters >10% of actual (vs 225 in [10.2024](/reports/settlement/additional_voters?elections=2024_10_27)) — series record. Top case: [с. Vehtino (Smolyan)](/sections/10910?elections=2026_04_19) at 161.82%, mathematically possible only for very small sections with high churn but worth flagging individually. Concentration in [Smolyan](/municipality/SML?elections=2026_04_19), [Kardzhali](/municipality/KRZ?elections=2026_04_19) and [Vratsa](/municipality/VRC?elections=2026_04_19) oblasts.

---

## 4. The protest-vote collapse

| election | mean section ["support no-one"](/reports/section/supports_no_one?elections=2026_04_19) % | sections >5% | >10% |
|---|---|---|---|
| [2014](/reports/section/supports_no_one?elections=2014_10_05) (option introduced) | 5.28% | 4,448 | 1,135 |
| [10.2022](/reports/section/supports_no_one?elections=2022_10_02) | 3.50% | 2,449 | 82 |
| [04.2023](/reports/section/supports_no_one?elections=2023_04_02) | 4.16% | 3,862 | 145 |
| [10.2024](/reports/section/supports_no_one?elections=2024_10_27) | 3.41% | 2,075 | 80 |
| [**04.2026**](/reports/section/supports_no_one?elections=2026_04_19) | **1.74%** | **84** | **1** |

*Methodology note: the per-section mean and the >5% / >10% thresholds are computed by the same formula the [section-level report](/reports/section/supports_no_one) uses — `100 × ⌈ (noOne ÷ totalActualVoters) × 100 ⌉ ÷ 100` — i.e. each section's percentage is **rounded up** to the nearest whole percent before counting and averaging. Without the ceiling rounding, the means would be ~0.3-0.4 pp lower, but the downward trend is the same.*

Sections with significant protest vote (≥5% "no one") fell from 2,075 to 84 — a **96% reduction**. Combined with the +11.89 pp turnout rise, the most parsimonious read is *previously demobilised voters returned with a positive choice* — [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) absorbed the protest vote. This pattern is hard to fabricate.

> **International context:** the same "protest-absorbed-by-new-movement" pattern appeared in Italy 2013 ([Five Star Movement](https://en.wikipedia.org/wiki/Five_Star_Movement)) where blank/null ballots and abstention dropped sharply as M5S took 25.6%; in France 2017 (Macron's En Marche absorbed both Socialist and Republican defectors and depressed blank ballots in round 1); and in Slovakia 2020 ([OĽaNO surge](https://en.wikipedia.org/wiki/2020_Slovak_parliamentary_election)). The fingerprint of fraud is the *opposite*: when protest votes are erased numerically (e.g. by reclassification or ballot substitution) without a movement-party surge, you typically see falling protest vote alongside falling turnout — not rising turnout, as Bulgaria 2026 shows.

---

## 5. [Risk neighborhoods](/reports/section/problem_sections?elections=2026_04_19) (8 communities, 138 sections)

In Bulgarian electoral analysis, the eight tracked risk neighborhoods are conventionally used as a *fairness barometer*: they have the highest historical incidence of organised vote-buying, ballot stuffing, and coerced "controlled" voting. Three signals are typically watched together — invalid-ballot rate, machine-vote share, and same-day list additions. Persistent extremes on these signals indicate a captured electorate; convergence toward national averages indicates a freer one.

> **International context:** the [OSCE/ODIHR final report on Bulgaria's June 2024 elections](https://www.osce.org/odihr/elections/bulgaria/575719) documented that the Ministry of Interior conducted raids in these specific neighborhoods explicitly to fight vote-buying, planned to publish a list of "risky polling stations" largely overlapping with the same areas, and opened 88 vote-buying investigations by the eve of election day — independent confirmation that the fairness concern in these specific neighborhoods is well-founded and predates this analysis. The academic literature on Bulgarian vote-buying (Mares & Young 2019, *Conditionality & Coercion*, Oxford UP) likewise treats these neighborhoods as the canonical case of broker-driven turnout in EU member states.

### 5.1 Turnout history

| neighborhood | sections | 2017 | 04.2021 | 10.2024 | **04.2026** | Δ vs 2024 |
|---|---|---|---|---|---|---|
| [Stolipinovo (Plovdiv)](/reports/section/problem_sections/stolipinovo?elections=2026_04_19) | 71 | 44.2% | 37.3% | 28.9% | 31.6% | +2.7 pp |
| [Fakulteta (Sofia)](/reports/section/problem_sections/fakulteta?elections=2026_04_19) | 10 | 27.0% | 26.2% | 6.1% | **19.1%** | **+13.0** |
| [Filipovci (Sofia)](/reports/section/problem_sections/filipovci?elections=2026_04_19) | 5 | 42.4% | 58.9% | 32.2% | 40.7% | +8.5 |
| [Nadezhda (Sliven)](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) | 8 | 38.4% | 22.9% | 5.3% | 10.4% | +5.1 |
| [Pobeda (Burgas)](/reports/section/problem_sections/pobeda_burgas?elections=2026_04_19) | 8 | 37.8% | 27.5% | 18.2% | 20.7% | +2.5 |
| [Gorno Ezerovo (Burgas)](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) | 3 | 48.0% | 45.6% | 21.8% | 29.0% | +7.2 |
| [Dolno Ezerovo (Burgas)](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) | 7 | 48.4% | 45.0% | 27.7% | **46.8%** | **+19.1** |
| [Maksuda (Varna)](/reports/section/problem_sections/maksuda?elections=2026_04_19) | 26 | 51.6% | 46.9% | 37.2% | **53.5%** | **+16.3** |

All 8 saw turnout increases. [Maksuda](/reports/section/problem_sections/maksuda?elections=2026_04_19) and [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) are back at or above their 2017 baselines — a 19 pp and 16 pp jump respectively in a single cycle. Whether that reflects genuine remobilisation or organised mobilisation is the question the next three sub-sections address.

### 5.2 Invalid ballot rate (the classic vote-buying signal)

Vote-buying schemes typically pay voters to deliver a *photographed marked ballot* and then tear up a substitute, or pay them to *spoil* their ballot intentionally. Both produce elevated invalid rates — a long-known pattern in these neighborhoods. National 2026 rate: **3.87%**.

| neighborhood | invalid % 10.2024 | invalid % **04.2026** | × national 2026 |
|---|---|---|---|
| [Fakulteta](/reports/section/problem_sections/fakulteta?elections=2026_04_19) | 12.69% | **17.95%** | **4.6×** |
| [Nadezhda Sliven](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) | 12.31% | 14.17% | 3.7× |
| [Gorno Ezerovo](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) | 12.94% | 11.48% | 3.0× |
| [Pobeda Burgas](/reports/section/problem_sections/pobeda_burgas?elections=2026_04_19) | 10.58% | 10.17% | 2.6× |
| [Filipovci](/reports/section/problem_sections/filipovci?elections=2026_04_19) | 7.83% | 9.38% | 2.4× |
| [Stolipinovo](/reports/section/problem_sections/stolipinovo?elections=2026_04_19) | 11.29% | 7.74% | 2.0× |
| [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) | 3.94% | 5.93% | 1.5× |
| [Maksuda](/reports/section/problem_sections/maksuda?elections=2026_04_19) | 2.70% | 3.20% | 0.83× (below national) |

The picture is mixed. **Stolipinovo improved sharply** (-3.5 pp), and Maksuda is now actually *below* the national invalid rate. But **Fakulteta got worse** (12.7% → 17.9%) — almost 5× the national average, the worst reading among the tracked neighborhoods in this dataset. Five of eight remain at 2-4× national, indicating that paid-vote and coerced-spoil patterns persist where they have always been concentrated, even as turnout rose.

### 5.3 Machine vote share (a fairness floor)

The voting machine produces a paper receipt and a tamper-evident flash record — both of which are independently auditable. Paper-only sections cannot be cross-checked against flash data. Higher machine share in a captured area therefore *limits* the available manipulation surface. National 2026: **47.61%** machine.

| neighborhood | machine % 10.2024 | machine % **04.2026** | shift |
|---|---|---|---|
| [Maksuda](/reports/section/problem_sections/maksuda?elections=2026_04_19) | 55.2% | **66.0%** | +10.8 pp |
| [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) | 49.2% | 61.4% | +12.2 |
| [Stolipinovo](/reports/section/problem_sections/stolipinovo?elections=2026_04_19) | 33.6% | 54.3% | **+20.7** |
| [Gorno Ezerovo](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) | 27.0% | 47.6% | +20.6 |
| [Filipovci](/reports/section/problem_sections/filipovci?elections=2026_04_19) | 30.6% | 39.6% | +9.0 |
| [Pobeda Burgas](/reports/section/problem_sections/pobeda_burgas?elections=2026_04_19) | 17.0% | 27.7% | +10.7 |
| [Nadezhda Sliven](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) | 20.0% | 26.6% | +6.6 |
| [Fakulteta](/reports/section/problem_sections/fakulteta?elections=2026_04_19) | 26.7% | 24.8% | -1.9 |

Three neighborhoods (Maksuda, Dolno Ezerovo, Stolipinovo) are now *above* the national machine share — which is unusual; historically these neighborhoods skew heavily paper. This is a substantive integrity improvement: a higher fraction of these votes is now auditable end-to-end. **Fakulteta and Nadezhda Sliven remain heavily paper** (75-77% paper), and they are also the two with the worst invalid rates — paper-heavy *and* spoil-heavy.

### 5.4 Same-day list additions

Election Day list additions ([`additional_voters`](/reports/section/additional_voters?elections=2026_04_19)) are how patron-managed voters are typically processed: they aren't on the standing roll, they show up with a paid courier, get added on the spot, and vote. Persistent high additions in a low-turnout area are a strong fairness flag.

| neighborhood | additions % 10.2024 | additions % **04.2026** | shift |
|---|---|---|---|
| [Nadezhda Sliven](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) | **13.99%** | 7.28% | -6.71 |
| [Fakulteta](/reports/section/problem_sections/fakulteta?elections=2026_04_19) | 9.96% | 4.80% | **-5.16** |
| [Pobeda Burgas](/reports/section/problem_sections/pobeda_burgas?elections=2026_04_19) | 6.93% | 5.27% | -1.66 |
| [Gorno Ezerovo](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) | 5.60% | 4.71% | -0.89 |
| [Stolipinovo](/reports/section/problem_sections/stolipinovo?elections=2026_04_19) | 3.80% | 4.29% | +0.49 |
| [Maksuda](/reports/section/problem_sections/maksuda?elections=2026_04_19) | 2.53% | 2.12% | -0.41 |
| [Filipovci](/reports/section/problem_sections/filipovci?elections=2026_04_19) | 2.16% | 2.90% | +0.74 |
| [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) | 1.60% | 1.82% | +0.22 |

Despite turnout rising, **same-day additions are *down* in 5 of 8 neighborhoods**, with two large-magnitude declines (Nadezhda Sliven -6.7 pp, Fakulteta -5.2 pp). This is the opposite of what controlled-mobilisation would produce — the additional turnout was largely from voters already on the roll, not from courier-driven on-the-day registrations.

### 5.5 Top party concentration — does PB look like a patron?

Captured-electorate signatures usually show one party with an *outsized* share. National PB share: **44.59%**.

| neighborhood | top party 10.2024 (share) | top party **04.2026** | PB pp above national |
|---|---|---|---|
| [Stolipinovo](/reports/section/problem_sections/stolipinovo?elections=2026_04_19) | GERB-SDS (41.5%) | PB 50.5% | +5.9 pp |
| [Fakulteta](/reports/section/problem_sections/fakulteta?elections=2026_04_19) | GERB-SDS (27.2%) | PB 53.7% | +9.1 |
| [Filipovci](/reports/section/problem_sections/filipovci?elections=2026_04_19) | DPS–NB (29.3%) | PB 40.7% | -3.9 |
| [Nadezhda Sliven](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) | DPS–NB (36.4%) | **PB 59.7%** | **+15.1** |
| [Pobeda Burgas](/reports/section/problem_sections/pobeda_burgas?elections=2026_04_19) | GERB-SDS (44.5%) | PB 40.2% | -4.4 |
| [Gorno Ezerovo](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) | GERB-SDS (44.9%) | PB 56.5% | +11.9 |
| [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) | GERB-SDS (28.3%) | **PB 60.1%** | **+15.5** |
| [Maksuda](/reports/section/problem_sections/maksuda?elections=2026_04_19) | GERB-SDS (29.6%) | PB 49.4% | +4.8 |

Two patterns coexist:
- In **Stolipinovo, Filipovci, Pobeda Burgas, and Maksuda** — the four most-populous tracked neighborhoods — PB's share is at or below its national average. Not a patron signature.
- In **Nadezhda Sliven, Gorno Ezerovo, Dolno Ezerovo, and Fakulteta** — the four smallest in registered-voter terms — PB performs **9-15 pp above national**. These are the same four neighborhoods with the worst invalid rates and the deepest paper share.

The neighborhoods where PB looks anomalously strong are also the neighborhoods where the structural fairness signals (invalid, paper share) are most degraded. The most parsimonious read is that *whatever local broker network historically ran turnout in Nadezhda Sliven, Dolno/Gorno Ezerovo, and Fakulteta has migrated its allocation from the previous patron parties (GERB-SDS, DPS–NB) to PB*. The headline national result is not driven by these four — they account for ~5,000 votes in total — but they are the cells where the cleanest fraud-style signature shows up, and they should be the focus of any post-election integrity review.

**One caveat:** of the four, only [Dolno Ezerovo](/reports/section/problem_sections/dolno_ezerovo?elections=2026_04_19) has a long-running pattern of swinging heavily toward each new movement party — [ITN in 04.2021](/reports/section/problem_sections/dolno_ezerovo?elections=2021_04_04) (25.9%) and [07.2021](/reports/section/problem_sections/dolno_ezerovo?elections=2021_07_11) (36.5%), [PP in 11.2021](/reports/section/problem_sections/dolno_ezerovo?elections=2021_11_14) (31.8%), now PB. Its 60% PB share in 2026 is partly consistent with ordinary movement-party adoption rather than a clear broker pivot. The other three — [Gorno Ezerovo](/reports/section/problem_sections/gorno_ezerovo?elections=2026_04_19) and [Fakulteta](/reports/section/problem_sections/fakulteta?elections=2026_04_19) voted GERB-SDS top in *seven straight elections* (04.2021 through 10.2024) and [Nadezhda Sliven](/reports/section/problem_sections/nadezhda_sliven?elections=2026_04_19) oscillated GERB-SDS / DPS without ever picking a movement party — making their abrupt 2026 pivot to PB harder to explain without a broker-network shift.

---

## 6. [Polling](/polls) vs result — largest miss in the dataset

**Final polls for 19.04.2026** — averaged across all agencies whose fieldwork ended within 14 days of election day (06.04 - 14.04.2026). Four agencies fall in this window: [Market Links](/polls/ML), [Myara](/polls/MY), [CAM (Center for Analysis and Marketing)](/polls/CAM), and [Sova Harris](/polls/SH).

| party | poll mean | actual | error |
|---|---|---|---|
| [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) | 35.20 | **44.59** | **+9.39 pp** |
| [GERB-SDS](/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1?elections=2026_04_19) | 19.55 | 13.39 | -6.16 |
| [PP-DB](/party/%D0%9F%D0%9F-%D0%94%D0%91?elections=2026_04_19) | 12.15 | 12.62 | +0.47 |
| [DPS](/party/%D0%94%D0%9F%D0%A1?elections=2026_04_19) | 9.58 | 7.12 | -2.46 |
| [Vazrazhdane](/party/%D0%92%D1%8A%D0%B7%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD%D0%B5?elections=2026_04_19) | 7.08 | 4.26 | -2.82 |
| [BSP-UL](/party/%D0%91%D0%A1%D0%9F-%D0%9E%D0%9B?elections=2026_04_19) | 4.00 | 3.02 | -0.98 |

**For comparison, [final polls for 27.10.2024](/polls):**

| party | poll mean | actual | error |
|---|---|---|---|
| [GERB-SDS](/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1?elections=2024_10_27) | 25.26 | 26.39 | +1.13 |
| [PP-DB](/party/%D0%9F%D0%9F-%D0%94%D0%91?elections=2024_10_27) | 16.98 | 14.21 | -2.77 |
| [Vazrazhdane](/party/%D0%92%D1%8A%D0%B7%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD%D0%B5?elections=2024_10_27) | 14.18 | 13.36 | -0.82 |
| [DPS–NB](/party/%D0%94%D0%9F%D0%A1-%D0%9D%D0%9D?elections=2024_10_27) | 11.08 | 11.51 | +0.43 |
| [BSP](/party/%D0%91%D0%A1%D0%9F?elections=2024_10_27) | 8.42 | 7.57 | -0.85 |

In [2024](/elections/2024_10_27), every party landed inside ±2.8 pp; in [2026](/elections/2026_04_19) the winner deviated +9.4 pp and GERB -6.2.

### How does this compare to international benchmarks?

The mean absolute error (MAE) across the parties shown:

- **2024-10-27 BG MAE:** 1.20 pp (across 5 parliamentary parties)
- **2026-04-19 BG MAE:** 3.71 pp (across 6 parliamentary parties)

The largest meta-analysis of pre-election polls — Jennings & Wlezien, "[Election polling errors across time and space](https://www.nature.com/articles/s41562-018-0315-6)" (Nature Human Behaviour, 2018), 30,000+ polls in 351 elections across 45 countries (1942-2017) — finds the eve-of-election MAE at **~2 percentage points** internationally. The American Association for Public Opinion Research notes that real-world error tends to run [closer to 3.5 pp](https://www.pewresearch.org/short-reads/2016/09/08/understanding-the-margin-of-error-in-election-polls/) once non-sampling sources are included, roughly double the textbook ±3 pp sampling margin for an n=1,000 poll.

So the **2024 BG aggregate MAE (1.20 pp) was unusually good** — better than the international historical average. The **2026 BG aggregate MAE (3.71 pp) is roughly at the real-world baseline** — not actually exceptional in aggregate.

What *is* exceptional is the **dispersion**: a single +9.39 pp miss on PB and a -6.16 pp miss on GERB-SDS pulling in opposite directions. Comparable single-party misses in major recent elections:

| election | party | poll | actual | miss |
|---|---|---|---|---|
| **BG 2026-04** | **PB (new)** | **35.2%** | **44.6%** | **+9.4 pp** |
| France 2017 round 2 | Macron | +22 lead | +32 lead | +10.0 pp |
| Italy 2013 | [Five Star Movement](https://en.wikipedia.org/wiki/Opinion_polling_for_the_2013_Italian_general_election) (new) | ~20% | 25.6% | +5.6 pp |
| US 2016 (state polls avg) | Trump | — | — | 5.2 pp |
| US 2016 (national polls avg) | Trump–Clinton margin | — | — | 3.1 pp |
| UK 2010 | Lib Dems (overestimate) | ~28% | 23% | -5 pp |

The PB miss (+9.4 pp) lands between the 2017 Macron round-2 underestimate (+10 pp) and the 2013 Five Star Movement underestimate (+5.6 pp). Both of those were also new-or-movement parties peaking late, and both produced equivalent national hand-wringing about polling failure that turned out, on review, to reflect known methodological weaknesses rather than fraud.

**Likely explanations for the 2026 miss:**

1. **[PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) is brand-new** (priorPct = 0). The systematic finding in the international literature — Five Star 2013, Macron's En Marche 2017, the Pirate party in Berlin 2011 — is that movement-style new parties are routinely under-polled by 5-10 pp in their breakthrough cycle. Likely-voter screens trained on prior turnout under-weight first-time and previously-demobilised voters; party-ID weighting anchors to the previous election where the new entrant scored zero.
2. **Turnout model error.** Pollsters likely modelled near 2024-10's 38.81% baseline; actual was 50.7% — surplus voters were under-weighted in likely-voter models. Bulgarian-specific [research on turnout-driven polling error](https://www.pure.ed.ac.uk/ws/portalfiles/portal/194763074/DaoustBJPIR2021BlameItOnTurnout.pdf) finds turnout shifts >5 pp are the single largest driver of polling failure across Europe.
3. **Anchoring on incumbent.** GERB numbers clustered tightly between 18.5-20.3% across all agencies — unusually narrow given the volatility, suggesting agencies anchored to historical baseline.

A polling miss of this magnitude is **not evidence of fraud** — Jennings & Wlezien's headline finding (summarised by the [University of Southampton press office](https://www.southampton.ac.uk/news/2018/03/opinion-poll-errors.page): *"claims of a crisis in the accuracy of election polling are false"*) is that single-party 5-10 pp misses occur in roughly one in ten national elections studied, almost always when a new party surges. The 2026 BG miss fits the well-documented "new-movement-party" failure mode rather than indicating something irregular happened on Election Day.

---

## 7. [Regional pattern](/regions?elections=2026_04_19)

[PB](/party/%D0%9F%D1%80%D0%91/regions?elections=2026_04_19) won **31 of 32 oblasts**. Exception: [Kardzhali](/municipality/KRZ?elections=2026_04_19) — won by [DPS](/party/%D0%94%D0%9F%D0%A1?elections=2026_04_19) at 56.1%.

**PB shares:**

- **Highest:** [Plovdiv](/municipality/PDV?elections=2026_04_19) 54.4%, [Yambol](/municipality/JAM?elections=2026_04_19) 54.9%, [Vratsa](/municipality/VRC?elections=2026_04_19) 53.6%, [V. Tarnovo](/municipality/VTR?elections=2026_04_19) 52.8%
- **Lowest:** [Sofia-23](/municipality/S23?elections=2026_04_19) 32.6% (central Sofia, [PP-DB](/party/%D0%9F%D0%9F-%D0%94%D0%91?elections=2026_04_19) stronghold), [Sofia-24](/municipality/S24?elections=2026_04_19) 35.0%, [Razgrad](/municipality/RAZ?elections=2026_04_19) 38.6%, [Blagoevgrad](/municipality/BLG?elections=2026_04_19) 39.8%, ["abroad"](/municipality/32?elections=2026_04_19) 38.0%

No oblast where PB wins with a patron-driven >65% share. The most-suspicious-on-its-face number is the **low** [central Sofia](/municipality/S23?elections=2026_04_19) figure, not a high one — the *expected* anti-populist district.

---

## 8. [Invalid ballots](/reports/section/invalid_ballots?elections=2026_04_19)

| election | mean | sections >5% | >10% | >25% |
|---|---|---|---|---|
| [2014](/reports/section/invalid_ballots?elections=2014_10_05) | 6.62% | 6,745 | 1,917 | 120 |
| [10.2024](/reports/section/invalid_ballots?elections=2024_10_27) | 3.13% | 2,244 | 376 | 16 |
| [**04.2026**](/reports/section/invalid_ballots?elections=2026_04_19) | 3.70% | 2,990 | 489 | 21 |

Modest uptick vs [10.2024](/reports/section/invalid_ballots?elections=2024_10_27), well within historical norms — half the 2014 peak. Top extreme cases all involve very low total-vote sections (small-N noise).

> **International context:** invalid-ballot rates are a well-established vote-buying proxy in the comparative-politics literature. Stokes, Dunning, Nazareno & Brusco's [*Brokers, Voters, and Clientelism*](https://www.cambridge.org/core/books/brokers-voters-and-clientelism/2346382B38862E36C09042C779EA1510) (Cambridge UP, 2013) documents the mechanism: paid voters are required to deliver a *spoiled or photographed* ballot to the broker as proof, which inflates section-level invalid rates 2-5× the national baseline. Bulgaria's 3.7% national rate is in line with EU peers (Romania 2-4%, Slovakia 3-5%, Italy 2-3%); the risk-neighborhood multiplier of 2-5× national in this dataset matches the literature's predicted signature in captured cells almost exactly.

---

## 9. Bottom line

The [19.04.2026 result](/elections/2026_04_19) reads, on the integrity metrics this dataset captures, as a **genuine but historically unusual surge** rather than a manipulated outcome.

### Signals consistent with a clean election

1. [**`supports_noone` collapsed -96%**](/reports/section/supports_no_one?elections=2026_04_19) — protest voters absorbed by the winning party.
2. [**Sections with turnout >100% fell**](/reports/section/turnout?elections=2026_04_19) despite +11.89 pp national turnout — opposite of fabrication pattern.
3. [**Direction of protocol-vs-flash discrepancy**](/reports/section/flash_memory_removed?elections=2026_04_19) — the winner is the largest victim, not the beneficiary.
4. [**Risk-neighborhood machine share rose 10-20 pp**](/reports/section/problem_sections?elections=2026_04_19) in five of eight neighborhoods — more votes are now end-to-end auditable; same-day additions also declined in five of eight.
5. [**Regional spread**](/regions?elections=2026_04_19) — 31/32 oblasts, no extreme shares; lowest in [central Sofia](/municipality/S23?elections=2026_04_19) (where it is *expected* to be low under a populist wave).
6. [**Settlement count with >80% concentration**](/reports/settlement/concentrated?elections=2026_04_19) at a 9-year low.

### Signals worth public scrutiny independent of who benefited

Listed in order of **votes impacted**, with section/settlement counts as secondary context. Total turnout was 3,360,330 — a useful denominator for scale. Each item also flags the **top beneficiary** — i.e. the party that captured the most votes in the affected units, with raw counts so the partisan tilt of each signal is visible.

1. [**~32,500 votes in 138 risk-neighborhood sections**](/reports/section/problem_sections?elections=2026_04_19) (~0.97% of national turnout, +7,353 votes vs 10.2024) — the single largest integrity-flagged vote bucket in the dataset. Most concentrated in [Maksuda (Varna)](/reports/section/problem_sections/maksuda?elections=2026_04_19), [Stolipinovo (Plovdiv)](/reports/section/problem_sections/stolipinovo?elections=2026_04_19), and the four high-PB neighborhoods called out in item 6 below. **Top beneficiary: [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) — 15,548 votes (50.5% of all votes here, +5.9 pp above its 44.59% national share); top party in 130 of 138 sections.**
2. [**~18,500 top-party votes across 145 settlements with >80% concentration**](/reports/settlement/concentrated?elections=2026_04_19) — down sharply from ~38,700 in 10.2024 (lowest since 2017), but still the second-largest single bucket and worth settlement-level review for the residual cluster. **Top beneficiary: [DPS](/party/%D0%94%D0%9F%D0%A1?elections=2026_04_19) — 15,863 votes (85.6% of the bucket), dominant in 131 of 145 settlements**. PB is dominant in only 11 settlements (2,311 votes). This is the classic captured-electorate signature in historically DPS-base areas — *not* a PB pattern.
3. [**~12,000 votes in 3,077 sections of "protocol below flash" discrepancy**](/reports/section/flash_memory_removed?elections=2026_04_19) — 24% of all machine sections, series high in section share, +2,929 votes vs 10.2024. Multi-cycle transcription drift that cannot be explained by "honest mistakes"; modest in vote terms (~0.36% of turnout) but a process-quality issue that warrants technical investigation regardless of outcome. **No party benefits — votes are subtracted from all parties; PB is the largest net loser at -4,156 votes (see §2.1 for the full breakdown).**
4. [**~9,700 day-of list additions across 429 settlements**](/reports/settlement/additional_voters?elections=2026_04_19) (+4,320 votes vs 10.2024, settlement count near-doubled — series high), concentrated in [Smolyan](/municipality/SML?elections=2026_04_19), [Kardzhali](/municipality/KRZ?elections=2026_04_19) and [Vratsa](/municipality/VRC?elections=2026_04_19). Top extreme: [с. Vehtino](/sections/10910?elections=2026_04_19) at 161% added. **Estimated split (proportional to in-settlement vote share): PB ~3,434 (35.5%), PP-DB ~1,844 (19.1%), GERB-SDS ~1,207 (12.5%), DPS ~1,124 (11.6%).** PB's share here is ~9 pp *below* its 44.59% national — these settlements are not particularly PB-leaning, so the surge is not a PB-specific signal.
5. [**~9,100 machine votes in 62 sections with completely missing flash drive**](/reports/section/missing_flash_memory?elections=2026_04_19) — nearly tripled in vote terms vs 10.2024 (3,146 votes), a sharper jump than the section count (33 → 62) implies. Un-auditable beyond paper. **Top beneficiary: [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) — 3,934 machine votes (43.2%, near its 44.59% national share). [PP-DB](/party/%D0%9F%D0%9F-%D0%94%D0%91?elections=2026_04_19) is notably *over*-represented at 2,251 votes (24.7% vs its 12.59% national).**
6. [**Four risk neighborhoods (Nadezhda Sliven, Dolno/Gorno Ezerovo, Fakulteta) where PB ran 9-15 pp above its national share**](/reports/section/problem_sections?elections=2026_04_19), in the same cells with the worst invalid-ballot rates (up to 4.6× national) and lowest machine share. The cleanest fraud-style signature in the dataset — small in absolute votes (~5,200 actual voters, a subset of the 32,500 in item 1) but worth a focused local review. **Top beneficiary: [PB](/party/%D0%9F%D1%80%D0%91?elections=2026_04_19) — 2,710 votes (57.7% of all votes in these 28 sections, +13.1 pp above national).**
7. [**~1,700 invalid ballots across 87 settlements with >10% invalid rate**](/reports/settlement/invalid_ballots?elections=2026_04_19) (+856 vs 10.2024). No party gets invalid ballots directly, but in the literature ([Stokes et al.](https://www.cambridge.org/core/books/brokers-voters-and-clientelism/2346382B38862E36C09042C779EA1510)) the implicit beneficiary is whoever the broker is paid to support — i.e. the dominant party in the flagged settlements: **PB dominant in 58 settlements (5,249 votes), DPS in 20 (1,336 votes), GERB-SDS in 7 (383 votes).**
8. [**~340 votes across 226 sections with reallocated votes between flash and protocol**](/reports/section/flash_memory?elections=2026_04_19) (+144 vs 10.2024) — small in absolute terms, but the upward trend in section count makes it worth tracking. **Effectively net-neutral by party: PB is both top gainer (105 votes across 88 sections) and top loser (59 votes across 33 sections), net +46.**

### The polling miss

The ~9 pp miss on the winner is a **forecast failure, not an integrity finding**, but it is the largest in the series and warrants a methodology post-mortem from polling agencies — particularly turnout modelling and incumbent anchoring.

---

## Methodology and disclosure

This analysis was generated by **Claude Opus 4.7** (Anthropic, May 2026), working from the structured datasets in [`/public/<date>/`](https://github.com/atanasster/data-bg) — `national_summary.json`, `problem_sections.json`, `dashboard/suspicious_settlements.json`, the per-section reports under `reports/section/*`, and the polls dataset under `polls/`. Every numeric claim in the article is computable from those files using the queries in the underlying repository; section anomaly counts follow the definitions in [`scripts/reports/nationalSummary.ts`](https://github.com/atanasster/data-bg/blob/main/scripts/reports/nationalSummary.ts) (the union of `recount`, `recountZeroVotes`, `suemgAdded`, `suemgRemoved`, `suemgMissingFlash`, and `problemSections` per election).

External references (academic, OSCE/ODIHR, polling-agency archives) were retrieved via web search at time of writing and are linked inline at point of use. No new survey, interview, or scraping work was performed for this article — it is entirely a re-analysis of pre-existing public datasets through the lens of the international election-forensics and polling-error literature.

Reproduction notes: the polling-MAE figures are computed by averaging the four April 2026 final polls per party and subtracting the official result; section-level distributions (>5%, >10%, >100% etc.) are direct counts from the corresponding `reports/section/*.json` files.
