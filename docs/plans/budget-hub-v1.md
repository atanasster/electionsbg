# /budget as a dashboard hub — v1

**Status:** proposed, 2026-08-12. **Revised 2026-08-13** — `municipal-fiscal-commitments-v1`
shipped in full (steps 1–15) between the two dates, which moves the migration numbers, rewrites
§8 and sharpens §7.1. Every change is marked **[2026-08-13]**.
**Pattern:** `.claude/skills/dashboard-hub`. Reference implementations: `/parliament` (the shape),
`/funds` (the PG-backed stat call).
**Related:** [funds-hub-v1.md](funds-hub-v1.md), [parliament-hub-v1.md](parliament-hub-v1.md),
[budget-package-2026-ingest-v1.md](budget-package-2026-ingest-v1.md),
[hub-search-v1.md](hub-search-v1.md).
**Must be read before T2 and T6:**
[municipal-fiscal-commitments-v1.md](municipal-fiscal-commitments-v1.md) — **shipped**, it owns
migration 149, the four `/api/db/municipal-fiscal*` routes, `/governance/municipal-finance` and
the choropleth. §8 is written to sit beside it, not to re-derive it.

---

## 1. Why

### 1.1 Measured, dev server, `/budget` — re-measured 2026-08-13, unchanged

**Two numbers, and they answer different questions.** The distinction matters because the tiles
below the fold fetch lazily, so a „page weight" figure is ambiguous until the scroll state is
declared — exactly the kind of undeclared basis §2 exists to prevent.

| | eager (above the fold) | full scroll |
|---|---|---|
| JSON fetched, budget-owned | **1 202 KB across 4 requests** | **1 752 KB across 16 requests** |
| page height | — | **25 215 px**, about twenty-five screens |

The eager four are `macro_peers.json` (794 KB), `kfp.json` (347), `documents.json` (48),
`index.json` (13). **`macro_peers.json` alone is 66% of the eager payload, and the screen reads
three scalars out of it** (`distribution.TR`, `.TE`, `.B9`). `kfp.json` carries six year
snapshots and one is ever rendered.

`BudgetScreen.tsx` is **520 lines**, 13 analysis tiles rendered inline.

For scale: `/parliament` before its conversion pulled 1.65 MB, `/funds` pulled 390 KB. **`/budget`
is the worst front page in the repo** on either measure, and the 794 KB : 3 scalars ratio is worse
than anything either of those had.

**[2026-08-13]** Re-measured after `2762db9d50` (the locale-bundle work, which ratcheted two
brotli budgets down): both figures are unchanged. That commit moved the app shell, not the
module's own fetches.

Full request list, decoded bytes:

```
macro_peers.json                794 KB   ← 3 scalars
budget/kfp.json                 347 KB   ← 300 observations + 6 fat snapshots; 1 snapshot rendered
budget/personnel.json           137 KB
reconciliation/2025/by-admin     64 KB
reconciliation/2026/program      64 KB
reconciliation/2024/by-admin     58 KB
reconciliation/2026/by-program   55 KB
cofog.json                       49 KB
budget/documents.json            48 KB
reconciliation/2026/by-admin     47 KB
investment_program/2025.json     37 KB
budget/noi/funds.json            20 KB
derived/ministry_procurement     14 KB
budget/index.json                13 KB
budget/noi/fund_plan.json         4 KB
investment_program/index.json     0 KB
```

Reproduce via `performance.getEntriesByType('resource')` on `/budget` — the exact expression is
in T0.1. **Measure the eager set before scrolling**, then scroll to the bottom and measure again;
one call after a `scrollTo` gives only the second number and reads as the whole story.

### 1.2 The discovery half

`/budget` is one of the zero-impression prefixes from the discovery-gap work, and the structural
reason is visible in the routing:

- **Six routed pages exist** under `/budget`: the hub, `methodology`, `tax-calculator`, `mod`,
  `simulator`, `ministry/:id`. Five are prerendered from `routes.ts`; the 55 ministry pages are
  prerendered from `dynamicRoutes.ts:3412` and carry 110 sitemap `<loc>`s (BG + EN).
- **There is no picker for them.** `/budget/ministries` does not exist. Grepped: the only
  producers of a `/budget/ministry/…` href are `BudgetMinistriesTile`, `BudgetTopDeviationsTile`
  and `BudgetMinistryScreen`'s own siblings list — the first two sit ~15 000 px down the hub.

**The budget module has 110 ministry `<loc>`s (55 × BG+EN) plus its six routed pages, and one
entry point — and the entry point is a 25 000 px scroll.** That is the discovery gap in one
sentence, and the skill §4 names the fix: *seeded destinations are a smell — prefer a picker.*

*(An earlier draft totalled these as „116 indexable URLs". That mixes two bases in one number —
it counts the ministry pages bilingually and the routed pages monolingually. In a plan whose §2
is entirely about declared denominators, the fix is to state the two counts rather than add
them.)*

### 1.3 The data half

**[2026-08-13]** There are **zero *state*-budget tables in Postgres**. One municipal corpus now
has them — `municipal_fiscal` (migration 149, shipped; §8.0) — but it is the ЗПФ чл. 130а
liability stocks, a different corpus from anything `/budget` renders. Everything the module
actually serves is still files. On disk:

```
data/budget/nzok                 17 MB   (served by the NZOK pack, not by /budget)
data/budget/capital_programs    8.8 MB   ← rendered ONLY on /governance place dashboards
data/budget/ipop                2.9 MB   ← rendered ONLY on /governance place dashboards
data/budget/municipal_transfers 2.5 MB   ← rendered ONLY on /governance place dashboards
data/budget/facts               1.7 MB   ⚠ GITIGNORED — bucket-shipped only
data/budget/reconciliation      1.2 MB   ⚠ GITIGNORED — bucket-shipped only
data/budget/ministries          692 KB   ⚠ GITIGNORED — bucket-shipped only
data/budget/classification      412 KB
data/budget/kfp.json            348 KB
data/budget/municipal_execution 212 KB   ← rendered ONLY on /governance place dashboards
data/budget/noi                 192 KB
```

**[2026-08-13] Those three ⚠ trees are on disk and not in git** — `.gitignore` excludes them
beside each other as „bulky regenerable shards", and measured, `git ls-files` returns 0 for
`reconciliation/` and `ministries/` against 24 and 55 files locally. Everything else the module
reads is committed (`index.json`, `kfp.json`, `documents.json`, `personnel.json`,
`classification/`, `cofog.json`, `investment_program/`).

That is a constraint on T0, T1 and every gate downstream, not a footnote: **CI and a fresh clone
cannot see the admin or program grain at all.** So the ledger reports those figures as *not
derivable* rather than omitting them (T0.2), the loader skips-and-warns rather than throwing
(T1), and `budget_pg_roundtrip.data.test.ts` must **skip loudly with the reason printed** when
the shards are absent — never silently compare an empty Postgres against an empty shard set and
report a lossless capture.

**The municipal tier — 14.4 MB, the largest half of the module — has no path from `/budget` at
all.** A reader who wants their town's budget must already know to go to `/governance/:place`.

---

## 2. What I measured before designing anything (skill §0)

Every figure a tile may display, with its denominator and the other defensible answers. **Nothing
here is a design decision; it is the ledger the tiles must be written against.**

### 2.1 The bases that differ

| Question | Answers that are all true | The one to use |
|---|---|---|
| "how far back does the budget go" | КФП observations **2021-06 → 2026-06** (60 periods × 5 series = 300 rows); document/law index **2018 → 2026**; admin reconciliation **2018 → 2026** | State the series. „КФП от 2021" and „закони от 2018" are different sentences |
| "how many ministries" | `by-admin` **rows** 2026 = 85; **distinct nodeIds** 2026 = 44; 2025 = 47; **files on disk** = 55 (the union across years) | Distinct `nodeId` **for the selected FY**. The row count is (node × kind) and is ~2× |
| "how much did the state spend" | FY2025 executed €28.38bn; FY2025 planned; FY2026 planned-only | Executed for a complete year, projected for the current one, and say which — `seriesView()` already models this |
| "what share of GDP" | balance/GDP vs expenditure/GDP; `gdpEur` is annual, against a possibly partial-year cumulative | Only on a complete year or a projection; never on `actualSoFar` |
| "per resident" | ГРАО **permanent** address vs ГРАО **current** address (`grao_population.json` carries both, as of 2026-06-15) vs census 2021 (149's `obshtina_population`) vs NSI estimate | See §7.1 — always captioned with its denominator; default only for a RANKING, never for a ramp |

### 2.2 Five traps specific to this corpus

**`monthsAvailable` is the count of captured monthly observations, NOT the months of the fiscal
year the figure covers.** FY2021 carries `monthsAvailable: 6, firstPeriod: "2021-06"` and
`complete: true` — because the КФП feed is **cumulative year-to-date**, so its 2021-12-31 row is
the whole year even though only six monthly snapshots were captured. A tile rendering „2021 — 6
месеца данни" would be false about a complete year. This is the skill's headline class: correct
arithmetic, false sentence.

**КФП lines are cumulative, so periods must never be summed.** A „total across the term" figure
built by adding monthly observations double-counts by roughly `n(n+1)/2`. Take the December (or
latest) cumulative per fiscal year and add those.

**Currency flipped mid-corpus.** Pre-2026 laws are denominated in BGN, FY2026 in EUR
(`b6bf2e75ae`, `52d55f71cd`). Every stored figure carries `{amount, amountEur, currency}`. **Only
`amountEur` may reach a tile**, and the PG schema below stores euros only, with the source
denomination as a separate column, so a later reader cannot pick the wrong one.

**Three bases exist per admin row — `planned`, `amended`, `executed` — and a variance needs two of
them named.** `variancePct` in the shards is executed-vs-plan; `amendmentTrail` is a third story.
„Отклонение" with no basis is ambiguous between „a ministry overspent its law" and „parliament
re-voted the law". §7.3 turns that ambiguity into a feature.

**[2026-08-13] A WITHHELD figure is not a zero, and this corpus family has already produced one.**
`municipal_fiscal` 2025-Q3 suppressed `commitments_eur` for all 265 municipalities — МФ froze the
column and the ingest withheld it rather than carrying it forward. A NULL there reads as „nothing
contracted", which is the opposite of the truth, so `municipal_fiscal_by_obshtina()` picks the
newest row that actually **has** the headline figure and only then falls back to the newest row of
any kind.

The КФП feed can freeze a line the same way. Every serving function in §6.2 that resolves a
„latest" figure needs the same two-tier pick, and every renderer needs „не е публикувано" as a
state distinct from „0". This is the skill's *undeclared „not derivable"* trap with a live
precedent in the neighbouring corpus — copy the resolution rather than rediscovering it.

### 2.3 The coverage finding that constrains two pages

Executed figures on the admin-grain reconciliation, per year — **[2026-08-13] re-derived by
`scripts/budget/hub_ledger.ts` (T0.3), which corrected the v1 draft's unit**:

| FY | spending units | rows | **units** carrying `executed` | rows carrying `executed` |
|---|---|---|---|---|
| 2018 | 45 | 85 | **0** | 0 |
| 2019 | 42 | 114 | **0** | 0 |
| 2020 | 42 | 123 | **0** | 0 |
| 2021 | 42 | 79 | **0** | 0 |
| 2022 | 45 | 83 | **1** | 2 |
| 2023 | 46 | 88 | **6** | 9 |
| 2024 | 48 | 97 | **8** | 14 |
| 2025 | 47 | 119 | **0** | 0 |
| 2026 | 44 | 85 | **0** | 0 |

`BudgetTopDeviationsTile` („Най-големи отклонения от плана") therefore ranks over **8 of 48
spending units in its best year, and none at all in six of nine years**. The figure is not wrong;
the impression that it ranks the government's ministries is.

**[2026-08-13] The v1 draft of this section said „14 of 97 spending units" and that was the
plan committing its own §2.1 error** — 14 and 97 are ROW counts, and rows are (nodeId × kind).
The units are 8 and 48. Worth leaving on the record: the ledger script T0.2 exists precisely to
catch this class, and the first thing it did on being run was catch it here.

This is skill §11 territory — *a hub surfaces a data layer, it does not repair one*. Two binding
consequences:

1. **`/budget/deviations` leads with the coverage, not the ranking**: „8 от 48 разпоредители са
   публикували отчет за 2024". A top-5 without that line asserts something the corpus cannot
   support.
2. The gap is an **ingest** problem (`scripts/budget/doklad.ts` / the `minfin_program_otchet`
   parser reaches few report layouts), not a hub problem. It is a **parallel track**, not a tier.
   Do not let a hub change paper over it.

### 2.4 The document corpus, counted

`documents.json` holds 48 records: **execution-report 30, law 9, amendment 2, audit-report 2,
fund-law 2, interim-law 2, kfp-feed 1.** Stages per year run `law` (2018-2020) →
`law + execution` (2021, 2025, 2026) → `law + amendment + execution` (2022-2024).

Two things follow, and §7.4 builds on both: **only two amendment documents exist**, so a
document-level version diff is thin — but `budget_admin_fact` carries `planned` / `amended` /
`executed` **per row**, which is the same story at a far better grain.

---

## 3. Competitive research

Eight sources examined; five contribute. Ignored: the municipal-SaaS tier (ClearGov, OpenGov,
Questica, Euna) — budgeting products for a finance department, not public analysis surfaces.

| Source | The transferable idea | Folded in as |
|---|---|---|
| **[USAspending Spending Explorer](https://www.usaspending.gov/explorer)** | Pick ONE starting dimension (agency / budget function / object class), then drill through a **persistent breadcrumb**, each level showing its own total and its share of the parent. The dimension choice is the first question, not a tab. | **§7.2 — `/budget/explorer`** |
| **[US Treasury, Your Guide to America's Finances](https://fiscaldata.treasury.gov/americas-finance-guide/)** | Every section answers the same four questions in the same order: **the source of funds, where the money goes, the trend over time, and how the country compares internationally.** A template, not fourteen bespoke pages. | **§7.1 — the four-part page spine + the basis control** |
| **[World Bank BOOST Open Budget Portal](https://www.worldbank.org/en/programs/boost-portal/boost-data-lab)** | One **variable indicator** control renders the same figure as absolute money, % of GDP, % of total spending, or per capita — and the same control works at subnational grain, which is what makes peer benchmarking possible. | **§7.1 — the basis control**; **§8.3 — municipal peers** |
| **[Ukraine E-Data / spending.gov.ua](https://ukraine.ua/e-data-ukrainian-transparency-platform-for-national-spending/)** | 262M transaction records, and the front page's move is **„the five largest payments the Treasury made recently"** — a wire, not a dashboard. | **§6.3 — the wire's shape and its `source` discriminator**, so the deferred СЕБРА arm (§3.2) is a union member later rather than a rewrite |
| **[OGP / IBP open budgets](https://www.opengovpartnership.org/open-gov-guide/fiscal-openness-open-budgets/)** — the eight key budget documents | A **scoring frame**: pre-budget statement, executive's proposal, enacted budget, **citizens budget**, in-year reports, mid-year review, year-end report, audit report. | **§7.4 — `/budget/law`**, and see §3.1 |
| [IFS](https://ifs.org.uk/be-chancellor) "Be the Chancellor" | A scenario tool. | Already shipped as `/budget/simulator`; the hub links it, nothing new |
| [Taxpayer receipt](https://en.wikipedia.org/wiki/Taxpayer_receipt) — US 2012 act, [ATO](https://ato.gov.au/taxreceipt), [National Priorities Project](https://www.nationalpriorities.org/) | A **personal** receipt, not a per-€100 average. Research finds it measurably lowers polarisation on tax questions. | **§7.5 — the hub's LeadCard** |
| [My Parliament bill comparison](https://myparliament.ca/tools/billcomparison), [transparency.gov.au](https://blog-pfm.imf.org/en/pfmblog/2021/02/australias-new-online-transparency-portal) | Version-to-version diff of a legislative text. | **§7.3 — план → изменен план → отчет**, at row grain rather than document grain (§2.4) |

### 3.1 The competitive position, and the one document Bulgaria does not publish

Bulgaria's own state platform, **[СИГМА](https://sigma.midt.bg/)** (МИДТ, 193k contracts /
€51bn), covers **procurement only** — a re-skin over the АОП/ЦАИС registers this repo already
holds (`reference_sigma_platform`). **minfin.bg** publishes budget execution as PDF/XLSX;
**data.egov.bg** publishes the raw feed. **ИПИ/IME** publishes analysis, not an explorer.

**Nobody in Bulgaria ships a budget-execution explorer.**

And mapping §2.4's counts onto the OGP eight: the enacted budget (`law`), in-year reports
(`kfp-feed`), year-end reports (`execution-report`) and audit reports (`audit-report`) are all
published. The one that is not — in Bulgaria, as in most of the region — is the **„граждански
бюджет" / citizens budget**: a plain-language version of the budget for people who do not read
appropriation tables.

That is what this module is. `/budget/law` should say so plainly, scored against the frame rather
than asserted. It is the only editorial claim in this plan and it is the one that is checkable.

### 3.2 Deferred, on the user's call: СЕБРА

Individual budget payments **≥ BGN 5 000**, per transaction with payee, published on data.egov.bg
per calendar quarter, **back to 2006**, for all budget organisations except salaries and social
contributions. Grepped: **not ingested anywhere in this repo.**

The payment-level counterpart to the procurement corpus — the thing that would let `/company/:eik`
show money the contracts corpus never sees, and would give `/budget` a *daily* cadence instead of
a monthly one. Multi-million rows plus a payee-resolution problem against `tr_companies`, so it
gets **its own plan**.

**What this plan does for it:** the wire is built with a `source` discriminator from the start
(§6.3) and Ukraine's „five largest recent payments" is its intended shape. The slot is reserved
and named; nothing is built.

---

## 4. Target shape

```
Title + description
HubSearch                    ← NEW: ministries, municipalities, budget laws, fiscal years
BudgetWireLine               ← NEW: „КФП към 30.06.2026 · публикуван преди N дни"
FY selector (?fy=)  +  basis control (?basis=)      ← §7.1
4 headline cards             ← stays (revenue / expenditure / EU contribution / balance)
TaxReceiptLead               ← NEW LeadCard, §7.5
────────────────────────────────────────────────────────────────────  the grid
BAND 1  Парите тази година          4 tiles
BAND 2  Кой ги харчи                4 tiles
BAND 3  Отвъд държавния бюджет      3 tiles
BAND 4  Общинските бюджети          3 tiles
SourceFooter
```

4 / 4 / 3 / 3 on a four-column `xl` grid — **no band strands a tile on its own row**. Verify on
the rendered grid, not the array length (skill §3).

The headline cards and the FY selector stay **live above the grid**, for the same reason `/funds`
kept its open-calls pair: they answer the question people arrive with. They become cheap — after
§6 they come from one ~6 KB stat call instead of 1 141 KB of `kfp.json` + `macro_peers.json`.

### 4.1 Band naming

Named for the question each answers, never „Разгледай" / „Още" (skill §3). Each carries a
one-line `descKey` under the heading.

- **„Парите тази година"** — how much came in, how much went out, and where you can follow it.
- **„Кой ги харчи"** — the spending units, the functions, the payroll, the gaps against plan.
- **„Отвъд държавния бюджет"** — public money that is not a state-budget line.
- **„Общинските бюджети"** — what the state sends the 265 municipalities and what they do with it.

Bulgarian is written as Bulgarian, not translated from the English heading
(`feedback_bg_language`). „Накъде отиват парите" (already in use) is right; check each new one
against how the language actually says it, not against its English sibling.

---

## 5. The tiles and their destinations

| today, inline on `/budget` | destination | status |
|---|---|---|
| `BudgetTrendTile` + `BudgetSamePointTile` | **`/budget/execution`** | NEW |
| `BudgetRevenueCompositionTile` | **`/budget/revenue`** | NEW |
| `BudgetExpenditureCompositionTile` | **`/budget/spending`** | NEW |
| `BudgetFlowTile` + its 5 drilldowns | **`/budget/explorer`** | NEW — §7.2 |
| `BudgetMinistriesTile` | **`/budget/ministries`** | NEW — the picker `/budget/ministry/:id` never had |
| `BudgetFunctionalTile` | **`/budget/functional`** | NEW |
| `BudgetPersonnelTile` | **`/budget/personnel`** | NEW |
| `BudgetTopDeviationsTile` | **`/budget/deviations`** | NEW — §2.3 coverage first, §7.3 basis |
| `BudgetSocialFundsTile` | **`/budget/social-funds`** | NEW |
| `BudgetInvestmentProjectsTile` | **`/budget/investments`** | NEW |
| `BudgetJourneyTile` | **`/budget/law`** | NEW — §7.4 |
| `BudgetCitizenViewTile` | — | becomes the **LeadCard** (§7.5), stays live |
| — | **`/budget/municipal`** | NEW — Art. 53 envelope, 265/265 |
| — | **`/budget/municipal/investments`** | NEW — ИПОП, 3 492 projects / 264 municipalities |
| — | **`/budget/municipal/capital`** | NEW — 26 oblast-centre capital programmes |
| `/indicators/budgets` cross-link card | unchanged | stays live below the headline cards |

**Fourteen new pages, fourteen tiles, fourteen distinct accents.**

**[2026-08-13] `TILE_ACCENTS` now carries 21 tokens and every one is in use.** `wine` was minted
in step 15 of the municipal-fiscal work precisely because „the money cluster grew a 21st tile and
the palette had exactly 20". Accents are unique **per page**, not globally, so drawing 14 of the
21 for `/budget` is fine — but a 22nd tile on any single page needs a new token, and
`tileAccents.ts` records the method: judge **hue distance**, not cluster membership (pairs already
shipping sit at Δh 0.2°, so „different cluster" is not separation), and eyeball it on both grounds.
That file also now corrects its own lightness rule — the „~48–58%" band is met by 5 of 21, so it
is a direction, not a spec.

The uniqueness gate (§11) will fire before the set is balanced.

Every new page is **self-contained**: its own `Title`, `GovernanceBreadcrumb`, source footer, and
it owns the fetch its content needs. That ownership is what takes the fetch off the hub.

**No seeded tiles.** Every `to` is static; `/budget/ministry/:id` is reached through the picker.

---

## 6. The data layer — full migration to Postgres

The user's call: state tier and municipal tier both. This is the bulk of the work and it lands
before the hub, because the hub's purpose is to stop fetching files.

Repo rules obeyed: `feedback_no_json_from_pg` (PG is live serving and queryable tables — it does
**not** generate committed JSON), `reference_migrated_family_watch_reload` (a JSON→PG migration
must add its `db:load:*:pg:cloud` to the owning watch skill, or prod goes stale while every local
check stays green), `reference_stage_merge_reload` (a served table is stage-merged, never
TRUNCATE-rebuilt).

**[2026-08-13] Migration numbers: 152–156.** The v1 draft said 150–154 and is superseded — since
then 149 (`municipal_fiscal`), 150 (`mp_tr_roles`) and 151 (`place_mp_companies`) have all landed.
**Next free is 152.** Re-check `ls scripts/db/schema/pg/` before writing: this file has been wrong
about the number twice in two days, which is itself the argument for checking rather than reading.

### 6.1 Tables

**152 — `budget_kfp`**

```
budget_kfp_observation (fiscal_year, period, series, constituent_budget)  PK
    as_of date, cadence text,
    executed_eur double precision, planned_eur double precision,
    source_denomination text,            -- 'BGN' | 'EUR', provenance only, never displayed
    source_ref jsonb
budget_kfp_snapshot_line (fiscal_year, period, section_code, line_ord)    PK
    kind text,                           -- revenue | expenditure | financing | balance
    depth int, is_subtotal bool,
    label_bg, label_en, group_label_bg, group_label_en text,
    executed_eur, planned_eur double precision
budget_fiscal_year (fiscal_year)                                          PK
    as_of date, complete bool, months_available int,
    first_period, last_period text, gdp_eur double precision,
    population int,                      -- NATIONAL only — see the [2026-08-13] note
    population_basis text,               -- 'grao_permanent' | 'grao_current' | 'census2021'
    actual_* / planned_* / projected_* double precision, projection_basis text
```

**[2026-08-13] `population` here is the NATIONAL denominator only.** The per-município one already
exists: `obshtina_population` (obshtina, population, census_year — NSI Census 2021), created by
migration 149 and resolving Sofia's census code `SOF46` through `place_dim.price_code`. Do not
mint a second one; §8.3 reads 149's.

Note 149's own header records why that table is declared **above** the functions that read it: a
`LANGUAGE sql` body is validated at CREATE time, so a function naming a not-yet-created table
raises 42P01 and — `exec()` sending the file as one transaction — rolls the whole migration back
on every database that does not already have it. 152–156 follow the same ordering.

`double precision`, never `numeric` — node-postgres serialises `numeric` as a string and every
money cell renders blank while the number is present in the payload (migrations 120 and 142 both
learned this).

`months_available` keeps its name; its **column comment states §2.2** — captured observations, not
coverage.

`population_basis` is a column rather than a convention because §7.1 makes per-capita a user-
selectable basis, and the three candidate denominators differ materially.

**153 — `budget_admin`**

```
budget_admin_node (node_id)              PK   -- 55 across all years
    name_bg, name_en, kind text, eik text NULL
budget_admin_fact (fiscal_year, node_id, kind, dimension)  PK
    planned_eur, amended_eur, executed_eur,
    variance_eur, variance_pct, completeness text, amendment_trail jsonb
budget_program_fact (fiscal_year, node_id, program_code)   PK
    name_bg, name_en, planned_eur, amended_eur, executed_eur, completeness
budget_personnel (fiscal_year, node_id)  PK
    headcount_planned int, headcount_actual int, payroll_eur double precision
budget_cofog (fiscal_year, cofog_code)   PK
    name_bg, name_en, amount_eur, pct_of_total
budget_document (document_id)            PK
    fiscal_year int NULL, kind text, title_bg, title_en,
    published_on date, dv_issue text, url text,
    obs_category text NULL,              -- §7.4, the eight-document frame
    adopted_by_item_id bigint NULL       -- §7.4, → vote_item (134)
```

`budget_admin_node.eik` is the join that makes a ministry page show its procurement without a name
match (`feedback_name_match_not_identity`); `derived/ministry_procurement.json` already holds that
mapping and moves here.

`adopted_by_item_id` is the cross-module edge — see §7.4. Nullable and **never inferred from a
title regex**: an unresolved link is NULL, not a guess.

**154 — `budget_municipal`** — *what the state SENDS. See §8.1 for the boundary against 149.*

```
budget_muni_transfer (fiscal_year, obshtina)  PK
    basic_eur, delegated_eur, equalizing_eur, capital_eur, winter_eur, total_eur,
    source_article text                       -- 'art53'
budget_muni_capital_project (fiscal_year, muni_slug, project_ord)  PK
    obshtina, name_bg, amount_eur, funding_source text, rayon text NULL
budget_muni_ipop_project (project_id)         PK
    obshtina, fiscal_year, name_bg, agreement_eur, paid_eur, status text, stalled bool
budget_muni_execution (obshtina, fiscal_year, line_code)  PK
    name_bg, planned_eur, executed_eur, kind text
```

`obshtina` joins `place_dim` (117) for every label — the dictionary `/procurement` and `/person`
already use. That makes `db:load:place-dim:pg` a **hard prerequisite**, not a trigger.

**Sofia is `SOF00`**, matching `municipal-fiscal-commitments-v1` T1.7 — a synthetic code with no
`place_dim` row, carrying the whole Stolichna obshtina. Any surface that renders Sofia's 24
districts must say the figure is Stolichna's single row, or a reader concludes the districts were
measured separately.

**[2026-08-13] 154 creates no `municipal_fiscal` table and no `obshtina_population`.** Both are
migration 149's and both are **shipped and loaded**. 154 reads them; §8 says how.

### 6.2 Serving functions and routes — 155

`155_budget_serving.sql`, `CREATE OR REPLACE` only, **no `DROP`** — the 077 lesson: a
loader-applied migration that DROPs an object another migration reads in a stored query aborts the
load (2BP01), and with `CASCADE` it silently deletes the dependent and exits 0.

| function | route | consumer |
|---|---|---|
| `budget_year_summary(fy, basis)` | `/api/db/budget-year` | hub headline cards |
| `budget_series(fy_from, fy_to, series, basis)` | `/api/db/budget-series` | `/budget/execution` |
| `budget_snapshot(fy, kind, basis)` | `/api/db/budget-snapshot` | `/budget/revenue`, `/budget/spending` |
| `budget_explorer(fy, dimension, parent, basis)` | `/api/db/budget-explorer` | `/budget/explorer` — one level per call, which is what makes the breadcrumb cheap |
| `budget_admin_list(fy, q, limit)` | `/api/db/budget-ministries` | picker + HubSearch |
| `budget_admin_detail(node_id, fy)` | `/api/db/budget-ministry` | `/budget/ministry/:id` |
| `budget_cofog_list(fy, basis)` | `/api/db/budget-functional` | `/budget/functional` |
| `budget_variance(fy, limit)` | `/api/db/budget-variance` | `/budget/deviations` — **returns the coverage pair with every ranking** |
| `budget_documents(fy)` | `/api/db/budget-law` | `/budget/law` |
| `budget_muni_list(fy, q, limit)` | `/api/db/budget-municipal` | `/budget/municipal` + HubSearch |
| `budget_muni_detail(obshtina, fy)` | `/api/db/budget-municipality` | per-municipality panel + §8.3 peers |

Every route follows skill §7: **degrade on `42P01 · 55000 · 42501 · 55P03`, never on `57014`**;
log the miss once per process with the loader to run (`bh:not-built`); the query function returns
`null` on **any** failure including a thrown one, so a `=== null` fallback is reachable.

`budget_variance` returning `{rows, coveredNodes, totalNodes}` rather than just `rows` is not
politeness: §2.3 means a consumer receiving only rows **cannot** render an honest page.

**`basis` is resolved server-side, in the same function that produces the number** (§7.1). A
client-side division would put the denominator in two places, and the skill's corollary — *if a
number is computed in two places it will drift* — has bitten this pattern twice.

### 6.3 The hub stat call — 156

`156_budget_hub_stats.sql`: `budget_hub_stats_cache` (matview) + `budget_hub_stats(fy)` behind
**`/api/db/budget-hub-stats`**. Same shape as migration 145 for `/funds`.

Materialised because the live aggregate spans five tables and runs on **every** `/budget` view.
Measure with `EXPLAIN (ANALYZE, BUFFERS)` on the **worst** fiscal year, not the current one, and
keep it under the ~2 000-buffer ceiling (skill §7). `reference_local_pg_has_no_stats`: a local
timing proves nothing about a db-g1-small.

Three rules carried from 145's review, each of which shipped broken there first:

- **A unique index on a plain COLUMN**, so `REFRESH … CONCURRENTLY` can succeed. An expression
  index does not qualify a matview, and the loader's `55000` catch then takes the locking path for
  ever, silently.
- **`CREATE MATERIALIZED VIEW`, never `IF NOT EXISTS`** — with `IF NOT EXISTS`,
  `apply_functions.ts` prints „applied" while changing nothing, so the documented escape hatch for
  a body fix is a no-op that reports success.
- **Every key names its basis.** `expenditureExecutedEur` and `expenditureProjectedEur`, never
  `expenditureEur`. §2.1 has five questions with more than one true answer; a key that omits the
  basis invites a consumer to pick one by accident.

**The peer bands live here.** `peerRevenuePctGdp` / `peerExpenditurePctGdp` / `peerBalancePctGdp`,
each `{bg, euAvg, rank, total, year}` — the three scalars that currently cost 794 KB.
`macro_peers.json` is untouched for `/indicators/compare`, which reads the whole distribution
legitimately; `/budget` stops fetching it. §7.1 then reuses these on every sub-page, so the 794 KB
is retired *and* the comparison appears in thirteen more places than it does today.

**The wire.** `latestKfpAsOf`, `latestKfpPublishedAt`, `latestLawKind`, `latestLawOn`, and a
`wireSource` discriminator. Ukraine's E-Data front page is the target shape (§3): the wire is
„what moved recently", and when СЕБРА lands its arm is a union member keyed on `wireSource`, not a
rewrite.

### 6.4 Loaders

```
db:load:budget:pg          → 152 + 153 DDL, and FILLS them    ← REFRESH_EXCLUSIONS
db:load:budget-muni:pg     → 154         (municipal corpus — what the state SENDS)
db:load:budget-hub:pg      → 152 + 153 DDL, then 155 + 156, then REFRESH
```

**[2026-08-13] The three loaders sort onto two different sides of `db:refresh`, and the axis is
the input, not the cost.**

- **`db:load:budget:pg` is in `REFRESH_EXCLUSIONS`, axis `uncommitted-input`.** Its admin and
  programme grain lives in `data/budget/reconciliation/` and `data/budget/ministries/`, both
  gitignored — 0 tracked files against 24 and 55 on a machine that has run the pipeline. It is
  **not** excluded on cost (~2 MB, seconds); recording the right axis matters, since
  `db-refresh-loader-gaps-v1` §1a documents five loaders that were once mis-sorted by cost when
  the operative constraint was the input.
- **`db:load:budget-muni:pg` stays IN the chain.** Its inputs are all COMMITTED — measured,
  `municipal_transfers` 47/47, `capital_programs` 112/112, `ipop` 265/265,
  `municipal_execution` 17/17 tracked. Excluding it would be the same mis-sorting in the other
  direction.
- **`db:load:budget-hub:pg` stays IN the chain**, and therefore **also applies 152 + 153's
  DDL**. Without that, a fresh `db:refresh` would reach 155 with no `budget_admin_fact`, and a
  `LANGUAGE sql` body validated at CREATE time raises 42P01 and rolls the file back. This is the
  `147_tender_search_text` shape: the tables **exist wherever the serving layer does and are
  EMPTY where the shards were never available.** Everything downstream must read 0 rows as „not
  loaded here", never as „the state appropriated nothing".

```
… 27. db:load:place-dim:pg
      db:load:municipal-fiscal:pg   ← [2026-08-13] already there
      db:load:budget-muni:pg        ← NEW  (committed inputs)
      db:load:budget-hub:pg         ← NEW  (applies the state DDL too)
   28. db:load:procurement-scopes:pg …

   db:load:budget:pg                ← NEW, EXCLUDED — run by update-budget
```

Three `ORDER_PAIRS` entries in `refresh_coverage.test.ts` — `place-dim → budget-muni`,
`municipal-fiscal → budget-muni`, `budget-muni → budget-hub`. There is deliberately **no**
`budget → budget-hub` pair: the two are on opposite sides of the chain, so a pair asserting an
order between them would be asserting an order that does not exist.

`vacuumAfterReload()` on every truncate-and-reload destination, with the table names added to
`reload_visibility_map.data.test.ts` — the visibility map a TRUNCATE throws away is invisible to
every row count and to the migration diff (`tenders` lost 5 047 buffers to it).

**[2026-08-13] That gate has an allowlist, and adding the tables is only half of it.**
`LOADER_FILES` in that test enumerates which loaders its static check reads, so a new loader is
invisible to the check until it is listed there — `load_municipal_fiscal_pg.ts` had a `RELOADED`
entry and no `LOADER_FILES` entry, so nothing was reading its call site at all. Both halves, or
the gate silently stops covering the loader it was extended for.

### 6.5 Watch-skill wiring — the step that goes stale silently

`reference_migrated_family_watch_reload`. `update-budget` gains, as its last step:

```bash
npm run db:load:budget:pg:cloud
npm run db:load:budget-muni:pg:cloud    # after a capital_programs / ipop / transfers refresh
npm run db:load:budget-hub:pg:cloud     # ALWAYS last — it reads both
```

`update-noi` gains `db:load:budget:pg:cloud` (the social-funds arm reads `data/budget/noi/`).

---

## 7. The enhancements, specified

Five, each from §3, each with its failure mode named.

### 7.1 The basis control, and the four-part page spine

**From BOOST (the variable indicator) and Fiscal Data (the four-question template).**

One control, `?basis=`, on the hub and every money page. Four values:

| basis | denominator | where it comes from |
|---|---|---|
| `eur` *(default)* | none | the figure itself |
| `gdp` | `budget_fiscal_year.gdp_eur` | already stored, already used by the headline cards |
| `share` | the parent total at the same level | computed in the same function |
| `capita` | `budget_fiscal_year.population` + `population_basis`; at municipal grain, 149's `obshtina_population` | captioned always; default **only for a ranking** — see below |

And every money page answers the same four questions in the same order, so fourteen pages read as
one module rather than fourteen:

```
1. Откъде идват парите        (the level, at this page's grain)
2. Накъде отиват              (the composition one level deeper)
3. Как се променя             (the trend across fiscal years)
4. Как сме спрямо ЕС          (the peer band 154 already computes)
```

Panel 4 is nearly free and currently appears in exactly one place on the whole site — as a chip on
three hub cards. Reusing it thirteen more times is the highest ratio of value to work in this plan.

**The denominator discipline, which is not optional here.** Commit `08bd7a6185` settled this for
the municipal corpus and the reasoning generalises: *population is the wrong denominator for a
fiscal-capacity question.* €20m of commitments in a municipality that spends €10m a year is a
different fact from the same €20m where €200m is spent, but per-resident normalises by people
rather than capacity, so a small municipality mid-project reads as reckless purely because its
denominator is small.

**[2026-08-13] The shipped implementation drew a sharper line than the v1 draft did, and it is the
one to copy.** `/governance/municipal-finance` shipped with **`DEFAULT_SORT = "perCapita"`** and
**`DEFAULT_LAYER = "commitmentsPct"`** (чл. 130а т. 3, normalised by the municipality's own
four-year expenditure base). Per-resident is not banned — it is:

- **the right default for a RANKING**, where the reader is comparing 265 places of wildly
  different size and needs a size-free comparator to sort by at all;
- **the wrong default for a CHOROPLETH**, where colouring 265 shapes by a denominator dominated by
  project timing renders project phase as recklessness, over a whole map, with no way to see the
  confound.

So the rule is by SURFACE, not by basis: **a ranking may default to per-capita; a ramp defaults to
the capacity measure.** The v1 draft's flat „opt-in, never default" would have made the shipped
page's own default illegal, which is how I know it was too coarse.

The rest stands:

- The caption always names the denominator. For the national figure that is `population_basis` —
  ГРАО permanent and ГРАО current differ materially (`grao_population.json` carries both) and
  permanent over-counts emigrants. For the municipal figure it is 149's `obshtina_population`,
  NSI Census 2021, a different vintage again.
- A page with no defensible denominator offers no basis control rather than a broken one.

**Two rendering rules carried from `08bd7a6185`, because they apply to any ramp this module
draws:** palettes are **threshold-anchored, not min–max** (a min–max ramp on a ratio with a legal
threshold makes the darkest thing whoever is highest and hides who is over the line), and class
breaks are **fixed across years** (per-year rescaling makes every year look identical and destroys
the one thing a multi-year view is for).

### 7.2 `/budget/explorer` — the drill-down, promoted

**From USAspending's Spending Explorer.**

Today five drill-down components (`BudgetFlowRevenueDrilldown`, `…CapitalDrilldown`,
`…MunicipalitiesDrilldown`, `…PersonnelDrilldown`, `…SocialFundsDrilldown`) are trapped inside one
tile on the hub, reachable only by scrolling to it and clicking into it. Promoting them to a page
is mostly re-wiring, and the corpus's four classification files — `admin`, `economic`,
`functional`, `program` — are exactly the dimensions the pattern wants.

- **The dimension choice is the page's first question**, not a tab: „по разпоредител / по функция
  / по икономически елемент / по програма".
- **A persistent breadcrumb**, each crumb showing its own total and its share of the parent.
- **One level per call** (`budget_explorer(fy, dimension, parent, basis)`), which is what keeps it
  under the buffer ceiling — the whole tree in one payload is the thing being retired.
- The URL carries dimension + path + `?fy` + `?basis`, so a level is linkable and shareable.
- **The caption lives inside the mode branch.** A caption written outside it will describe the
  other dimension — skill §6, and this page has four.

### 7.3 План → изменен план → отчет — the variance, given a basis

**From the bill-comparison tools, moved to row grain (§2.4 — only two amendment documents exist,
but `budget_admin_fact` carries all three columns per row).**

`/budget/deviations` becomes a **three-column diff** per spending unit rather than a single
„отклонение" number:

```
разпоредител   план (закон)   изменен план (ЗИД)   отчет   Δ спрямо закона   Δ спрямо изменения
```

Two distinct stories, currently collapsed into one ambiguous word: **a ministry overspent its
appropriation**, and **parliament re-voted the appropriation**. §2.2's **fourth** trap is that the
existing `variancePct` silently picks the first. Naming both columns is the fix, and it costs
nothing — the data is already in the row.

**The page still leads with §2.3's coverage line**, and the third column is empty for **six of the
nine** years. That is honest and it is also the page's own argument: a year where **0 of 44
spending units** (FY2026) have filed a report is a finding, not a blank.

The route is named `budget_variance`, not `budget_deviations`, so the SQL cannot quietly go back
to meaning one thing.

### 7.4 `/budget/law` — the eight-document frame, and the vote that adopted it

**From OGP/IBP.**

`budget_document.obs_category` maps each of the 48 records onto the eight key documents, and the
page scores the frame: *„България публикува N от 8 ключови бюджетни документа"*, naming which are
present and which are not. §3.1: the missing one is the **citizens budget**, and that is what this
module is — a claim worth making once, in the place where it is checkable.

**The cross-module edge nobody else can build.** We own both the budget-document corpus and the
roll-call corpus (migration 134, `vote_item`; migration 136, `bill`). Every ЗДБРБ and every ЗИД
was adopted by a recorded vote. `budget_document.adopted_by_item_id` links them, so `/budget/law`
shows **who voted for each budget** and `/votes` gains a reason to link back.

Three rules on that link, all of which this repo has already learned:

- **Never inferred from a title regex.** `bill`'s stem split is TypeScript for exactly this reason
  — a title carrying „второ гласуване" in a procedural position is a first reading. An unresolved
  link is NULL and renders as absent.
- **Aggregate `vote_item` with `WHERE superseded_by IS NULL`** or it over-counts by 9.8%.
- **Party affiliation comes from `vote_cast.party_id`** (affiliation at cast time), never
  `mp_seat.party_id` — 179 of 2 366 seats change party mid-term.

### 7.5 The tax receipt — the hub's LeadCard

**From the taxpayer-receipt literature.**

Both halves exist and are not joined: `BudgetCitizenViewTile` („За всеки €100") is a
**population-average** split, and `/budget/tax-calculator` computes an **individual's** actual tax.
The LeadCard joins them: enter income → your tax → your receipt, itemised down the same
expenditure split the average uses.

- It is a **projection of the reader's own tax onto the enacted budget's shares**, not a claim
  about where their specific euros went. The copy must say so; the receipt is an illustration of
  proportions, and the disclaimer is part of the card, not a footnote.
- Nothing is stored or sent. The computation is client-side against the stat call's shares.
- The average („за всеки €100") stays visible beside the personal figure, because a reader with no
  income to enter must still get an answer.

---

## 8. The municipal band

**[2026-08-13] Rewritten. `municipal-fiscal-commitments-v1` is no longer in flight — it shipped.**

### 8.0 What exists now, so this plan does not re-derive it

| shipped | |
|---|---|
| corpus | `municipal_fiscal` — 265 municipalities × quarter, **2016-Q1 → 2025-Q3 continuous** (39 quarter files), plus `obshtina_population` (NSI Census 2021) |
| migration | **149**, with `municipal_fiscal_by_obshtina()`, `municipal_fiscal_ranking()`, `municipal_fiscal_national()` |
| loader | `db:load:municipal-fiscal:pg[:cloud]`, in `db:refresh` right after `db:load:place-dim:pg` |
| routes | `/api/db/municipal-fiscal`, `-national`, `-years`, `-ranking` — all four already degrade on a missing table with the loader named in the log |
| pages | `/governance/municipal-finance` (table + filters + year picker + a 6-layer choropleth), prerendered, in the sitemap |
| tiles | `MyAreaMunicipalFiscalTile` (per place), `GovernanceMunicipalCommitmentsTile` (governance hub), `RegionMunicipalFiscalTile` (per oblast) |
| national | the three stocks in `macro.json` → `/indicators/fiscal` |

**So §8's job shrank and got sharper.** The v1 draft budgeted for "connect to a plan in flight and
degrade when 149 is absent". What is left is a boundary problem, not an integration problem.

### 8.1 The boundary: two municipal money corpora that must never be one figure

This is now the single most important rule in the section, because both corpora are live and a
reader will see both.

| | what the state **SENDS** | what municipalities **OWE** |
|---|---|---|
| corpus | Art. 53 transfer envelope, capital programmes, ИПОП | ЗПФ чл. 130а — commitments, expense obligations, arrears |
| tables | `budget_muni_*` (154, this plan) | `municipal_fiscal` (149, shipped) |
| home | **`/budget/municipal*`** | **`/governance/municipal-finance`** |
| grain | annual, by fiscal year | quarterly |

They are **adjacent and never combined.** Not summed, not netted, not shown as one „municipal
money" total — the same rule `municipal-fiscal-commitments-v1` T11.2 draws for state debt vs
municipal commitments, applied one level down. A transfer received and a liability contracted are
different facts about different years with different debtors.

Each page **links to the other and names what the other holds.** That cross-link is the whole
integration; anything more is duplication.

### 8.2 Three tiles, each declaring its own coverage

The three differ by an order of magnitude, so coverage is part of the tile:

| tile | destination | coverage | second figure |
|---|---|---|---|
| `muniTransfers` | `/budget/municipal` | **265 / 265** — the Art. 53 envelope, complete by construction | FY2026: €4.89bn основни + €4.35bn делегирани + €255m капиталови |
| `muniIpop` | `/budget/municipal/investments` | **264 municipalities, 3 492 projects** | **769 спрели** — the number that makes the page worth opening |
| `muniCapital` | `/budget/municipal/capital` | **26 of 265** — see the [2026-08-13] note below | say „26 общини", never a bare count |

**[2026-08-13] The 26 are NOT „oblast centres", and an earlier draft of this table said they
were.** Measured against `place_dim` once the corpus was loaded: six of the 26 are not oblast
centres at all (Асеновград, Велинград, Дупница, Казанлък, Карлово, Самоков) and seven centres are
absent. They are simply the municipalities whose capital programme was reachable and parseable.
So the tile names the COUNT and not a category — „26 общини" — because „26 областни центъра" is
the skill's headline defect: arithmetically right about the number, false as a sentence.

`municipal_execution` (Ruse and Nikolaevo — **2 of 265**) gets **no tile**. Two municipalities is a
pilot, not a surface; it stays on those two governance dashboards until the ingest widens. A tile
implying a national municipal-execution view is the skill's „destination counts a different set"
defect at its most extreme.

### 8.3 Peer comparison — built on 149, not beside it

**From BOOST's subnational benchmarking, with §7.1's denominator discipline applied.**

`/budget/municipal` shows a municipality against a **peer set**, because the transfer figure alone
answers nothing — a reader cannot tell whether €14m is a lot without knowing what comparable towns
get.

- The peer set is **population band × municipality type**, disclosed on the page. Population comes
  from **149's `obshtina_population`** (NSI Census 2021); do not mint a second denominator.
- The comparison basis is **the municipality's own expenditure base**,
  `municipal_fiscal.expenditure_avg4y_eur` — *not* per resident, per `08bd7a6185`. Per-resident is
  available as a basis with its caption (§7.1).
- **[2026-08-13] Reuse `municipal_fiscal_ranking()` rather than writing a second ranker.** It
  exists, it is loaded, its route degrades correctly, and a parallel implementation would give
  `/budget/municipal` and `/governance/municipal-finance` two orderings of the same 265 places —
  the skill's *computed in two places, therefore it will drift* corollary, with the drift visible
  to any reader who opens both.
- The absent-149 branch is now a **cold-database** case rather than a not-yet-built one, but it
  still ships: `42P01` → peer panel omitted, transfer table still renders, logged once.

**Three semantics of that corpus that any surface reading it must respect** (all from
`municipal-fiscal-commitments-v1` and CLAUDE.md, all easy to get backwards):

- **Seven criteria, not six.** МФ's year-end releases enumerate them 1..7.
- **`meets_threshold` NULL is not FALSE.** It is TRUE only when three are actually met (decisive by
  monotonicity) and FALSE only when all were evaluable; elsewhere it is NULL because only three of
  the seven are computable from this source. `criteria_evaluable` records which were checkable, so
  **„2 met" can never be rendered as „2 of 6"**.
- **A withheld column is not a zero** — §2.2's [2026-08-13] note; 2025-Q3 is the live instance.

### 8.4 What this band must NOT do

Three boundaries `municipal-fiscal-commitments-v1` sets, all now enforceable against shipped code:

- **The choropleth lives on `/governance/municipal-finance`, and only there** (T13.5: „one map,
  one home"). `/budget/municipal` is a table plus the peer panel. **Do not add a second map** —
  and note the shipped one has six layers and a year picker, so a thinner second map would also be
  a worse one.
- **`/budget` takes the NATIONAL line only** (T10.3): municipal commitments beside the state
  deficit, for the reader who came asking how big the deficit is. **[2026-08-13] Read it from the
  `macro.json` series that already exist** — `municipalCommitments`, `municipalExpenseObligations`,
  `municipalArrears`, the three already behind `/indicators/fiscal` — or from
  `/api/db/municipal-fiscal-national`. Do not re-aggregate the corpus for one line. Note the macro
  assembler exempts these three from its 10%-shrink gate by ratio (`MAY_SHRINK`) **but not at
  zero**: losing a quarter is designed behaviour when МФ freezes a column, dropping to no points
  is still an abort.
- **Never sum state debt with municipal commitments**, and — §8.1 — never sum transfers with
  liabilities either. Different debtors, different mandates, and no row count will show the error.

One rendering rule from the same source applies to every municipal surface here: **a municipality
that did not file renders as a no-data hatch, never as zero.** Colouring a non-filer zero puts it
at „no commitments" — the healthiest shade in the country.

Every one of these pages links to `/governance/:place` for the full place dashboard rather than
reproducing it. **Budget owns the money by level of government; governance owns the place.**

---

## 9. The finder

`/budget` gets a `HubSearch` (`src/ux/search/HubSearch.tsx` — the shared adapter; do not build a
new one). Sources in `src/screens/budget/budgetSearch.ts`:

1. **Ministries and spending units** — server, `/api/db/budget-ministries?q=`. 55 subjects.
2. **Municipalities** — server, `/api/db/budget-municipal?q=`. 265 subjects.
3. **Budget laws and documents** — client `EntityIndex` over 48 titles, small enough to ride the
   stat call's sibling shard.
4. **Fiscal years** — a tiny static source; typing „2024" lands on `/budget?fy=2024`.

**Scope ranks, it never filters** (skill §4). The selector is `?fy=` plus the inherited
`?elections` term. A ministry with no 2026 line still exists — „няма данни за 2026" is a far better
answer than „няма такова министерство". In-scope hits first, out-of-scope second and **labelled for
the scope they are outside** („разпоредители извън бюджет 2026"), built through `scopedSources()`
as **two independent sources with independent caps** — a partition over one ranked scan silently
empties the narrower tier.

Shliokavitsa rides `141_shlyo_query_fold.sql` on the query side only, as a **second probe** after
the plain one — never ORed inline, or a database without 141 raises 42883 for the whole statement
and returns nothing.

Every „see all" destination must **read the param**: grep `/budget/ministries` and
`/budget/municipal` for `?q=` before linking. `/votes?q=` and `/officials/assets?q=` both shipped
as links to a filtered page that delivered an unfiltered one.

---

## 10. Things the hub must not do

- **No corpus total on a scoped page.** The hub carries `?elections` (a parliament term) and `?fy=`
  (a year within it). Every figure is scoped to the selected FY, and the FY chip sits directly
  above the cards so the scope is visible while the numbers are read.
- **No structural zeroes.** FY2026 has zero executed admin rows (§2.3). The deviations tile
  **omits its figure** for such a year rather than printing „0 отклонения", which reads as „every
  ministry hit its plan".
- **`undefined` for an uncovered FY is an answer, not a loading state.** A term whose years have no
  КФП renders a named empty state, not a grid of zeroes.
- **Calendar days in UTC.** `as_of` is day-precision; through an `Intl.DateTimeFormat` with no
  `timeZone` it renders a day early for every reader west of UTC, and the label then disagrees with
  the `?fy=` it links to. Use the shared day-label hook; the repo-wide grep gate exists.
- **No backtick inside SQL held in a template literal.** Four recurrences so far, in `.js` routes
  and a `.ts` generator. Write identifiers bare.
- **A caption describes what is drawn, in the mode it is drawn in** — binding on §7.2, which has
  four dimensions and one caption slot.

---

## 11. Gates

| Gate | File | Catches |
|---|---|---|
| Every tile id has a scene | `budgetHubRegistry.test.ts` | white screen (`InfographicTile` renders `<Scene />` unguarded) |
| Every `to` is absolute AND in a literal routed list | `budgetHubRegistry.test.ts` | dead links |
| Every `/budget/*` sub-page is a hub destination | `budgetHubCoverage.test.ts` | orphans |
| No accent twice on the page | `budgetHubRegistry.test.ts` | „these two are the same kind of thing" — 14 from 21 tokens, this will fire |
| No unimported file in `src/screens/budget/` | `budgetHubCoverage.test.ts` | half-finished moves left as sediment (the `/funds` step-8 lesson) |
| Stat call under its byte budget (~6 KB) | `budget_hub_stats.data.test.ts` | regrowth to the full artifact |
| Every headline figure re-derived from its **declared** basis | `budget_hub_stats.data.test.ts` | the six-of-six class |
| `months_available` never rendered as coverage | grep gate | §2.2 |
| `budget_variance` returns coverage with every ranking | `budget_serving.data.test.ts` | §2.3 |
| Every `basis` is resolved server-side; no money division in `src/screens/budget/` | grep gate | §7.1's two-places-drift |
| `capita` is never the default basis, and always captioned with `population_basis` | `budgetBasis.test.ts` | the `08bd7a6185` denominator error |
| Municipal tiles declare a coverage matching the table | `budget_municipal.data.test.ts` | „26 of 265" rendered as national |
| No surface sums state debt with municipal commitments, **or transfers with liabilities** | `budget_municipal.data.test.ts` | §8.1 / §8.4 |
| **[2026-08-13]** `/budget/municipal` peers come from `municipal_fiscal_ranking()`, not a local ranker | `budget_municipal.data.test.ts` | two orderings of the same 265 places, visible to any reader who opens both pages |
| **[2026-08-13]** No second `obshtina_population`; no second choropleth over `municipal_fiscal` | grep gate | duplicating 149 |
| **[2026-08-13]** A withheld figure renders as „не е публикувано", never as 0 | `budget_serving.data.test.ts` | §2.2's fifth trap — 2025-Q3 is the live instance |
| `adopted_by_item_id` filters `superseded_by IS NULL`; no title-regex inference | `budget_law.data.test.ts` | §7.4 |
| A scoped search source returns out-of-scope rows for a query that has them | `budgetSearch.test.ts` | scope silently filtering |
| Each search group's cap is independent | `budgetSearch.test.ts` | in-scope group eating the out-of-scope budget |
| Every see-all param is read by its destination | `budgetSearch.test.ts` | filtered link, unfiltered page |
| Every `<loc>` in `sitemap_budget.xml` has `dist/<path>/index.html` | `scripts/sitemap/families.data.test.ts` (extend) | a committed sitemap outliving a build |
| No `DROP` in 152–156 read by another migration's stored query | `migration_drop_dependents.data.test.ts` (already generic) | the 077 / 003 class |
| Vacuumed tables listed | `reload_visibility_map.data.test.ts` | the permanent `relallvisible = 0` class |

**Then check each gate can fail.** Break every clause and watch it fire. Two gates in this
pattern's history read as real tests and were vacuous: one asserted `max(id) >= count(*)` (true of
any gap-free sequence — the very symptom it named), another matched a `timeZone: "UTC"` string
inside the comment explaining the fix.

**A figure gate must assert against something the generator does not use** — the destination
screen's own filter, the shard files, or the source PDF's own total. A gate that re-runs the
matview's own SQL proves only that the file was freshly written and inherits every
misunderstanding it was meant to catch.

---

## 12. Shipping order

Hosting last, always.

```bash
npm run db:load:place-dim:pg:cloud       # 0a. PREREQUISITE — preflight a COLUMN, not a count
npm run db:load:municipal-fiscal:pg:cloud# 0b. PREREQUISITE for §8.3 peers — already exists
npm run db:load:budget:pg:cloud          # 1a. state corpus (152+153)
npm run db:load:budget-muni:pg:cloud     # 1b. municipal corpus (154)
npm run db:load:budget-hub:pg:cloud      # 1c. serving + stat call (155+156)
npm run deploy:db                        # 2.  the routes
npm run build                            # 3.  prerender (14 new static pages + sitemap)
npm run deploy                           # 4.  hosting
```

Step 0a is a prerequisite, not a trigger. Prod's `place_dim` had the right row count and the wrong
columns once already (the Interreg deploy, 2026-08-08), so a count-based preflight passed it.

**[2026-08-13]** Step 0b is a prerequisite only for the peer panel (§8.3), which degrades without
it — so it does not gate the deploy, but a cloud database that has never run it serves
`/budget/municipal` with the panel silently absent. Its own loader also depends on `place-dim`,
so 0a genuinely comes first.

No bucket step: this migration moves data **off** files. `data/budget/**` stays on disk and on the
bucket for the ingest and for the pages not yet migrated; retiring any of it is a separate decision
needing both a `bucket_sync_paths.ts` refusal **and** a `CHILD_EXCLUDES` entry — one without the
other still lets the subtree re-upload.

**Probing a route before it exists pins a 404 at the CDN for up to an hour.** If a just-deployed
`/api/db/budget-*` 404s, retry with a cache-buster before debugging.

---

## 13. Tiers

### T0 — Measure and write the ledger *(before any code)*

- **T0.1** Re-run §1.1 and record it (it will have drifted):
  ```js
  performance.getEntriesByType('resource')
    .filter(r => /\.json/.test(r.name))
    .map(r => [r.name.split('/').slice(-2).join('/'), Math.round(r.decodedBodySize/1024)])
  ```
- **T0.2** Two files, and the split is load-bearing:
  - **`scripts/budget/hub_ledger.ts`** — the derivation, imported by
    `budget_hub_stats.data.test.ts` (T4). This is the artifact §11's figure gates assert
    against, so it must never share a code path with the generator.
  - **`scripts/budget/__measure_hub.ts`** — the human view
    (`npx tsx scripts/budget/__measure_hub.ts --all`). No `npm run` alias, matching the 17
    unaliased `__smoke_*` / `__write_*` siblings in `scripts/budget/`.

  **Two of its inputs are GITIGNORED** — `data/budget/reconciliation/` and
  `data/budget/ministries/`, both bucket-shipped only, alongside `facts/`. So on CI and on a
  fresh clone every admin/program figure is *not derivable*, and the ledger must emit those
  keys with `value: null` and a basis saying why. An omitted key is invisible to a gate, which
  would then pass while checking nothing — the vacuous-gate failure skill §8 warns about,
  arriving through the back door.
- **T0.3** Re-confirm §2.3's coverage table against the current shards — the table above is
  produced by `hub_ledger.ts`, not hand-counted.
- **T0.4** `ls scripts/db/schema/pg/` and fix the migration numbers in §6. **[2026-08-13]** This
  file has been wrong twice: the v1 draft said 150–154, which 150/151 took within a day. Read the
  directory, do not read this line.

### T1 — State corpus into Postgres

152 + 153, `scripts/db/load_budget_pg.ts` (stage-merge, `vacuumAfterReload`, absent-safe on a fresh
clone, **throws** on a present-but-malformed input), `db:load:budget:pg[:cloud]`, chain membership
+ `ORDER_PAIRS`, and `budget_pg_roundtrip.data.test.ts` — Postgres is a lossless capture of the
shards.

### T2 — Municipal corpus into Postgres

**Read `municipal-fiscal-commitments-v1` first** — §8.0 lists what already exists so this tier does
not re-derive it, and §8.1 is the boundary it must not cross.

154, `scripts/db/load_budget_muni_pg.ts` with a `place_dim` **column** preflight and a placement
floor below which it refuses rather than writing NULLs over good rows. Loader wiring + gates as T1,
plus the `municipal-fiscal → budget-muni` `ORDER_PAIRS` entry.

### T3 — Serving layer

155's eleven functions, eleven routes in `functions/db_routes.js` with the skill §7 degrade
contract and `bh:not-built` logging, `EXPLAIN (ANALYZE, BUFFERS)` on the **worst** FY for each
(nothing over ~2 000 buffers ships live), `budget_serving.data.test.ts`.

**The `basis` parameter lands here**, in SQL, not later in the screens (§7.1). So does the
two-tier „newest row that HAS the figure" pick (§2.2) — copy
`municipal_fiscal_by_obshtina()`'s shape rather than reinventing it.

### T4 — The hub stat call

156, `db:load:budget-hub:pg[:cloud]`, `/api/db/budget-hub-stats`,
`src/data/budget/useBudgetHubStats.ts`, `budget_hub_stats.data.test.ts` with the basis assertions
and the byte budget. **The peer bands move here and `macro_peers.json` leaves `/budget`.**

### ⚠️ [2026-08-13] T5 AND T6 ARE IN THE WRONG ORDER — read this before starting T5

T5 builds a registry of 14 tiles; T6 builds the 14 pages they point at. Measured against
`src/routes.tsx` after T4: **none of the 14 destinations is routed.** So T5 as written cannot
ship — §11's second gate is „every `to` is absolute AND in the routed list", which is precisely
the dead-link check, and it would fail on all 14. Nor should it be weakened: a hub whose every
tile 404s is worse than no hub.

Three ways out, and the third is the one to take:

1. **Loosen the gate for one tier.** No — that gate exists because dead links are what this
   pattern ships, and a gate that is off when it would fire is not a gate.
2. **Stub the 14 routes in T5.** No — a routed path with no prerender entry serves the SPA
   shell, so to a crawler each is a duplicate of the homepage. That is the exact defect §1.2
   says the module already has, multiplied by fourteen.
3. **Interleave: build each page and its tile together.** Do T6's pages first — each is
   self-contained and needs only the T3 routes, which exist — then T5's registry over
   destinations that are already live. The registry's `to` list is then a description of the
   tree rather than a promise about it.

Concretely: run T6.1–T6.14 first, then T5.1-3, then T5.4–T5.6. The tier numbering below is
left as-is so the plan's own history stays readable; this note is the running order.

The dependency was invisible while the plan was being written because both tiers are „the
hub" in one's head. It became visible the moment T4 landed and the next step was real.

### T5 — The hub

- **T5.1** `src/screens/budget/budgetRegistry.ts` — 4 bands, 14 tiles, 14 accents, pure data.
- **T5.2** `budgetScenes.tsx` — 14 bespoke 300×116 scenes, `currentColor` ink + `var(--sector)`
  accent. Draw the actual structure: a cumulative-YTD staircase for execution, a breadcrumb-tree
  stub for the explorer, a treemap for functional, a 265-cell grid for municipal.
- **T5.3** `BudgetHubScreen.tsx` — Title → HubSearch → wire → FY + basis controls → headline cards
  → TaxReceiptLead → `TileHubGrid`. DEV console guard for the id↔scene contract.
- **T5.4** `budgetSearch.ts` + `budgetSearch.test.ts` (§9).
- **T5.5** The TaxReceiptLead (§7.5).
- **T5.6** The national municipal-commitments line (§8.4) — read from the `macro.json` series or
  `/api/db/municipal-fiscal-national`, never re-aggregated. It degrades when 149 is absent, which
  is now a cold-database case rather than a not-yet-built one.

### T6 — The fourteen sub-pages

One commit per page; each gets its route, screen, `Title`, breadcrumb, source footer, its own PG
fetch, prerender entry and sitemap entry — and each is built on §7.1's four-part spine.

Order by what unblocks the hub's payload fastest: **`/budget/explorer`, `/budget/ministries`,
`/budget/revenue`, `/budget/spending`** first, since those four carry the largest inline fetches.
Then `/budget/deviations` (§7.3) and `/budget/law` (§7.4) — the two with the most design in them.
Municipal last, after reading `municipal-fiscal-commitments-v1`.

### T7 — Retire the hub's fetches, and prove it

- **T7.1** Delete the inline tiles from `BudgetScreen`; the coverage gate catches anything now
  unimported.
- **T7.2** Re-measure. **Target: under 60 KB and under 6 requests**, from 1 752 KB / 16.
- **T7.3** A `tests/perf.spec.ts` entry pinning the ceiling, so the next addition argues with a
  number. **[2026-08-13]** Pin **both** figures from §1.1 — eager and full-scroll — since retiring
  the lazy tiles and retiring the eager four are different wins and one number hides the other.
  That file already ratchets its brotli budgets downward (`2762db9d50`); follow the same
  convention rather than adding a parallel mechanism, and note its per-language loop throws on the
  FIRST language over budget, so a regression in the second is invisible until the first is fixed.

### T8 — SEO

14 `staticPage` entries in `scripts/prerender/routes.ts` with real BG + EN bodies; entries in
`scripts/sitemap/route_defs.ts`; extend `families.data.test.ts` to cover `sitemap_budget.xml` the
way it covers `/court` and `/pension-fund`; a budget section in `llms-full.txt`. Verify every
emitted URL is the **no-slash** form and that the EN root is `/en`, not `/en/`.

### Parallel track, NOT a tier — the execution-report parser

§2.3: 8 of 48 spending units carry an executed figure in the best year, and none at all in six of
nine years. That is an ingest gap in
`scripts/budget/doklad.ts` / `minfin_program_otchet`, and it caps what `/budget/deviations` and
`/budget/ministries` can ever say — including §7.3's third column. Worth its own plan. **Do not let
the hub paper over it**: a hub change that hides a resolver gap makes the gap permanent (skill
§11).

---

## 14. Verify in the browser

After every visible change: `preview_start`, load the page, read the DOM — rendered figures, hrefs,
the grid's last-row count, the console. Then click the thing you built.

Four of the last defects in this pattern were found by looking at the page, not by the suite: a
missing field rendering `votes_outcome_undefined`, two off-by-one dates, raw vote sums, and a state
toggle that silently never applied because a formatter had reshaped the target.

Specifically here: **the last row of each band** (4/4/3/3 must not strand a tile), **the FY chip
against the cards** (scope visible while the numbers are read), **the deviations page on FY2026**
(no figure, not a zero), **the basis control on a page with no defensible denominator** (absent,
not broken), and **`/budget/explorer`'s caption after switching dimension** (it must change).
