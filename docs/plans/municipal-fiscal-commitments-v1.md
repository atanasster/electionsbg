# Per-municipality commitments + arrears ingest (ЗПФ чл. 130а) — v1

**Status:** design, sources probed 2026-08-11. Goal: turn the one national number we hold for
all 265 общини combined into a per-município, per-year series covering the three *distinct*
liability stocks Bulgarian public finance actually distinguishes — and with it, make the
"governments push payments into the next budget year" claim testable for the first time.

Motivating analysis: [`docs/analysis/deficit-deferral-claim-v1.md`](../analysis/deficit-deferral-claim-v1.md).
Its conclusion is that the claim's central mechanism sits in the blind spot of every series we
hold. This plan closes that blind spot.

Builds on / does not duplicate:

- `scripts/macro/fetch_arrears.ts` + `data/_cache/minfin_arrears/` — the **national** arrears
  parser. This plan reuses its manual-drop pattern, its unit detection and its sanity-ceiling
  idiom verbatim. It does not replace it; the national series becomes the **reconciliation
  target** for the new per-município one (T3.1).
- `scripts/budget/municipal_execution/` — the two-município egov cash-execution ingest. Its
  `REGISTRY` + `egov_api.ts` client are the model for T0's automated path. Its **payload is
  disjoint** from this one: it carries revenue/expense plan-vs-actual by paragraph and
  **no liability lines at all**.
- `place_dim` (migration 117) — the obshtina code→name dictionary. T2 joins it; it does not
  mint another one (see the "second producer" warning in `scripts/person/places.ts`).

---

## 0. What is actually published, and why we do not have it

### 0a. The three stocks are different, and conflating them is the failure mode

Bulgarian public finance distinguishes three nested liability stocks. We hold **only the
innermost**, and only nationally:

| # | stock | meaning | do we hold it? |
|---|---|---|---|
| 1 | **Поети ангажименти за разходи** | *Contracted.* Signed obligations, payment not yet due. The outermost ring. | **No — nowhere, at any grain.** |
| 2 | **Задължения за разходи** | *Invoiced.* Due or accrued, not yet past term. | **No — nowhere, at any grain.** |
| 3 | **Просрочени задължения** | *Overdue.* Past the statutory payment term. | Yes — **one national number a year**, with a central/social/local split. |

Stock 1 is the claim's mechanism. Stock 3 is the only thing anyone measures, and by
construction it can never see stock 1: a payment *contractually scheduled* for next year is
never просрочено. The national series is therefore not merely thin — it is the wrong
instrument, and its flatness (€60.7m local in 2021 → €95.6m in 2025) has been read as evidence
of health when it is evidence of nothing.

`ЗПФ` defines stock 2 with a carve-out worth carrying into the schema: obligations for
**personnel, pensions, interest on debt, taxes and other public receivables are excluded**.
So these are supplier/contractor liabilities — the same population as the procurement corpus.
That is what makes T6's cross-check possible.

### 0b. MinFin publishes all three per município — under ЗПФ чл. 130г ал. 2

The publication is the чл. 130а ал. 1 criteria table, one row per município per year. Verbatim
shape, read from Велинград's 2025–2027 оздравителен план (Таблица № 2, към 31.12.2024):

| # | criterion | threshold | Велинград 2024 |
|---|---|---|---|
| 1 | плащания по общинския дълг ÷ средногодишни собствени приходи + изравнителна субсидия, 3 г. (чл. 32 ал. 1) | > 15% | 3.4% |
| 2 | **задължения за разходи** ÷ средногодишни отчетени разходи, 4 г. | > 15% | **43.9%** |
| 3 | **поети ангажименти за разходи** ÷ средногодишни отчетени разходи, 4 г. | > 50% | **107.2%** |
| 4 | **просрочени задължения** ÷ отчетени разходи, последна година | > 5% | **27.4%** |
| 5 | бюджетно салдо отрицателно във всяка от последните 3 години | — | −4,882,940 лв. |
| 6 | осреднена събираемост ДНИ + ДПрС под средната за страната | < нац. средно (76.00% за 2024) | 75.5% |

**≥3 criteria met → „община с финансови затруднения"** (чл. 130а ал. 1), which triggers a
мandatory оздравителен план (чл. 130д) and admits the município to an interest-free central
loan (чл. 130ж — Велинград drew 10,000,000 лв. in 2025).

Landing pages: [minfin.bg/bg/810](https://www.minfin.bg/bg/810) („Финансови показатели на
общините") and [minfin.bg/bg/19](https://www.minfin.bg/bg/19) („Финанси на общините").
Quarterly arrears: [minfin.bg/bg/statistics/10](https://www.minfin.bg/bg/statistics/10) — the
page we already draw the national aggregate from.

### 0c. Access — probed 2026-08-11, all four routes

| route | result |
|---|---|
| `curl` w/ browser UA → `minfin.bg/bg/{810,19,statistics/10}` | **403** (5,559 B Cloudflare interstitial) |
| `WebFetch` → same | **403** |
| Browser pane → `minfin.bg` | Cloudflare **interactive Turnstile** ("Verify you are human"). Not cleared — completing bot-detection challenges is out of bounds, and `fetch_arrears.ts`'s README records that Playwright-driven Chromium just re-challenges anyway. |
| `web.archive.org` CDX | **429** from this egress on every attempt (a known recurrence — see `reference_council_scrape_ip_blocking`) |

`data.egov.bg` is **403 from this egress too** (both the HTML listing and the `POST /api/*`
client) — the documented `403 = egress IP` condition, not a portal outage. It works from the
operator's normal environment, which is why `municipal_execution` and the procurement ingest
rely on it.

**This is the one open question that changes the plan's shape, and T0 answers it.**

---

## T0 — Source reconnaissance — ✅ RUN 2026-08-11

**Outcome: the dataset exists, is richer than assumed, and is unreachable from this operator's
egress. Build against a saved file with a pluggable fetcher.**

### T0.1 The dataset is real and catalogued — `Финансови показатели за общините`

Found via the EU open-data mirror, which harvests data.egov.bg and is **not** geo-blocked:
[`data.europa.eu/data/datasets/4229`](https://data.europa.eu/data/datasets/4229?locale=bg),
machine-readable at `https://data.europa.eu/api/hub/search/datasets/4229`.

- **Publisher:** Дирекция „Финанси на общините", Министерство на финансите.
- **Scope, verbatim:** *„Обхватът — спазване на условията съгласно **чл. 94 и чл. 130а** от
  Закона за публичните финанси."* Both the commitment *limits* and the distress *criteria*.
- **Cadence, verbatim:** *„Справката се изготвя на **тримесечие**."* Upstream is the **ИСО**
  reporting system, filed by authorised municipal officers under чл. 133 + чл. 167 ЗПФ.
- **Coverage:** all **265** общини (ИСО is universal municipal reporting, not a distressed
  subset). Quarterly files are published per quarter on `minfin.bg/bg/810`.
- **Unit, verbatim:** *„лева, след 01.01.2026 г. - евро."*

**The EU mirror carries metadata only — zero distributions.** Verified against both API
shapes; dataset 4229 returns an empty distribution list while sibling datasets return full
download URLs. So the EU portal gives us the *definitions* and the *cadence*, and no data.
Do not re-try it for files.

### T0.2 Access — every automated route is blocked, and it is not transient

| route | result 2026-08-11 |
|---|---|
| `data.egov.bg` — `POST /api/listDatasets`, `GET /`, `GET /data/view/{uuid}` | **403**, bare `Server: Apache` + IETF-2.0 error body = origin IP/reputation rule |
| `testdata.egov.bg` | connection failure (`000`) |
| `minfin.bg` (curl / WebFetch / browser) | **403** / interactive Cloudflare Turnstile |
| `web.archive.org` CDX | **429** on every attempt |
| `data.europa.eu` | ✅ works — metadata only |

Egress at run time was `146.70.245.158` — **AS9009 M247 Europe, Sofia**, i.e. the BG
*datacenter* VPN that memory already records as **not** clearing egov's block (measured
2026-08-10 alongside a US-residential exit, also blocked). The untried option remains a BG
**residential** IP or a BG-hosted VPS. This has been the standing condition since 2026-06-25.

**Decision: T1 parses a saved FILE; the fetch layer is pluggable** (`egovResource` |
`manualDrop`). The manual path is the one that works today, via the operator's own browser at
[minfin.bg/bg/810](https://www.minfin.bg/bg/810) — the same route that already sustains
`fetch_arrears.ts`. If a BG residential IP ever becomes available the fetcher swaps and nothing
else in the plan changes. **Do not make the parser depend on the transport.**

### T0.3 All four questions answered — three from the catalogue, one from the files (T0.5)

1. **Cadence — QUARTERLY.** Not the annual grain the criteria table suggested. `quarter` is a
   real dimension, not a defensive always-`4` column, and quarterly commitments let us watch
   the *within-year* build rather than only the year-end stock. This is a material upgrade to
   what the analysis can say.
2. **LEVELS — confirmed in the workbook.** Cols 45–53 publish просрочени / задължения /
   ангажименти as **лв. amounts**, alongside the ratios and every denominator. T1.1's design is
   supported by the source rather than working around it.
3. **Coverage — all 265**, confirmed: 265 data rows, one per община.
4. **Sofia — a SINGLE row** (`7200`, „Столична община"). The 24 районни администрации do not
   report separately here, so no disaggregation is available or needed.

### T0.4 The source's own definitions — now the schema's authority

Each stock has an exact chart-of-accounts anchor (СБО = Сметкоплан на бюджетните организации).
Put these in the migration's column comments; they settle every naming question in T1.1 and are
the reason T3.3's nesting check must be a tendency rather than an invariant:

| stock | anchor | who computes it |
|---|---|---|
| **Поети ангажименти за разходи** | end balance of **сметка 9200** „Поети ангажименти за разходи – наличности", отчетна група „Бюджет" | the município's own trial balance |
| **Задължения за разходи** | end balances of **раздел 4** СБО revenue/expense positions, excluding personnel, pensions, debt interest, taxes and public receivables — and excluding provisions, debt, and commitments | **computed by МФ** from the reported balances |
| **Просрочени задължения** | **задбалансови сметки 9921–9929**, оборотна ведомост, отчетна група „Бюджет" | **self-reported by the município** |

The commitments definition is, verbatim, the concept this whole plan exists to capture:

> „Налични към края на годината поети ангажименти за разходи са всички ангажименти за разходи,
> независимо кога са били поети, които са останали неизпълнени/нереализирани към края на
> годината и **подлежат на изпълнение/реализиране изцяло или частично в следващите бюджетни
> години**."

That is *contracted, unperformed, falling due in later budget years* — MinFin's own words for
the mechanism the claim alleges, published quarterly per município, and absent from every
dataset we hold.

The `разходи` denominator is likewise pinned to an explicit ЕБК paragraph list (§§01/02/05/08
personnel · 10/46 издръжка · 21–29 лихви · 40/42 социални · 43/45/49 субсидии и трансфери ·
51–54 капиталови · 55 капиталови трансфери), so T1.1's denominators are reproducible rather
than inferred.

**⚠ New trap, from T0.4: arrears are SELF-REPORTED off-balance-sheet.** Only `задължения за
разходи` is computed by МФ; `просрочени задължения` is whatever the município enters in
9921–9929. That is a real incentive problem — the indicator that triggers чл. 130а distress is
filed by the party the finding falls on — and it is a candidate explanation for why the
national arrears series looks so implausibly flat (€60.7m local in 2021 → €95.6m in 2025)
while contracted value ran 2.8×. **Never present arrears as audited.** Commitments (сметка
9200) and obligations (МФ-computed) are the sturdier two of the three.

### T0.5 Files acquired — ✅ 2026-08-11, T1 is unblocked

Operator downloaded three files from `minfin.bg/bg/810`; saved to
`data/_cache/minfin_municipal_fiscal/` (gitignored, README committed — that README is now the
authoritative column map and supersedes any layout description elsewhere in this plan).

| file | quarters |
|---|---|
| `1. quarterly-reports-Q22024-Q42024-Q22025-website.xlsx` | Q2-2024 · Q4-2024 · Q2-2025 |
| `1. quarterly-reports-Q32024-Q42024-Q32025-website.xlsx` | Q3-2024 · Q4-2024 · Q3-2025 |
| `4. municipal-analysis of negative trends 31 03 2025.pdf` | МФ narrative to 31.03.2025 |

**Both workbooks are needed** — each carries three quarters in a rolling prev/final/current
comparison and they overlap only on Q4-2024. That shared column is **identical across the two
files** (2,120 numeric cells, 0 mismatches), so they merge safely and the overlap is a free
parser self-check. Two files per year covers the series; grab both the Q2- and Q3-anchored
releases.

**The reconciliation gate already passes, before a line of code.** Summing Q4-2024 просрочени
over all 265 rows = **143,017,277 лв = €73.1m**, matching *exactly*:

- `data/_cache/arrears.json` 2024 `breakdownEurM.local` = **€73.1m**, parsed independently from
  the national year-end Обобщена справка, and
- the negative-trends PDF's implied 31.12.2024 figure (171.6м лв at 31.03.2025, „с 28,6 млн.
  лв. спрямо размера към 31.12.2024 г." → 143.0м лв).

Three independent МФ publications agreeing to the lev. **T3.1's tolerance is therefore not a
judgement call — set it tight** (≤0.1%) and treat any drift as a defect. The worry that the
national "местно правителство" tier might include entities outside the чл. 130г table is
resolved: it does not.

### T0.6 The headline the ingest exists to produce — already visible

Summed over 265 municipalities, from the two workbooks:

| stock | Q3-2024 | Q4-2024 | Q3-2025 | YoY |
|---|---:|---:|---:|---:|
| Просрочени задължения | 122.1м лв (€62.4m) | 143.0м лв (€73.1m) | 147.4м лв (€75.4m) | +20.7% |
| Задължения за разходи | 489.4м лв (€250m) | 932.8м лв (€477m) | 755.1м лв (€386m) | +54.3% |
| **Поети ангажименти** | **6,710.8м лв (€3.43bn)** | **6,613.1м лв (€3.38bn)** | **8,141.3м лв (€4.16bn)** | **+21.3%** |

**Municipal contracted-but-unperformed commitments are ~€3.4–4.2bn — 46× the arrears figure
that the entire public debate runs on**, and up €731m year-on-year. This is the number the
analysis said did not exist anywhere; it exists, it is published quarterly, and nobody
aggregates it.

Two cautions before this is quoted anywhere. Q3→Q3 is the only clean YoY comparison available
from these two files (Q4-2024 has no Q4-2023 counterpart here — a third workbook is needed).
And a commitment stock is *supposed* to be large: it includes every multi-year contract legally
in force. The finding is the **level and the growth rate**, not that a positive number exists.

### T0.7 New task surfaced: the municipality key is an МФ code, not EKATTE

Col A is the МФ/ЕБК municipal code (`5101` Банско … `7805`), not the `RSE27`-style obshtina
code the repo uses everywhere. Col B carries the name, so the crosswalk is buildable by
name-matching against `data/municipalities.json` — but it must be **built once, committed and
gated**, not done inline at parse time. Fold into T1 as `municipal_fiscal/codes.ts` with a test
asserting all 265 resolve; an unresolved código means a município silently never appears on any
page (T3.5 already covers the database side).

---

## T1 — Parser + cache

New: `scripts/budget/municipal_fiscal/{parse.ts,ingest.ts,types.ts}`.

### T1.1 Store LEVELS and DENOMINATORS, never only the ratio — the plan's load-bearing decision

MinFin's Таблица № 2 publishes **percentages**. A percentage is unusable for everything this
ingest exists to do:

- **It cannot be summed.** "43.9% + 107.2%" is meaningless; "how many euro of contracted
  commitments do Bulgarian municipalities carry" is the question, and a ratio cannot answer it.
- **It cannot reconcile.** T3.1's gate against the national arrears series compares *money*.
- **It cannot be re-based.** Criteria 2–4 divide by a rolling 4-year (or 1-year) expenditure
  average, so **the ratio moves when the past revises even if the stock does not**. A stored
  ratio silently mixes numerator and denominator movement — exactly the confound this whole
  analysis is about.

So the row carries the numerator, the denominator and the ratio, each independently:

```ts
type MunicipalFiscalYear = {
  obshtina: string;          // EKATTE obshtina code, joins place_dim
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;    // REAL grain — the справка is quarterly (T0.3-1), not annual

  // --- the three stocks, as money (native + EUR) ---
  commitments:        Money | null;  // поети ангажименти за разходи   (чл. 130а ал. 1 т. 3)
  expenseObligations: Money | null;  // задължения за разходи          (т. 2)
  arrears:            Money | null;  // просрочени задължения          (т. 4)

  // --- the denominators, stored so every ratio is re-derivable ---
  expenditureAvg4y:   Money | null;  // средногодишни отчетени разходи, 4 г.
  expenditureLastY:   Money | null;  // отчетени разходи, последна година
  ownRevenueAvg3y:    Money | null;  // + изравнителна субсидия, 3 г.  (т. 1)
  debtServiceAnnual:  Money | null;  // плащания по общинския дълг     (т. 1)
  budgetBalance:      Money | null;  // бюджетно салдо                 (т. 5)

  // --- as published, kept for provenance and drift detection ---
  ratiosPublished: { c1: number|null; c2: number|null; c3: number|null;
                     c4: number|null; c6: number|null };
  collectionRateAvg: number | null;  // ДНИ+ДПрС, %                    (т. 6)
  collectionRateNational: number | null; // the year's national mean, the т. 6 comparand

  criteriaMet: number[];     // which of 1..6 are met
  isDistressed: boolean;     // criteriaMet.length >= 3
  sourceFile: string;
  suspect: boolean;
};
```

**Note the criteria are annual by construction** („налични към края на **годината**"), while the
справка is quarterly. So a Q1–Q3 row carries stocks and denominators but **no meaningful
`criteriaMet` / `isDistressed`** — those are Q4 verdicts. Compute them only for `quarter = 4`
and leave them null elsewhere; a mid-year "distressed" flag would be a fabrication, and it is
exactly the kind of figure that gets quoted once it exists.

**If the first workbook publishes only ratios** (T0.3-2, still open), the levels are still recoverable for
criteria 2–4 by multiplying through a denominator we can build ourselves from
`municipal_execution` — but we hold that for **two of 265 municipalities**, so in practice the
answer is: derive what we can, leave the rest null, and say so in the payload. Do not
back-solve a level from a ratio and a *guessed* denominator. A null is honest; a
plausible-looking reconstructed euro figure is not, and it will be quoted.

### T1.2 Currency

Native лв. through FY2025, euro from FY2026. Store both, exactly as `ArrearsPoint` does
(`nativeTotal` + `unit` + the EUR value), converting via `toEur` from `src/lib/currency`.
The rate is the locked currency-board 1.95583, so a 4-year average spanning the changeover is
**exact, not approximate** — but the `unit` must still be detected per file, not assumed
(`detectUnit` in `fetch_arrears.ts` already handles all four cases and should be lifted into a
shared helper rather than copied).

### T1.3 Sanity ceilings — the 2022 precedent

The published Q4-2022 national file lists local arrears at ~€46.5bn, ~500× its neighbours;
`fetch_arrears.ts` flags and excludes it, which is why our series has a hole in the single most
interesting year. Per-município values are ~265× smaller and the same class of cell corruption
will occur. Apply a **per-município** ceiling expressed as a multiple of that município's own
`expenditureLastY` (a município cannot plausibly owe 20× its annual spend), not a flat euro
figure — 265 municipalities span four orders of magnitude and a flat ceiling would be either
useless for Sofia or wrong for Николаево.

### T1.4 Partial files must not publish

Borrow the Interreg loader's rule verbatim: **never build the stage from a subset.** If a
year's workbook parses fewer municipalities than the previous year's, refuse and report rather
than write. A partial ingest that anti-joins is how you silently delete 200 municipalities and
still reconcile every row count.

**Output:** `data/budget/municipal_fiscal/{year}.json` + `index.json` (coverage, cadence,
distressed count per year). Committed; raw drops gitignored.

---

## T2 — Postgres (migration 147) + loader

**T2.1 `147_municipal_fiscal.sql`** — next free number (146 is `tender_dossier`).

```sql
CREATE TABLE IF NOT EXISTS municipal_fiscal (
  obshtina text NOT NULL,
  fiscal_year int NOT NULL,
  quarter smallint NOT NULL DEFAULT 4,
  commitments_eur double precision,
  expense_obligations_eur double precision,
  arrears_eur double precision,
  expenditure_avg4y_eur double precision,
  expenditure_last_y_eur double precision,
  own_revenue_avg3y_eur double precision,
  debt_service_eur double precision,
  budget_balance_eur double precision,
  collection_rate_avg double precision,
  collection_rate_national double precision,
  criteria_met smallint[] NOT NULL DEFAULT '{}',
  is_distressed boolean NOT NULL DEFAULT false,
  source_file text,
  PRIMARY KEY (obshtina, fiscal_year, quarter)
);

COMMENT ON COLUMN municipal_fiscal.commitments_eur IS
  'Поети ангажименти за разходи — end balance of сметка 9200 (СБО, отчетна група „Бюджет"). '
  'Contracted, unperformed, falling due in LATER budget years. Source: município trial balance.';
COMMENT ON COLUMN municipal_fiscal.expense_obligations_eur IS
  'Задължения за разходи — раздел 4 СБО end balances, excl. personnel/pensions/debt interest/'
  'taxes/public receivables, excl. provisions, debt and commitments. Computed by МФ.';
COMMENT ON COLUMN municipal_fiscal.arrears_eur IS
  'Просрочени задължения — задбалансови сметки 9921–9929. SELF-REPORTED by the município; '
  'not audited, and the indicator that triggers чл. 130а distress. See T0.4.';
```

`criteria_met` / `is_distressed` are populated **only for `quarter = 4`** (T1.1). A partial
index on that predicate serves every distress query.

**Every money column is `double precision`, never `numeric`.** node-postgres serializes
`numeric` as a string, which blanks every money cell on the page while the number is present in
the payload — invisible to every row count and to any assertion made through SQL. This repo has
shipped that defect twice (migration 120's matview, migration 142's `open_calls`, whose
retype needed a reconcile `ALTER` because `CREATE TABLE IF NOT EXISTS` cannot retype a warm
column). Get it right the first time.

**T2.2 Serving functions.**

- `municipal_fiscal_by_obshtina(code text, yr int)` — the governance-tile payload: the six
  criteria with numerator, denominator, ratio and threshold, so the UI never re-derives a ratio.
- `municipal_fiscal_ranking(yr int, metric text, lim int)` — the national browse.
- `municipal_fiscal_national(yr int)` — the aggregate: total commitments, obligations, arrears
  across all reporting municipalities. **This is the number that does not currently exist
  anywhere in Bulgarian public discourse**, and the reason to build the whole thing.

Join `place_dim` for the BG/EN município label. Do not mint a second dictionary.

**T2.3 Loader** `scripts/db/load_municipal_fiscal_pg.ts`, `db:load:municipal-fiscal:pg[:cloud]`.

- Reads only `data/budget/municipal_fiscal/` (committed) — so it is a pure-load step and works
  on a fresh clone. **Skip-and-warn when absent, throw on malformed**, matching the nzok family.
- Applies 147 itself.
- **Stage merge** (`scripts/db/lib/stage_merge.ts`), not TRUNCATE+rebuild: this is a serving
  path and a plain TRUNCATE takes an AccessExclusiveLock that 55P03s live readers.
- `vacuumAfterReload()` after the COMMIT — outside `withTx`, since VACUUM cannot run in a
  transaction block. A stage-merged table keeps its visibility map, but the loader should carry
  the call anyway so a future switch to TRUNCATE cannot silently give back index-only scans.
- Wire `ingest_changelog.ts` so `recent_updates()` surfaces it. Per repo convention this is
  required, and it is **separate from** `data/data-changes.json`, which `process-watch-report`
  stamps per-skill.

**T2.4 `db:refresh` membership.** Add to the chain; `refresh_coverage.test.ts` enforces it.
Position: after `db:load:place-dim:pg` (it joins the dimension) and anywhere after the budget
steps. Add an `ORDER_PAIRS` entry for the place-dim dependency.

**T2.5 Cloud.** `npm run db:load:municipal-fiscal:pg:cloud`, after
`db:load:place-dim:pg:cloud`. Nothing runs it automatically — document it in `CLAUDE.md`
beside the other standalone loaders, in the same "green locally, stale on prod" framing.

---

## T3 — Gates (`scripts/db/tests/municipal_fiscal.data.test.ts`)

**T3.1 The reconciliation gate — the one that makes the ingest trustworthy.**
`sum(arrears_eur)` over all municipalities **at `quarter = 4`** for year Y must reconcile
against `data/_cache/arrears.json`'s `breakdownEurM.local` for the same Y, within a stated
tolerance. Both sides are year-end stocks; comparing a Q2 sum to the national year-end figure
is a category error, so the quarter filter is part of the assertion, not an optimisation.

Two independent MinFin publications of the same quantity; if they disagree, we learn something
real. Expect a **coverage difference** rather than an exact match — the national "местно
правителство" tier may include районни администрации and municipal budget-funded entities
outside the чл. 130г table. **Set the tolerance from the measured first run and record the
reason for the residual in the test's comment**, rather than picking a round number that
happens to pass. A gate whose threshold was reverse-engineered from the data it guards is
decoration.

Available comparands: local arrears €60.7m (2021), €80.9m (2023), €73.1m (2024), €95.6m (2025).
2022 is unavailable (T5.2).

**T3.2** Every `is_distressed` row has `array_length(criteria_met, 1) >= 3`, and every
`criteria_met` entry is re-derivable from the stored levels and thresholds. This catches a
parser that read the wrong column — the failure that produces a plausible table of wrong
municipalities.

**T3.3** `commitments_eur >= expense_obligations_eur >= arrears_eur` should hold **as a
reported tendency, not an invariant** — the stocks nest conceptually but are measured on
different bases and a município can legitimately violate it. Assert on the *share* of rows that
violate it (alert if it moves), never on individual rows.

**T3.4** Coverage floor: refuse a year with fewer municipalities than the previous year (T1.4's
rule, enforced at the database too).

**T3.5** Every `obshtina` resolves in `place_dim`. An unresolvable code means the workbook uses
a naming scheme we mis-mapped, and it will otherwise surface as a município that silently never
appears on any page.

---

## T4 — Watcher + skill wiring

**T4.1** New `scripts/watch/sources/minfin_municipal_fiscal.ts`, registered in
`scripts/watch/sources/index.ts`.

**T0 settled which arm ships first: the egov one cannot.** The portal is 403 from every egress
available to this operator, so fingerprint via **Wayback CDX** over `minfin.bg/upload/`, as
`minfin_mreports.ts` already does for the Cloudflare-walled bulletins. Wayback 429s this
repo's egress regularly (it did so on every attempt during T0), so the watcher **must degrade
to "unchanged" on 429 rather than throw** — otherwise it cries wolf on every run.

Write the egov arm anyway, behind the same pluggable fetcher as T1, and leave it dormant. It is
~20 lines given `egov_municipal_execution.ts`, and it is what makes the ingest automatic the
day a BG residential IP exists. Do not let the blocked transport dictate the architecture.

**A quarterly source needs a quarterly watcher.** The four filings a year land irregularly;
fingerprint on `(year, quarter) → capture timestamp`, not on a file count, or a re-published
correction to an existing quarter never surfaces.

**T4.2** Extend the existing `update-budget` skill rather than minting a new one — this is
budget data, the skill already owns `data/budget/`, and a separate skill would need its own
`state/ingest/` entry and its own place in `process-watch-report`'s mapping for no gain.

**T4.3** `data/data-changes.json` entry via `process-watch-report`, and the `/data` map + the
`/sources` page gain the new dataset. Both are repo conventions; neither is optional.

---

## T5 — Backfill and the known holes

**T5.1** Backfill as far as `minfin.bg/bg/810` publishes. The чл. 130а regime dates from the
2016 Глава осма „а" amendments (Сливен's plan is against 31.12.2015 data), so **2015 is the
realistic floor** — which is 10 years, and comfortably spans the 2021 inflection the claim is
about.

**T5.2** While in the same browser session, **re-download the corrected Q4-2022 national
arrears file** and re-run `npx tsx scripts/macro/fetch_arrears.ts`. Near-zero cost, and it
fills the hole in the pivotal year — 2022 is where the cash-vs-accrual wedge is widest
(+2.11pp, ~€1.8bn) and where our arrears series is blank.

**T5.3** Same session: backfill **2024-Q4 fiscal reserve** and **2025 `cashBalance`**, both
missing and both on the disputed years.

---

## T6 — The payoff: what becomes answerable

**T6.1 The national aggregate that does not currently exist.** Total contracted-but-unpaid
municipal commitments, per year, in euro. Today the public debate has *one* number — national
arrears, €188.9m in 2025 — and it is the wrong one. Велинград alone carries commitments at
**107.2% of its 4-year average expenditure**; nothing in our data or anyone else's currently
aggregates that.

**T6.2 The cross-check nobody else can run.** We already hold municipal *contracted* value from
the procurement corpus — €1.13bn (2021) → €3.14bn (2025), **2.8×**, against flat municipal
arrears. That is suggestive of forward-scheduled payment but not conclusive, because contracted
value and поети ангажименти are measured differently (ours is contract face value at signing;
MinFin's is the outstanding commitment stock at year-end, personnel and debt excluded).

With both series, per município, the comparison becomes a **direct** one: does a município
whose procurement contracting ran ahead of its cash execution show it in чл. 130а т. 3? If yes,
the claim's mechanism is demonstrated at the municipal tier with two independent sources
agreeing. If no, the procurement ramp is ordinary multi-year EU-programme delivery and the
claim loses its last support. **Either outcome is publishable, which is the mark of a fair
test** — and note the ЗПФ definition excludes personnel and debt, so the two populations
genuinely overlap.

Caveat to carry into any output: 2020 is a **procurement corpus coverage hole** (4,629
contracts corpus-wide against 24k–31k either side) and must be excluded from the ramp, not
plotted as a collapse.

**T6.3 Surfaces.**
- `/governance/:obshtina` — a "Финансово състояние" tile: the six criteria with the município's
  value against its threshold, and the чл. 130а verdict. Self-suppress on no data, per the
  `place_companies` tile precedent.
- A national browse of distressed municipalities, with the чл. 130ж interest-free loans beside
  it. This is the highest-public-interest artifact in the plan.
- Fold the national aggregate into the deficit analysis as its missing term.

---

## Traps, collected

1. **Ratio-only storage** kills the aggregate, the reconcile and the re-basing. T1.1.
2. **The denominators are rolling averages** — a criterion moves when the *past* revises. Store
   the vintage; never present a ratio change as a stock change.
3. **`numeric` money columns** render blank in the browser while being present in the payload.
   `double precision` everywhere. T2.1.
4. **Three stocks, three names.** Any code path, column or label that says "задължения" without
   qualifying which one re-creates the exact confusion this plan exists to end.
5. **Partial-file publish** silently deletes municipalities and reconciles anyway. T1.4/T3.4.
6. **A ceiling tuned to pass** is decoration. T3.1's tolerance must be justified, not fitted.
7. **Wayback 429s this egress routinely** — the watcher must not treat that as a change.
8. **Never complete the Cloudflare Turnstile programmatically.** The manual-drop pattern exists
   precisely because that route is closed, and it works fine.
9. **Arrears are self-reported off-balance-sheet** (T0.4); only `задължения за разходи` is
   МФ-computed. Never label arrears as audited, and prefer commitments as the headline stock.
10. **The criteria are annual; the справка is quarterly.** Never compute `isDistressed` on a
    Q1–Q3 row (T1.1).
11. **The published ratios switch denominator by quarter** — планирани разходи in Q1–Q3,
    отчетени / средногодишни-4г in Q4 — so cols 54–62 are *not* a quarterly series and only the
    Q4 column is the чл. 130а criterion. Chart the levels; re-derive every ratio.
12. **Col A is the МФ/ЕБК code, not EKATTE** (T0.7). Name-match once into a committed,
    gated crosswalk; never resolve inline at parse time.
13. **Both workbooks per year, not one.** Each carries three quarters and they overlap only on
    Q4; taking one file a year silently drops half the series.

---

## Open decisions for the operator

**T0 is done — its fork is resolved.** Build against a saved file with a pluggable fetcher;
the egov arm ships dormant. Three decisions remain:

1. **Backfill depth.** Now a *quarterly* count, not annual: 2015→ is ~44 workbooks to save by
   hand, 2019→ is ~28, and year-end-only (Q4) is ~11 or ~7. Recommendation: **Q4-only back to
   2019 first** (7 files, covers the disputed period, and Q4 is the only quarter the criteria
   are defined on), then widen to all quarters for 2021+ once the parser is proven — the
   within-year build is a second-order question and the schema already holds the grain.
2. **Scope of first cut** — data layer only (T1–T5), or through the governance tile (T6.3)?
   The data layer alone makes the analysis answerable; the tile is a separate week.
3. **Is a BG residential IP or BG VPS worth pursuing?** Not needed for this plan — the manual
   drop works and the files are in hand. It would only ever be a convenience: it turns the
   quarterly download into an automated fetch and lets the dormant egov arm go live.
