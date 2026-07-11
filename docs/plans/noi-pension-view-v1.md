# Пенсии (NOI pension view) — v1 plan

Status: **v1 fully built (uncommitted) — all five phases + pack §8 shipped and verified.**
Only remaining item: the deferred pack momentum tile (§8.3 #4). See "Build status" below.

## Build status (2026-07-11)

Shipped and verified in-browser (typecheck + lint clean, not committed):

- **Ingest** — `scripts/budget/noi/parse_yearbook_xlsx.ts` + `__write_pensions.ts` →
  `data/budget/noi/pensions.json` (national series, size distribution, per-oblast avg
  pension + cash-vs-bank, Eurostat poverty line). All the §4.3 parser rules; the
  sum-to-Общо gate passes for 2022/2023/2024. Pensioner constant + STATB watcher fixed.
  The B1 transfer-line fix and the ДОО-scoping fix landed earlier (committed).
- **/pensions view** — route, nav leaf (governance) + prefix, i18n (both locales),
  `data_map` dataset+feature+edges, prerender staticPage (reads pensions.json), sitemap.
  Tiles: funding hero (46.8% / €239 reframe), distribution histogram (floor spike + cap
  wall + poverty line), oblast avg-pension choropleth + sorted bars, cash-collection
  choropleth (29% national), long wage/income/pension series.
- **Pack §8 ship-now** — shared `<InsightChips>` + `<PillToggle>` primitives, €↔count
  toggle on the category & suppliers tiles, Pareto concentration curve, and the
  `NoiIntegrityTile` (single-bid with the statutory mandate split out — the §8.4
  differentiator).
- **Phase 3 — КФН pillars 2/3** — `scripts/budget/kfn/parse_kfn.ts` + `__write_funds.ts`
  parse the four accumulation workbooks (UPF/PPF/VPF/VPFOS) → `data/budget/kfn/funds.json`
  (31 funds, €14.6bn net assets, 5.1M insured). `KfnFundsTile` on `/pensions`: sortable
  fund comparison (net assets ↔ insured toggle), grouped by pillar, company labels.
  **Stored as static JSON, not Postgres** — a deviation from §4.2: ~30 funds/quarter
  (~120 rows/year) is firmly static-JSON territory by the §4.1 query test, and the Cloud
  SQL deploy can't complete from this environment. If the corpus is later widened to
  per-participant grain or many metrics × many quarters, revisit PG. Deferred: the
  `/company/:eik` cross-link (needs the ПОД EIKs) and a КФН quarterly watcher.

- **Phase 4 — reform sandbox** — `src/lib/pensionReform.ts` (pure engine reusing the
  `bgTaxPolicy` scorers + `policy_baseline.json`) and `PensionReformTile` on `/pensions`.
  Levers: contribution rate, Swiss-rule indexation weight, minimum pension, cap. Live
  scoreboard (% of the €5.9bn ДОО transfer closed, deficit as % of GDP), per-lever
  breakdown, constraint flags, exposed-assumptions footnote. Verified live: +3pp + CPI-only
  closes 24% (€5.9bn → €4.5bn); raising the minimum to €500 *widens* it to €8.5bn (−45%),
  the adequacy-vs-sustainability tradeoff shown honestly. Retirement age deliberately
  omitted (needs an actuarial cohort model, not a static elasticity).

- **Phase 5 — replacement signature + projection** — `src/lib/pensionFormula.ts` (the КСО
  formula on synthetic biographies, OECD PaG method). `PensionReplacementTile`: the
  three-earner signature (low 54% / median 54% / high 48% for a 40-yr career, floored for
  low earners and capped for high — the redistributive shape), career-length toggle
  (30y → median 41%). `PensionProjectionTile`: НОИ vs EC pension-expenditure-to-2070 as two
  named lines from the verified §3.3 anchors (~1pp gap = the point), not a fabricated fan.

Not built: pack momentum tile (§8.3 #4, deferred — needs a shared-engine change and adds
little for NOI's few structural suppliers). Everything else in this plan is built.

The existing NOI procurement pack stays where it is; the view is additive and cross-links.

Goal: make naiasno.bg the best public pension analysis in the world for one country,
using only published aggregates and the law. Ship a top-level `/pensions` view covering
pillar 1 (НОИ/ДОО) and pillars 2/3 (КФН private funds).

---

## 1. Where we start

The current "NOI pack" is a **procurement pack**, not a pension product. It renders at
`/awarder/121082521` and answers "what does НОИ buy?" — ~€110m of contracts over 15
years, classified by CPV division. The €12.6bn fund appears only as a denominator.

That framing is honest and worth keeping. It is not what a pension view is for.

| | NOI pack | NZOK pack |
|---|---|---|
| Tiles | 4 | 13 |
| Postgres | none | `nzok_hospital_payments` (facility × month) |
| Time series | none (1 usable year) | yes (execution history, momentum, pace) |
| Geography | none | regional choropleth |
| Interactivity | none | year picker, drill-down, head-to-head |
| AI tools | 1 (`noiFunds`) | 4 |

### Why there is no time series

`scripts/budget/noi/__write_funds.ts` tries years 2020–2025 × 3 funds. Only the **2024**
B1 files were ever downloaded. nssi.bg returns 200 on HEAD but **302-redirects on GET**
for `B1_*.xls`, so the `nssi_b1` watcher can detect a change but cannot fetch it — a
human must download by hand. Hence `funds.json` = 18.5 KB, 2 years, one usable (2023 is
a yearbook-only shell with `funds: []` and `revenue: 0`).

**This does not block us.** The yearbook ZIP and the quarterly bulletin GET cleanly (§3).
The pension *statistics* series can be fully automated even though B1 execution cannot.

---

## 2. Competitive position

### Bulgaria

Verified by opening each. The field is close to empty.

- **НОИ** publishes an actuarial projection to 2070 (gross replacement rate 55.0% → 43.6%,
  недостиг ~5% of GDP, pensioners-to-insured 68.2% → peak 81.1% (2060) → 78.2%). It is a
  PDF. No interactive version exists anywhere. Exact figures and definitions in §3.3.
- **ИПИ/IME**'s pension calculator is a **downloadable Excel file from Sept 2008**,
  built to argue for Chilean-style privatization.
- **regionalprofiles.bg** (our nearest regional competitor) carries **one** pension
  indicator: average monthly pension per oblast. This is their weakest flank.
- **Fiscal Council, FES, КНСБ, МТСП, IMF** — all publish pension-sustainability analysis
  as prose PDFs. No charts.
- **Pension companies** (Доверие, Алианц, ДСК-Родина, UBB…) have polished pillar-2
  slider calculators. All are lead-generation.
- **moitepari.bg** is the only neutral public pension-fund comparison. Dated ASP.NET.
- The only live pension dashboard in Bulgarian media is **one Flourish chart**
  economic.bg published once and never maintained.

No neutral, maintained, well-designed, data-grounded pension explainer exists.

### The world

Two families, and only one is contestable.

**Personalization — ceded.** minPension.se, mijnpensioenoverzicht.nl, PensionsInfo (DK),
mypension.be, norskpensjon.no all win because the state owns the individual records and
national eID pulls them with zero user input. НОИ owns Bulgaria's, gated behind a ПИК
code collected in person (and since 1 Jan 2026, only via eportal.nssi.bg). **We cannot
and should not build this.** Say so explicitly on the site.

**Analysis — unclaimed.** Bulgaria has **no OECD *Pensions at a Glance* country
profile** and is **absent from the Mercer CFA Global Pension Index**. Both products are
built by applying a country's legislated pension formula to *synthetic biographies*.
They require no microdata — only the law and a rules engine.

The defensible position: **be the OECD/COR/CRFB analytical toolkit rebuilt for Bulgaria
at oblast grain, entirely from public aggregates, with a reform sandbox as the
flagship.** Add the thing no national portal does, because national portals think
nationally: **place-grained pensions**, cross-linked to our existing wage, census and
my-area layers.

---

## 3. The data (all verified with `curl`, 2026-07-10)

nssi.bg / noi.bg run `Server: NSSI`. No Cloudflare, no WAF. Plain 200 on HTML/PDF/XLS/ZIP.

### 3.1 The yearbook is XLSX, not PDF

We currently PDF-scrape `Yearbook_Pensions_2024.pdf` for **one** table (6.3) via
`parse_pension_yearbook.ts`. The same publication ships as a ZIP of clean workbooks:

    https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_2024.zip   → 200, 1.5 MB

Contents (verified — 11 chapter workbooks + annex):

    CHAPT#1-2024.xlsx    headline series: population, insured, pensioners,
                         avg wage vs avg insurable income vs avg pension
    CHAPT#2-2024.xlsx    pensions/pensioners by type × sex
    CHAPT#3-2024.xlsm    pensioners by age group × type × sex (back to 2016)
    CHAPT#4-2024.xlsx    individual coefficient: average + distribution
    CHAPT#5-2024.xlsx    ** SIZE DISTRIBUTION — 17 brackets × type × sex **
    CHAPT#6-2024.xlsx    expenditure by fund & type   (the one we parse today)
    CHAPT#7-2024.xlsx    avg pension size, avg service (стаж), avg retirement age
    CHAPT#8-2024.xlsx    supplements (widow чл.84, attendance allowance)
    CHAPT#9-2024.xlsm    ** OBLAST GRAIN — 28 ТП на НОИ **
    CHAPT#10-2024.xlsx   Teacher Pension Fund (УчПФ)
    CHAPT#11-2024.xlsx   pensions under EU regs / bilateral treaties, by country
    PRILOJENIE 1_2_3_2024.xls

Clean XLSX exists for **2022, 2023, 2024 — and only those** (2022 is legacy `.xls`; chapters
3 and 9 are `.xlsm` in 2023/24). 2021 and 2025 return an **HTML 404 page with HTTP 200** —
sniff the `PK` magic bytes. 2014–2021 are PDF-only (the existing PDF parser remains useful
for backfill). See §4.3 for the full parser contract.

Sheet `9.8-2024` — average monthly pension per oblast, with YoY. Verified read:

| | лв/mo | €/mo |
|---|---|---|
| София-град | 1 079 | 552 |
| Бургас | 979 | 500 |
| Перник | 965 | 493 |
| … | | |
| Разград | 730 | 373 |
| Кърджали | 710 | 363 |
| **National** | **883** | **451** |

Spread across real oblasts: **1.52×**. (A 29th row, "Турция и ЕРМД" at 564 лв, is
pensions paid abroad under EU regulation/bilateral treaty — **not an oblast**. Exclude
it from maps and from the spread, or it silently becomes the "lowest region".)

Sheet `5.1-2024` — pensioners by monthly pension bracket. Verified read, 31.12.2024:

- **2 052 553** pensioners (excl. those held as 2nd/3rd/4th pensions)
- **812 313 — 39.6% — at or below the minimum pension** of 580.57 лв (€297/mo)
- modal bracket 493.49–580.57 лв holds **429 473 people (20.9%)**, piled on the floor
- **4 598** people sit *exactly* at the 3 400 лв cap (таван, €1 738); **7** are above it
- the average, 883 лв, sits in the empty valley between the floor spike and the ceiling

The bracket boundaries **are the policy parameters** (276.37 / 435.43 / 493.48 / 580.57).
That is what makes this dataset special: the histogram is shaped by law, and you can see
the law in it.

> **Never publish the average pension without the distribution.** The mean describes
> almost nobody. Every Bulgarian source — including НОИ's own press releases — reports
> only the mean.

### 3.2 Quarterly bulletin — same grain, 4× a year

    https://www.nssi.bg/wp-content/uploads/STATB{Q}{YYYY}.xls    → 200

Single .xls, ~45 sheets. Carries **both** high-value dimensions: oblast (`brRUSO` /
`razRUSO` / `smrRUSO` = count / expenditure / average size per ТП) and the size-bracket
sheets (`grupi`). XLS 2023-Q1 → present; PDF back to 2015. This is the live pulse.

Already polled by the `policy_baseline_local` watcher (which hard-codes
`STATB_QUARTER=1, STATB_YEAR=2026` — fix that).

### 3.3 Actuarial report to 2070

    https://www.noi.bg/wp-content/uploads/ActuarialReport_2024.PDF   → 200

PDF, 82 pp, tables embedded, no machine-readable annex. Built on **EUROPOP2023**
demographics + the МФ (Институт за анализи и прогнози) spring macro forecast.
Extraction is a one-off, hand-verified table lift — not a watcher target.

**Cadence is irregular, not "every ~3 years".** The prior edition is **2019**; the gap was
five years. Date-stamp the projection tiles prominently.

**Verified figures** (page refs are to АД2024):

| Metric | Definition | 2023 | 2070 | Note |
|---|---|---|---|---|
| Replacement rate | avg labour pension ÷ avg **gross** insurable income | 55.0% | 43.6% | peaks 56.4% in 2026; trough 43.1% ~2060 |
| Replacement rate (net) | avg pension ÷ avg **net** insurable income | 69.9% | — | **single year only; НОИ does not project it** |
| ДОО недостиг (shortfall transfer) | % GDP | 5.3% | ~5.2% | peaks >6.0% 2026-27; trough 4.7% ~2040 |
| Pension expenditure | ДОО pensions ÷ GDP | 10.4% | 10.5% | peaks 11.5% in 2027 |
| Pensioners-to-insured | system dependency | 68.2% | 78.2% | **not monotonic** — peaks 81.1% in 2060 |
| Required contribution rate | dependency × replacement | 37.5% | 34.1% | vs **actual 16.3%** → 21.2pp structural gap |
| 65+ share of population | EUROPOP2023 | 21.6% | 30.8% | peaks 32.4% in 2060 |

Three corrections to what earlier drafts of this plan said:

- The famous "55% → 43%" is the **gross** rate. The "69.9%" is the **net** rate, 2023 only.
  They are not two ends of one series. Label every chart with which one it is.
- Pensioners-to-insured is **not** a monotonic 68 → 78. It peaks at 81.1% in 2060 and eases
  back. A chart drawn as a straight rise would be wrong.
- "Pensioners as % of population rising to 31–35%" **is not in the report.** It was a misread
  of the 65+ population share (21.6% → 30.8%). Drop it.

**The "named scenarios" design decision (§6) needs adjusting.** АД2024 does *not* ship an
optimistic/pessimistic macro band. It ships **one deterministic baseline** plus two *policy*
scenarios (Part 5): contribution +5pp phased to 2045, and CPI-only indexation — plus a
back-comparison to the 2019 report. So:

- Do not present the projection tile as a macro fan or as if НОИ published one. It has a
  single baseline.
- The two policy scenarios map **directly onto reform-sandbox levers** (Phase 4). That is a
  gift: НОИ has pre-costed two of our sliders.

**EC vs НОИ disagree, and that is itself a chart.** EC 2024 Ageing Report (BG fiche, Табл. 6)
projects pension expenditure **9.5% of GDP (2022) → peak 10.8% (2025) → 9.6% (2070)**; НОИ
runs ~0.9–1.0pp higher throughout and peaks higher and later. Same demography (EUROPOP2023),
different scope (EC's AWG/ESSPROS "public pension expenditure" vs НОИ's full ДОО pension
line) and different base year — the permanent COVID-era pension hikes land between 2022 and
2023. The EC's benefit ratio (avg pension ÷ avg **wage**) is 31% → 25%, a fourth distinct
measure again. Four ratios, all correct, all different denominators. Never mix them.

### 3.4 data.egov.bg org 123 — six oblast × annual series

Same API pattern as org-56 (agri). Cleaner and longer than the XLS where it overlaps.

1. Брой на пенсионерите по ТП (средномесечен)
2. Брой на пенсиите по ТП (средномесечен)
3. Майчинство — recipients by ТП
4. Болнични (temporary incapacity) — recipients by ТП
5. Безработица — recipients by ТП
6. Трудова злополука / проф. болест — recipients by ТП

### 3.5 КФН — pillars 2 & 3 (the missing half)

    https://www.fsc.bg/en/social-insurance-activity/statistics/       (index)
    https://www.fsc.bg/wp-content/uploads/2025/08/statistics_2025_q2-1.zip   → 200

Quarterly ZIP of XLSX, one workbook per fund type: **УПФ** (universal), **ППФ**
(professional), **ДПФ/ВПФ** (voluntary), plus pension companies (ПОД) and
`Participants_Gender_Age_*.xlsx`.

Grain: **per fund, per company** — net assets, insured count, contributions, investment
structure, returns, fees.

Two reasons this is in scope for v1 rather than a separate product:

- Pillar 2 is not optional for anyone born after 1959. A pension view that stops at ДОО
  is describing half of a mandatory system.
- The ПОД holding companies are **already in our company/connections graph**. Linking
  `/pensions` → `/company/:eik` for Доверие, Алианц, ДСК-Родина et al. is a cross-link
  no competitor can make, and moitepari.bg — the only comparison site — is a dated black
  box.

### 3.6 Parametric history (hand-curated, once)

КСО consolidated: `https://lex.bg/laws/ldoc/1597824512` (200, windows-1251) — retirement
age schedule (чл.68), contribution splits, Swiss-rule indexation (чл.100), service
coefficient 1.2 → 1.35 (чл.70). Annual ЗБДОО in Държавен вестник sets min/max pension,
the cap, and МОД.

No single source publishes this as a table. Assembling it once — retirement age,
contribution %, min pension, cap, indexation %, service coefficient, by year — gives
every chart on the view its event annotations. Small file, high leverage.

### 3.7 Not fetchable

- **Сребърен фонд** (minfin.bg/bg/229) — Cloudflare 403 `cf-mitigated: challenge`.
  Needs a headed browser, same as our other MinFin-blocked sources. Defer.
- **B1 execution XLS** — 302 on GET. Stays a manual drop (`update-noi` skill).

### 3.8 Eurostat (for the peer layer, via existing `update-macro` machinery)

`spr_exp_pens` (pension expenditure), `ilc_pnp3` / `tespn070` (aggregate replacement
ratio), `ilc_pnp13` (**gender pension gap**), `ilc_li02` (at-risk-of-poverty, take 65+),
`demo_pjanind` (old-age dependency, observed), `proj_23ndbi` (projected, EUROPOP2023).
EC **2024 Ageing Report** ships Excel annexes with a Bulgaria country fiche.

None of these are in `macro.json` today (42 indicators, zero pension-specific).
`cofog.json` has `GF10` (social protection) but no `GF1002` (old age) decomposition.

---

## 4. Storage: what goes to Postgres, and what does not

### 4.1 `funds.json` stays on disk

Considered and rejected. 18.5 KB; 2 years × 3 funds × 9 expense lines.

- **Nothing to query.** No filter, sort, pagination or search. PG earns its keep on
  selectivity; there is none here.
- **Every runtime consumer reads it whole** — `useNoi`, `BudgetFlowSocialFundsDrilldown`,
  `BudgetSocialFundsTile`, `CabinetFiscalFootprintTile` — behind React Query with
  `staleTime: Infinity`. One cached fetch. An API round-trip would return identical bytes
  and add a live dependency.
- **It has a build-time consumer.** `scripts/budget/run_policy_baseline.ts:902` reads it
  off disk via `readJson`. Moving it to PG makes the daily policy-baseline build — which
  feeds the tax simulator — depend on Cloud SQL being reachable. Strict regression.
- Fails the house rule: PG = live serving + queryable tables; ingests keep writing JSON.

### 4.2 Apply the same test to the new data

| Dataset | Rows | Read pattern | Store |
|---|---|---|---|
| `noi_pensions_oblast` | 28 × types × years | whole (choropleth) | JSON |
| `noi_pension_brackets` | 17 × type/sex × years | whole, per slider drag | JSON |
| `noi_series` (national) | a few series | whole | JSON |
| **КФН funds (pillars 2/3)** | fund × company × quarter, growing | sort/filter/compare | **PG** |

КФН is the only genuine PG candidate: unbounded growth and the natural interface is a
sortable, filterable comparison of funds by return, fee and net assets — i.e. a
`DbDataTable` registry entry.

### 4.3 Pre-implementation audit — blocking findings

Everything below was verified against the source files, not inferred. Ordered by severity.

**RED — the flagship map's denominator does not exist where the plan assumed.**
`getopendata_json.php?id=612` is **national only** (dimensions: NACE activity × period ×
ownership; no geography), in annual BGN. Eurostat wage series (`nama_10r_2coe`) are **NUTS2**
— the 6 statistical regions, not the 28 oblasts. НОИ does **not** publish insurable income by
oblast either (Chapter 9 is entirely pensions; insurable income appears only as a national
series in Chapter 1). NSI *does* publish oblast wages (topic 179) but only via Infostat
(Cloudflare-walled) or per-oblast press-release PDFs.

So "pension ÷ local wage by oblast" costs a bespoke parser. Options:
  a. Build the NSI topic-179 parser (real work, correct denominator).
  b. Ship the map against **oblast GDP per capita**, already in `regional.json` from Eurostat
     NUTS3. Free, weaker, but honest if labelled as such.
  c. Ship avg pension per oblast *un-normalised* first (sheet 9.8 alone), add the ratio later.
Decide before Phase 2. Do not assume (a) is cheap.

**RED — "workers per pensioner" cannot be computed at oblast grain.** Pensioners by oblast:
yes (9.1 / `brRUSO` / egov). Insured contributors by oblast: **published nowhere** — not the
yearbook, not the quarterly bulletin, and the six egov org-123 series are all *recipient*
counts. НОИ publishes the system dependency ratio **nationally only** (68.2%, 2023).

The demographic ratio (65+ ÷ working-age, from census or Eurostat) is a *different, larger,
softer* number. Labelling it "workers per pensioner" would publish a falsehood. Rule:
  - national ticker → "insured per pensioner" (the real system dependency ratio);
  - oblast/municipality tiles → "demographic old-age dependency (65+ ÷ working-age)".
Never the same words for both.

**AMBER — the yearbook parser cannot key on sheet names or row indices.** Verified across
2022/2023/2024:
  - Coverage is **2022–2024 only**. 2021 and 2025 return an identical 283 450-byte HTML 404
    page **with HTTP 200**. Sniff the `PK` zip magic bytes; never trust the status code.
  - Sheet names drift: `<9.8-2024 >` (trailing space) / `<9.8 >` (2023, no year suffix) /
    `<9.2-2022  >` (two trailing spaces); `9.5` gains a stray dot in 2022 and 2024.
    Normalise: strip `-YYYY`, strip all whitespace, strip trailing dot, match the numeric code.
  - 2023 injects a `"към съдържание"` nav row at the top, shifting **every table by one row**.
    Anchor on header text (`ТП на НОИ`, `Общо`), never on an absolute index.
  - Bracket boundaries change every year (2022: 222,**30** — comma decimals; 2023: 248.98;
    2024: 276.37) because they track the statutory minimum pension — **and the topology
    changed**: 2024 split the 1600–2000 bin in two. Read the edges from the sheet; never
    hardcode. The row count staying at 17 is coincidence.
  - 2022 ships all chapters as legacy `.xls`; 2023/2024 use `.xlsx` except chapters 3 and 9,
    which are `.xlsm`.
  - **Memo rows must be excluded or you double-count.** Bracket rows carry a numeric ordinal
    in column A; memo rows (`на 3400.00 лв.`, `до 580.57 лв. вкл.`, and in 2024 an extra
    *unlabelled* one) do not. Validation gate: rows with a numeric ordinal in column A sum
    **exactly** to the `Общо` headline — verified for all three years.
  - The count lives in column **C**, not B.
  - The non-oblast 29th row has **three different names** across sources: `Турция и ЕРМД`
    (yearbook 9.8), `Европейски регламенти и международни договори` (`brRUSO`), `ЦУ на НОИ`
    (`razRUSO`). Identify it by **ordinal 29**, never by name. Exclude from maps and spreads.

**AMBER — the quarterly bulletin needs its own parser.** Its sheets are Latin transliterations
(`brRUSO`, `smrRUSO`, `grupi (2)`) with zero overlap with the yearbook's numeric codes, and
they vary *by quarter*: the Q4 file names it `razRUSO_31.12` where Q1/Q3 use plain `razRUSO`.
Sheet count varies 44–46. One shared cell-locator engine, two source profiles.

**GREEN — oblast mapping is 1:1**, 28 ТП ↔ 28 codes in `scripts/lib/oblast_names.ts`. Join by
name, not row index (НОИ's numbering is its own — Добрич sits at #24). **The Sofia trap:**
row 21 `София-град` = `SOF` (capital, 1 079 лв, highest in the country); row 22 bare `София` =
`SFO` (София-област, 915 лв). Swapping them puts the highest pension in the wrong polygon.
Пловдив and София-град each fan out to several МИР sub-codes — mirror
`fetch_nsi.ts`'s `EKATTE_OBLAST_TO_REGIONAL`.

**GREEN — the poverty line is available.** Eurostat `ilc_li01`, filters
`hhcomp=A1, statinfo=MED_EI, rskpovth=B_60` (note `B_60`, not `A_60` — the `A_` codes return
empty for BG). 2024 single-person threshold = 9 166 лв/yr = **764 лв/month**. Coverage through
2024. `macro.json`'s `povertyRate` is a **rate**, not a threshold — we hold nothing today.
764 лв sits *above* both the minimum pension (580.57) and the modal bracket, which is the
entire point of shading it.

**GREEN — cash-vs-bank is a clean trend, not a snapshot.** Sheet 9.11 ÷ 9.1, all three years:

| Year | Bank-paid | Total ДОО pensions | Cash % |
|---|---:|---:|---:|
| 2022 | 1 380 674 | 2 042 661 | **32.4%** |
| 2023 | 1 419 854 | 2 048 976 | **30.7%** |
| 2024 | 1 464 421 | 2 063 480 | **29.0%** |

### 4.4 Two latent bugs found while checking this

**(a) Shell-year selection — FIXED** (`28cb69f49`, `e052f665a`).
`run_policy_baseline.ts` used to take `noi.years[noi.years.length - 1]` — the *last array
element* — as the pension-mass source. The B1 ingest publishes a new fiscal year mid-cycle
as a **partial/shell record** (`funds: []`, `revenue: 0`), so appending a 2025 shell would
have silently fed a partial pension mass into the `/budget/simulator` levers.

The producer now stamps `complete` (`parse_b1_xls.ts:421`) and `src/data/budget/noiYear.ts`
is the single place that interprets it, via `latestCompleteNoiYear()` — which sorts by
`fiscalYear` rather than trusting array order, falls back to the structural test when the
flag is absent (a stale artifact served from the GCS bucket), and throws when no year
qualifies. It replaced four separately hand-rolled copies of the predicate
(`run_policy_baseline.ts`, `useNoi.tsx`, `BudgetSocialFundsTile`,
`BudgetFlowSocialFundsDrilldown`).

Verified: picks 2024 today (no-op); still picks 2024 with a 2025 shell appended; still picks
2024 with the `complete` flag stripped.

**(b) The transfer line is never parsed, and the shipped tile overstates it.**
`parse_b1_xls.ts:242-252` reads only sections `I. ПРИХОДИ`, `II. РАЗХОДИ` and `V. Дефицит`.
The sheet also carries **`III. Трансфери`** (ДОО 2024: 11 525 190 085 BGN) and
`IV. Вноска в общия бюджет на ЕС`. Because `funds.json` has no transfer field,
`NoiFundFlowTile.tsx:107` computes `transferEur = expenditure − revenue` = €5.99bn.

The real transfer is **€5.89bn**. The difference is the €0.10bn residual deficit covered by
financing — so the live tile on `/awarder/121082521` currently **overstates the state
transfer by ~€100m** and labels §I revenue ("Приходи, помощи и дарения", which includes
€0.11bn of fines and property income) as "contributions".

Fix in Phase 1: parse sections III and IV, add `transfers` + `euContribution` to
`NoiFundsFile`, and split §I into `taxRevenue` (contributions) vs `otherRevenue`. Then assert
`I − II + III − IV == V` at ingest.

---

## 5. What we already hold

Do not rebuild these.

- **`data/budget/derived/policy_baseline.json`** — regenerated daily. Carries
  `expenditure.pensions` (mass €11.13bn, pensionerCount 2.05m, supplementMass €754m,
  cpiPct, wageGrowthPct), `pensionFloor.bands` (from the НОИ quarterly bulletin),
  a fitted log-normal + Pareto `earnings` model with the €2 112 cap and
  `shareAboveCap 0.073`.
- **`src/lib/bgTaxPolicy.ts`** — already implements `scorePensionIndexation` (the Swiss
  rule), `scorePensionFloorRaise` (band-based top-up), `scoreWageIndexation`. Mirrored in
  `ai/tools/taxPolicy.ts`. **The reform sandbox's levers already exist**, buried inside
  the fiscal-balance calculator at `/budget/simulator`.
- **`data/census_2021.json`** — `age65plus` per oblast *and* per municipality. Good for the
  **demographic** dependency ratio only (§4.3), never for "workers per pensioner". Five years
  stale; prefer Eurostat `demo_r_pjanaggr3` (NUTS3, through 2025) for the pyramid.
- **`data/regional.json`** — per-oblast population, net migration, death rate,
  `gdpPerCapita`. **No wage series.**
- `FeatureMap` (`src/screens/components/maps/FeatureMap.tsx`) is the reusable choropleth
  primitive; `sequentialScale.ts` the shared ramp; `AgriOblastMap.tsx` the closest template.
  There is **no** global theme-token chart palette — §6 asks for one, so that is new work.
- `NzokBudgetBridgeTile.tsx` is an existing waterfall/bridge to copy.

**Not cheap, contrary to earlier drafts: average wage by oblast.** See §4.3 (RED). The
`policy_baseline_local` watcher polls `getopendata_json.php?id=612`, which is **national
only** — no geography dimension. Eurostat wages are NUTS2. This blocks the pension ÷ wage
map until someone writes an NSI topic-179 parser.

---

## 6. Design decisions (settled)

Taken from the dataviz research; these are constraints on implementation, not options.

**No Sankey hero.** ДОО is a one-hop fund — contributions in, benefits out. A Sankey
spends enormous visual budget saying what a waterfall says instantly, collapses to
unreadable threads with many small categories, and cannot reflow below 375px. Use a
horizontal **waterfall** for the accounting identity (contributions + state transfer →
outlays → balance) and a **treemap** for composition. Our current
`BudgetFlowSocialFundsDrilldown` is the shape to avoid repeating here.

**Per-unit reframe everywhere.** The single highest-return change on the list, and it
costs nothing.

> Осигурителните вноски покриват **51.5%** от разходите на ДОО. Трансферът от централния
> бюджет покрива **46.8% — €5.89 млрд., или €239 на пенсионер на месец.**

Never lead with €12.6bn.

**The headline arithmetic — get this exactly right (§4.4).** Earlier drafts said "52.4%
contributions / 47.6% transfer / €6.0bn / €243". All four were wrong, because they used
`expenditure − revenue` as the transfer. The B1 sheet's real identity is

    V. Дефицит  =  I. Приходи  −  II. Разходи  +  III. Трансфери  −  IV. Вноска в ЕС

ДОО (fund 5500), 2024, straight from `B1_2024_12_5500.xls`:

| Section | BGN | € | share of expenditure |
|---|---:|---:|---:|
| I. Приходи, помощи и дарения | 12 889 953 266 | 6.59bn | 52.4% |
| — of which `Данъчни приходи` (contributions) | 12 673 973 046 | 6.48bn | **51.5%** |
| — of which other (fines, property, fees) | 215 980 220 | 0.11bn | 0.9% |
| III. Трансфери | 11 525 190 085 | 5.89bn | **46.8%** |
| — of which from the central budget | 11 522 308 949 | 5.89bn | 46.8% |
| V. Дефицит (financed) | −199 903 454 | −0.10bn | 0.8% |
| II. Разходи | 24 615 046 805 | 12.59bn | 100% |

So: contributions 51.5% + transfers 46.8% + financed deficit 0.8% = 100%. "Revenue" is
**not** "contributions" (it carries €0.11bn of non-tax income), and `expenditure − revenue`
(€5.99bn) **overstates the transfer** by the financed deficit.

**`funds.json` does not carry section III at all** — `parse_b1_xls.ts` reads only I, II and V
(§4.5). Phase 1 must parse the Трансфери line. Until it does, every downstream figure is a
derived approximation, including the one currently shipped on `/awarder/121082521`.

**Standing cross-check, to be asserted in the ingest.** Against Eurostat 2024 nominal GDP of
€104.77bn (`macro.json`):

- transfer €5.89bn = **5.62% of GDP** — reconciles with НОИ's projected 5.5% недостиг and the
  IMF's "over 5½ percent of GDP".
- pensions paid €11.13bn = **10.6% of GDP** — reconciles with НОИ's 10.4–10.5%.

If a future ingest breaks these two reconciliations, the parse is wrong. Assert them.

**Two tiers of "state transfer", never conflated.** НОИ's and the IMF's headline "5.3–5.5% of
GDP" is the narrower *недостиг* (shortfall) line. Our €5.89bn is *total* transfers, which also
funds non-contributory pensions and чл. 230/231 obligations. Both are defensible; they measure
different things. Present them as two tiers, and never equate our 46.8% with НОИ's 5.3%.

**Distribution before average.** Histogram with the minimum-pension spike, the poverty
line shaded, and the 4 598-person pile-up at the cap marked. Ridgeline across years to
show the floor spike growing.

**Named scenarios, not a fan chart — but НОИ has no macro scenarios to name.** A 45-year
pension projection's uncertainty is structural and political, not statistical, so a smooth
probability fan would dress policy choices as noise. However (§3.3): АД2024 ships **one
deterministic baseline**, not a COR-style macro fan. Its only alternatives are two *policy*
scenarios — contributions +5pp phased to 2045, and CPI-only indexation. So the projection
tile shows: one baseline line, plus those two policy variants, plus the **EC Ageing Report's
independent path** as a second opinion (which runs ~1pp lower — §3.3). Do not invent macro
scenarios НОИ did not publish, and do not draw a fan.

**Choropleth of a ratio, never a count.** A map of "number of pensioners" is a
population map. Map pension ÷ local wage, diverging around the national average, with a
hexbin toggle (28 oblasts is an ideal hexmap size, and it stops Sofia from vanishing).
Always pair with a sorted bar chart — the map shows *where*, the bar shows *rank*.

**Theme-token chart palette.** Colour-blind-safe; desaturate for dark mode rather than
inverting saturated fills. Wire to the existing HSL CSS variables.

**Cede personalization.** No personal pension statement. If we ship a calculator it is a
rules-only *what-if* estimator with an explicit 3-scenario band, all client-side, stated
plainly — never a lookup of anyone's real record.

---

## 7. Phasing

Placement, settled: **additive and cross-linked.** The four procurement tiles stay at
`/awarder/121082521` untouched, keeping their "contracts at the scale of the fund"
framing. `/pensions` is a new top-level view. Each links to the other.

### Phase 1 — ingest (no user-visible change)

Switch off the PDF path for 2022+; add the ZIP/XLSX path.

- `scripts/budget/noi/parse_yearbook_xlsx.ts` — chapters 1, 5, 7, 9 (then 3, 4).
- `scripts/budget/noi/parse_statb_xls.ts` — quarterly oblast + bracket sheets.
- egov org-123 ingest for the six oblast series.
- **Storage: static JSON, not Postgres.** `noi_pensions_oblast` (28 × types × years),
  `noi_pension_brackets` (17 × type/sex × years) and the national long series are all
  small, static, and consumed *whole* — a choropleth wants every oblast, and the reform
  sandbox recomputes the bracket population on every slider drag, which must be local
  rather than an API call per keystroke. Nothing to filter, sort or paginate.
  Same test that keeps `funds.json` on disk (§4.1). Register in `data_map.json` /
  `data-changes.json` as usual.
  **Exception: КФН (Phase 3) does belong in PG** — per fund × per company × quarterly,
  unbounded growth, and the natural UX is a sortable/filterable fund comparison. That is
  a `DbDataTable` registry entry, not a new endpoint. Wire it into `recent_updates` via
  `recordIngestBatch` (in-txn, stable natural key).
- **Parse B1 sections III + IV** and split §I into contributions vs other revenue (§4.4b).
  Assert `I − II + III − IV == V`. This unblocks the honest headline and fixes a live
  overstatement on `/awarder/121082521`.
- Delete the hand-typed `NOI_PENSIONERS_BY_YEAR = { 2024: 2_060_000 }` in
  `src/lib/noiBenchmarks.ts:31`. The real figure — **2 052 553** — is in CHAPT#5.
- Fix `policy_baseline_local.ts:28-29` — it hard-codes `STATB_QUARTER=1, STATB_YEAR=2026`.
- Add the Eurostat poverty threshold (`ilc_li01`, §4.3) via `update-macro`.
- ~~Add oblast average wage (NSI) to `regional.json` via `update-macro`.~~ **Blocked — see
  §4.3 RED.** Decide between the NSI topic-179 parser, GDP-per-capita as denominator, or
  shipping the un-normalised map first.

Parser requirements (all verified in §4.3 — none are optional):
- **Sniff `PK` magic bytes.** 2021/2025 yearbook URLs return an HTML 404 with HTTP 200.
- **Normalise sheet names** (strip `-YYYY`, all whitespace, trailing dot) before matching.
- **Anchor on header text, never row index** — 2023 shifts every table by one row.
- **Read bracket edges from the sheet**, never hardcode; the topology changed in 2024.
  Handle comma decimals (2022) and dot (2023+).
- **Exclude memo rows** (no numeric ordinal in column A) or you double-count.
- **Validation gate:** rows with a numeric ordinal in column A must sum *exactly* to the
  `Общо` headline. Holds for 2022/2023/2024. Fail the ingest if it doesn't.
- Counts live in column **C**. Values are in **лева** — convert at ingest (1 EUR = 1.95583).
- Identify the non-oblast 29th row by **ordinal**, not name (three different names exist).
- Chapters 3 and 9 are `.xlsm` in 2023/24; all of 2022 is legacy `.xls`.
- **Reconciliation asserts:** transfer ≈ 5.6% of GDP, pensions ≈ 10.6% of GDP (§6).
- The quarterly bulletin is a **separate parser** (Latin sheet codes, per-quarter names).

Repo integration (from the readiness audit — ordering matters):
- A new watcher source **must** be placed in `scripts/data_map/model.ts` (source group →
  dataset → feature → edges) in the same commit, or `prebuild` fails with
  `watcher source(s) not placed on the data map` (`build_manifest.ts:210`).
- Nav: add a leaf to `governanceMenu` (`src/layout/header/reportMenus.ts`) **and**
  `/pensions` to `GOVERNANCE_PREFIXES` (`Header.tsx:56`), so the Управление pill tints.
- i18n keys go in **both** `src/locales/{en,bg}/translation.json`. There is **no missing-key
  gate** — a missing key silently renders as the raw key.
- Prerender (`scripts/prerender/routes.ts`) and sitemap (`scripts/sitemap/route_defs.ts`)
  must be edited **together**; every sitemap `<loc>` needs a real `dist/<path>/index.html`.
  A dashboard + browse page ≈ 4 files — nowhere near the Firebase ceiling. Per-fund pages
  would be.
- Ship data with `bucket:sync:paths -- pensions` (seconds) then `bucket:gz` — **in that
  order**, since rsync clobbers the gzip.
- `EXPLAIN ANALYZE` every new query on the worst-case entity before shipping.

### Phase 2 — the view

`/pensions`, dashboard-tile shell (homepage shell, no `max-w-5xl` cap), tiles not tabs:

1. **Hero — who pays for pensions.** Waterfall + the 46.8% / €239-per-month reframe (§6).
2. **The distribution.** Histogram, floor spike (39.6% at or below the minimum), cap wall
   (4 598 exactly at 3 400 лв, 7 above), poverty line at 764 лв (Eurostat `ilc_li01`).
3. **The map.** Average pension by oblast (sheet 9.8) — **un-normalised in v1** unless the
   wage denominator is unblocked (§4.3). Hexbin toggle; sorted-bar pair; exclude row 29;
   mind the SOF/SFO trap.
4. **Ageing.** Population pyramid (Eurostat `demo_r_pjanaggr3`, NUTS3, to 2025) with a
   ghost-outline reference year. **Two separate, separately-labelled numbers:** a national
   "insured per pensioner" ticker (the real system dependency ratio, 68.2%), and per-oblast
   **demographic** old-age dependency. Never one label for both (§4.3 RED).
5. **The cash map.** Share of pensions collected in cash, by oblast — 29.0% nationally,
   Смолян 39.9% → София-град 17.6%, and falling (32.4% → 30.7% → 29.0%). Nobody publishes
   this. Links to the Български пощи чл. 92б mandate (§8).
6. **The long series.** Avg wage vs avg insurable income vs avg pension (all national —
   CHAPT#1), with reform and indexation events annotated from the parametric history (§3.6).
7. **Peers.** BG vs RO/GR/HU/HR on replacement ratio, gender pension gap, 65+ poverty —
   reuses `/indicators/compare` peer machinery.
8. **The projection.** НОИ baseline + its two policy scenarios + the EC's independent path
   (§3.3). Date-stamped; cadence is irregular.

Plus AI tools to close the 1-vs-4 gap: `noiPensionDistribution`, `noiPensionByOblast`,
`noiPensionSeries`, `kfnFunds`.

### Phase 3 — pillars 2 & 3

КФН quarterly ingest → per-company net assets, insured, returns, fees. Cross-link
`/pensions` → `/company/:eik` for the ПОД holdings via the existing connections graph.

### Phase 4 — the flagship: reform sandbox

CRFB "Reformer" pattern. Sliders: retirement age, contribution rate, Swiss-rule
indexation blend, minimum pension, cap (таван). Live scoreboard: **% of the ДОО deficit
closed**, and the state transfer as % of GDP.

What makes it credible rather than a toy (all four are required):

- a **stated goal** with a progress meter, not free-floating sliders;
- **distributional readout** — who bears it, by pension bracket, using the CHAPT#5
  distribution as the population;
- **constraint flags** (e.g. raising the minimum above the cap; a retirement age beyond
  local life expectancy);
- **exposed assumptions**, each lever linking to its elasticity and source.

Reuse `scorePensionIndexation`, `scorePensionFloorRaise`, `scoreWageIndexation` and
`policy_baseline.json`. This is surfacing existing machinery, not building an engine.

### Phase 5 — the chapter Bulgaria never got

Rules-engine on synthetic biographies, OECD *Pensions at a Glance* methodology:
replacement rates for a low (0.5×), median (1×) and high (2×) earner; career variants
(10-year care break, minimum-wage career, informal gap, work-two-years-longer). Then the
interactive actuarial projection (§3.3) as named scenarios.

---

## 8. Hardening the procurement pack (`/awarder/121082521`)

Separate track from the `/pensions` view. The view is a new destination; this is about
making the existing four-tile sector pack world-class in its own right. Both can proceed
independently. Grounded in a cross-pack code audit + a benchmark of Tussell, USASpending,
OpenTender/DIGIWHIST, the EU Single Market Scoreboard, SIGMA (МИДТ) and GovSpend.

### 8.1 Where the pack stands

NOI is the **thinnest of our four packs** — 4 tiles, and the only pack with **zero charts
and zero interactive controls**. NZOK (~11 tiles) is the in-house reference; VSS (2, by
design — the rich views live on `/judiciary`) and Roads (11, bespoke geometry) bracket it.

| Capability | NOI | NZOK | VSS | Roads |
|---|:--:|:--:|:--:|:--:|
| Year picker | ○ | ● | ● | ○ |
| Trend chart | ○ | ● | ○ | ● |
| Momentum / YoY movers | ○ | ● | ○ | ○ |
| Execution-pace (plan vs actual) | ○ | ● | ○ | ○ |
| Per-entity drill-down | ◐ | ● | ◐ | ◐ |
| Regional choropleth | ○ | ● | ○ | ◐ |
| €↔count / metric toggle | ○ | ● | ○ | ● |
| Budget↔execution bridge | ◐ | ● | ● | ○ |
| Single-bid / competition | ● | ● | ● | ● |
| Statutory-context chips | **● (origin)** | ● | ● | ○ |
| AI tools | **1** | 4 | 4 | 1 |

NOI is also the **origin** of the statutory-context chip pattern (NZOK and VSS copied it),
and it owns the one thing no competitor has (§8.4). Its gap is maturity, not identity.

### 8.2 What competitors validate — two things nobody else does

The web benchmark's decisive findings:

- **Fusing procurement with the fund the body administers is genuinely novel.** USASpending
  shows "account spending" and "award spending" as adjacent lenses but never as one ratio;
  OpenTender and SIGMA have **no budget layer at all**; Bloomberg Gov keeps budget as
  narrative. Our `NoiFundFlowTile` — €110m of contracts as a sliver of the €12.6bn ДОО
  fund — has no equivalent anywhere. **This is the strongest asset in the pack; lead with
  it, don't bury it.**
- **Statutory-context flags are a market gap.** OpenTender, SIGMA and DG GROW all score a
  legally-mandated sole supplier identically to a rigged one. Our Български пощи /
  Информационно обслужване chips (§ the chip fix already shipped) already do the thing every
  serious tool gets wrong. Own it explicitly — "we don't cry scandal at the law."

SIGMA (our named competitor) is, by its own README, a *ledger* — clean traceability, daily
freshness, CSV export, but **no risk layer, no time trend, no concentration metric, no
competition analysis, no budget context**. That gap is our whole opening.

### 8.3 What to build — ranked by value × portability

**The generic-vs-pack boundary is a hard constraint.** The awarder page already renders,
for every buyer: the KPI grid, top contracts / contractors, "какво купува" by CPV, the
EU-threshold single-bid/no-call benchmarks, money-flow, the supplier treemap, **and a
per-year bar chart** (`CompanyByYearChart` on `awarderRollup.byYear`), tenders and КЗК
appeals. The pack must add domain-unique framing only — anything that duplicates a generic
tile is cut. This kills the naive "add a trend chart" idea (§ below).

**Ship now — UI only, no ingest, no engine change:**

1. **`€ ↔ брой` (value↔count) toggle** on `NoiCategoryTile` and `NoiStrategicSuppliersTile`.
   The model already carries both. OpenTender's count-vs-value toggle is the reference; NZOK
   already does it (`NzokHospitalPaymentsTile`). A ranking that flips basis is the single
   cheapest credibility win.
2. **Pareto concentration curve** on the suppliers tile — sorted supplier bars + a cumulative
   `%` line, annotating where the top-N crosses 50% / 80%. Today the tile shows only a
   "top-8 share" number. Pareto is the honest concentration viz (bars rank; a pie does not).
   Optionally an **HHI badge** with DOJ bands as a *secondary* flag, never the headline.
3. **Extract two shared primitives first** (they don't exist yet — each is hand-rolled in all
   four packs): `<InsightChips>` (the `{text, warn}` chip row) and `<PillToggle>` (the
   `role="group"` + `aria-pressed` button set behind every NZOK picker/toggle). Building #1
   and #2 on these keeps the fifth pack from forking a sixth variant, exactly as
   `chipStyles.ts` already single-sources the amber.

**Small engine extension — medium effort, no ingest:**

4. **Procurement momentum / YoY movers** among NOI's suppliers, mirroring
   `NzokHospitalMomentumTile` (mover ranking with a base-value floor so a €0→€1k jump isn't
   "+∞%"). The corpus is genuinely multi-year (`buildAwarderModel` emits `model.years[]`,
   2005→2024), but it only breaks down by *category*, not per-supplier×year — so this needs a
   small `awarderModel` addition. Temper the value estimate: NOI's supplier set is small and
   structural (Български пощи, Информационно обслужване), so movers say less here than across
   NZOK's 256 hospitals. Worth it mainly as the vehicle for #5.
5. **Integrity-indicator row** (OpenTender/DIGIWHIST model) — score each contract 0/50/100 on
   a few flags (single-bid, direct-award procedure, short/long decision period, new-company
   winner), average to a per-buyer read, and show which flag drags NOI down — **with the
   statutory exemption applied**, so a чл.92б/ЗЕУ supplier scores green with a citation. This
   is where §8.2's two differentiators combine into something genuinely best-in-world. Reuses
   the canonical `isSingleBid` / `competitionStats` in `awarderModel.ts`. Present single-bid
   **always against the national-average band** (frameworks excluded), never bare — the DG
   GROW rule.

**Blocked on ingest — the real prize, needs Phase 1 first:**

6. **Execution-pace curve** (plan vs actual), NOI's equivalent of NZOK's flagship
   `NzokExecutionPaceChart`. Blocked twice: `__write_funds.ts` collapses the monthly B1 to an
   annual snapshot (the parser reads monthly — retain it), and there is no ЗБДОО plan line
   ingested. Ship the graceful-degradation pattern NZOK uses: a plan-vs-actual line when ≥2
   months exist, a single YTD gauge otherwise.
7. **Fund-year picker** on the fund-flow tile — blocked until ≥2 *complete* B1 years exist
   (today only 2024 is usable; the picker would auto-hide). Falls out of the §3 ingest for
   free.
8. **Regional dimension** — pensioners / average pension by ТП on the same `FeatureMap` +
   per-capita-toggle recipe NZOK uses, once §3's oblast ingest lands. This is the bridge
   between the pack and the `/pensions` view — the pack can cross-link into the view's map.

Explicitly **skipped**: head-to-head compare (NZOK compares 256 hospitals; NOI has a handful
of statutory suppliers — no value), and a plain annual trend chart (**collides** with the
generic `CompanyByYearChart`; only a monthly or per-category-stacked or movers grain earns a
pack chart).

### 8.4 What "best in the world" means for this pack

Not more tiles — SIGMA has more rows than us and is still a ledger. It means the three
things no competitor combines on one entity page:

1. **The fund-fusion ratio** as the hero (unique).
2. **Risk framing with a statutory exemption** — the honest version of the integrity score
   every benchmarked tool gets wrong (unique).
3. **Cross-linked to the connections graph** — the FollowTheMoney-style relationship view
   (Aleph/OpenCorporates have the graph but no spend/budget analytics; we have both).

### 8.5 Anti-patterns to avoid (observed in the benchmark)

- No sunburst / nested-donut (USASpending abandoned it for a treemap).
- No pie for top-N suppliers — angles don't rank; use bars / Pareto.
- No bare gauges or vanity KPIs — every number gets a band, a peer, or a "% of fund".
- No auto-expanded network hairball — expand-on-click, typed edges only.
- No 200-node Sankey — keep money-flow pairwise / top-N (as the generic `EntityFlowTile`
  already does).

---

## 9. Open questions

- **Yearbook backfill depth.** XLSX only reaches 2022. Is the existing PDF parser worth
  extending to 2014–2021 for the oblast + bracket series, or is 2022+ enough for v1?
- **Municipal grain does not exist.** Finest published pension grain anywhere is oblast
  (28 ТП). Do not promise a municipality pension map. Old-age *dependency* can go to
  municipality via census `age65plus`; average pension cannot.
- **Actuarial report cadence** (~every 3 years) means the projection tiles will visibly
  age. Date-stamp them prominently.
- ~~Български пощи' pension-delivery mandate expired 1 July 2026.~~ **Investigated and
  false — the code comment was wrong.** ПМС № 199/6.06.2024 (ДВ бр. 49, 11.06.2024,
  стр. 11) amended НПОС чл. 92б, "за срок 10 години" → "за срок 15 години". The
  entrustment runs to **1 July 2031**, and the €15M/yr compensation cap was replaced
  with full compensation under state-aid rules. `noiBenchmarks.ts` corrected.

  Two things that surfaced from that check and belong in the view:

  - **Pension delivery is invisible to procurement.** It is an SGEI entrusted by
    regulation, not a ЗОП contract, so it never enters the АОП/ЦАИС ЕОП register. The
    six НОИ → Български пощи contracts we hold (€7.09m, 2017–2024) are CPV 64110000
    **postal and courier services** for the ЦУ and 28 ТП — ordinary mail. The
    compensation for handing ~600k pensioners their pension in cash — historically
    capped at €15M/yr, now uncapped — appears nowhere in our corpus. A procurement-only
    view of НОИ therefore *systematically understates* what Български пощи is paid.
  - **Yearbook table 9.11 answers the cash-vs-bank question**, per oblast, which no
    news source seems able to cite. 2024: of 2 063 480 pensions, 1 464 421 go to a bank
    account — so **599 059 (29.0%) are collected in cash**. Range across oblasts:
    Смолян 39.9%, Благоевград 39.8%, Търговище 36.7%, Видин 35.6% → София-град 17.6%.
    (Exclude the ЕРМД / Турция rows.) This is a strong tile: the geography of
    financial exclusion among pensioners, and the actual stake of the postal mandate.

## 10. Sources

- НОИ statistics index — https://nssi.bg/publikacii/statistika/
- Yearbook ZIP — https://www.nssi.bg/wp-content/uploads/Yearbook_Pensions_2024.zip
- Quarterly bulletin — https://www.nssi.bg/wp-content/uploads/STATB{Q}{YYYY}.xls
- Actuarial report — https://www.noi.bg/wp-content/uploads/ActuarialReport_2024.PDF
- Release calendar — https://www.noi.bg/wp-content/uploads/Calendar_stats_NOI_2025_topics.pdf
- data.egov.bg org 123 — https://data.egov.bg/data?org%5B0%5D=123
- КФН — https://www.fsc.bg/en/social-insurance-activity/statistics/
- КСО — https://lex.bg/laws/ldoc/1597824512
- EC 2024 Ageing Report (BG fiche) — economy-finance.ec.europa.eu
- IMF, *Bulgaria: Caught Between Adequacy and Sustainability* (SIP, 2024)
- CRFB Social Security Reformer — https://www.crfb.org/socialsecurityreformer/
- OBR on presenting uncertainty — https://obr.uk/box/psnb-fan-charts/
- INPS Osservatori (per-territory pension geography) — https://www.inps.it/osservatoristatistici
- DRV Rentenatlas (the "atlas" packaging idea) — deutsche-rentenversicherung.de
