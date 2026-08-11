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

## Audit — v1.1, 2026-08-11

Full pass after T0 landed the files, against the codebase. Eleven findings; every one is folded
in below rather than listed and forgotten.

| # | finding | lands in |
|---|---|---|
| 1 | **T1.1's schema ignored two thirds of the workbook.** It modelled the three stocks and the criteria denominators only — the source also publishes приходи, разходи, салдо, **налични средства (the municipal „каса")**, дълг and the eight РМС 436/2017 indicators, all as levels, all for 265 общини. | T1.1, T2.1 |
| 2 | **`isDistressed` conflated two different facts.** Meeting ≥3 чл. 130а criteria *obliges* a recovery procedure; being **in** one is a separate administrative state with its own sheet in the workbook, persisting across years. Conflating them mislabels municipalities in both directions on a page that names them. | **T1.1b**, T2.1, T3.2 |
| 3 | **T1.1 assumed the source key was EKATTE.** It is the МФ/ЕБК code (col A). Both must be stored — the source key for provenance, the resolved one for joins. | T1.1, T2.1, T0.7 |
| 4 | **T3.1 contradicted T0.5.** T3.1 still said "expect a coverage difference, set the tolerance from the first run" after T0.5 measured *exact* agreement. A tolerance chosen to fit is decoration. | T3.1 |
| 5 | **T1.1 carried a dead ratio-only contingency** that T0.5 had already answered, and it proposed back-solving levels from a denominator we hold for 2 of 265 municipalities. | T1.1 |
| 6 | **The published ratios switch denominator by quarter** (planned in Q1–Q3, actual/4y-avg in Q4), so a ratio group's three columns are not a time series and only Q4 is the real criterion. Nothing recorded which basis was used. | **T1.1a** |
| 7 | **No `/api/db` route, no `deploy:db` ordering.** T2.2 defined SQL functions; nothing wired the HTTP surface that the UI reads. | **T2.6** |
| 8 | **No bucket/serving decision.** `data/budget` is bucket-served via `dataUrl()`, so an unstated JSON output invites a second serving path for data that should be PG-only. | **T2.7** |
| 9 | **No exact filenames, and the operator cannot act without them.** | **T7** |
| 10 | **The watcher had no way to REQUEST a manual download** — and neither does any of the ~8 existing manual-step sources. The report has Changed / Unchanged / Skipped / Errors and no "you must fetch something" channel. | **T8** (generic capability) |
| 11 | **No data-page, UI or governance integration at all.** | **T9 · T10 · T11** |

Two further notes that are not defects but change sequencing: the workbook's `СЕС-код 42 и код
98` sheet (EU-funds accounts, same município grain) is **out of scope for v1** and recorded in
T12 so it is a decision rather than an oversight; and the cached negative-trends PDF is
**provenance + national cross-check only** — it is not parsed (T12).

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
type MunicipalFiscalQuarter = {
  mfCode: number;            // МФ/ЕБК code as published (col A) — the SOURCE key
  obshtina: string;          // resolved EKATTE obshtina code, joins place_dim (T0.7)
  nameBg: string;            // col B, kept for crosswalk provenance
  fiscalYear: number;
  quarter: 1 | 2 | 3 | 4;    // REAL grain — the справка is quarterly (T0.3-1)

  // --- the three stocks, as money (native + EUR) — cols 45-53 ---
  commitments:        Money | null;  // поети ангажименти за разходи   (чл. 130а ал. 1 т. 3)
  expenseObligations: Money | null;  // задължения за разходи          (т. 2)
  arrears:            Money | null;  // просрочени задължения          (т. 4)

  // --- the fiscal position, all published as LEVELS — cols 30-44 ---
  revenue:            Money | null;  // приходи по чл. 45 ал. 1 т. 1 (без §46/47/48)
  expenditure:        Money | null;  // разходи по чл. 45 ал. 1 т. 2 (без §19)
  budgetBalance:      Money | null;  // бюджетно салдо                 (т. 5)
  cashOnHand:         Money | null;  // налични средства по бюджета — the municipal „каса"
  debtStock:          Money | null;  // размер на общинския дълг
  debtPerCapita:      Money | null;  // индикатор 4.2, лв./човек (НСИ population)

  // --- denominators, so every ratio is re-derivable rather than trusted ---
  expenditureAvg4y:   Money | null;  // средногодишни отчетени разходи, 4 г.
  expenditureLastY:   Money | null;  // отчетени разходи, последна година
  expenditurePlanned: Money | null;  // планирани разходи за годината (the Q1-Q3 denominator)
  ownRevenueAvg3y:    Money | null;  // + изравнителна субсидия, 3 г.  (т. 1)
  debtServiceAnnual:  Money | null;  // плащания по общинския дълг     (т. 1)

  // --- as published, for provenance and drift detection, never for maths ---
  ratiosPublished: Record<"c1"|"c2"|"c3"|"c4"|"c6", number | null>;
  ratioBasis: "planned" | "actual";  // WHICH denominator the source used — see T1.1a
  indicatorsRms436: Record<string, number | null>; // cols 3-29, the 8 РМС 436/2017 indicators
  collectionDni: number | null;      // col 63, %   (Q4 only)
  collectionDprs: number | null;     // col 64, %   (Q4 only)
  collectionAvg: number | null;      // col 65, %   (Q4 only) — the т. 6 value
  collectionNational: number | null; // the year's national mean, the т. 6 comparand

  // --- Q4 only (T1.1) ---
  criteriaMet: number[] | null;      // which of 1..6 are met; null for Q1-Q3
  meetsThreshold: boolean | null;    // criteriaMet.length >= 3; null for Q1-Q3
  // --- from the SEPARATE „общини фин. оздр." sheet, never derived (T1.1b) ---
  inRecoveryProcedure: boolean;

  sourceFile: string;
  suspect: boolean;
};
```

### T1.1a The published ratios switch denominator by quarter — store which

Cols 54–62 look like one indicator each and are not. **Q1–Q3 divide by планираните разходи за
годината; Q4 divides by отчетените разходи (arrears) or средногодишните разходи за последните
4 години (obligations, commitments).** So only the Q4 column is the actual чл. 130а criterion,
and the three columns of any one ratio group are not a time series. `ratioBasis` records which
denominator the source used so a consumer cannot chart across the break; every ratio the UI
shows is re-derived from the stored levels.

### T1.1b `meetsThreshold` is NOT „в оздравяване" — they are different facts

Meeting ≥3 чл. 130а criteria is what *obliges* a município to open a чл. 130д recovery
procedure. Being **in** one is a separate, administratively-recorded state: it persists across
years while the plan runs, can begin the year after the criteria were met, and can continue
after they stop being met. The workbook keeps them apart too — the `общини фин. оздр.` sheet is
its own list — and so must we. Conflating them mislabels municipalities in both directions on a
page that names them, which is the most defamation-adjacent thing in this plan. Ingest the sheet
as `inRecoveryProcedure`; never derive it.

**Note the criteria are annual by construction** („налични към края на **годината**"), while the
справка is quarterly. So a Q1–Q3 row carries stocks and denominators but **no meaningful
`criteriaMet` / `meetsThreshold`** — those are Q4 verdicts. Compute them only for `quarter = 4`
and leave them null elsewhere; a mid-year "distressed" flag would be a fabrication, and it is
exactly the kind of figure that gets quoted once it exists.

**T0.5 settled this: the source publishes levels.** The contingency that used to sit here — 
back-solving a level from a ratio and a denominator built from `municipal_execution` — is
dropped, and should stay dropped if an older workbook turns out to be ratio-only. We hold
`municipal_execution` for two of 265 municipalities, so any reconstructed euro figure would be
a guess wearing a number's clothes. Leave it null and say so in the payload.

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

**T1.5 A município absent from ONE quarter is not a shrunken file.** ИСО filings can be late,
so `T1.4`'s coverage floor must be evaluated per *file*, not per município: refuse a workbook
whose row count drops, but allow an individual município to be missing from a quarter it did
not file. Those are `absent` (no row written), never `0` — writing a zero would put a município
at „no commitments" on the browse, ranked as the healthiest in the country, purely for filing
late.

**Output:** `data/budget/municipal_fiscal/{year}-Q{q}.json` + `index.json` (per-quarter
coverage, newest quarter present — T8.1 reads this, so it is load-bearing rather than
informational). Committed as loader input only; **not** bucket-synced (T2.7). Raw drops
gitignored.

---

## T2 — Postgres (migration 147) + loader

**T2.1 `147_municipal_fiscal.sql`** — next free number (146 is `tender_dossier`).

```sql
CREATE TABLE IF NOT EXISTS municipal_fiscal (
  obshtina text NOT NULL,          -- resolved EKATTE code (place_dim)
  mf_code int NOT NULL,            -- МФ/ЕБК code as published — keep the source key
  fiscal_year int NOT NULL,
  quarter smallint NOT NULL,       -- no DEFAULT: the grain is real, make callers state it
  -- the three stocks
  commitments_eur double precision,
  expense_obligations_eur double precision,
  arrears_eur double precision,
  -- the fiscal position
  revenue_eur double precision,
  expenditure_eur double precision,
  budget_balance_eur double precision,
  cash_on_hand_eur double precision,
  debt_stock_eur double precision,
  -- denominators
  expenditure_avg4y_eur double precision,
  expenditure_last_y_eur double precision,
  expenditure_planned_eur double precision,
  own_revenue_avg3y_eur double precision,
  debt_service_eur double precision,
  -- collection (Q4 only)
  collection_dni double precision,
  collection_dprs double precision,
  collection_avg double precision,
  collection_national double precision,
  -- verdicts (Q4 only; NULL elsewhere — see T1.1)
  criteria_met smallint[],
  meets_threshold boolean,
  in_recovery_procedure boolean NOT NULL DEFAULT false,  -- from the separate sheet (T1.1b)
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

`criteria_met` / `meets_threshold` are populated **only for `quarter = 4`** (T1.1). A partial
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

**T2.6 The HTTP surface** (`functions/db_routes.js`). T2.2's SQL functions carry no data to a
browser by themselves. Three routes:

- `/api/db/municipal-fiscal?obshtina=&year=` → T10.2's tile payload
- `/api/db/municipal-fiscal-national?year=` → T11.2's card
- the national browse rides the existing **`/api/db/table`** registry engine (a
  `municipal_fiscal` resource), so T10.1 needs no bespoke route.

**Degrade a missing migration to an empty payload**, in the `procurement_settlement_payloads`
(123) shape rather than the `cpv_catalog` (121) one: the tiles self-suppress on empty, so an
orderless first deploy shows nothing instead of 500ing, and the log line
(`mf:not-built`, once per process) is the signal that the cloud loader never ran. Deploy order
is then cosmetic — but keep the documented rule anyway: **`db:load:municipal-fiscal:pg:cloud`
before `npm run deploy:db`.**

**T2.7 Serving is Postgres-only — the JSON is loader input, not a served artifact.**
`data/budget/` is bucket-served via `dataUrl()`, so `data/budget/municipal_fiscal/*.json` would
be picked up by `bucket:sync` and become a *second* serving path for the same numbers, free to
drift from the table. It must **not** get a `bucket_sync_paths.ts` entry, and the UI reads
`/api/db/*` only. This matches the funds family's PG-only rule and the repo's standing "no
JSON-from-PG generation" line; the one thing to avoid is the halfway state where a tile fetches
JSON and a browse queries PG.

Note this cuts the other way from `hub_stats.json` / `sector_stats.json`, which *are* committed
bucket-synced artifacts derived from PG — that pattern exists because those are read by a hub
that must render without a database. Nothing here has that constraint.

---

## T3 — Gates (`scripts/db/tests/municipal_fiscal.data.test.ts`)

**T3.1 The reconciliation gate — the one that makes the ingest trustworthy.**
`sum(arrears_eur)` over all municipalities **at `quarter = 4`** for year Y must reconcile
against `data/_cache/arrears.json`'s `breakdownEurM.local` for the same Y, within a stated
tolerance. Both sides are year-end stocks; comparing a Q2 sum to the national year-end figure
is a category error, so the quarter filter is part of the assertion, not an optimisation.

**Measured 2026-08-11, and it is exact** (T0.5): 143,017,277 лв = €73.1m from the workbook
against €73.1m in `arrears.json`. The feared coverage difference — районни администрации or
budget-funded entities inside the national „местно правителство" tier but outside the чл. 130г
table — **does not exist**. So the tolerance is **≤0.1%**, and any drift is a defect rather
than a reconciliation residual to be explained away.

Available comparands: local arrears €60.7m (2021), €80.9m (2023), €73.1m (2024), €95.6m (2025).
2022 is unavailable (T5.2). Only 2024 is verified so far; **assert every year the backfill
brings in**, and treat a year that fails as a finding about that year's workbook, not a reason
to loosen the gate.

**T3.2** Every `meets_threshold` row has `array_length(criteria_met, 1) >= 3`, and every
`criteria_met` entry is re-derivable from the stored levels and thresholds. This catches a
parser that read the wrong column — the failure that produces a plausible table of wrong
municipalities. **And `criteria_met` / `meets_threshold` are NULL on every `quarter <> 4` row**
(T1.1), which is an assertion, not an implementation detail.

**T3.2a `in_recovery_procedure` must not be derivable from `meets_threshold`** (T1.1b). Assert
both directions occur in the corpus — a município meeting ≥3 criteria and *not* in a procedure,
and one in a procedure *not* currently meeting ≥3. If either set is empty the parser has
probably wired one from the other, and the page would then be asserting a legal status from an
arithmetic test.

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

**T4.1 → superseded by T8.** An earlier draft here proposed fingerprinting `minfin.bg/upload/`
through Wayback CDX, the way `minfin_mreports.ts` does. **Do not build that.** Wayback 429'd
this egress on every attempt during T0, so the probe would be unreliable in exactly the way that
produces a source which errors or flaps — and a flapping source is worse than an absent one,
because it trains the operator to ignore the report.

T8.1 inverts it: watch **our own coverage against the calendar** and emit a named manual
request. Read T8 instead of this section. What survives from the draft: write the dormant egov
arm anyway (~20 lines given `egov_municipal_execution.ts`) so the blocked transport does not
dictate the architecture.

**T4.2** Extend the existing `update-budget` skill rather than minting a new one — this is
budget data, the skill already owns `data/budget/`, and a separate skill would need its own
`state/ingest/` entry and its own place in `process-watch-report`'s mapping for no gain.

**T4.3** `data/data-changes.json` entry via `process-watch-report`, and the `/data` map + the
`/sources` page gain the new dataset — specified in **T9**. Both are repo conventions; neither
is optional.

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
10. **The criteria are annual; the справка is quarterly.** Never compute `meetsThreshold` on a
    Q1–Q3 row (T1.1).
11. **The published ratios switch denominator by quarter** — планирани разходи in Q1–Q3,
    отчетени / средногодишни-4г in Q4 — so cols 54–62 are *not* a quarterly series and only the
    Q4 column is the чл. 130а criterion. Chart the levels; re-derive every ratio.
12. **Col A is the МФ/ЕБК code, not EKATTE** (T0.7). Name-match once into a committed,
    gated crosswalk; never resolve inline at parse time.
13. **Both workbooks per year, not one.** Each carries three quarters and they overlap only on
    Q4; taking one file a year silently drops half the series.

---

## T7 — The download protocol: exact filenames

### T7.1 The naming rule, derived from the three files in hand

Each release is `1. quarterly-reports-Q{q}{Y−1}-Q4{Y−1}-Q{q}{Y}-website.xlsx` — three quarters
in prev / final / current order, where **the middle column is always Q4 of the previous year**.

Verified against what we hold:

| file | prev | final | current |
|---|---|---|---|
| `1. quarterly-reports-Q22024-Q42024-Q22025-website.xlsx` | Q2-2024 | **Q4-2024** | Q2-2025 |
| `1. quarterly-reports-Q32024-Q42024-Q32025-website.xlsx` | Q3-2024 | **Q4-2024** | Q3-2025 |

The narrative PDF is `4. municipal-analysis of negative trends {DD} {MM} {YYYY}.pdf`, dated to
the quarter end — `31 03`, `30 06`, `30 09`, `31 12`. Verified: `…31 03 2025.pdf`.

### T7.2 That rule collapses the backfill from ~28 files to 5

Because the middle column is the previous year's Q4, **one file per year yields that year's
year-end** — the only quarter on which the чл. 130а criteria are defined — *plus* two Q3
comparands. Q4-2024 is already in hand from both files, so to reach 2019:

```
1. quarterly-reports-Q32023-Q42023-Q32024-website.xlsx   → Q4-2023  (+ Q3-2023, Q3-2024)
1. quarterly-reports-Q32022-Q42022-Q32023-website.xlsx   → Q4-2022  (+ Q3-2022, Q3-2023)
1. quarterly-reports-Q32021-Q42021-Q32022-website.xlsx   → Q4-2021  (+ Q3-2021, Q3-2022)
1. quarterly-reports-Q32020-Q42020-Q32021-website.xlsx   → Q4-2020  (+ Q3-2020, Q3-2021)
1. quarterly-reports-Q32019-Q42019-Q32020-website.xlsx   → Q4-2019  (+ Q3-2019, Q3-2020)
```

Five files give Q4-2019 → Q4-2024 (six year-ends, the whole disputed period) and a Q3 series
from 2019. **The Q3-anchored release is the one to take** — the Q2 one duplicates the same
middle column for no extra year-end.

### T7.3 What is predicted vs verified — read this before hunting

**The rule is derived from two samples, both 2025 releases.** The `-website` suffix, the `1.`
prefix and the three-quarter structure are almost certainly not stable back to 2019. So:

- **Save whatever the page actually offers for that year, unrenamed**, even if the name differs
  from the prediction above. The parser reads the periods from **row 2** and only cross-checks
  the filename, so a differently-named file still ingests correctly (T1 must be written that
  way round — filename as a hint, row 2 as the truth).
- **Report the real filenames back** so T7.1's rule can be corrected rather than assumed.
- **Q4-anchored releases are an unknown shape.** Under the rule a Q4-2025 release would be
  `Q42024-Q42024-Q42025`, whose first two columns are identical — degenerate, so MinFin
  probably uses a different layout. Do not predict it; look.
- **Items `2.` and `3.` on the page are unknown.** The prefixes we have are `1.` and `4.`, so
  the release carries at least four items. Worth listing once — one of them may be the СЕС
  companion or a methodology note.

### T7.4 The standing ask, per quarter

For each new quarter, two files:

```
1. quarterly-reports-Q{q}{Y-1}-Q4{Y-1}-Q{q}{Y}-website.xlsx
4. municipal-analysis of negative trends {quarter-end DD MM YYYY}.pdf
```

from <https://www.minfin.bg/bg/810>, into `data/_cache/minfin_municipal_fiscal/`, unrenamed.
T8 asks for these by name automatically.

---

## T8 — Watching a source we cannot fetch, and asking for it

### T8.1 A "due" watcher, not an upstream fingerprint

minfin.bg is Turnstile-walled and Wayback 429s this egress, so **fingerprinting the upstream is
not reliably possible**. Watching it anyway would produce a source that errors or flaps, which
is worse than not watching it.

Invert it: watch **our own coverage against the calendar**. `municipal_fiscal_due`
(`scripts/watch/sources/municipal_fiscal_due.ts`):

- read the newest `(year, quarter)` present in `data/budget/municipal_fiscal/index.json`;
- compute the newest quarter that *should* be published, = quarter end + a publication lag;
- fingerprint on `(newest-have, newest-due)`. Behind → `changed`.

This never claims a file exists — it says "by the calendar Q3-2025 is due and we hold Q2-2025".
The worst case is asking for something not yet published, which costs one look at a page.

**Set the lag from observation, not from a guess.** We have one datapoint (the Q1-2025 analysis
is dated 31.03.2025; its publication date is unknown). Start at **90 days** — conservative, so
the watcher under-asks rather than nags — and tighten it once two or three publication dates
have been observed. Record the observed lag in the source file as it is learned.

`publishes: "quarterly"` (90 days) and `cadence: "weekly"` — `cadence.test.ts` enforces
sampling at least twice per publication period, so weekly is comfortably inside it and monthly
would also pass.

### T8.2 A generic manual-request channel — the repo needs this anyway

The watcher can detect the gap; it currently has **no way to say what to do about it**.
`renderReport` emits Changed / Unchanged / Skipped / Errors, and "changed" on this source means
"go download a file", not "an ingest can now run" — a distinction the orchestrator cannot see.

At least eight existing sources are in the same position and each solves it in prose somewhere
else: TI CPI and Eurobarometer (manual paste), `ministry_execution_reports`'s `manual-pdf`
entries, `minfin_program_otchet`, `capital_programs` (+ its `UNWATCHABLE` Vidin), LISI, НОИ B1,
and now this one. So make it a first-class capability rather than a special case:

```ts
// scripts/watch/types.ts
export interface ManualRequest {
  /** One line: what the operator must do. */
  instruction: string;
  /** Where to get it. */
  url: string;
  /** Exact filenames to save, when derivable (T7). */
  files?: string[];
  /** Where they go. */
  dropDir?: string;
}

export interface WatchSource {
  // …
  /** Non-null when this source needs a human to fetch something before any
   *  ingest can run. Evaluated every run, independent of `changed`. */
  manualRequest?(prev: WatchState | null, curr: Fingerprint): ManualRequest | null;
}
```

`renderReport` gains a section, placed **above `## Changed`** because it blocks:

```markdown
## Manual downloads needed
- **Финансови показатели на общините**: Q3-2025 is due (we hold Q2-2025).
  Save from https://www.minfin.bg/bg/810 into data/_cache/minfin_municipal_fiscal/:
  - `1. quarterly-reports-Q32024-Q42024-Q32025-website.xlsx`
  - `4. municipal-analysis of negative trends 30 09 2025.pdf`
```

Two rules so the section stays worth reading. It renders **only** when
`manualRequest()` returns non-null — a source with nothing outstanding contributes nothing, or
the section becomes a permanent block of noise everyone scrolls past. And it is **idempotent**:
the request keeps appearing every run until the file lands, because that is the true state, but
`## Changed` must not also fire on the same fact every day — the fingerprint moves only when
`(newest-have, newest-due)` moves, so a still-missing quarter is `unchanged` with a standing
manual request. That distinction is the whole design: **"still needed" is not "changed".**

### T8.3 `process-watch-report` wiring

Three edits to `.claude/skills/process-watch-report/SKILL.md`:

1. **Mapping table** (both the report-label table and the canonical `state/watch` id table):

   | source | skill |
   |---|---|
   | `Финансови показатели на общините (ЗПФ чл. 130г)` / `municipal_fiscal_due` | `update-budget` (municipal-fiscal sub-step) — **manual download first, see below** |

2. **A new Procedure step, ahead of skill invocation.** Read every source's manual request;
   surface them as a single up-front list; do **not** invoke a skill whose input is still
   missing. The orchestrator should report "Q3-2025 requested, not yet downloaded — skipped"
   rather than run an ingest that will find nothing and stamp a successful marker over it.
   That last part is the real hazard: a skill that runs on an absent file and exits 0 writes
   `lastSuccessfulIngest`, and the request never surfaces again.
3. **A `### Municipal fiscal: manual download first` section**, in the shape of the existing
   `### Governments: manual edit first` and `### TI CPI: manual paste first`, carrying T7's
   filename rule so the instruction is reproducible without opening this plan.

**`state/ingest/update-budget.json` must not be stamped by a run that skipped this sub-step.**
Either give the sub-step its own marker (`update-budget-municipal-fiscal`) or make the stamp
conditional. The first is cleaner and matches how the skill already separates its paths.

---

## T9 — Data pages

**T9.1 `/data` map** (`scripts/data_map/model.ts`). Two edits:

- add `municipal_fiscal_due` to the existing **`minfin` source node's** `members` array (it
  already carries `minfin_mreports`, `minfin_eurobond`, `minfin_program_otchet` and
  `skills: ["update-budget"]`, so the node needs no other change);
- add a **dataset node** for the municipal fiscal series — `label` „Финансови показатели на
  общините", `origin: "state"`, `cadence: "weekly"` (our probe), `route` to T10.1's page,
  `skills: ["update-budget"]`, `path: "data/budget/municipal_fiscal"`.

The manifest is bucket-served (`data/data_map.json`), so this ships on `bucket:sync` without a
Firebase deploy — but it **is** code-coupled for structure and labels, so the model edit and the
manifest rebuild go together.

**T9.2 `/data/sources`** (`src/screens/DataSourcesScreen.tsx` + `src/lib/officialSources.ts`) —
add МФ „Финансови показатели на общините" with the чл. 130г ал. 2 basis and the ИСО upstream.
Name the **self-reported** nature of the arrears arm here, not only in the plan: the sources
page is where a reader goes to decide how much to trust a number.

**T9.3 `/data/updates`** — free, provided T2.3's `ingest_changelog.ts` wiring lands
(`recent_updates()`), plus the per-skill `data/data-changes.json` stamp from
`process-watch-report`. Both are required by repo convention; neither is optional.

---

## T10 — UI integration

### T10.1 `/governance/municipal-finance` — the national browse (the flagship)

A `DbDataTable` over 265 municipalities. Server-side, on the shared registry engine, so search /
sort / paging cost nothing new. Columns:

| column | why |
|---|---|
| община | links to `/governance/:obshtina` |
| **поети ангажименти** | the headline stock, absolute |
| **на жител** | the only cross-município comparable — GRAO population |
| **% от средногодишните разходи (4 г.)** | the чл. 130а т. 3 ratio, re-derived, with the 50% threshold marked |
| задължения за разходи | + its 15% threshold |
| просрочени задължения | + its 5% threshold |
| дълг · салдо · налични средства | the fiscal position |
| чл. 130а | „N от 6 критерия" |
| оздравяване | the **separate** administrative state (T1.1b) |

Filters: `?year` · `?q` · `?crit=3` (meets ≥N criteria) · `?recovery=1`. Default sort:
commitments per resident, descending.

**Per-resident is the honest default** and absolute is the trap: Столична община will top every
absolute column by construction, which tells a reader nothing and buries the small distressed
municipalities the page exists to surface.

### T10.2 The municipality tile — `/governance/:id`

`MyAreaMunicipalFiscalTile`, a **new** tile rather than a third story inside
`MyAreaMunicipalBudgetTile`. The existing tile answers *what does this община receive* (чл. 53
transfers + cash execution); this one answers *what does it owe and to whom is it committed*.
Different question, and the existing tile is already two stories deep. Place it directly after,
so the pair reads money-in then money-owed.

Content, in order:

1. **Headline: „Поети ангажименти на жител — €X"**, with the national median and the
   município's rank. One number, comparable, and the thing nobody currently publishes.
2. **A three-bar stack** — ангажименти / задължения / просрочени — at one scale, which makes
   the nesting visible and kills the conflation this whole plan is about.
3. **The чл. 130а strip**: six criteria, each a value against its threshold, met ones marked.
   Only on Q4 rows (T1.1). „N от 6" and the ≥3 rule stated in words.
4. **If `in_recovery_procedure`**: a factual callout — in a чл. 130д procedure since YYYY,
   with a link to the município's own plan where we have one. **Never styled as an alarm.**
5. **Coverage line**: the quarter, and that arrears are self-reported.

**Sofia:** the S2xxx district dashboards must show Столична община's row (mf code 7200)
explicitly labelled „за Столична община като цяло" — the same `oblastFromObshtina` mapping
`MyAreaMunicipalBudgetTile` already uses. Silently showing city-wide figures on a district page
is the reading error to avoid.

### T10.3 Elsewhere on the site

- **`/budget`** — a national line: municipal commitments beside the state deficit, since the
  reader who came for "how big is the deficit" is exactly the reader missing this.
- **`/indicators/fiscal`** — `CabinetBudgetScorecard` already renders national arrears per
  cabinet-year. Add the **municipal commitments** column beside it; it is the same table's
  natural fourth measure and the contrast (arrears flat, commitments 2.8×) is the finding.
- **`/procurement` cross-link** — T6.2's two-source comparison, per município.
- **A `naiasno-post`** on the 46× finding once the backfill lands and the trend is multi-year.

### T10.4 What NOT to build

No map choropleth in v1. Commitments per resident is dominated by whether a município is
mid-way through a big EU project, so the map would render project timing as municipal
recklessness — a strong visual making a claim the data does not support. Revisit only with a
multi-year series where a *sustained* level can be distinguished from a spike.

---

## T11 — Governance dashboards

**T11.1 `/governance` hub** — a tile in the existing **`gov_hub_cluster_money`** cluster
(beside budget / procurement / funds / subsidies / sectors), routing to T10.1.

**T11.2 `/governance/overview`** (`GovernanceCards`) — a national card. `GovernanceDebtTile`
already carries state debt; municipal commitments are its natural sibling and the pairing is
the point: **€34.6bn state debt is watched monthly; €4.2bn of municipal commitments is
watched by nobody.** Keep the two visually adjacent and separately labelled — they are not
summable and must never appear as one total.

**T11.3 `/governance/region/:oblast`** — an oblast rollup: the oblast's municipalities summed,
plus how many meet ≥3 criteria and how many are in a recovery procedure. Cheap (a GROUP BY on
a table already joined to `place_dim`) and it is the level at which a пattern is visible —
distress clusters regionally.

**T11.4 `/governance/sectors`** — **no**. This is not a sector; it is a tier of government.
Adding it to `sectorRegistry` would put it beside water/transport/health where it does not
belong and would dilute a registry whose coherence is its value.

**T11.5 The through-line to state.** The governance view's spine is *who spends your money and
how well*. Municipal commitments belong on it because they are the one liability the state's
own headline numbers exclude — the consolidated cash deficit records a municipal payment when
it is made, so a município's forward commitments are invisible nationally until they are paid.
Say that in the copy; it is the reason the page exists and it is defensible.

---

## T12 — Deliberately out of scope for v1

Recorded so each is a decision rather than an oversight.

- **`СЕС-код 42 и код 98` sheet** (EU-funds and other accounts, 272 × 50, same município
  grain). A second corpus with its own semantics; folding it in doubles the parser and the
  gates for a question this plan does not ask. Own tier once v1 is serving.
- **The negative-trends PDF is not parsed.** It is provenance and a national cross-check (it
  is how the Q4-2024 arrears figure was confirmed a third way). Parsing МФ's prose into a
  narrative series is a different kind of work with a different failure mode.
- **The eight РМС 436/2017 indicators are stored but not surfaced.** They are cheap to carry in
  the same row and expensive to design a UI for; T1.1 keeps them so a later tier does not need
  a re-ingest.
- **No pre-2019 backfill** until the naming rule is confirmed against a real 2020 release
  (T7.3).

---

## Open decisions for the operator

**T0 is done and the files are in hand.** Three decisions remain:

1. **Backfill depth.** T7.2 changes this materially: it is **5 files, not ~28**, because each
   release's middle column is the previous year's Q4. Recommendation: **take the five
   Q3-anchored releases 2020–2024** → Q4-2019 … Q4-2024 plus a Q3 series. If the naming rule
   breaks on the older ones, stop at whatever resolves and report the real names (T7.3).
2. **Scope of first cut** — data layer only (T1–T5), or through T10.2's municipality tile? The
   data layer alone makes the analysis answerable. Recommendation: **T1–T5 + T8**, because the
   watcher is what stops the corpus silently going stale a quarter from now, and it is cheap.
3. **Is the generic `manualRequest` channel (T8.2) in scope here, or its own change?** It is
   ~40 lines across `types.ts` / `report.ts` / the skill, it unblocks this source, and it
   retro-fits at least eight existing manual-step sources. Recommendation: **do it here** — it
   is the difference between a watcher that helps and one that says "changed" and stops.
