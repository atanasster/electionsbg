# /budget as a dashboard hub — v1

**Status:** proposed, 2026-08-12.
**Pattern:** `.claude/skills/dashboard-hub`. Reference implementations: `/parliament` (the shape),
`/funds` (the PG-backed stat call).
**Related:** [funds-hub-v1.md](funds-hub-v1.md), [parliament-hub-v1.md](parliament-hub-v1.md),
[budget-package-2026-ingest-v1.md](budget-package-2026-ingest-v1.md),
[hub-search-v1.md](hub-search-v1.md).
**Must be read before T5:** [municipal-fiscal-commitments-v1.md](municipal-fiscal-commitments-v1.md)
— it is in flight, it owns migration 149, it owns the municipal choropleth, and §8 below is
written to connect to it rather than duplicate it.

---

## 1. Why

### 1.1 Measured, dev server, `/budget`, 2026-08-12

| | |
|---|---|
| page height | **25 215 px** — about twenty-five screens |
| JSON fetched (budget-owned, excluding the app shell) | **1 752 KB across 16 requests** |
| the single largest | `macro_peers.json` — **794 KB, 45% of the page**, from which the screen reads **three scalars** (`distribution.TR`, `.TE`, `.B9`) |
| second largest | `budget/kfp.json` — **347 KB**, of which one of six year snapshots is ever rendered |
| `BudgetScreen.tsx` | **520 lines**, 13 analysis tiles rendered inline |

For scale: `/parliament` before its conversion pulled 1.65 MB, `/funds` pulled 390 KB. **`/budget`
is the worst front page in the repo**, and the 794 KB : 3 scalars ratio is worse than anything
either of those had.

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
in T0.1.

### 1.2 The discovery half

`/budget` is one of the zero-impression prefixes from the discovery-gap work, and the structural
reason is visible in the routing:

- **Six routed pages exist** under `/budget`: the hub, `methodology`, `tax-calculator`, `mod`,
  `simulator`, `ministry/:id`. Five are prerendered from `routes.ts`; the 55 ministry pages are
  prerendered from `dynamicRoutes.ts:3412` and carry 110 sitemap `<loc>`s (BG + EN).
- **There is no picker for them.** `/budget/ministries` does not exist. Grepped: the only
  producers of a `/budget/ministry/…` href are `BudgetMinistriesTile`, `BudgetTopDeviationsTile`
  and `BudgetMinistryScreen`'s own siblings list — the first two sit ~15 000 px down the hub.

**The budget module has 116 indexable URLs and one entry point, and the entry point is a 25 000 px
scroll.** That is the discovery gap in one sentence, and the skill §4 names the fix: *seeded
destinations are a smell — prefer a picker.*

### 1.3 The data half

There are **zero budget tables in Postgres**. The entire module — state and municipal — is
file-served. On disk:

```
data/budget/nzok                 17 MB   (served by the NZOK pack, not by /budget)
data/budget/capital_programs    8.8 MB   ← rendered ONLY on /governance place dashboards
data/budget/ipop                2.9 MB   ← rendered ONLY on /governance place dashboards
data/budget/municipal_transfers 2.5 MB   ← rendered ONLY on /governance place dashboards
data/budget/facts               1.7 MB
data/budget/reconciliation      1.2 MB
data/budget/ministries          692 KB
data/budget/classification      412 KB
data/budget/kfp.json            348 KB
data/budget/municipal_execution 212 KB   ← rendered ONLY on /governance place dashboards
data/budget/noi                 192 KB
```

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
| "per resident" | ГРАО **permanent** address vs ГРАО **current** address (`grao_population.json` carries both, as of 2026-06-15) vs census 2021 vs NSI estimate | See §7.1 — per-capita is **opt-in and captioned**, never a default |

### 2.2 Four traps specific to this corpus

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

### 2.3 The coverage finding that constrains two pages

Executed figures on the admin-grain reconciliation, counted per year:

| FY | rows | distinct nodes | rows carrying `executed` |
|---|---|---|---|
| 2018 | 85 | 45 | **0** |
| 2020 | 123 | 42 | **0** |
| 2022 | 83 | 45 | **2** |
| 2023 | 88 | 46 | **9** |
| 2024 | 97 | 48 | **14** |
| 2025 | 119 | 47 | **0** |
| 2026 | 85 | 44 | **0** |

`BudgetTopDeviationsTile` („Най-големи отклонения от плана") therefore ranks over **14 of 97
spending units in its best year and none at all in four of seven years**. The figure is not wrong;
the impression that it ranks the government's ministries is.

This is skill §11 territory — *a hub surfaces a data layer, it does not repair one*. Two binding
consequences:

1. **`/budget/deviations` leads with the coverage, not the ranking**: „14 от 97 разпоредители са
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
| **[World Bank BOOST Open Budget Portal](https://www.worldbank.org/en/programs/boost-portal/boost-data-lab)** | One **variable indicator** control renders the same figure as absolute money, % of GDP, % of total spending, or per capita — and the same control works at subnational grain, which is what makes peer benchmarking possible. | **§7.1 — the basis control**; **§8.2 — municipal peers** |
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

**Fourteen new pages, fourteen tiles, fourteen distinct accents.** `TILE_ACCENTS` carries 21
tokens, so this fits — tightly. The uniqueness gate (§10) will fire before the set is balanced.

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

**Migration numbers: 150–154.** 148 is `person_company_basis` (in flight, untracked);
**149 is claimed by `municipal-fiscal-commitments-v1` T2** — that plan's own text says 148 and is
now stale, so re-check `ls scripts/db/schema/pg/` before writing either.

### 6.1 Tables

**150 — `budget_kfp`**

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
    population int,                      -- §7.1; the denominator is NAMED, see below
    population_basis text,               -- 'grao_permanent' | 'grao_current' | 'census2021'
    actual_* / planned_* / projected_* double precision, projection_basis text
```

`double precision`, never `numeric` — node-postgres serialises `numeric` as a string and every
money cell renders blank while the number is present in the payload (migrations 120 and 142 both
learned this).

`months_available` keeps its name; its **column comment states §2.2** — captured observations, not
coverage.

`population_basis` is a column rather than a convention because §7.1 makes per-capita a user-
selectable basis, and the three candidate denominators differ materially.

**151 — `budget_admin`**

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

**152 — `budget_municipal`**

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

**152 creates no `municipal_fiscal` table.** That is migration 149's, owned by the in-flight plan.
This one **reads** it (§8.2) and must therefore degrade when it is absent.

### 6.2 Serving functions and routes — 153

`153_budget_serving.sql`, `CREATE OR REPLACE` only, **no `DROP`** — the 077 lesson: a
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
| `budget_muni_detail(obshtina, fy)` | `/api/db/budget-municipality` | per-municipality panel + §8.2 peers |

Every route follows skill §7: **degrade on `42P01 · 55000 · 42501 · 55P03`, never on `57014`**;
log the miss once per process with the loader to run (`bh:not-built`); the query function returns
`null` on **any** failure including a thrown one, so a `=== null` fallback is reachable.

`budget_variance` returning `{rows, coveredNodes, totalNodes}` rather than just `rows` is not
politeness: §2.3 means a consumer receiving only rows **cannot** render an honest page.

**`basis` is resolved server-side, in the same function that produces the number** (§7.1). A
client-side division would put the denominator in two places, and the skill's corollary — *if a
number is computed in two places it will drift* — has bitten this pattern twice.

### 6.3 The hub stat call — 154

`154_budget_hub_stats.sql`: `budget_hub_stats_cache` (matview) + `budget_hub_stats(fy)` behind
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
db:load:budget:pg          → 150 + 151   (state corpus)
db:load:budget-muni:pg     → 152         (municipal corpus)
db:load:budget-hub:pg      → 153 + 154, then REFRESH budget_hub_stats_cache
```

Each with a `:cloud` twin. Placement in `db:refresh` — **after** `db:load:place-dim:pg` (step 27),
because 152 joins `place_dim` for every municipal label:

```
… 27. db:load:place-dim:pg
      db:load:budget:pg          ← NEW
      db:load:budget-muni:pg     ← NEW
      db:load:budget-hub:pg      ← NEW
   28. db:load:procurement-scopes:pg …
```

Three `ORDER_PAIRS` entries in `refresh_coverage.test.ts` (`place-dim → budget-muni`,
`budget → budget-hub`, `budget-muni → budget-hub`), plus chain membership so the coverage gate
passes.

`vacuumAfterReload()` on every truncate-and-reload destination, with the table names added to
`reload_visibility_map.data.test.ts` — the visibility map a TRUNCATE throws away is invisible to
every row count and to the migration diff (`tenders` lost 5 047 buffers to it).

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
| `capita` | `budget_fiscal_year.population` + `population_basis` | **opt-in, captioned, never default** |

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

So:

- `capita` is **opt-in and captioned**, never the default and never the only basis offered.
- The caption names `population_basis`. ГРАО permanent and ГРАО current differ materially
  (`grao_population.json` carries both), and permanent over-counts emigrants.
- At municipal grain the **capacity** basis (`share` against the municipality's own expenditure
  base) is the one offered first — see §8.2.
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
appropriation**, and **parliament re-voted the appropriation**. §2.2's third trap is that the
existing `variancePct` silently picks the first. Naming both columns is the fix, and it costs
nothing — the data is already in the row.

**The page still leads with §2.3's coverage line**, and the third column is empty for four of
seven years. That is honest and it is also the page's own argument: a year where 0 of 97 spending
units have filed a report is a finding, not a blank.

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

### 8.1 Three tiles, each declaring its own coverage

The three differ by an order of magnitude, so coverage is part of the tile:

| tile | destination | coverage | second figure |
|---|---|---|---|
| `muniTransfers` | `/budget/municipal` | **265 / 265** — the Art. 53 envelope, complete by construction | FY2026: €4.89bn основни + €4.35bn делегирани + €255m капиталови |
| `muniIpop` | `/budget/municipal/investments` | **264 municipalities, 3 492 projects** | **769 спрели** — the number that makes the page worth opening |
| `muniCapital` | `/budget/municipal/capital` | **26 of 265** — oblast centres only | say „26 областни центъра", never a bare count |

`municipal_execution` (Ruse and Nikolaevo — **2 of 265**) gets **no tile**. Two municipalities is a
pilot, not a surface; it stays on those two governance dashboards until the ingest widens. A tile
implying a national municipal-execution view is the skill's „destination counts a different set"
defect at its most extreme.

### 8.2 Peer comparison — capacity, not population

**From BOOST's subnational benchmarking, with §7.1's denominator discipline applied.**

`/budget/municipal` shows a municipality against a **peer set**, because the transfer figure alone
answers nothing — a reader cannot tell whether €14m is a lot without knowing what comparable towns
get.

- The peer set is **population band × municipality type**, and it is disclosed on the page.
- The comparison basis is **the municipality's own expenditure base**, read from
  `municipal_fiscal.expenditure_avg4y_eur` (migration 149) — *not* per resident, per
  `08bd7a6185`. Per-resident is available as an opt-in basis with its caption.
- **Degrade when 149 is absent.** That plan is in flight; if `municipal_fiscal` is missing, the
  peer panel does not render and the transfer table still does. `42P01` → panel omitted, logged
  once.

### 8.3 What this band must NOT do

Read `municipal-fiscal-commitments-v1` before building any of it. Three boundaries it sets:

- **The choropleth lives on `/governance/municipal-finance`, and only there** (its T13.5: „one map,
  one home"). `/budget/municipal` is a table plus the peer panel. Do not add a second map.
- **`/budget` takes the NATIONAL line only** (its T10.3): municipal commitments beside the state
  deficit, for the reader who came asking how big the deficit is. One line, on the hub, not a
  tile.
- **Never sum state debt with municipal commitments.** Different debtors, different mandates —
  adjacent and never combined. Its T11.2 draws the same line; a figure that adds them is wrong in
  a way no row count will show.

And one rendering rule from the same source, which applies to every municipal surface here: **a
municipality that did not file renders as a no-data hatch, never as zero.** Colouring a non-filer
zero puts it at „no commitments" — the healthiest shade in the country.

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
| No surface sums state debt with municipal commitments | `budget_municipal.data.test.ts` | §8.3 |
| `adopted_by_item_id` filters `superseded_by IS NULL`; no title-regex inference | `budget_law.data.test.ts` | §7.4 |
| A scoped search source returns out-of-scope rows for a query that has them | `budgetSearch.test.ts` | scope silently filtering |
| Each search group's cap is independent | `budgetSearch.test.ts` | in-scope group eating the out-of-scope budget |
| Every see-all param is read by its destination | `budgetSearch.test.ts` | filtered link, unfiltered page |
| Every `<loc>` in `sitemap_budget.xml` has `dist/<path>/index.html` | `scripts/sitemap/families.data.test.ts` (extend) | a committed sitemap outliving a build |
| No `DROP` in 150–154 read by another migration's stored query | `migration_drop_dependents.data.test.ts` (already generic) | the 077 / 003 class |
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
npm run db:load:place-dim:pg:cloud       # 0.  PREREQUISITE — preflight a COLUMN, not a count
npm run db:load:budget:pg:cloud          # 1a. state corpus (150+151)
npm run db:load:budget-muni:pg:cloud     # 1b. municipal corpus (152)
npm run db:load:budget-hub:pg:cloud      # 1c. serving + stat call (153+154)
npm run deploy:db                        # 2.  the routes
npm run build                            # 3.  prerender (14 new static pages + sitemap)
npm run deploy                           # 4.  hosting
```

Step 0 is a prerequisite, not a trigger. Prod's `place_dim` had the right row count and the wrong
columns once already (the Interreg deploy, 2026-08-08), so a count-based preflight passed it.

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
- **T0.2** `scripts/budget/__measure_hub.ts` — prints every candidate figure with its denominator,
  committed, so §11's figure gates have something the generator does not use to assert against.
- **T0.3** Re-confirm §2.3's coverage table against the current shards.
- **T0.4** `ls scripts/db/schema/pg/` and fix the migration numbers in §6 — 148 and 149 are both
  in flight.

### T1 — State corpus into Postgres

150 + 151, `scripts/db/load_budget_pg.ts` (stage-merge, `vacuumAfterReload`, absent-safe on a fresh
clone, **throws** on a present-but-malformed input), `db:load:budget:pg[:cloud]`, chain membership
+ `ORDER_PAIRS`, and `budget_pg_roundtrip.data.test.ts` — Postgres is a lossless capture of the
shards.

### T2 — Municipal corpus into Postgres

152, `scripts/db/load_budget_muni_pg.ts` with a `place_dim` **column** preflight and a placement
floor below which it refuses rather than writing NULLs over good rows. Loader wiring + gates as T1.

### T3 — Serving layer

153's eleven functions, eleven routes in `functions/db_routes.js` with the skill §7 degrade
contract and `bh:not-built` logging, `EXPLAIN (ANALYZE, BUFFERS)` on the **worst** FY for each
(nothing over ~2 000 buffers ships live), `budget_serving.data.test.ts`.

**The `basis` parameter lands here**, in SQL, not later in the screens (§7.1).

### T4 — The hub stat call

154, `db:load:budget-hub:pg[:cloud]`, `/api/db/budget-hub-stats`,
`src/data/budget/useBudgetHubStats.ts`, `budget_hub_stats.data.test.ts` with the basis assertions
and the byte budget. **The peer bands move here and `macro_peers.json` leaves `/budget`.**

### T5 — The hub

- **T5.1** `src/screens/budget/budgetRegistry.ts` — 4 bands, 14 tiles, 14 accents, pure data.
- **T5.2** `budgetScenes.tsx` — 14 bespoke 300×116 scenes, `currentColor` ink + `var(--sector)`
  accent. Draw the actual structure: a cumulative-YTD staircase for execution, a breadcrumb-tree
  stub for the explorer, a treemap for functional, a 265-cell grid for municipal.
- **T5.3** `BudgetHubScreen.tsx` — Title → HubSearch → wire → FY + basis controls → headline cards
  → TaxReceiptLead → `TileHubGrid`. DEV console guard for the id↔scene contract.
- **T5.4** `budgetSearch.ts` + `budgetSearch.test.ts` (§9).
- **T5.5** The TaxReceiptLead (§7.5).
- **T5.6** The national municipal-commitments line (§8.3), degrading when 149 is absent.

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
  number.

### T8 — SEO

14 `staticPage` entries in `scripts/prerender/routes.ts` with real BG + EN bodies; entries in
`scripts/sitemap/route_defs.ts`; extend `families.data.test.ts` to cover `sitemap_budget.xml` the
way it covers `/court` and `/pension-fund`; a budget section in `llms-full.txt`. Verify every
emitted URL is the **no-slash** form and that the EN root is `/en`, not `/en/`.

### Parallel track, NOT a tier — the execution-report parser

§2.3: 14 of 97 spending units carry an executed figure in the best year. That is an ingest gap in
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
