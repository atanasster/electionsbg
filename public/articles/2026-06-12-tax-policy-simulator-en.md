---
keywords:
  - tax policy simulator
  - Bulgaria budget calculator
  - VAT simulator
  - flat income tax
  - tax-free minimum
  - maximum insurable income
  - progressive taxation
  - behavioral elasticities
  - fiscal multipliers
  - dynamic scoring
  - Maastricht deficit
  - НАП income distribution data
  - freedom of information request
  - Bulgaria budget deficit
schemaType: TechArticle
updatedAt: 2026-06-12
---

# The budget simulator — how it works, what it assumes, and what we're asking НАП for

Every tax debate in Bulgaria circles the same two questions: _how much will this change bring (or cost) the budget_, and _how will it hit my payslip_. The answers usually arrive piecemeal — a ministry press release, a union opinion, an expert comment — and almost never in one place, with a shared methodology and checkable sources.

The [budget simulator](/budget/simulator) on electionsbg.com does exactly that: move a rate and see, side by side, the change in consolidated budget revenue per year **and** the effect on one worked payslip per month. You can test real proposals — a progressive tax, higher VAT, removing the social-security cap, higher defense — and compare them against the published official costings, all with fully open source and documented assumptions.

This piece explains how the tool works under the hood: where the numbers come from, how each lever is scored, what is certain and what is modeled, and — at the end — what data we are asking the National Revenue Agency (НАП) for, so we can replace the one large assumption in the model with real data.

## Two modes: static and dynamic

The simulator scores every scenario two ways, toggled with one button.

![Scenario scoreboard: goal missions (Maastricht −3%, debt under 40%, defense 3%), a static/dynamic toggle, and a gauge showing how close the scenario is to the target deficit — "today −4.1%" vs "scenario −2.2%", target met with a margin.](/articles/images/budget_simulator/en/01-scoreboard.png)

**Static mode** holds the tax base at the latest closed fiscal year (the 2025 execution) and assumes people do not change behavior. This is the convention of official costings — when the Ministry of Finance says "+1pp VAT = +X", it computes exactly that: the current base times the new rate. The approach is reasonable for small moves and useful precisely because it is comparable to the official figures.

**Dynamic mode** (the default) adds what static omits: people respond to taxes. It layers three things — behavioral responses of the tax base (reporting, profit shifting, compliance), a reduced-form macroeconomic feedback on GDP, and a Monte-Carlo uncertainty band. The result is a more conservative but more honest estimate: a tax hike almost always yields less than the static figure.

The headline shows both: the dynamic central estimate, the uncertainty band (5th to 95th percentile), and a "static X · behavior −Y" decomposition, so you can see exactly how much the behavioral response eats.

## The goal: what you're actually trying to achieve

Above the numbers sits a scoreboard with three missions that turn the abstract result into a target:

- **Maastricht −3%** — bring the deficit under 3% of GDP for 2026; precisely the threshold behind the European Commission's recommendation to open an excessive-deficit procedure against Bulgaria on 3 June 2026.[^edp]
- **Debt under 40% by 2030** — keep government debt below 40% of GDP at the end of the projection (the baseline drifts to ~43%).
- **Defense 3%** — reach 3% of GDP on defense without a first-year deficit worse than the baseline.

The gauge shows where the deficit is "today", where your scenario takes it, and where the finish line is — like the budget-balancing games of the US Committee for a Responsible Federal Budget. The number no longer floats; it moves toward a goal.

## How each lever is scored

This is the heart of the tool. Every lever has its own methodology, and every number traces to КФП execution, the НАП annual report, Eurostat national accounts or the НОИ aggregates.

![Per-tax revenue breakdown: VAT +799M (static +887M), income tax +1.8B (static +1.9B), and under the administration lever, a note that 85% of the cut falls on vacant positions.](/articles/images/budget_simulator/en/02-breakdown.png)

**VAT.** The model rides on Eurostat household final consumption by COICOP purpose[^coicop]: each consumption slice carries its statutory VAT regime (standard 20%, reduced 9%, zero or exempt), and the gap between modeled and actual VAT revenue (households are only part of the base) is bridged by a calibration factor that is stable around **1.17** across 2021–2025. A +1pp move in the standard rate yields ≈ +€447M. For context: Bulgaria's VAT compliance gap is estimated at **€781M — 8.6% of the theoretical liability** in the EC's 2025 edition.[^vatgap]

**Income tax — flat rate, tax-free minimum, progression.** This is the one large modeled assumption in the whole tool. Because no Bulgarian institution publishes the exact number of insured persons by income bracket, the wage distribution is recovered with a **statistical model** — a split log-normal body (derived from the decile ratios in Eurostat's Structure of Earnings Survey, SES 2022[^ses]), a level from the НОИ average insurable income, and a Pareto tail for the top incomes. The model is validated by reproducing the НАП employment-PIT line at the current flat 10% (calibration coefficient κ = 1.00), and the fitted tail backtests the legislated 2025 cap raise at **€113M** against the Ministry of Finance's own **€128M** estimate. The tax-free minimum, the progressive brackets and cap moves in both directions are scored over this distribution. **This is the component we want to replace with real НАП data** (see below).

**Corporate and dividend tax.** Both are flat (10% and 5%) and in static mode scale linearly off the executed budget line. Here the model is most cautious: at a higher corporate rate the real revenue is almost certainly overstated, because Bulgaria's 10% attracts accounting profit from abroad and a higher rate would push part of that base out. Dynamic mode applies a behavioral correction precisely for this — and for dividends it is calibrated to the only published Bulgarian behavioral estimate: a 5%→10% rise yields **+€75M static** but **≈ +€45M dynamic**, within the Fiscal Council's ≤€50M ceiling.[^fs]

**Maximum insurable income (МОД).** The social-security cap (now **€2,111.64**) is a special case: the wage mass above the cap is recovered from the accounting gap between the uncapped PIT base and the capped insurable base, plus a Pareto tail for the distribution above the cap. Because the tail is uncertain, this lever alone carries an explicit uncertainty band on the result.

**Expenditure levers.** The simulator also scores the spending side: pension indexation under the Swiss rule (CPI weight vs insurable-income growth), administration cuts (where vacant positions absorb the cut first and save almost nothing in cash), a minimum-wage freeze, a NATO-definition defense target, capital spending (through the historical execution rate), the health contribution, the minimum pension, public-sector wages, and several levers from the live budget debate (maternity, MP pay, party subsidies).

**Every wage lever pays itself partly back.** When the budget raises (or cuts) pay, it also collects (or loses) the PIT and social contributions on that pay — roughly **30.6%** of the change comes straight back. The administration-cut lever always modelled this; as of June 2026 the **same mechanical feedback is applied consistently** to public-sector wage indexation and the teachers' 125% peg, so a wage rise costs the budget materially less than its gross price tag (a +5% public-wage indexation nets ≈ €98M, not ≈ €142M). Under the consolidated-budget frame the employer contribution nets out — the budget both pays and receives it — leaving exactly the genuine cost. This is an accounting offset, not a behavioral guess: it sits in **both** static and dynamic mode.

## The dynamic layer: behavior and macro feedback

Dynamic mode rests on two tiers, each sourced.

**Tier 1 — behavioral base responses.** Each lever gets a behavioral correction expressed as an elasticity with a low/central/high band. The correction carries **only** reporting, shifting and compliance responses — aggregate-demand effects live in Tier 2, to avoid double-counting.

| Parameter                                     | Central (range)  | Source                                               |
| --------------------------------------------- | ---------------- | ---------------------------------------------------- |
| Elasticity of taxable income — employment     | 0.20 (0.10–0.40) | Gruber–Saez (2002); Saez–Slemrod–Giertz (2012)[^eti] |
| Elasticity of taxable income — non-employment | 0.50 (0.30–0.80) | Saez–Slemrod–Giertz (2012)[^eti]                     |
| Corporate base semi-elasticity, %/pp          | 0.8 (0.4–1.5)    | de Mooij–Ederveen; Heckemeyer–Overesch (2017)[^cit]  |
| Dividend base semi-elasticity, %/pp           | 4.5 (3.0–6.5)    | calibrated to the Fiscal Council (2025)[^fs]         |
| VAT — share lost to compliance                | 0.10 (0.03–0.20) | EC VAT gap (2025)[^vatgap]                           |
| Maternity — share returning to work if cut    | 0.45 (0.25–0.65) | НСИ maternal-employment gap + КСО чл.54[^matwork]    |
| Dividend↔salary relabeling — net recapture   | 0.008 (0.0–0.03) | derived; Chetty–Saez (2005)[^fs]                     |

**Tier 2 — macroeconomic feedback.** The fiscal impulse passes through a multiplier onto GDP, and the GDP change comes back as revenue. The multipliers come from the IMF study specific to Bulgaria — _Fiscal Multipliers in Bulgaria: Low But Still Relevant_ (Muir & Weber, 2013)[^imf]: a year-1 tax multiplier of 0.3–0.4 (VAT at the low end), spending ≈ 0. Exactly as the paper concludes — direct taxes and capital spending have the largest effect on output, indirect taxes and non-targeted transfers the smallest — which is why VAT gets the low band. The result: a tax consolidation yields about **13% less** in the first year than the static estimate, reproducing the empirical rule that "static revenue gains from tax hikes are overstated by 10–15%".

**Monte-Carlo band.** For every scenario the model draws 500 times from each parameter's range (plus the Pareto index), with a **fixed seed** — so the band moves smoothly with the sliders instead of flickering — and reports a 90% interval around the headline.

## Second-order effects: when one lever moves another

A policy rarely changes just the line it targets. Cutting a benefit, for instance, sends some recipients back to work — and the taxes they then pay partly offset the saving. The model now captures the most material of these knock-on effects, each banded the same way as the elasticities above so it flows through the uncertainty band rather than masquerading as a precise number.

**Maternity: a cut also brings in PIT and contributions.** Bulgaria's paid second year of leave is among the EU's longest. Cutting it saves the benefit (€154M for the full year), but a share of the affected mothers return to work earlier — and once working they pay income tax and social contributions. So the _true_ saving is larger than the benefit line alone: with a central assumption that **45%** return (the band spans 25–65%, reflecting scarce under-3 childcare and the rule that lets a mother keep half the benefit while working), the full-year cut saves about **€218M dynamically, not €154M**. The direction matters as much as the number: the static figure _understates_ the saving here, the opposite of a tax hike.

**Dividends and salary are substitutes.** Raising the dividend tax pushes some owner-managers to take income as salary instead, where it is taxed differently. We credit the net budget recapture on that relabeled sliver — but deliberately keep it **small and bounded**: most of the dividend-base response is profit-retention and payout-timing rather than salary relabeling, and dividend income concentrates above the contributions cap, where shifting to salary is roughly neutral (the 10% income tax on the salary is offset by the corporate tax the company saves by deducting it). For the 5%→10% scenario this adds only a few million euro, and it rides its **own** line — so the Fiscal Council dividend calibration is untouched.

**Health-contribution deductibility.** Raising the health contribution collects more, but the employee's share of it is deductible from the income-tax base — so the budget gives a little income tax back (about 4% of the gross). Small, but it is the same deduction interaction the МОД lever already models, now applied consistently.

These are the cases where the offset is large enough to matter and defensible enough to source. Others — defense procurement and capital projects generating wages and VAT — are left to the Tier-2 macro multiplier rather than double-counted as a direct feedback.

## Who gains, who loses

A single average hides the distribution. The simulator reveals it two ways.

![Who gains, who loses by employee decile: a diverging-bar chart for each tenth of wage earners by gross salary, plus the Gini coefficient before and after the scenario.](/articles/images/budget_simulator/en/03-deciles.png)

The **winners-and-losers** strip shows the mean monthly change (net pay + VAT on spending) for each tenth of wage earners, ordered by gross salary — you instantly see whether a measure is progressive or regressive. Below it the tool reports the Gini coefficient before and after.

![One payslip: a gross-salary slider and a net / VAT / total breakdown, plus the effect at several exemplar salaries — €620, €1,250, €2,500, €5,000.](/articles/images/budget_simulator/en/04-citizen.png)

The **one-payslip** panel translates the scenario to a personal level: at a chosen gross salary it shows the net effect, the VAT-on-spending effect and the total, plus ready exemplars for a minimum, average, high and above-cap salary.

## The five-year projection

The headline is the one-year effect. But deficits and debt accumulate — so the simulator rolls the scenario forward to 2030.

![Balance and debt to 2030: bars for the balance as % of GDP and lines for debt (scenario vs baseline path), with the −3% (Maastricht) and 60%-debt reference lines, plus a per-year table with the figures and the scenario's interest effect.](/articles/images/budget_simulator/en/05-projection.png)

The projection is at the general-government (ESA 2010) grain, not the cash КФП grain of the rest of the screen, because the −3%/60% reference values and the EC forecast are defined there. The 2025 bar is the НСИ outturn (deficit −3.5%, debt 29.9%, GDP €116.0bn)[^nsi]. The baseline rides the EC Spring 2026 forecast (balance −4.1% in 2026 and −4.3% in 2027[^edp]), then holds policy unchanged. Debt follows the standard debt-dynamics recursion with no stock-flow adjustments[^ecb]; interest is modeled in two buckets (inherited debt at ~3.0%, new at ~3.6%). "Scenario interest" is the accumulated difference in interest cost — the compounding cost of servicing the extra debt a loosening scenario issues.

## Validation against official estimates

Calibration is shown, not asserted. The same scenarios, run live through the model, against the published official costings:

| Scenario                 | Model (static) | Dynamic | Published estimate                                                                |
| ------------------------ | -------------- | ------- | --------------------------------------------------------------------------------- |
| Restaurants VAT → 9%     | −€286M         | −€258M  | МФ (2024–25): −€150…−240M/yr; Budget 2025 booked +€238M when restored to 20%[^mf] |
| Corporate tax +1pp       | +€333M         | +€304M  | МФ (2023): ≈ +€230M/pp (2023 base)[^mf]                                           |
| Dividend tax 5% → 10%    | +€75M          | +€45M   | Fiscal Council (2025): up to +€50M (with behavioral response)[^fs]                |
| Health contribution +1pp | +€302M         | +€287M  | КНСБ/НОИ (2025): ≈ +€300M/pp[^knsb]                                               |
| МОД cap €2,112 → €2,352  | +€147M         | +€133M  | КНСБ (2025): ≈ +€180M for ДОО (≈ +€230M all contributions)[^knsb]                 |
| Tax-free minimum €620/mo | −€1.9B         | −€1.9B  | ≈ −€1.9B (scaled from a 2022 estimate for 500 лв)                                 |

The takeaway: static scoring matches the official _static_ numbers (МФ's own menu is static per-pp on the then-current base), and the one place static materially overstates a published estimate is the dividend (€75M vs the Fiscal Council's ≤€50M) — precisely because the Council's number embeds a behavioral response that dynamic mode reproduces.

## Limitations and assumptions

No model is reality. Here is where this one's edges are:

- **The static base is fixed** at the latest closed year. For large moves the real base will have changed — hence dynamic mode, but even that is a reduced form, not general equilibrium.
- **The fitted wage distribution is the largest modeled assumption.** It determines the tax-free minimum, the progressive brackets and МОД. The backtests validate it, and since 2026 its body is also validated against the real 2023 НАП table (see below); finer, annual data would shrink the tail uncertainty further.
- **Corporate estimates overstate** at higher rates (profit shifting), which static mode does not see and dynamic mode captures only partially.
- **No general equilibrium, no employment effects** beyond the reduced-form multiplier. Second-round effects (wages, prices, investment) are not modeled.
- **The behavioral elasticities are from the literature**, not Bulgarian estimates — the low/central/high ranges reflect exactly that uncertainty and feed the Monte-Carlo band.

Transparency here is the point, not a claim of euro-level precision. Every assumption is listed, and the code is open.

## What we're asking НАП for, and why

You saw that the one large modeled assumption in the entire tool is the **wage distribution** — it determines the estimates for the tax-free minimum, progressive taxation and the social-security cap. It is recovered statistically, because there is no public **machine-readable** source for the exact number of taxpayers by income bracket.

But a version of this data **exists** — and has been released. НАП routinely derives it from employers' monthly Form №1 declarations and the annual чл.50 declarations under the Personal Income Tax Act, distributed by annual tax base. The Ministry of Finance has already answered parliamentary questions with exactly this distribution — the number of people and the tax paid, by income group:

- for **2023** — [MoF written answer, December 2024](https://www.minfin.bg/bg/wreply/996-4/12881)[^naptiers];
- for **2012–2016** — [written answer by income group](https://www.minfin.bg/bg/wreply/10320);
- for **2019** — [written answer by group and category](https://www.minfin.bg/bg/wreply/11134).

**We now use the 2023 table.** It covers **3,109,552 filers**, **€3.07B of declared ДДФЛ** on **€30.7B of taxable base** — with the top **1.5%** (47,630 people above 108,000 лв of base) paying **21.5%** of all ДДФЛ. We folded it in conservatively: we use it to **validate the body** of the fitted distribution where the two populations coincide (and they coincide well — the cumulative mass through the upper-middle incomes is within 8 percentage points), and to **source the tail ordering**. There is a subtlety we make explicit: the НАП table is _all_ filers (employees + self-employed + final-tax), while the model scores _wage employees_. So the all-filer tail is fatter (Pareto α ≈ 1.67) than the employee-only tail (α ≈ 2.27) — the top НАП groups blend in dividend and business income. **That ordering is the correct one**, and the real data confirms it; so we do not overwrite the employee parameters (which drive the МОД lever) — we validate them.

What we still **request**, under the [Access to Public Information Act](https://www.aip-bg.org/) (ЗДОИ), is for the same data to be published as a **machine-readable, reusable open dataset**, refreshed **annually** and at **finer income brackets** — rather than extracted one parliamentary answer at a time from locked PDFs (the MoF site blocks automated access). With such a dataset both the body and the tail become fully source-traceable, the tax-free-minimum / progression / МОД uncertainty shrinks further, and — most importantly — any citizen, journalist or analyst could transparently cost a tax proposal. Better data makes for a better public debate.

## Open source and reproducibility

The whole tool is open source at [github.com/atanasster/electionsbg](https://github.com/atanasster/electionsbg). The static scoring engine lives in `src/lib/bgTaxPolicy.ts`, the dynamic layer in `src/lib/bgBehavioral.ts`, the five-year projection in `src/lib/bgFiscalProjection.ts`, and the offline baseline is assembled by `scripts/budget/run_policy_baseline.ts`. Each part is locked by smoke tests that assert the identities (for example, that at zero elasticity dynamic equals static, and that the dividend lever stays within the Fiscal Council's ceiling). The research notes and full source list are in `docs/budget_simulator_grounding.md`.

You can also add your own scenario to the [simulator's public tally](/budget/simulator) ("what the public chose") — voluntarily, with no personal data. Start here: [open the simulator](/budget/simulator).

---

[^edp]: European Commission — Spring 2026 economic forecast (Bulgaria), 21 May 2026; recommendation to open an excessive-deficit procedure, 3 June 2026. See the [EC Bulgaria page](https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages/bulgaria_en).

[^nsi]: НСИ — excessive-deficit-procedure (EDP) notification, 22 April 2026: general-government deficit and debt for 2025 (preliminary). See [НСИ](https://www.nsi.bg/bg/content/2432/).

[^vatgap]: European Commission — _VAT Gap Report 2025_: Bulgaria's VAT gap ≈ €781M, 8.6% of the theoretical liability (VTTL). [taxation-customs.ec.europa.eu](https://taxation-customs.ec.europa.eu/taxation/vat/fight-against-vat-fraud/vat-gap_en).

[^imf]: Dirk Muir, Anke Weber, _Fiscal Multipliers in Bulgaria: Low But Still Relevant_, IMF Working Paper 13/49, February 2013. [imf.org (PDF)](https://www.imf.org/external/pubs/ft/wp/2013/wp1349.pdf).

[^eti]: J. Gruber, E. Saez, _The elasticity of taxable income: evidence and implications_ (2002); E. Saez, J. Slemrod, S. Giertz, _The Elasticity of Taxable Income with Respect to Marginal Tax Rates: A Critical Review_, Journal of Economic Literature (2012). [PDF](https://eml.berkeley.edu/~saez/saez-slemrod-giertzJEL10final.pdf).

[^cit]: R. de Mooij, S. Ederveen, meta-analyses of the corporate base elasticity; J. Heckemeyer, M. Overesch (2017) — consensus semi-elasticity ≈ 0.8. [NBER ETI review (PDF)](https://www.nber.org/system/files/working_papers/w15012/w15012.pdf).

[^fs]: Fiscal Council of the Republic of Bulgaria — opinion on the draft 2026 State Budget Act / 2026–2028 medium-term plan (12 December 2025): estimate of up to +€50M for raising the dividend tax, with behavioral response. [fiscal-council.bg](https://www.fiscal-council.bg/bg/publikacii).

[^matwork]: Return-to-work share if the paid second year is cut — a judgment band (central 45%, range 25–65%) anchored to the НСИ employment gap for mothers of children under 3 (low among EU member states) and the КСО чл.54 rule that lets a mother keep half the benefit while working; OECD Family Database for leave-length context. No Bulgarian point estimate exists, hence the wide band. The representative return wage (≈€1,000/mo gross) is held FIXED — deliberately conservative — so the recapture's uncertainty band derives from the return share alone, not the wage. The recapture mechanism (returning mothers pay PIT + contributions) is in `src/lib/bgBehavioral.ts` and locked by `scripts/budget/__smoke_behavioral.ts`.

[^knsb]: КНСБ — opinions on the draft State Budget and the ДОО (social-security) budget for 2026 (November 2025).

[^mf]: Ministry of Finance — consolidation menu (April 2023, via Sega); МФ/Mediapool on restaurant-services VAT (2024–25). See e.g. [Mediapool](https://www.mediapool.bg/).

[^coicop]: Eurostat — household final consumption expenditure by purpose (COICOP), series `nama_10_co3_p3`.

[^ses]: Eurostat — Structure of Earnings Survey, series `earn_ses_hourly`, 2022 wave.

[^ecb]: European Central Bank — _Economic Bulletin_ 2/2019, debt-dynamics methodology.

[^naptiers]: НАП/MoF written answer for tax year 2023 — the distribution of declared income across 7 annual-taxable-base groups (filer count and PIT paid). Ingested as a source in `scripts/budget/nap_income_tiers.ts` and the validation is locked by the smoke test `scripts/budget/__smoke_income_tiers.ts`. [minfin.bg/bg/wreply/996-4/12881](https://www.minfin.bg/bg/wreply/996-4/12881).
