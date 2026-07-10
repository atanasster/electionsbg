# НЗОК hospital intelligence v1

Closing the capability gaps on the health pack (`/awarder/121858220`, `/company/:eik`).

Status: PHASES 0, 1, 2 and 4 (lineage) IMPLEMENTED 2026-07-10; Phase 3 and
Phase 5 NOT built. Written 2026-07-10.

## Implementation status

| Phase | State |
|---|---|
| 0 — payment streams | **SHIPPED**. Migration 050, parser `stream` arg, loader walks all three, watcher fingerprints all three. |
| 1 — ЕЕОФ financials | **SHIPPED**. `parse_eeof.ts` + `write_eeof.ts`, migration 051, loader, 2 routes, 2 tiles. 26 quarters. |
| 2 — drug unit prices | **SHIPPED**. `parse_drug_unit_prices.ts` + writer, migration 052, loader, 3 routes, 1 tile. |
| 3 — clinical-pathway activity corpus | **NOT BUILT.** Consequence: no per-patient ranking anywhere, enforced in SQL comments, TS types and tile footnotes. |
| 4 — lineage (`contracts.unp`) | SHIPPED earlier. The two red flags remain unbuilt. |
| 5 — crosswalk tail / `opendata.his.bg` | **NOT BUILT** (still a spike). |
| 6 — surface | Tiles, routes, hooks, watchers, data-map, skill doc: done. AI tools + SEO/OG: not done. |

Verified end-to-end: all three payment streams reconcile against their own header
totals (bmp 0.024%, drugs 0.000%, devices 0.000%); Св. Екатерина FY2025 went from
31.6M лв (БМП only) to **43.6M лв**, against the 46.9M лв a public reference
reports for the same hospital's НЗОК revenue — the residual being accrual-vs-cash
and outpatient. The ЕЕОФ `НЗОК` parity sheet independently corroborates all three
streams: per quarter, its accrual figures land within a few percent of the cash
YTD ÷ 3 for bmp, drugs and devices alike.

Original plan text follows. Every external source below was probed live on
that date; response codes, row counts and column headers are recorded inline so
the next session does not re-discover them.

Prior art: the health pack (per-hospital БМП payments, drug reimbursement by INN,
budget bridge, execution pace, momentum/percentile, regional choropleth) already
ships. This plan adds the four things that pack cannot currently answer:

1. How much money in total does a hospital get from НЗОК? (today we answer only
   the БМП slice)
2. Is a hospital financially healthy — debt, overdue debt, cost per patient?
3. Does a hospital pay more than its peers for the *same pack of the same drug*?
4. Is a procurement award above its own published estimate, and how much did
   annexes add after signature?

---

## Guiding constraint: peer comparison must be case-mix adjusted

The naive version of (3) and of any "cost per patient" ranking is wrong, and
wrong in a way that is easy to ship and hard to retract. An oncology dispensary
spends multiples of a general hospital's drug cost per patient because it
dispenses antineoplastics. Nationally, ATC L01 is roughly 87% of hospital drug
reimbursement. Ranking a СБАЛОЗ against a "peer group" defined by the string
"МБАЛ" vs "УМБАЛ" reproduces the specialty, not a finding.

So: **no per-patient or per-unit outlier ships without a case-mix denominator.**
Phase 3 (activity corpus) is therefore a prerequisite for the headline claims of
Phase 2, not an optional extra. Where case-mix cannot be controlled, we publish
the raw figure descriptively and say so, the way `NzokRegionalChoroplethTile`
already footnotes that it attributes spend to the hospital's РЗОК rather than
patient residence.

Unit-price comparison must be at **pack identity** (`Национален №` / `НЗОК код`),
never at INN — otherwise pack size and dosage form silently drive the "anomaly".

---

## Phase 0 — Fix the per-hospital payment base (correctness bug)

**Problem.** `nzok_hospital_payments` carries the БМП PDF only. The monthly
publication is three files, not one. Our per-hospital number therefore understates
what a hospital actually receives, and every downstream tile inherits the error.

Measured: Св. Екатерина (ЕИК 831605845) reads €16.17M for FY2025 in our table.
Its total НЗОК revenue for the same year is materially higher — the difference is
drugs and medical devices, which we never parse.

**Source (verified 2026-07-10).** `https://nhif.bg/bg/hospitals/bmp/{year}` →
HTTP 200, 36 file links for 2025 = 12 months × 3 families:
- `Заплатени здравноосигурителни …` — БМП (what we parse today)
- `Заплатени средства за ЛП …` — lekarstveni produkti (drugs in hospital)
- `Заплатени средства за МИ …` — meditsinski izdeliya (devices)

**Work.**
- Generalise `scripts/nzok/parse_hospital_payments.ts` over a `stream` dimension
  (`bmp` | `drugs` | `devices`). The three PDFs share the Excel-to-PDF layout, so
  `pdftotext -layout` + the existing `extractAmounts(tail, cols)` should carry;
  confirm column count per family before trusting it.
- Migration: add `stream text NOT NULL DEFAULT 'bmp'` to
  `nzok_hospital_payments`, move the PK to `(reg_no, period, stream)`.
- Backfill the two new streams across the year range already loaded.
- Update `nzok_hospital_payments_latest` / `nzok_hospital_reimbursement_by_eik`
  to sum streams, and expose the split so a hospital page can show
  "БМП / лекарства / медицински изделия".

**Guard.** [[nzok-health-pack]] records the lesson: a parser change once dropped
€201K silently inside the 0.5% reconciliation tolerance. After any parser edit,
assert the **latest-period total per stream**, not just the facility count.

**Cheaper cross-check.** The МЗ workbook in Phase 1 carries all three streams per
`Рег.№ ЛЗ` quarterly. Use it as an independent parity reference for Phase 0
rather than as the serving source (it is quarterly and lags).

---

## Phase 1 — Hospital financial + activity indicators (ЕЕОФ)

The largest gap. We hold zero per-hospital financial or capacity data today.

**Source (verified 2026-07-10).**
`https://www.mh.government.bg/bg/politiki/standart-za-finansovo-upravlenie-na-drzhavnite-lechebni-zavedeni/`
→ HTTP 200. Publishes **"Финансови показатели на лечебни заведения за болнична
помощ"**, one XLSX per quarter, **2019 Q2 → 2025 Q3** (26 files). Legal basis:
Наредба № 5 от 17 юни 2019 г. Also on the page: the blank ЕЕОФ templates
(state / municipal / monthly personnel) — templates only, not filled data.

Workbook shape (checked against 2025 Q3, `/upload/17415/…2025 Q3.xlsx`):

| Sheet | Rows | Key | Contents |
|---|---|---|---|
| `Държавни ЛЗБП Q3` | 67 | hospital **name** | 25 indicator groups |
| `Общински ЛЗБП Q3` | 122 | hospital **name** | same 25 groups |
| `НЗОК Q3` | 394 | **`Рег.№ ЛЗ`** | БМП payments + devices + drugs, per quarter, with YoY |

The 25 indicator groups on the state/municipal sheets:
total revenue; total expense; cost-efficiency coefficient; personnel cost and its
share; издръжка cost and share; drugs-and-devices cost and share; total
liabilities; **overdue liabilities**; three debt-ratio columns; patients treated;
average monthly doctors; average monthly nursing specialists; patients per doctor;
patients per nurse; average monthly beds; bed-days; cost per bed-day; **cost per
patient**; average length of stay; **bed occupancy %**.

Each group carries three period columns (prior-year quarter, prior quarter,
current quarter) plus change columns — so a single file already yields a YoY and
a QoQ without a backfill, and 26 files yield a genuine series.

**This sheet trio also closes Phase 0's join problem**: the `НЗОК` sheet is keyed
by `Рег.№ ЛЗ`, the exact key `data/budget/nzok/hospital_eik.json` already
crosswalks to EIK. The state/municipal sheets are keyed by name only — resolve
them through the `НЗОК` sheet where a name/reg pairing exists, and fall back to
the existing fold-and-match tokeniser.

**Work.**
- `scripts/budget/nzok/parse_eeof.ts` — fetch listing, resolve the 26 upload URLs
  (Cyrillic filenames are URL-encoded; `xlsx.read(readFileSync(path), {type:"buffer"})`,
  never `xlsx.readFile`, per the bundled-xlsx fs restriction).
- Header is two-row (group row + period row). Build the column map from the pair;
  do not hard-code offsets — the group set is stable but the ordering is not
  guaranteed across 2019→2025.
- Units: **хил. лева**. Convert to EUR at 1.95583 and store EUR, per
  [[feedback-bg-uses-eur]]. Store the native value too for parity assertions.
- Skip the `ОБЩО/СРЕДНО` and legal-form subtotal rows (` ЕАД`, ` АД`, ` ЕООД`) —
  they are aggregates interleaved with facilities.
- Migration `0NN_hospital_financials.sql`: table `hospital_financials`
  (`eik`, `reg_no`, `name`, `quarter`, `ownership`, 25 indicator columns, native
  + EUR). Index `(eik, quarter DESC)` and `(quarter DESC, …)` per
  [[reference-pg-query-performance]].
- jsonb fns + `/api/db` routes with `missingMigrationEmpty`, mirroring the
  `nzok-hospital-*` routes.
- `recordIngestBatch` + `recent_updates` wiring — mandatory, per
  [[feedback-pg-changelog-required]].

**Known unresolved.** Two indicators visible on comparable public dashboards are
**not** in this file: **леталитет (in-hospital mortality)** and **salary by staff
position**. The monthly personnel ЕЕОФ exists as a blank template on МЗ but the
filled returns are not published there. Treat as a spike (below) — do not promise
a mortality tile until the source is located.

---

## Phase 2 — Per-hospital drug unit prices

This is the item previously recorded as BLOCKED. It is not blocked; we were
looking at the wrong file. The "Брутни разходи по INN" annual XLS has no quantity
column, but a different НЗОК publication does.

**Source (verified 2026-07-10).** `https://nhif.bg/bg/nzok/medicine/5` → HTTP 200,
73 files, `Справка 5_ПЛС2_{MM.YYYY}.xls` monthly plus `…_{YYYY}.xls` annual.
Title: *"Разходи и брой болни за противотуморни лекарствени продукти и
лекарствени продукти за коагулопатии, заплащани извън стойността на КП/АПр — по
РЗОК, лечебни заведения и МКБ код на заболяването"*.

One sheet named for the period. 05.2026 has **18,824 rows**. Columns:

```
РЦЗ | Наименование на леч.заведение | ATC код | INN | Национален № | НЗОК код |
Търговско наименование | Лекарствена форма | Колич. на лекарственото в-во |
Брой в опаковка | МКБ код | Наименование на заболяването |
Брой на ЗОЛ | Опаковки | Реимбурсна сума
```

Three properties make this the strongest asset in the plan:
- `РЦЗ` **is** the `Рег.№ ЛЗ` (e.g. `0103211015`) — joins our crosswalk 1:1, no
  name matching.
- Unit price is derivable: `Реимбурсна сума / (Опаковки × Брой в опаковка)`.
- `МКБ код` is on every row — the case-mix denominator the guiding constraint
  demands, in the same file.

Sibling cuts, same section: `medicine/6` (by МКБ), `medicine/7` (by ATC),
`medicine/1`–`4` (by НЗОК/МКБ code, with and without РЗОК).

**Work.**
- `scripts/nzok/parse_drug_unit_prices.ts` (xls, codepage 1251, buffer read).
- Migration `0NN_nzok_drug_unit_prices.sql`: fact table at
  `(reg_no, period, national_no, icd)` with packs, units, amount; plus a derived
  `unit_price_eur`. Roughly 19k rows/month → low hundreds of thousands per year;
  index `(national_no, period)` and `(reg_no, period)`.
- Peer engine: per `(national_no, period)` compute median / p25 / p75 across
  facilities holding ≥ N packs (set a volume floor — a single-pack purchase has
  no negotiating context and will dominate any ratio).
- Overpay-vs-median = `(unit_price − median) × units`, reported **with** the
  volume floor and the pack identity stated, never as an accusation.
- The differentiator a single-year corpus structurally cannot produce: **is the
  gap widening or closing?** Same INN, same pack, same hospital, month over month
  across the 73 files. That is the tile.

**Trap to avoid.** Price dispersion for the same pack has legitimate causes:
volume discount, delivery period, contract terms. State them, as the source
itself does. The claim we can defend is *persistent* dispersion, not a single
month's ratio.

Off-label / Наредба 10 (2011) therapies (no ceiling price, individually approved
by МЗ) are a separate, smaller corpus and a later phase — source not yet located
on mh.government.bg; add to spikes.

---

## Phase 3 — Clinical-pathway activity corpus

**Source (verified 2026-07-10).**
`https://nhif.bg/bg/hospitalcare-report/activities/{year}` → HTTP 200, 12 files
for 2025, `Брой случаи и брой ЗОЛ по …`.

Gives cases and insured-persons per clinical pathway (КП) / ambulatory procedure
(АПр) / clinical procedure (КПр) per facility per month.

**Why it is load-bearing.** It supplies:
- the case-mix vector per hospital that Phase 1 (cost per patient) and Phase 2
  (drug spend per patient) need as a denominator;
- a defensible **cases-per-bed** outlier check within a pathway — an over-reporting
  signal that does not require a black-box model, because the comparison is
  pathway-internal;
- pathway concentration: a hospital shifting volume toward higher-priced pathways.

Pathway prices are published in the НРД; join to get value per pathway.

---

## Phase 4 — Contract↔tender lineage, and the two missing red flags

Investigated in depth 2026-07-10 against local PG and the raw ingest files. The
earlier read of this phase ("lineage exists only for 2026") was an artifact of
joining on `ocid`. **The join key is `УНП` — the unique procurement number — and
it is already present on both sides for most of the corpus.**

### 4.0 The key

`tenders.unp` (format `00353-2019-0127`) is populated on all 126,042 tender rows,
2020-01-02 → 2026-07-09, unique per row. On the contracts side the УНП is
reachable by three different routes, one per ingest era:

| Contract era | ocid namespace | Route to УНП | Status |
|---|---|---|---|
| 2024–2025 (ЦАИС flat договори) | `eop-<УНП>` | `substring(ocid from 5)` — the ocid **is** the УНП | free, no reparse |
| 2016–2023 (АОП legacy CSV) | `aop-legacy-<ds>-<docId>` | raw CSV column `УНП` (2022 file: `Уникален номер на поръчката`) | present in raw, **never mapped** by `legacy_csv.ts` |
| 2026 (OCDS bundles) | `ocds-e82gsb-*` | `tenders.ocid` → `tenders.unp` | already joins |

The legacy raw files were re-parsed to check: 142,462 rows carry a well-formed
УНП, collapsing to **87,272 distinct `(file, documentId)` pairs, and every one maps
to exactly one УНП — zero conflicts.** `legacy_csv.ts` reads the row and drops the
column (`COLUMN_PATTERNS` has no `unp` entry).

Two legacy files are unusable, both harmlessly: `2011-2015.csv.gz` is actually
JSON (`aop-2011-2015.json`, gzip metadata confirms) and `2018.csv.gz` has no УНП
column at all (it carries `S51.ID` instead). Both predate the tender corpus, so
nothing is lost.

### 4.1 The ceiling is the tenders corpus, not the contracts side

`tenders` starts at procedure-year 2020, and its 2020 slice is thin (8,284 rows
against ~20k real procedures — ЦАИС ЕОП rolled out during that year).
Joinability of legacy contract rows, by the **procedure** year embedded in the
УНП (not the contract's own date):

| Procedure year | rows | joins | pct |
|---|---|---|---|
| ≤2019 | 24,080 | 0 | 0.0% |
| 2020 | 9,809 | 4,835 | 49.3% |
| 2021 | 8,631 | 8,609 | 99.7% |
| 2022 | 30,243 | 30,085 | 99.5% |
| 2023 | 24,049 | 23,173 | 96.4% |

Resulting coverage per contract-date year, counting rows that would gain a usable
`estimated_value_eur`:

| Contract year | contracts | with estimate | pct |
|---|---|---|---|
| 2019 | 18,171 | 0 | 0.0% |
| 2020 | 4,131 | 4,115 | 99.6% |
| 2021 | 5,878 | 190 | 3.2% |
| 2022 | 30,537 | 28,490 | 93.3% |
| 2023 | 34,494 | 31,715 | 91.9% |
| 2024 | 39,443 | 30,665 | 77.7% |
| 2025 | 42,898 | 38,964 | 90.8% |
| 2026 | 17,102 | 15,521 | 90.8% |

2021 looks anomalous but is not: contracts *dated* 2021 overwhelmingly reference
procedures from 2018–2020 (only 1,887 of 3,324 reference 2020 at all), and the
2020 tender slice is half-empty. It is a source limit, not a bug.

**Residual causes, 2024 (the weakest joinable year):**
- 4,923 rows — УНП well-formed, procedure-year 2023, simply absent from `tenders`.
- 3,693 rows — `eop-T*` ocids (see below).
- 135 rows — stray `aop-legacy` rows.

**`eop-T*` (7,403 rows across 2024–25).** `normalize_eop.ts:172` sets
`ocid = eop-${unp || contractNumber}`, so a source record with **no** УНП falls
back to the contract number. These cannot be joined: `tenders.tender_id` matches
0 of 7,403; `tenders.notice_id` matches 1,009 (13.6%) — far too weak to publish
against. Correct handling is `available: false`, not a guess.

### 4.2 Correction: there is no consortium double-count

An earlier draft of this plan claimed multi-supplier awards inflate our totals
because each member repeats the full amount. **That is wrong.** Both normalizers
already apportion:

- `normalize_eop.ts:203-207` — `amountPer = amount / validSupplierCount`
- `normalize.ts:309-313` and `:396-399` — same split on the OCDS path

So contract rows for one award **sum back to the awarded total**, and the correct
aggregation is a plain `SUM(amount_eur)` grouped by procedure. Do **not** dedupe
by `contract_id`; that under-counts by `(n−1)/n`.

Verified end-to-end on the largest multi-supplier award in the corpus — МЗ's drug
framework `eop-00080-2024-0030`, 16 supplier rows: `SUM(amount_eur)` =
€1,306,709,898, against a published estimate of €1,306,709,898. Exact.

### 4.3 Above-estimate flag (4a) — analysed 2026-07-10, spike RESOLVED

**The `lots_count = 0` spike is closed, and the answer changes the design.**

`lots_count = 0` simply means the procedure has no обособени позиции (25,041 of
2025's tenders). It is not a per-lot estimate. The Електроразпределителни мрежи
Запад rows that looked like 6–7× overruns carry `is_framework_agreement = true`,
so the framework guardrail already removes them. No new guardrail is needed there.

**The better find: the ЕОП договори feed carries a per-row `estimatedValue` we do
not ingest.** It is the *lot-level* estimate, present on **187,455 of 195,665
contract rows (95.8%)** of the raw feed. Verified: for `04319-2025-0001` the five
rows' estimates sum to 28,042.07 BGN and for `00106-2025-0012` to 340,800.00 BGN —
in both cases exactly `tenders.estimated_value_native`. So `tenders.estimated_value`
IS the sum of lot estimates, and the raw feed lets us compare each contract to its
**own** lot's estimate instead of to the procedure total.

Row-level `contractValue / estimatedValue` across the whole ЕОП feed:

| ratio | rows | share |
|---|---|---|
| ≤ 1× | 175,995 | 93.89% |
| 1.00–1.05× | 1,690 | 0.90% |
| 1.05–1.5× | 5,191 | 2.77% |
| 1.5–2× | 1,307 | 0.70% |
| 2–5× | 1,774 | 0.95% |
| 5–10× | 556 | 0.30% |
| 10–50× | 650 | 0.35% |
| 50–150× | 165 | 0.09% |
| > 150× | 127 | 0.07% |

VAT is **not** a confound: the 1.20× bin holds 233 rows, fewer than the 1.10× bin
(403), so there is no systematic "estimate без ДДС vs contract с ДДС" spike. A
tolerance of ~5% is still wise to swallow rounding.

**A data-quality bug found in passing, and it is live.** 18 rows in the ЕОП feed
publish `contractValue` at exactly 100× their own `estimatedValue` — a stotinki/leva
data-entry error upstream, not a parse bug (verified against the raw record:
`03000-2025-0001` reads `estimatedValue "201592,00"`, `contractValue "20159200,10"`).
**15 of them are in our corpus**, carrying €45,662,799 where the true total is
€442,672 — **€45.2M phantom**. Община Две могили shows a €14.2M contract that is
really €142k. This inflates awarder totals and any concentration/risk share
computed from them. It must be fixed independently of the flag; do NOT silently
divide by 100 — treat it as a curated override list plus a recurring data-quality
report, the way `MANUAL_OVERRIDES` handles the НЗОК crosswalk.

Design, in order:
1. Ingest the per-row `estimatedValue` (+ currency) into `contracts` as
   `estimated_value` / `estimated_value_eur`. This is the flag's real substrate.
2. `aboveEstimate` fires when `amount_eur > estimated_value_eur × 1.05`, using the
   row's own estimate where present and falling back to the procedure-level
   comparison (`SUM(amount_eur)` per unp vs `tenders.estimated_value_eur`) where
   it is not (OCDS 2026 rows, legacy rows).
3. Exclude `is_framework_agreement`.
4. **Suppress the unit-error band.** Ratio ≥ 50 is a data error, not an overrun
   (292 rows: 165 at 50–150×, 127 above). Any value-weighted "worst offenders"
   ranking that skips this step ranks typos, not corruption. The whole >5× tail
   (1,498 rows, 0.8%) deserves manual review before it is ever published.

Availability: good for 2020–2025 (row-level), procedure-level for 2026 OCDS and
for legacy rows whose procedure-year is ≥ 2020, and **unavailable before 2020**.

### 4.4 Annex magnitude flag (4b) — source LOCATED and verified 2026-07-10

`unp` fixed the *linkage* (506 → 2,807 of 3,487, 80.5%), but not the magnitude:
`contracts.amount_eur` on an amendment row is the **original contract value carried
forward** (2,099 of 2,507 exactly equal the parent; median ratio 1.000). No join
recovers a number that is not in the column.

**The `анекси` feed exists, is fetchable, and carries the delta explicitly.**
Verified live at
`https://storage.eop.bg/open-data-<YYYY-MM-DD>/Автоматично генерирани данни за анекси, публикувани в ЦАИС ЕОП на DD.MM.YYYY.json`
(same daily-bucket + Bulgarian-sentence key convention as the `договори` file in
`ingest_eop.ts:51`). Present 2020 → 2026; sparse in 2020, roughly 15–46 records a
day since. A 23-day sample across 2025 returned 362 annexes.

Every field the flag needs is already there — no inference:

```
uniqueProcurementNumber  contractNumber   lotIdentifier
lastContractValue        currentContractValue   contractValueDifference
contractCurrency         changeReason     changeDescription
changeReasonDescription  awardedToGroup   supplierRegisterNumber
```

`contractValueDifference` is the signed delta. In the 362-annex sample: 105
positive, 15 negative, 242 zero — so a boolean "has an annex" flag (what we ship
today) is noise on two-thirds of annexes. Positive deltas in that sample alone
total 121.8M BGN native.

**`changeReason` is a first-class signal**, and better than the magnitude alone.
Sample distribution:

| changeReason | n |
|---|---|
| Промени, предвидени в договора чрез клаузи за преразглеждане | 160 |
| Несъществени промени | 102 |
| Необходимост от промени поради непредвидими обстоятелства | 68 |
| Необходимост от допълнителни работи, услуги или доставки | 31 |
| Нов изпълнител замества стар | 1 |

The first two are benign by construction (foreseen review clauses; non-substantial
changes). The чл. 116 ал. 1 т. 2 (additional works) and т. 3 (unforeseeable
circumstances) grounds are the scope-creep ones. Weight by reason class; do not
treat a priced-option exercise as a red flag.

Currency: BGN through 2025, EUR from 2026 — convert at ingest per
[[feedback-bg-uses-eur]].

**The join is already paid for.** Annexes key on `(uniqueProcurementNumber,
contractNumber)`, which is exactly `(contracts.unp, contracts.contract_id)` — the
column shipped in 4.5. Measured on the 362-annex sample: **309 (85.4%) join on
`(unp, contract_id)`**, 315 on `unp` alone.

Approach: ingest the flat `анекси` feed into its own table keyed by
`(unp, contract_number, lot_identifier, notice_id)`, carrying the delta, currency
and reason. Do not derive the delta from `contracts`. `legacy_csv.ts:549` also
rejects the legacy annexes file — a separate, older source, out of scope here.

### 4.5 Work

**Lineage — SHIPPED 2026-07-10.** `contracts.unp` exists, is populated, and the
round-trip suite is green (47 tests, 0 fail).

- `scripts/db/schema/pg/049_contracts_unp.sql` — `ALTER TABLE contracts ADD
  COLUMN unp`, partial index `idx_contracts_unp … WHERE unp IS NOT NULL`, and
  `resolve_contract_unp()`. (`tenders.unp` needed no index — it is already the
  table's PRIMARY KEY. The plan's earlier claim that neither index existed was
  wrong.) Applied by `load_pg.ts`; 001's `CREATE TABLE IF NOT EXISTS` is a no-op
  on an existing DB, hence the separate ALTER migration.
- `scripts/procurement/types.ts` — `Contract.unp?`.
- `scripts/db/lib/procurement_schema.ts` — the column⇄field map.
- `scripts/procurement/legacy_csv.ts` — new `unp` pattern group, declared
  **before** `tenderId`. `buildHeaderMap` claims columns in key order, and the
  РОП files carry both "ID на поръчката" and "УНП"; `tenderId`'s loose
  `/id.*на.*поръчк/i` was claiming the numeric column first, leaving УНП
  unbound. That is why the corpus shipped for years with no lineage. Only a
  well-formed `\d{5}-\d{4}-\d{4}` is kept.
- `scripts/procurement/normalize_eop.ts` — emits the `unp` it already computed.
- `scripts/procurement/backfill_unp.ts` — fills the ~300k existing shards in
  place (idempotent, no network, `--apply` to write). Three routes: `eop-<УНП>`
  substring, legacy `(dataset, documentId)` → raw CSV, and OCDS `ocid` → tender
  shards.
- `load_pg.ts` / `load_tenders_pg.ts` — both call `resolve_contract_unp()`, so
  either load order leaves the column correct.

**A trap worth recording.** Resolving the OCDS rows' `unp` only at load time made
Postgres a *superset* of the shard corpus, and `pg_roundtrip.data.test.ts` failed
on 310 rows — correctly: it asserts PG is a lossless capture, not a superset. The
fix was to resolve OCDS rows into the shards from the tender shards (which carry
both `ocid` and `unp`), leaving the SQL function as a safety net for rows ingested
later. After that, the loader reports `resolved unp for 0 ocds contracts`, which
is the signal that the shards are authoritative.

**Delivered coverage** (measured post-load, matches the 4.1 prediction exactly):

| Feed | rows | with unp |
|---|---|---|
| legacy (2011–23) | 198,251 | 122,949 (62.0%) |
| eop (2024–25) | 75,038 | 75,038 (100%) |
| ocds (2026) | 20,524 | 18,523 (90.3%) |
| `eop-T` (source has no УНП) | 7,403 | 0 |

Contracts gaining a joinable tender estimate, ocid-join → unp-join:
2020 `0 → 4,115` · 2021 `0 → 190` · 2022 `0 → 28,490` · 2023 `0 → 31,715` ·
2024 `0 → 30,665` · 2025 `0 → 38,964` · 2026 `15,456 → 15,521`.

Amendment→parent resolution: **506 → 2,807 of 3,487 (80.5%)**, better than the
71.9% predicted, because legacy parents now carry `unp` too.

Index verified: `EXPLAIN ANALYZE` on a two-sided join is an Index-Only Scan on
`idx_contracts_unp` and `tenders_pkey`, 0.6 ms.

**Remaining, not built** (both spikes are now closed — this is implementation):
1. **`contracts.estimated_value_eur`** — ingest the per-row lot estimate from the
   ЕОП договори feed (95.8% of rows; `normalize_eop.ts` already reads the record).
   Substrate for 4a. Backfill the shards the way `backfill_unp.ts` did.
2. **Flat `анекси` ingest + table** (4b). Source, key, delta field and reason
   taxonomy all verified above.
3. ~~Data-quality fix: the live ×100 rows~~ — **SHIPPED 2026-07-10.**
   `amount_overrides.ts` (curated, guarded table) wired into all three normalizers
   before the multi-supplier split, plus `fix_amount_overrides.ts` (idempotent shard
   backfill) and `detect_amount_anomalies.ts` (the only sanctioned way to grow the
   table; exits 1 on new finds). 18 corrections across two evidence classes — the
   ЕОП per-row lot estimate, and the single-lot procedure estimate, which caught five
   rows the ЕОП detector was structurally blind to (legacy/OCDS publish no per-row
   estimate). Four of those share the signature `ratio = 51.129 = 100 / 1.95583`: a
   ×100 slip that then went through a BGN→EUR conversion. Corpus total
   €74,087,692,582 → €73,843,647,407 (−€244.0M). Seven single-lot rows at 50–100×
   remain UNCORRECTED on purpose: ÷100 does not reproduce their estimate (−0.1% to
   −30%), and a real award may land under estimate, so the ratio alone cannot separate
   a decimal slip from a genuine overrun. They need a human to read the contract.
   Also fixed in passing: `normalize_eop.ts` would have written the source's
   ЦАИС-internal `T…` id into `contracts.unp` on the next ingest — `eop-T*` ocids come
   from a `T`-prefixed `uniqueProcurementNumber`, not an absent one. Now validated via
   the shared `scripts/procurement/unp.ts`.
4. Flags: add `aboveEstimate` and `annexIncrease` to `RiskComponentKey` in
   `src/data/procurement/computeProcurementRisk.ts`. Both must set
   `available: false` outside their supported window — the CRI denominator already
   handles unavailable checks, so a 2019 contract scores out of fewer checks
   rather than being scored wrongly. Proposed weights `aboveEstimate` 25,
   `annexIncrease` 25, tuned against the corpus before merge. `annexIncrease`
   should scale with the reason class, not fire on every annex (two-thirds carry a
   zero delta).
5. `db:dump` snapshot + Cloud SQL apply of 049 before the next deploy.

Scope note: this is a **procurement-wide** change, not a health change. It
benefits every awarder/company/contracts surface, independent of the НЗОК phases.

---

## Phase 5 — Crosswalk tail

`hospital_eik.json` matches 265 of 381 facilities (93% of value). The 111-facility
tail blocks per-hospital pages for small municipal hospitals.

Candidate source found 2026-07-10: **`https://opendata.his.bg/lzibph/`** —
"Публичен регистър на ЛЗИБПХ", reported to carry ~37,000 facilities including
branches and departments. It is a client-rendered SPA; the static HTML is 1.2KB
and no `/api/*` guess returned JSON. **Spike:** open it in the browser, capture
the XHR endpoint from the network panel, check whether the payload carries both
EIK and a facility registration number.

If it does, it may replace the hand-maintained `MANUAL_OVERRIDES` table entirely.
Bar for merge stays **zero false positives**, audited with the distinctive-token
check that caught the Сърце-и-Мозък multi-site case.

---

## Phase 6 — Surface

Only after the data phases land. Nothing here is novel plumbing; it follows the
existing pack seam (`getSectorPack(eik)`), tile conventions, and
[[feedback-dashboard-layout]] (dashboard tiles, no tabs).

- `/company/:eik` hospital view: money-in (three НЗОК streams, stacked, quarterly)
  above money-out (procurement), plus the financial-health strip (debt ratio,
  overdue debt, cost per patient vs case-mix-adjusted peers).
- `NzokDrugUnitPriceTile` on the НЗОК page: pack-level dispersion, and the
  widening/closing trend per hospital.
- Extend `NzokPeerGrowthStrip` to sit on financial indicators, not just spend.
- Watchers: new sources for `mh_eeof_quarterly`, `nzok_drug_unit_prices`,
  `nzok_activities`; map them into `process-watch-report` and extend the
  `update-nzok` skill. Phase 0's two new PDF families fold into the existing
  `nzok_hospital_bmp` watcher.
- AI tools in `ai/tools/nzok.ts` for the new tables; regression suite must stay green.
- `EXPLAIN ANALYZE` every new jsonb fn on the worst-case entity before merge, per
  [[feedback-db-query-perf]].

---

## Spikes (do these before committing to a phase)

1. **Personnel + mortality source.** Filled ЕЕОФ personnel returns and леталитет
   are not on the МЗ standards page. Check НЦОЗА publications and the annual
   "Здравеопазване" statistical yearbook; if neither, a ЗДОИ request is the
   honest path. Blocks any mortality or salary tile.
2. ~~`unp` on contracts~~ — **RESOLVED 2026-07-10**, see Phase 4. The key exists
   on both sides; coverage measured; no spike needed, only the work.
3. ~~OCDS amendment releases~~ — **RESOLVED**: the flattened amendment amount is
   the original value carried forward (2,099/2,507 exactly equal). Use the flat
   `анекси` feed instead (Phase 4.4).
4. **`estimated_value_eur` semantics when `lots_count = 0`** — per-lot or total?
   Blocks the above-estimate flag for utilities (Phase 4.3).
5. **`opendata.his.bg` XHR endpoint** (Phase 5).
5. **Наредба 10 (2011) off-label register** — locate the publisher.
6. **Справка 5 history depth.** 73 files listed; confirm how far back the monthly
   series runs and whether the pre-2021 layout differs (the drug-reimbursement
   generator already handles an `old.nhif.bg` split for a sibling file).

---

## Sequencing

```
Spike 2 ─┐
Spike 1 ─┤
Spike 3 ─┴─▶ P4 (procurement flags)      ── independent of the health data
P0 (payment streams) ──▶ P1 (ЕЕОФ) ──┐
P3 (activity corpus) ────────────────┴─▶ P2 (drug unit prices, case-mix adjusted)
                                          └─▶ P6 (surface)
P5 (crosswalk tail) — parallel, unblocks the long tail of /company/:eik
```

P0 is a correctness fix on shipped data and should go first regardless.
P3 before P2 — the case-mix denominator is not optional.
P4 is orthogonal and can run in parallel by a different session.

## Done criteria

- Per-hospital НЗОК total reconciles across three streams against the МЗ `НЗОК`
  sheet for at least two independent quarters, per stream, within 0.5%.
- No per-patient or per-unit ranking ships without a stated denominator and a
  volume floor.
- `hospital_financials` and the drug unit-price table each carry a
  `recent_updates` changelog row and a watcher.
- Above-estimate and annex flags either cover the full corpus or declare
  `available: false` outside their supported era — never silently score a
  contract on checks that could not run.
- Every new `/api/db` route has an `EXPLAIN ANALYZE` recorded in the commit.
