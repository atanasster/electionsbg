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

| Lever | This model | Published estimate | Source |
|---|---|---|---|
| VAT standard +1пп | ≈ +€500–550M | МФ 2023 menu: 22% "за всички стоки" = +1.63 млрд лв per H2-2023 — implies ≈ €830M/пп/yr but bundles reduced-rate abolition; naive static on 2023 base ≈ €360M | Sega 25.04.2023 |
| Restaurants → 9% | ≈ −€170M | МФ 2025: −300…−400 млн лв (−€153…−205M); booked +465 млн лв (+€238M) in Budget 2025 when restored | Mediapool 21.03.2025; Investor 26.02.2025 |
| Books/periodicals/baby 9% (permanent) | n/a (already baseline) | −16 млн лв/yr (−€8.2M) | Actualno 08.12.2022 (Петкова) |
| CIT +1пп | +€333M (2025 base €3.33B) | МФ 2023: +2.31 млрд лв for +5пп → ≈ +€236M/пп on the 2023 base; КНСБ 2025: +€1.1B for 15% | Sega 25.04.2023; КНСБ становище ЗДБРБ 2026 |
| Dividend 5→10% | +€75M (static) | Фискален съвет 12.12.2025: **max +€50M** (behavioral leakage) | ФС opinion PDF p.20 |
| Pension contribution +1пп | +€315M (insurable base €31.5B) | КНСБ/НОИ: +€601M for +2пп → ≈ +€300M/пп | КНСБ становище ДОО 2026 |
| МОД €2,112 → €2,352 | model: band-fit estimate (run live in UI) | КНСБ: +€231M all contributions (≈ +€180M ДОО); note this includes the 5пп second pillar the budget does not keep | КНСБ становище ЗДБРБ 2026 |
| Необлагаем минимум = МРЗ | ≈ −€1.9B (static, full distribution) | М. Димитров 2022: −1.5 млрд лв (−€767M) at 500 лв/мес → scaled to €620 (1,213 лв) ≈ −€1.86B — consistent; КНСБ Oct-2025: −€1.5B net *with* a 15% rate offset; IMF Art. IV 2025: progressive reform could yield ~1% of GDP | News.bg 07.2022; Investor 07.10.2025; IMF PR 25-384 |
| VAT compliance gap | (context) | EC VAT gap 2025 edition (data 2023): BG gap €781M = 8.6% of VTTL | EC VAT gap report |

Takeaways encoded in the UI:

1. Static scoring matches official *static* numbers (МФ's own menu is static per-pp on
   the then-current base). Differences vs older sources are base-year growth, not method.
2. The dividend lever is the one place static scoring overshoots a published estimate
   materially (€75M vs ФС's ≤€50M) — the ФС number embeds behavioral response.
3. МФ's 22%-VAT menu number is NOT a clean ±1пп benchmark (it bundles reduced-rate
   abolition and carryover); do not calibrate against it.
4. Fiscal Council on the (dead) 2026 draft: revenues overestimated by €2.6–3.2B;
   VAT plan implied +30% y/y. Our baseline uses 2025 *execution*, which sidesteps that.

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

| Measure | Status (2026-06-11) | Costing anchor | Lever |
|---|---|---|---|
| Maternity 2→1 year | Rumor-stage: floated by ПБ MP Владимир Николов 2026-06-01 (bTV), formally denied same day by К. Проданов; NOT a МФ proposal | Second-year benefit (чл.53 КСО) €398.81/mo frozen; 2025 НОИ execution **€154.2M** (2024: €160.5M from the НОИ statistical XLS); ~33.5k avg full-rate recipients (derived — no published count) | `mat` slider, months kept 12→0; static, ignores return-to-work SSC/PIT offset and the 50%-if-working rule |
| MP salary freeze | Правна комисия approved **17–0 on 2026-06-11**; plenary pending; freezes base at 3× NSI public-sector avg for March 2026 | Base **€4,236/mo** (May 2026); 240 MPs × ~1.30 committee extras × 1.1902 employer SSC ≈ **€18.9M/yr** pay mass; saving = foregone growth (~11.8%/yr НОИ insurable-income proxy) ≈ €2.2M/yr; president (2×), НС chair (+55%), PM, ministers ride the same base (not modeled) | `mpf` checkbox |
| Party subsidy cut | **ADOPTED 2026-06-03**: €4.09 → **€3.00/vote** retroactive 30.04.2026 (saving ≈ €3.1M annualized) | ~2.861M subsidized votes (€11.7M ÷ €4.09), 7 formations | `psub` slider 0–€4.50, default €3.00 = current law |
| МОД €2,300 from 01.08.2026 | Confirmed Donev guideline (2026-05-18) | — | existing МОД slider |
| Administration −10% payroll from 01.09.2026 | Donev guideline, no EUR figure | — | existing admin lever |
| Capital freeze (non-priority) | Donev guideline, no EUR figure | — | existing capital lever |
| Pensions +7.8% (01.07.2026) + min pension €347.51 + no COVID supplement for NEW pensions | Adopted 2026-06-03 (extension-law amendments) | — | Swiss rule = current law; pensionFloor baseline (€322.37, as of 2026-03-31) predates the July rise — regen note |
| Public-sector pay cap = president's salary; end of top-office auto-indexation | Donev guideline 2026-05-18 | no published saving | not modeled (no costable base) |
| СУПТО revival / collection measures | In Nov-2025 draft (€320M claimed), dropped Dec 2025; presence in the Donev bill UNVERIFIED | — | not modeled (ФС disputed the claimed yields) |

Constants live in `bgTaxPolicy.ts` (`MATERNITY_Y2_SPEND_EUR`, `MP_PAY_MASS_EUR`, `PARTY_SUBSIDY_VOTES`) — single published figures, deliberately not piped through policy_baseline.json.

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

## Pending data upgrade

A ЗДОИ request to НАП for ДДФЛ income-tier statistics (income distribution by bracket)
is being prepared. When it lands, the fitted earnings distribution (split log-normal +
Pareto, α≈2.27, κ≈1.108, SES 2022 anchors) in `run_policy_baseline.ts` should be
replaced/recalibrated with the actual tier data — it directly determines the
необлагаем-минимум, progressive-bracket and МОД-cap scores, and removes the largest
modeled (vs sourced) component in the engine.

## Key sources

- НСИ EDP notification 2026-04-22 (2025 deficit/debt/GDP)
- EC Spring 2026 forecast, Bulgaria page (2026-05-21); EDP recommendation 2026-06-03
- Фискален съвет, становище по ЗДБРБ 2026 / АСБП 2026-2028 (12.12.2025)
- КНСБ становища по ЗДБРБ 2026 и бюджета на ДОО 2026 (13.11.2025)
- МФ consolidation menu (April 2023, via Sega); МФ/Mediapool on restaurant VAT (2024-25)
- ECB Economic Bulletin 2/2019 (debt dynamics); EC Economic Papers 536 (elasticities);
  IMF WP/13/49 (BG fiscal multipliers); Government Debt Management Strategy 2026-2028
