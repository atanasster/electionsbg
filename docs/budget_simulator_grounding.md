# Budget simulator — grounding against published estimates (research notes, 2026-06-11)

Working notes behind the simulator's "Съпоставка с публикувани оценки" block and the
2026–2030 projection engine (`src/lib/bgFiscalProjection.ts`). All BGN figures converted
at the locked rate 1 EUR = 1.95583 BGN.

## Political/fiscal context as of 2026-06-11

- Bulgaria has **no adopted 2026 budget**. The Nov-2025 draft was withdrawn after mass
  protests; the Dec-2025 revised draft died with the government; the state runs on
  extension laws (ДВ бр. 113/23.12.2025 + a second, open-ended one from March 2026).
  The Radev cabinet (since 2026-05-08) has promised 2026 budget bills by end-June 2026.
- 2025 outturn (НСИ EDP notification, 2026-04-22): ESA deficit **−€4,113M = −3.5% of
  GDP**, general-government debt **€34,635M = 29.9%**, nominal GDP **€116,018M**.
  Cash КФП deficit: −€3,491M (МФ, 2026-02-02).
- EC Spring 2026 forecast (2026-05-21): balance **−4.1% (2026), −4.3% (2027)**; real
  growth 2.5/2.2%; HICP 4.2/2.6% (Middle East energy shock); unemployment 3.7/3.9%;
  debt 32.3/35.5%. On **2026-06-03 the EC recommended opening an excessive-deficit
  procedure**; the Council decision is pending.
- Debt market: 2025 Eurobonds priced at 3.375% (10y) – 4.125% (13y/20y); the May-2026
  10y domestic reopening yielded **4.34%** amid the budget impasse. Implicit rate on
  the stock ≈ 3.0% (Eurostat D41PAY 0.8% of GDP ÷ debt). Average residual maturity
  8y3m (Debt Management Strategy 2026-2028) → ~12%/yr rollover.
- Extension-law parameters in force: МРЗ €620.20, МОД frozen at €2,111.64, contribution
  rates unchanged (the +2пп pension-contribution hike was dropped). Donev's May-2026
  guidelines: МОД €2,300 from 2026-08-01, frozen through 2028.

## Published estimates vs the engine (base: 2025 execution)

| Lever                                 | This model                                | Published estimate                                                                                                                                                                                                                                                                                                                                                             | Source                                              |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| VAT standard +1пп                     | ≈ +€447M                                  | МФ 2023 menu: 22% "за всички стоки" = +1.63 млрд лв per H2-2023 — implies ≈ €830M/пп/yr but bundles reduced-rate abolition; naive static on 2023 base ≈ €360M                                                                                                                                                                                                                  | Sega 25.04.2023                                     |
| Restaurants → 9%                      | ≈ −€170M                                  | МФ 2025: −300…−400 млн лв (−€153…−205M); booked +465 млн лв (+€238M) in Budget 2025 when restored                                                                                                                                                                                                                                                                              | Mediapool 21.03.2025; Investor 26.02.2025           |
| Books/periodicals/baby 9% (permanent) | n/a (already baseline)                    | −16 млн лв/yr (−€8.2M)                                                                                                                                                                                                                                                                                                                                                         | Actualno 08.12.2022 (Петкова)                       |
| CIT +1пп                              | +€333M (2025 base €3.33B)                 | МФ 2023: +2.31 млрд лв for +5пп → ≈ +€236M/пп on the 2023 base; КНСБ 2025: +€1.1B for 15%                                                                                                                                                                                                                                                                                      | Sega 25.04.2023; КНСБ становище ЗДБРБ 2026          |
| Dividend 5→10%                        | +€75M (static)                            | Фискален съвет 12.12.2025: **max +€50M** (behavioral leakage)                                                                                                                                                                                                                                                                                                                  | ФС opinion PDF p.20                                 |
| Health contribution +1пп              | +€302M net, €315M gross (base €31.5B)     | КНСБ/НОИ: +€601M for +2пп → ≈ +€300M/пп                                                                                                                                                                                                                                                                                                                                        | КНСБ становище ДОО 2026                             |
| МОД €2,112 → €2,352                   | model: band-fit estimate (run live in UI) | КНСБ: +€231M all contributions (≈ +€180M ДОО); note this includes the 5пп second pillar the budget does not keep                                                                                                                                                                                                                                                               | КНСБ становище ЗДБРБ 2026                           |
| Необлагаем минимум = МРЗ              | ≈ −€1.9B (static, full distribution)      | М. Димитров 2022: −1.5 млрд лв (−€767M) at 500 лв/мес → scaled to €620 (1,213 лв) ≈ −€1.86B — consistent; КНСБ Oct-2025: −€1.5B net _with_ a 15% rate offset; IMF Art. IV 2025 (CR 25/306) recommends progressive PIT but publishes NO per-measure yield — the widely-quoted "~1% of GDP" is the overall adjustment needed for a neutral stance, NOT the progressive-PIT yield | News.bg 07.2022; Investor 07.10.2025; IMF CR 25/306 |
| VAT compliance gap                    | (context)                                 | EC VAT gap 2025 edition (data 2023): BG gap €781M = 8.6% of VTTL                                                                                                                                                                                                                                                                                                               | EC VAT gap report                                   |

Takeaways encoded in the UI:

1. Static scoring matches official _static_ numbers (МФ's own menu is static per-pp on
   the then-current base). Differences vs older sources are base-year growth, not method.
2. The dividend lever is the one place static scoring overshoots a published estimate
   materially (€75M vs ФС's ≤€50M) — the ФС number embeds behavioral response.
3. МФ's 22%-VAT menu number is NOT a clean ±1пп benchmark (it bundles reduced-rate
   abolition and carryover); do not calibrate against it.
4. Fiscal Council on the (dead) 2026 draft: revenues overestimated by €2.6–3.2B;
   VAT plan implied +30% y/y. Our baseline uses 2025 _execution_, which sidesteps that.

## Projection methodology (engine defaults)

- Debt recursion `debt_t = debt_{t-1} − balance_t`, `balance = primary − interest`,
  SFA = 0 (ECB EB 2/2019 formulation; EC DSM convention beyond the forecast window).
  Caveat: 2025-26 pre-funding made the SFA strongly positive — near-term debt is
  slightly understated.
- Baseline balance: EC Spring 2026 for 2026–2027, then constant primary-balance ratio
  (no-policy-change). Yields deficit drifting −4.1 → ~−4.6% and debt ~43% by 2030 —
  directionally matching the EC's "expenditure outgrows revenue" EDP analysis and the
  АСБП debt path (36.6% in 2028 vs ours ~37.6%).
- Interest: two buckets — legacy stock at 3.0% rolling over at 12%/yr, new/rolled debt
  at 3.6% (2025-26 issuance bracket 3.375–4.34%).
- Policy delta keeps a constant share of GDP (rate yields grow with the base).
- Revenue elasticities (EC ECP536, BG rows; for reference, not separately modeled):
  PIT 1.15 (wage-base 1.07 — flat tax), CIT 2.13 (cyclical; trend ~1.2), SSC 0.61,
  indirect 1.00; long-run buoyancy ≈ 1.0 justifies the constant-share simplification.
- What "static" ignores (IMF WP/13/49, Bulgaria-specific): year-1 tax multipliers
  0.3–0.4 (VAT at the low end), spending ≈ 0 — static revenue gains from tax hikes
  are overstated by roughly 10–15% in year 1.
- EU rules overlay: endorsed net-expenditure path (C/2025/3700) 6.2/4.9/4.4/4.0%
  for 2025–2028 + defense escape clause ≤1.5% of GDP (C/2025/3961); both superseded
  by a corrective path once the Council opens the EDP.

## Audit revisions (2026-06-11, second pass)

- **Pension indexation compounds in the projection**: the year-1 delta is no longer
  flat-scaled; `projectFiscalPath` takes a per-year fixed path and the simulator
  recomputes `scorePensionIndexation` for each horizon year (cpionly's saving grows
  ~€0.5B (2026) → ~€2.9B (2030) instead of staying ~€0.5B). All other levers remain
  constant-share-of-GDP; UI note says which is which.
- **Single 2026 GDP everywhere**: the defense lever now prices against the projection
  module's €123.9B (EC-consistent) instead of the stale `gdpNextEur` (€128.2B,
  a +10.5% nominal-growth vintage from macro.json). The pipeline field is now unused
  by the simulator screen.
- **Chart safety**: dynamic axis domains (extreme combos reach −9% balance / >60%
  debt) + the 60%-debt Maastricht reference line with extendDomain.
- **Benchmark strings tightened**: МОД row now quotes the verified КНСБ split
  (≈ +€180M ДОО / ≈ +€230M total) instead of an unverified "incl. 2nd pillar" claim;
  restaurants row carries the Budget-2025 +€238M booking so the model's −€286M on the
  larger 2025 base reads in context.
- **Multiplier honesty caveat** added to the caveats card (IMF WP/13/49 numbers).
- Known UI conventions: headline "% of GDP" uses baseline-2025 GDP; the projection
  card uses its own per-year GDP — both labeled. The horizon (ph) slider affects the
  headline only; the projection always shows the full per-year path.

## June-2026 government-debate levers (added 2026-06-11, second research pass)

| Measure                                                                                  | Status (2026-06-11)                                                                                                         | Costing anchor                                                                                                                                                                                                                                                              | Lever                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maternity 2→1 year                                                                       | Rumor-stage: floated by ПБ MP Владимир Николов 2026-06-01 (bTV), formally denied same day by К. Проданов; NOT a МФ proposal | Second-year benefit (чл.53 КСО) €398.81/mo frozen; 2025 НОИ execution **€154.2M** (2024: €160.5M from the НОИ statistical XLS); ~33.5k avg full-rate recipients (derived — no published count)                                                                              | `mat` slider, months kept 12→0; static, ignores return-to-work SSC/PIT offset and the 50%-if-working rule                                                                                                         |
| MP salary freeze                                                                         | Правна комисия approved **17–0 on 2026-06-11**; plenary pending; freezes base at 3× NSI public-sector avg for March 2026    | Base **€4,236/mo** (May 2026); 240 MPs × ~1.30 committee extras × 1.1902 employer SSC ≈ **€18.9M/yr** pay mass; saving = foregone growth (~11.8%/yr НОИ insurable-income proxy) ≈ €2.2M/yr; president (2×), НС chair (+55%), PM, ministers ride the same base (not modeled) | `mpf` checkbox                                                                                                                                                                                                    |
| Party subsidy cut                                                                        | **ADOPTED 2026-06-03**: €4.09 → **€3.00/vote** retroactive 30.04.2026 (saving ≈ €3.1M annualized)                           | ~2.861M subsidized votes (€11.7M ÷ €4.09), 7 formations                                                                                                                                                                                                                     | `psub` slider 0–€4.50, default €3.00 = current law                                                                                                                                                                |
| МОД €2,300 from 01.08.2026                                                               | Confirmed Donev guideline (2026-05-18)                                                                                      | —                                                                                                                                                                                                                                                                           | existing МОД slider                                                                                                                                                                                               |
| Administration −10% payroll from 01.09.2026                                              | Donev guideline, no EUR figure                                                                                              | —                                                                                                                                                                                                                                                                           | existing admin lever                                                                                                                                                                                              |
| Capital freeze (non-priority)                                                            | Donev guideline, no EUR figure                                                                                              | —                                                                                                                                                                                                                                                                           | existing capital lever                                                                                                                                                                                            |
| Pensions +7.8% (01.07.2026) + min pension €347.51 + no COVID supplement for NEW pensions | Adopted 2026-06-03 (extension-law amendments)                                                                               | —                                                                                                                                                                                                                                                                           | Swiss rule = current law; pensionFloor baseline (€322.37, as of 2026-03-31) predates the July rise — regen note                                                                                                   |
| Public-sector pay cap = president's salary; end of top-office auto-indexation            | Donev guideline 2026-05-18                                                                                                  | no published saving                                                                                                                                                                                                                                                         | not modeled (no costable base)                                                                                                                                                                                    |
| СУПТО revival / collection measures                                                      | In Nov-2025 draft (€320M claimed), dropped Dec 2025; presence in the Donev bill UNVERIFIED                                  | —                                                                                                                                                                                                                                                                           | not modeled (ФС disputed the claimed yields)                                                                                                                                                                      |
| Vignette/toll +30% (road charges)                                                        | Кабинет "Радев" 2026 framework (Donev presser ~2026-06-24), to be adopted July; bundled with higher МОД + toll for carriers | АПИ road-charge revenue ≈ **€562M** (2025, ~1.1bn BGN; €459.7M in 2024 = €144M e-vignettes + €302M toll); govt quotes **≈ +€53M** from +30% on vignettes (the ≈€180M vignette slice — `clubz.bg/176346`)                                                                    | new `vin` slider — uniform % uplift on the combined €562M base (`ROAD_CHARGES_BASE_EUR` in bgTaxPolicy.ts; base watched by `api_road_charges`, behavioral band 0.05/0.15/0.40 %/pp = toll cross-border diversion) |

Constants live in `bgTaxPolicy.ts` (`MATERNITY_Y2_SPEND_EUR`, `MP_PAY_MASS_EUR`, `PARTY_SUBSIDY_VOTES`, `ROAD_CHARGES_BASE_EUR`) — single published figures, deliberately not piped through policy_baseline.json.

## EU country comparators (added 2026-06-11, third research pass)

"Като в… (ЕС)" dropdowns under 7 levers (`src/lib/euPolicyPresets.ts` — 27 options),
all values re-verified 2026-06-11. Catches vs stale knowledge, for future refreshes:

- **Estonia**: VAT 24% permanent since 07/2025; the legislated 24% PIT/CIT rise for
  2026 was **cancelled Dec 2025** (стays 22%); the universal €700/mo exemption DID
  take effect 01/2026 with no phase-out. (EMTA, EY, Grant Thornton)
- **Slovakia**: PIT has **4 brackets from 2026** (19/25/30/35, 25% from €43,983/yr);
  VAT 23% since 2025. Modeled as 19/25 two-bracket approximation, note says so.
- **NATO defense 2025 estimates** (June 2025 compendium): PL 4.48, LT 4.00, EE 3.38,
  GR 2.85, IT 2.01; **Germany unreported** — used national ≈2.4% with caveat.
- **Spain**: the 2022-24 food-VAT holiday lapsed — back to 10/4%.
- **France CIT**: 25% + exceptional surtax (≥€1.5bn turnover) extended into 2026.
- Maternity mappings are explicit approximations (well-paid months beyond BG's
  410-day first year): EE 605d@100% → 6 mo; SE 390 well-paid d + 90 flat → 3 mo;
  DE Elterngeld 12-14 mo → 0 mo. Pension indexation: FR CPI-only (+0.9% 01/2026),
  DE wage-linked (+4.24% 07/2026).
- UI behavior: a pick self-clears (matcher) when the lever no longer equals the
  country's values, so scenarios are never mislabeled.

## Behavioral layer — dynamic mode (added 2026-06-12)

The simulator now scores in two modes; **dynamic is the default** (static stays one tap
away via `?mode=static`, preserving the official-costings convention and the benchmark
column). Engine: `src/lib/bgBehavioral.ts`; gates: `scripts/budget/__smoke_behavioral.ts`
(zero-draw identity, calibration, sign/scale, Tier-2 magnitudes, MC determinism,
slider-extreme finiteness, second-order recaptures). Design rules:

- **Tier 1 (per-lever base responses)** carries supply-side margins only —
  reporting/shifting/compliance plus (2026-06-12) labour-supply participation
  (maternity return-to-work) and salary↔dividend relabeling; aggregate demand
  lives ONLY in Tier 2 (anti-double-counting). Offsets are EUR added to the
  static delta; the tax/compliance ones always oppose its sign (the maternity
  recapture reinforces a cut's saving — a supply, not a leakage, response).
  - ДДФЛ: Feldstein decomposition over the band grid — Σ workers × τ_new ×
    base × clamp(Δlog(1−τ_marginal), ±1) × 12 × κ × ETI. ETI employment
    0.10/0.20/0.40 (Gruber–Saez 2002; Saez–Slemrod–Giertz 2012; no BG estimate —
    set below the US central because wage income is withheld at source);
    non-employment 0.30/0.50/0.80 (SSG 2012; Gorodnichenko et al. 2009).
    The необлагаем минимум has NO Tier-1 response by construction (τ_new = 0
    below the threshold, τ unchanged above) — gated in the smoke test.
  - Корпоративен: exponential semi-elasticity exp(−s·Δпп/100)−1, s = 0.4/0.8/1.5
    (de Mooij–Ederveen; Heckemeyer–Overesch 2017 ≈0.8; Beer–de Mooij–Liu 2020).
  - Дивидент: same form, s = 3.0/4.5/6.5 — **calibrated, not estimated**: the
    central reproduces ФС's ≤ +€50M for 5→10% (engine: static +€75M → dynamic
    ≈ +€45M; headline after Tier-2 ≈ +€39M). The smoke gate pins the lever to
    [€35M, €55M], so a recalibration is a deliberate act.
  - ДДС: attenuation −staticΔ × g, g = 0.03/0.10/0.20 (compliance/cross-border
    only; EC VAT gap 2025 edition — BG €781M = 8.6% of VTTL — as level anchor).
  - МОД raise: haircut 0.05/0.10/0.20 (×2 capped 0.40 for no-cap; 0 when
    lowering); health pp: 0.02/0.05/0.10. Judgment bands (КНСБ-vs-МФ spread,
    undeclared-work literature).
  - Дивидент↔заплата (added 2026-06-12): a rate change relabels a sliver of
    income between the dividend and salary bases; net recapture coef
    0.0/0.008/0.03 on `−ΔdividendBase` (reuses the same divSemiElast draw).
    Small/bounded by design (most of the base response is retention/timing,
    and dividend income sits above the SSC cap where the shift is ≈ neutral);
    rides its OWN offset line so the ФС dividend calibration is untouched.
  - Майчинство return-to-work (added 2026-06-12): cutting the paid 2nd year
    sends a share of mothers back to work → PIT+SSC recapture ON TOP of the
    benefit saving. Band 0.25/0.45/0.65 (НСИ maternal-employment gap + КСО
    чл.54 50%-if-working), on freed recipient-months × labourTaxFeedbackOnSalary
    at a ~€1,000/mo representative wage. Full-year cut: €154M static →
    ≈ €218M dynamic. OUT of the Tier-2 impulse (the new wage income offsets the
    tax withdrawal at the demand level).
  - Other expenditure levers carry no Tier-1 offset, BUT the mechanical
    labour-tax feedback (~30.6% of labour cost back as PIT+SSC) is now netted
    in the STATIC score — `labourTaxFeedbackOnCost` shared by scoreAdminCut
    (unchanged), scoreWageIndexation and scoreTeachersPeg (added 2026-06-12);
    scoreHealthContribution nets the employee-share PIT deductibility. See the
    second-order section below.
- **Tier 2 (macro feedback)**: impulse split (VAT / other revenue / non-pension
  spending / pension path) × IMF WP/13/49 year-1 multipliers (VAT 0.10/0.25/0.40,
  tax 0.20/0.35/0.50, spending 0.00/0.05/0.20), geometric decay φ = 0.4/0.6/0.8,
  revenue feedback 0.33/0.38/0.40 of ΔGDP. Central tax-consolidation feedback =
  0.35 × 0.38 ≈ 13.3% of the impulse — reproducing this doc's "static gains
  overstated 10–15% in year 1". Rides projectFiscalPath's existing
  `fixedDeltaByYearEur` parameter (the recursion body is untouched; the new
  `PROJECTION_GDP_EUR` export is gated byte-identical to the path).
- **Monte Carlo**: triangular draws of all 14 parameters + the Pareto α
  (subsumes the old МОД-only band; the VAT calibration factor is an identity,
  NOT sampled). The two 2026-06-12 second-order params (maternity return-to-work,
  div↔salary recapture) are appended LAST in the draw so every prior draw stays
  byte-identical (determinism). 500 draws, mulberry32 seeded — slider moves never
  resample. Headline = central draw + 5/95 band.
- **UI**: goal scoreboard (Маастрихт −3% / дълг ≤40% / отбрана 3% missions,
  `?goal=`), static/behavior decomposition line, per-lever static sub-lines,
  decile winners/losers strip (incidence curve folded beneath), benchmarks
  table gains a dynamic column, behavioral assumptions list rendered from the
  engine constants, share-card PNG export. The AI chat tool
  (`ai/tools/taxPolicy.ts`, `simulateTaxChange`) leads with the dynamic value
  and carries `delta_static`/`behavior`/`range` facts; **it now mirrors EVERY
  simulator lever** — the 17 revenue/expenditure/Phase-5 instruments plus the 5
  June-2026 debate levers (maternity with its dynamic return-to-work recapture,
  teachers' peg, minimum pension, MP-pay freeze, party subsidy), each with a
  natural-language parser + definitional guard. Parity gates in
  `ai/tools/harness.ts`; the AI↔engine equality is locked per-lever by
  `scripts/budget/__test_ai_parity.ts`.
- **Watched anchors** (manual-edit pattern, scripts/watch/sources/fiscal_anchors.ts):
  `nsi_edp` (ESA outturn anchors), `ec_vat_gap` (VAT_GAP_RESPONSE),
  `imf_weo_bg` (WEO vintage proxy for the IMF multiplier anchors — the Article IV
  catalog is bot-blocked, the DataMapper API is open), `fiscal_council_bg`
  (benchmark costings + the dividend calibration target).

Deferred (unchanged): real microsimulation awaits the НАП ЗДОИ income-tier data
(below); IFS-style household-type slicing is gated on the microsim.

## Second-order / cross-lever refinements (added 2026-06-12)

A lever rarely touches only its own line. An audit found the labour-tax feedback
was captured for SOME levers and ignored for the symmetric others — fixed by a
shared helper — plus two material behavioral cross-effects worth banding.

- **Consistent labour-tax feedback (mechanical, STATIC).** When the budget moves
  wage income it also collects/loses PIT + SSC on it. `scoreAdminCut` always did
  this; the shared `labourTaxFeedbackOnSalary`/`OnCost` (`src/lib/bgTaxPolicy.ts`)
  now applies the SAME offset to public-wage indexation and the teachers' peg.
  Rate: salary × (SSC_COMBINED_BUDGET_RATE 0.278 + (1−SSC_emp 0.1378)×PIT 0.10)
  ≈ 36.4% of salary ≈ 30.6% of labour cost. Under the consolidated (КФП) frame
  the employer SSC nets out (paid as cost, received as revenue), so applying it
  to a labour-cost change leaves the genuine net cost. Effect: wage indexation
  +5% −€142M gross → −€98M net; teachers→125% −€207M → −€143M net. This is an
  accounting offset (NOT a behavioral elasticity, NOT a demand multiplier), so it
  sits in BOTH static and dynamic mode, and the Tier-2 multiplier rides the
  resulting net impulse (no double count).
- **Health-contribution deductibility (mechanical, STATIC).** The employee share
  (≈40%, ЗЗО чл.40 60/40 split) of a health-pp rise is PIT-deductible, so the
  budget gives back ~PIT×0.4 of the gross. `scoreHealthContribution` now nets it:
  +1пп +€315M gross → +€302M net (dynamic lever +€287M). Same deduction
  interaction the МОД lever's pitOffset already modeled.
- **Maternity return-to-work + dividend↔salary (behavioral, DYNAMIC, banded).**
  See the two new Tier-1 bullets above — both are EUR offsets with low/central/high
  bands flowing through the MC, value-0 = no response (zero-draw identity intact).
- **Deliberately left to Tier-2:** defense procurement / capital projects generate
  wages + VAT, but that is an aggregate-demand effect — handled by the macro
  multiplier, NOT double-counted as a direct feedback.

Gates: `__smoke_behavioral.ts` gate 11 (maternity sign/scale + €218M integration,
div↔salary sign + bounded < 25% of the dividend lever, ФС calibration untouched);
`__smoke_expenditure.ts` prints are now net; AI parity (`harness.ts`) + regression
(`ai/tests/regression.ts`) updated to the netted wage/health numbers. κ=1.00 and
the €113M МОД backtest are untouched (fitEarnings not in scope).

## Regression suite — `npm run budget:test` (added 2026-06-12)

One command runs **10 test files** for every simulator calculation and exits
non-zero on any broken invariant (`scripts/budget/test.ts`):

- **`__test_engine.ts`** — pure-function golden math with SYNTHETIC inputs and
  hand-derived golden values for EVERY `score*` function + behavioral adapter
  (revenue scorers, PIT brackets, Gini, МОД band + closed form, all expenditure
  - debate levers, the labour-tax feedback helpers, the Tier-1 adapters, the
    second-order recaptures, Tier-2 feedback, the seeded RNG). Baseline-independent
    — it pins the formulas, so a refactor that changes any calculation fails here.
- **`__test_ai_parity.ts`** — asserts the chat tool's `scoreScenario` equals an
  INDEPENDENT single-lever recomputation from the raw engine for every lever, and
  that the dynamic recaptures surface (maternity dynamic > static; dividend
  dynamic < static). This is the regression lock for "every lever is in chat".
- The 8 baseline-backed `__smoke_*` scripts (earnings/κ, VAT calibration, МОД
  identity, expenditure netting, debate levers, behavioral, projection, НАП
  tiers).

The AI layer's own broader suite (routing, narration, 773 regression cases) stays
in `npm run ai:test` + `npm run ai:harness`.

## Public tally — "what the public chose" (added 2026-06-12)

The Polco/Balancing-Act pattern, un-deferred once Firebase Functions became the
sanctioned backend. One cloud function (`scenarios` in `functions/index.js`,
project elections-bg, reached same-origin via the `/api/scenarios` hosting
rewrite; the AI chat origin ai.electionsbg.com is CORS-allowlisted from day one):

- **Submit** is an explicit button (deliberate consent, clean data): the
  simulator's own query string (policy levers only — mode/goal/gross stripped)
  plus client-computed display metrics (headline, balance, debt, mission flags).
  The server validates every key/value against a PARAM_SPEC mirroring the
  component's `clampIntParam` bounds; unknown keys reject. Metrics are
  range-clamped and captioned as visitor-computed, never re-trusted.
- **Abuse/privacy**: per-IP daily limit (20) on salted-SHA-256 IP hashes (the
  only IP-derived data stored), per-IP same-scenario dedup, deny-all
  `firestore.rules` (Admin-SDK-only access), App Check still a TODO like `llm`.
- **Aggregates**: atomic Firestore increments on `scenario_agg/v1` — total,
  mission-met counts, per-lever touched counts + value histograms (every lever
  value is a bounded integer/enum, so key sets are bounded), headline histogram
  in €250M buckets. `GET /stats` derives percentages, top levers and the median
  headline; cached 5 min.
- **UI**: the "Какво избра публиката" card (after the projection) renders only
  when the stats fetch succeeds; percentages hidden below N = 20. The submit
  button lives with the share actions, disabled at current law, with a
  per-scenario localStorage marker against re-submission.

## Income-tier validation (added 2026-06-12)

The fitted earnings distribution (split log-normal + Pareto, α≈2.27, κ≈1.108, SES 2022
anchors) is the engine's largest modeled-not-sourced component — it determines the
необлагаем-минимум, progressive-bracket and МОД-cap scores. A real published НАП table
now validates it: the distribution of ДДФЛ filers by годишна данъчна основа for tax year
2023 (MoF parliamentary answer, minfin.bg/bg/wreply/996-4/12881 — hand-keyed in
`scripts/budget/nap_income_tiers.ts` because minfin.bg is WAF-blocked; one-off-backfill,
not a watcher).

**Validate-and-anchor, NOT refit** (the option-(i) decision). The НАП table is a
_different population_ — 3.11M ALL filers (employees + self-employed + final-tax) in
_taxable-base_ units — than the engine grid (~2.63M insured _employees_ in _gross-wage_
units), so a full refit would break the two employee-specific anchors (the κ=1.00 gate and
the €113M МОД backtest: the bottom-bin part-year/self-min floor and the self-employed/
dividend blend would pull σ and α down). Instead `fitEarnings` is untouched and the НАП
data does two honest things:

- **Body validation** — bin the fitted grid (deflated to the НАП year) into the 7 НАП
  taxable-base brackets; renormalized over bins 2–7 (bin 1 ≤9360 лв is the sub-full-year-MW/
  self-insured floor the employee fit correctly doesn't model), the cumulative-through-the-
  upper-middle matches within ~7pp. Gate: cumulative ±10% (passes); bin-4 standalone is a
  WARN (narrow, deflation-sensitive), not a hard gate.
- **Tail ordering sourced** — the all-filer Pareto α≈1.67 (conditional-mean estimator,
  stable across thresholds 1.66–1.71) sits _below_ the engine's employee α≈2.27, exactly
  as it must (the top НАП bins blend in fatter dividend/business income). The employee α
  stays canonical for МОД; НАП only asserts the ordering `fit.alpha > napAllFilerAlpha` +
  a plausibility band. **Never let the all-filer α leak into the employee tail / МОД lever.**

Emitted as `policy_baseline.json` → `incomeTiers` (raw EUR table + fitComparison + tail);
gates in `scripts/budget/__smoke_income_tiers.ts` and as hard throws in
`run_policy_baseline.ts`. Headline: 3,109,552 filers · €3.07B ДДФЛ · €30.7B base · top 1.5%
pays 21.5%.

**Still pending (the ЗДОИ ask):** a _machine-readable, annual, finer-grained_ open dataset
of the same table — the current source is one parliamentary answer at a time from a
WAF-blocked PDF page. That would make the body+tail fully source-traceable and shrink the
tail uncertainty further.

## Budget-paid contributions lever (`ssp`) — full legal scope (added 2026-06-12)

**Legal basis (verified against lex.bg consolidations, through ДВ 52/2026):**

- **КСО чл. 6, ал. 5**: contributions for the persons under чл. 4, ал. 1, т. 2, 3, 4
  и 10 are "за сметка на държавния бюджет, съответно бюджета на съдебната власт".
  The referenced categories: т. 2 държавни служители по ЗДСл; т. 3 magistrates +
  държавни съдебни изпълнители + съдии по вписванията + **съдебни служители** + ВСС
  members/inspectors; т. 4 военнослужещи (ЗОВСРБ) + държавни служители по ЗМВР,
  ЗИНЗС, ЗДАНС, ЗДАР, ЗСРС (ДАТО), ЗНСО + fire service (чл. 69, ал. 6); т. 10
  junior-magistrate candidates.
- **Health**: ЗЗО чл. 40, ал. 1, т. 1, б. "а" ("изцяло за сметка на ... ведомството,
  когато това е предвидено в закон") + the special statutes: ЗДСл чл. 38, ал. 2;
  ЗОВСРБ чл. 220; ЗМВР чл. 183, ал. 1; ЗСВ чл. 224/277/292/351.
- **ДЗПО**: no explicit КСО clause; flows through the special statutes ("задължителното
  социално ... осигуряване" budget-paid) and НАП's contribution tables (category 05:
  24.3% pension-side + 8% health, zero employee column). Exception: ДАР/ДАНС/Военно
  разузнаване staff are NOT in УПФ (КСО чл. 127, ал. 5) — their фонд "Пенсии" rate is
  +5 пп instead, also budget-paid.
- **PIT base**: ЗДДФЛ чл. 25, ал. 1 / чл. 42, ал. 2 deduct only contributions
  "удържани ... които са за сметка на физическото лице" — nothing is withheld for
  these categories, so their taxable base is the FULL gross (effective PIT on gross
  10.0% vs 8.62% for a private employee). This is why `scoreSscSelfPaid` nets
  ×(1−PIT_RATE): after the shift the personal share becomes deductible.

**Population & wages (НОИ "Среден осигурителен доход", SOD_2024.pdf — the last
edition with headcounts; SOD_2025 publishes averages only):**

| НОИ category                                                            | 2024 count | avg 2024 (BGN) | avg 2025 (BGN)  |
| ----------------------------------------------------------------------- | ---------: | -------------: | --------------- |
| Държавни служители, следователи, съдии и прокурори; членове на ИК       |     64,178 |       2,581.64 | 2,905.09        |
| Отбрана и сигурност (военни + МВР + ДАНС/ДАР/ДАТО/НСО/ГДИН — not split) |     68,684 |       2,438.86 | 3,274.37 (+34%) |

Baseline emits the sum (132,862) + count-weighted avg (€1,282.23/mo at 2024 levels).
**Modeling choice:** the lever shifts the STANDARD employee share (13.78%) — what any
third-category worker pays; the elevated чл. 69 pension rates (55.8/60.8%, total
budget-paid wedge ≈73.3% of gross for police/military) stay budget-paid either way.
The ПП-ДБ Feb-2025 bill instead phased toward 60:40 of the TOTAL (≈29.3% of gross for
the uniformed services) — far more aggressive; not modeled.

**Cross-checks:** Фискален съвет (29.10.2025): ~200 млн лв/yr for ЗДСл servants alone
(48,280 @ 2,432 лв, gross — no PIT netting), "много по-голям ефект" from police/military.
24chasa/НОИ (2022): 1.26 млрд лв paid for ~129k people in 2021 — consistent with the
two-category scope. Engine at full scope: ≈€282M gross, **≈€254M net of PIT** (static,
no gross-up); €0 with the compensating gross-up (`sspg`).

## Additional published benchmarks (research pass 2026-06-13)

Four new rows added to the article's validation table, all run live through the engine:

| Scenario                       | Engine static / dynamic | Published                                                                                                                     |
| ------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Food + medicines VAT → 9%      | −€1.7B / −€1.4B         | МФ 20.05.2020 letter on the six VAT bills: −1.5 млрд лв/yr (2020 base; all six −1.8 млрд лв) → scaled to 2026 ≈ −€1.2…−1.3B   |
| Corporate 10→15%               | +€1.7B / +€1.3B         | КНСБ 07.10.2025 package: ≈ +€1.1B isolated                                                                                    |
| Pensions CPI-only (`pw=100`)   | +€479M / +€470M         | НОИ НС decision 09.06.2026: July-2026 Swiss indexation 7.8% = €513.1M for H2-2026 (≈ €1.0–1.1B/yr); CPI-only ≈ half — derived |
| Party subsidy 4.09→3.00 €/vote | +€3M/yr (reverse lever) | Sponsors at adoption 03.06.2026: ≈ €2.2M for 2026 (8 months → ≈ €3.3M/yr); single-source (eurocom.bg)                         |

Benchmarks found but NOT table-worthy (kept here for reference):

- **Bread/flour 0% VAT** (in force 07.2022–12.2024): МФ (Петкова, budget committee
  07.01.2025) — **−94 млн лв/yr** forgone, with explicitly no visible price pass-through.
  Corroborates the engine's historical-window calibration; no UI lever (bread is not a
  separate group).
- **МРЗ formula caveat**: МФ's Budget-2025 number (+283.3 млн лв for МРЗ 933→1,077 лв)
  is the EXPENDITURE side (public wage bill, лични асистенти); the engine's `mrz` lever
  scores the REVENUE side (PIT+SSC on ~600k workers' raises, −€280M if frozen). The two
  are different objects — do not compare them.
- **Defense 2.06→3.0%**: no official incremental costing exists; Budget 2026 puts
  defense at ~2.25% of GDP (>5 млрд лв, budget basis). The engine prices from the NATO
  2025 estimate **2.06%** (def-exp-2025 Table 3, BG: 2024e 1.95%, 2025e 2.06%) — the same
  basis as the peer "like in…" chips, so the comparison stays apples-to-apples — hence
  ≈ −€1,205M for the 3.0% target. National plan: 3.5% by 2032, 5% (3.5 core + 1.5
  related) by 2035.
- **+2пп ДОО contribution** (legislated for 2026, then dropped): КНСБ 13.11.2025 —
  **+€601.2M all funds** → ≈ €300M/пп on the same insurable base as the health lever
  (engine: +€315M gross, +€302M net) — internally consistent cross-check. A ДОО-rate
  lever would be trivially scoreable on the same base (future candidate).
- **КНСБ Budget-2026 package ≈ +6.2 млрд лв** is a BUNDLE (ДДФЛ 15% + НМ, corporate 15%,
  dividend 15%, windfall 33%, FTT, child reliefs ×2) — only the corporate slice is
  isolated; never benchmark the bundle against single levers.
- **ИПИ Алтернативен бюджет 2026** ("златно правило 20/10"): ~100k public employees
  released over 3 years, savings ~1.5–2.0% of GDP/yr at full effect (≈ €1.7–2.3B) —
  program estimate, not an МФ costing; severance fund included by design.
- **EC "Mind the Gap" country fiche BG** (SWD(2025) 421, 11.12.2025): VAT compliance gap
  BGN 1.5B ≈ €800M / 9% of VTTL (2023 — vs the €781M/8.6% in the VAT-gap edition we cite;
  same vintage, different rounding/method note); PIT compliance gap 13.8%; SSC gap 16.5%;
  undeclared labour income 6.37% of GDP; VAT **rate** gap (cost of all reduced rates)
  BGN 1B ≈ €500M (4% of notional — lowest in EU); total tax expenditures BGN 1,742M =
  0.80% of GDP (МФ forecast 2025). Useful anchors for compliance-margin levers.
- **Dividend status**: the 5→10% hike was in the Nov-2025 draft but dropped from the
  December redraft — rate remains 5% as of 06.2026. The ФС ≤€50M estimate remains valid
  as a benchmark of the _proposal_.
- **IMF CR 25/306** (Nov 2025): recommends progressive PIT, removing the SSC cap,
  reversing reduced VAT rates — all unquantified per measure. The "~1% of GDP" figure is
  the overall adjustment for a neutral fiscal stance, NOT a per-measure yield (fixed in
  the table above). imf.org PDFs 403-wall non-browser fetchers; download CR 25/306
  manually if the staff-report tables are needed.
- **No published numbers exist** for: full МОД-cap removal (engine: +€1.1B static),
  cutting second-year maternity (only the benefit freeze through 2028 is on record),
  the MP-pay freeze saving.

## Key sources

- НСИ EDP notification 2026-04-22 (2025 deficit/debt/GDP)
- EC Spring 2026 forecast, Bulgaria page (2026-05-21); EDP recommendation 2026-06-03
- Фискален съвет, становище по ЗДБРБ 2026 / АСБП 2026-2028 (12.12.2025)
- КНСБ становища по ЗДБРБ 2026 и бюджета на ДОО 2026 (13.11.2025)
- МФ consolidation menu (April 2023, via Sega); МФ/Mediapool on restaurant VAT (2024-25)
- ECB Economic Bulletin 2/2019 (debt dynamics); EC Economic Papers 536 (elasticities);
  IMF WP/13/49 (BG fiscal multipliers); Government Debt Management Strategy 2026-2028
