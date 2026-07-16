---
name: update-budget
description: Ingest Bulgarian state-budget data into data/budget/. Two main paths share one CLI — the data.egov.bg КФП feed (consolidated state-budget execution time series + monthly snapshot) and per-ministry "Отчет за изпълнението на програмния бюджет" reports (admin + program grain reconciliation against the State Budget Law). Also handles three side-ingests folded into the same data tree: Article 53 of the State Budget Law (per-municipality transfer envelope under data/budget/municipal_transfers/, emitted automatically by the main ingest from the already-fetched law HTML), the Приложение III investment program (per-project capital allocations under data/budget/investment_program/, runs from scripts/budget/investment_program/__write_program.ts when the dv_investment_annex watcher flips), and per-município annual capital programmes for 26 oblast-centre municipalities (data/budget/capital_programs/{year}/{muni}.json — Sofia, Plovdiv, Burgas, Stara Zagora, Ruse, Varna, Pleven + 19 more — each run separately from scripts/budget/capital_programs/<muni>.ts when the capital_programs watcher flips; the scan-only or layout-fragmented sources additionally need a Gemini Vision OCR pre-step via {muni}_ocr.ts — e.g. Varna because its source PDF is rasterized scans, Pleven because the layout is too fragmented for deterministic parsing). Use when the daily watcher flags `data.egov.bg бюджет`, `ministry_execution_reports`, `dv_investment_annex`, or `capital_programs` as changed, when the user asks to "refresh budget" / "update budget data", when adding a new fiscal year of execution reports / investment-program annex / municipal capital programmes, after a fresh clone if `data/budget/` is empty, or to investigate a canary mismatch or sanity-warning surfaced by a previous run.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Budget skill

Ingests the Bulgarian state budget into `data/budget/`. **Four pillars** run from one CLI (`npm run budget:ingest`):

1. **КФП feed** (data.egov.bg) — monthly consolidated execution snapshots → time series, economic-grain plan-vs-actual, fiscal-year roll-ups, latest snapshot.
2. **State Budget Law** (Държавен вестник HTML) — per-spending-unit appropriations → admin-grain + program-grain BudgetFacts at `stage: "law"`, the administrative + program classification registries, the law/amendment document index.
3. **Per-ministry execution reports** — each first-level spending unit's "Отчет за изпълнението на програмния бюджет" → admin + program-grain BudgetFacts at `stage: "amendment"` (уточнен план) and `stage: "execution"` (отчет), joined against the law facts for the full law → amended → executed reconciliation. **Four source formats supported**, hand-curated in `EXECUTION_REPORTS`.
4. **Personnel** (headcount + Персонал spend) — re-parses the same per-ministry execution-report bytes for the "Численост на щатния персонал" rows + the annual "Доклад за състоянието на администрацията" PDF from iisda.government.bg/annual_reports for national aggregates (positions, vacancy, structure counts). Output: `data/budget/personnel.json`. Adding a new fiscal-year Доклад: resolve the file id from /annual_report/<id> and add to `DOKLAD_FILE_IDS` in `scripts/budget/doklad.ts`.

Plus the budget-journey document index, procurement cross-link (Phase 4), and per-ministry rollups (sliced files the ministry detail screen reads).

## When to run

| Trigger                                                                                                       | Action                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.egov.bg бюджет: N new monthly snapshot(s)`                                                              | Incremental ingest (`npm run budget:ingest`)                                                                                                                                              |
| `Per-ministry execution reports: N updated`                                                                   | Same — the watcher's `describe()` names the changed ministries                                                                                                                            |
| `Доклад за състоянието на администрацията: new year`                                                          | Resolve file id from /annual_report/<id> → add to `DOKLAD_FILE_IDS` in `scripts/budget/doklad.ts` → run `npm run budget:ingest`                                                           |
| User says "refresh budget" / "update budget data"                                                             | Same — incremental                                                                                                                                                                        |
| New fiscal year's reports publish (mid-year)                                                                  | Update each ministry's URL in `EXECUTION_REPORTS`; ingest; re-seed canaries                                                                                                               |
| `data/budget/` empty (fresh clone)                                                                            | Cold-start ingest of every visible monthly resource + curated reports                                                                                                                     |
| Canary mismatch warning surfaced                                                                              | Investigate the named parser in `scripts/budget/` BEFORE re-running                                                                                                                       |
| `budget_law` flips / new ЗДБ year added to `LAW_DV_MATERIALS`                                              | After `budget:ingest`, also run `tsx scripts/budget/__write_izdrazhka.ts` (per-spending-unit издръжка series) **and** `tsx scripts/budget/__write_judiciary.ts` (judiciary budget by органи, feeds the ВСС pack); bucket:sync `data/budget/izdrazhka_by_institution.json` + `data/budget/vss/budget.json` |
| Sanity-warning `⚠ admin-grain sanity (…)` surfaced                                                           | Investigate that ministry's report manually before committing                                                                                                                             |
| `Eurostat policy-baseline (BG)` flips (`eurostat_policy`)                                                     | Policy-baseline sub-step — `run_consumption_coicop.ts` then `run_policy_baseline.ts` (see "Policy-baseline ingest" below)                                                                 |
| КФП ingest closes a fiscal year (new December snapshot), `nap_annual` re-ingested, or `customs_revenue` flips | Re-run `run_policy_baseline.ts` so the /budget/simulator re-bases (КФП = base year + expenditure anchors; НАП = PIT split + МОД identity; customs = the per-product excise-lever anchors) |

## Step 1 — Ingest

```bash
npm run budget:ingest
```

What it does:

1. Walks the egov dataset listing; downloads each monthly КФП resource (gzip-cached); parses into the five top-level sections.
2. Fetches the State Budget Law HTML for each year in `LAW_DV_MATERIALS` (gzip-cached); extracts per-spending-unit I/II/III/IV tables → admin grain; program-budget tables → program grain (policy areas only — the law doesn't decompose deeper).
3. Builds the program registry up-front so it's available to the execution-fact emitter.
4. For each row in `EXECUTION_REPORTS`, dispatches by `format` to the right fetcher + parser, then emits law + amendment + execution facts at admin grain plus program-grain facts for отчет programmes that name-match a registry node.
5. Joins admin + program facts via `buildAdminReconciliation` + `buildProgramReconciliation`; flags ratios outside expected bounds with `⚠ admin-grain sanity` warnings.
6. Writes canonical JSON to `data/budget/`; canaries on six pinned artifacts byte-compare against fixtures.

Expected output on a normal day (one new monthly КФП snapshot, no ministry changes):

```
→ walking egov budget dataset
  11 resource(s) listed
  • 2026-04 (EUR) — 5 section(s), <uuid>
  …
→ canary on resource <…>
  canary OK (sha256=…)
  kfp.json: 51 observation(s), 2 snapshot(s)
→ parsing state budget laws
  • 2024: 47 spending unit(s)
  • 2025: 47 spending unit(s)
→ canary on budget law 2024
  canary OK (sha256=…)
  procurement cross-link: 43/47 spending unit(s) matched to an awarder
→ parsing ministry execution reports
  • admin-ministerstvoto-na-… 2024 [pdf]: executed € … (95.7% of amended)
  …
→ canary on execution report [pdf] admin-ministerstvoto-na-zdraveopazvaneto 2024
  canary OK (sha256=…)
→ canary on execution report [pdf-borderless] admin-ministerstvoto-na-otbranata 2024
  canary OK (sha256=…)
→ canary on execution report [xlsx-in-zip] admin-ministerstvoto-na-truda-i-sotsialnata-politika 2024
  canary OK (sha256=…)
  admin registry: 47 node(s); facts: 213 row(s)
  program registry: 82 node(s); facts: 166 row(s) law + N row(s) execution
  ministry rollups: 47 file(s)
→ building economic-grain facts + variance
→ canary on economic facts 2025
  canary OK (sha256=…)
→ building document index
  documents.json: 14 document(s)
  index.json: 4 fiscal year(s) (1 complete, …)
→ wrote N file(s) under data/budget/
✓ budget ingest complete — …
```

## Step 2 — Verify

```bash
node -e "
const idx = require('./data/budget/index.json');
console.log('kfp:', idx.kfp);
console.log('years:', idx.years.map(y => y.fiscalYear + ' [' + y.stages.join(',') + ']').join(' | '));
console.log('documents:', idx.documentCount);
"
git diff --stat data/budget/
```

Expect: `documents.json` + `index.json` modified (the only committed-tree budget data). `facts/`, `reconciliation/`, `ministries/` are gitignored shards that don't count toward the diff cap.

## Step 3 — Upload + commit

```bash
npm run budget:ingest -- --upload
git add data/budget/ tests/fixtures/budget/
git commit -m "budget: ingest through YYYY-MM"
```

The canary fixtures (`tests/fixtures/budget/*.json`) are committed.

## Revenue-breakdown ingests (separate scripts)

Two complementary ingests live alongside the main budget pipeline but run independently. They itemise the revenue-side wedges (excise, import VAT, customs duties, domestic VAT, PIT) that the KFP feed publishes only as flat aggregates. Run them when the matching watcher source flips (`customs_revenue`, `nap_annual`).

### Single combined command (recommended)

```bash
npm run budget:revenue-breakdown
```

Runs both `scripts/budget/run_customs_revenue.ts` and `scripts/budget/run_nap_annual.ts` in sequence — covers every output under `data/budget/revenue_breakdown/{customs,vat,pit}/`. Use this when the orchestrator invokes `/update-budget` because `customs_revenue` or `nap_annual` flipped. Subsequent runs are cheap — both scripts cache the source PDFs under `raw_data/budget/` and skip re-download.

Stamp the result with: `npx tsx scripts/stamp-ingest.ts update-budget --summary "revenue-breakdown: customs <years>, vat/pit <years>"`.

The two scripts also run individually if you need finer control:

### Customs Agency (Митница) — excise + import VAT + customs duties

Source: `customs.bg/wps/portal/agency/media-center/customs-chronicle` — the annual "Митническа хроника" PDF, published in March of T+1.

```bash
npx tsx scripts/budget/run_customs_revenue.ts             # all known years
npx tsx scripts/budget/run_customs_revenue.ts --year 2025 # single year
npx tsx scripts/budget/run_customs_revenue.ts --refresh   # bypass cache
```

Output: `data/budget/revenue_breakdown/customs/<year>.json` per fiscal year — total collections, excise by product group (fuels → diesel/petrol/LPG/natural-gas/kerosene + tobacco + alcohol), import VAT, customs duties, fines, and top-5 country-of-origin split for customs duties.

Coverage: 2022, 2023, 2024, 2025. Sub-product detail only for 2025 (older reports use different narrative phrasings); top-level + country split for all 4 years.

Reconciles to KFP totals **exactly** (Δ ≈ 0 across all years).

Adding a new year: find the PDF URL via WebSearch (`site:customs.bg Mitnicheska_hronika <YYYY>`), then add it to `MITNICHESKA_HRONIKA_REPORTS` in `scripts/budget/customs_revenue.ts`.

### НАП annual — domestic VAT by sector + PIT by income type

Source: `nra.bg/wps/portal/nra/za-nap/osnovni-dokumenti/Godishni-otcheti-za-deynostta-na-NAP` — the annual "Годишен отчет за дейността на НАП" PDF, approved by Council of Ministers in March of T+1.

```bash
npx tsx scripts/budget/run_nap_annual.ts             # all known years
npx tsx scripts/budget/run_nap_annual.ts --year 2024 # single year
npx tsx scripts/budget/run_nap_annual.ts --refresh   # bypass cache
```

Output (two files per fiscal year):

- `data/budget/revenue_breakdown/vat/<year>.json` — declared net VAT by КИД-2008 sector (21 sectors), from Table 3 of the report.
- `data/budget/revenue_breakdown/pit/<year>.json` — PIT by income type (employment + non-employment + final tax/dividends, each with payment-type sub-lines) from Tables 8, 10 + narrative. Plus `bySector` from Table 9 (employment PIT due contributions by КИД-2008 sector, Jan-Nov coverage — the source's published window, not ours).

Coverage: 2024 only. Older years' URLs aren't web-indexed (opaque WCM UUIDs); backfill is a manual URL-hunt follow-up.

Reconciliation:

- VAT: НАП declared net ≈ KFP total VAT minus Митница import VAT (gap ≈ 2-3% timing).
- PIT: НАП-reported total ≈ 88% of KFP PIT total. The 12% gap is patent tax (municipal, §01-03) + other income types collected outside НАП. UI captions should say "NAP-administered PIT", not "all PIT".

Adding a new year: same pattern — find the PDF URL (via `site:nra.bg "Годишен отчет НАП" <YYYY>`), add to `NAP_ANNUAL_REPORTS` in `scripts/budget/nap_annual.ts`.

### System dependency

The NAP parser shells out to `pdftotext -layout` (poppler-utils) because the NAP report's tables have multi-line wrapping that defeats custom pdfjs column extraction. `pdftotext` is universal on dev/CI environments. The customs parser is pdfjs-only — no extra dependency.

## Agency budgets (НАП / Митници) → /governance/sectors tiles

`data/budget/agencies/{nap,customs}.json` carry the **own annual budget (уточнен план на разходите)** of НАП and Агенция „Митници“ — second-level разпоредители under МФ that are absent from the first-level `ministries/` tree, so the ЗДБРБ carries no clean per-agency line. These files are the `revenue` and `customs` sector headlines on `/governance/sectors` + the `/procurement` featured strip (folded via `AGENCY_BUDGET_FILE` in `scripts/db/gen_procurement/sector_stats.ts` → `basis:'budget'`). Same `years[].expenditure.amountEur` shape as a ministries node.

**Hand-curated constants** (no parser — like `defense/programs.json`), committed to git. Sources, both published ~March of T+1:

- **НАП** (`nap.json`): the НАП „Годишен отчет за дейността“ — the **same PDF** the `nap_annual` watcher already tracks and `run_nap_annual.ts` fetches. Table „Отчет на разходите на НАП“, column „Уточнен план“ (в хил. лв → EUR ÷ 1.95583). So when `nap_annual` flips, refresh this alongside the VAT/PIT ingest above.
- **Митници** (`customs.json`): the customs.bg „Отчет за касовото изпълнение на бюджета“ (форма Б-3, декемврийски кумулативен), ред „II. РАЗХОДИ“, column „Годишен уточнен план“ — a *different* customs.bg form than the Митническа хроника `customs_revenue` watches, but the same annual cadence, so refresh it in the same pass.

To refresh: read the new уточнен-план figure from the report, add/patch the `years[]` row (keep `source`), then **rerun `npm run db:gen-sector-stats`** (needs local PG + local `ministries/` files) so the two hub tiles pick up the new year. No new watcher — the `nap_annual` flip is the trigger for НАП; customs rides the same March cycle.

## Policy-baseline ingest (tax-policy simulator)

The `/budget/simulator` screen scores rate-change scenarios (ДДС standard + per-category, ДДФЛ flat, корпоративен, дивидент, МОД cap) against a single derived file. Two scripts, run in order:

```bash
npx tsx scripts/budget/run_consumption_coicop.ts   # Eurostat → revenue_breakdown/consumption.json
npx tsx scripts/budget/run_policy_baseline.ts      # joins everything → derived/policy_baseline.json
```

- `run_consumption_coicop.ts` fetches household consumption by COICOP purpose (Eurostat `nama_10_co3_p3`, BG structure lags ~2 years) plus the fresher `nama_10_gdp` P31_S14 totals used to scale it. **Unit hazard**: post-changeover Eurostat re-denominates BG "national currency" series to euros dataset-by-dataset, so the script anchor-validates each fetch against `macro.json` nominal GDP instead of trusting the unit label — never remove that check.
- `run_policy_baseline.ts` joins the КФП December snapshots (executed ДДС/ДДФЛ/корпоративен/дивиденти lines), the НАП PIT split (`revenue_breakdown/pit/<latest>.json` — rate-sensitive share + the МОД-cap identity), the **Митническа хроника excise split** (`revenue_breakdown/customs/<latest>.json` — `exciseDieselEur`/`excisePetrolEur`/`exciseTobaccoEur`/`exciseAlcoholEur`, walked back ≤2 years if the latest isn't on disk; these anchor the per-product excise levers), one live `gov_10a_taxag` fetch (D613CE contributions, same GDP-anchored unit detection), and the consumption slices, pre-scaled to the latest closed fiscal year. The COICOP→VAT-regime map lives in `src/lib/bgTaxPolicy.ts` (`VAT_SLICES`) — the single source of truth shared with the frontend engine. (The gambling GGR anchor, wine commercial-volume base, and the EU-country excise comparator rates in `src/lib/euPolicyPresets.ts` are curated constants in code, not fed by this script — refresh manually.) **So re-run this after a `customs_revenue` flip too**, not only after КФП/НАП/Eurostat.
- The same run **fits the earnings distribution** behind the bracket-schedule and МОД-incidence scoring (`scripts/budget/earnings_distribution.ts`): split log-normal body (σ per half from the `earn_ses_hourly` SES decile ratios — ratios, so the unit hazard cancels), level from the curated НОИ СОД average (`NOI_SOD_EMPLOYEES_BGN` — one value per identity year from `nssi.bg/wp-content/uploads/SOD_{YYYY}.pdf`, трета-категория row), Pareto tail in closed form from the identity's above-cap mass. Emits ~120 quantile bands into the `earnings` section. **When a new НАП year lands, also curate that year's СОД value or the run fails loudly.**

Self-validation (the script throws instead of writing):

- **Drift gate** — the VAT calibration factor (actual ДДС ÷ modeled household VAT, expected ~1.17) must stay within 12% min-max across all calibration years. A breach usually means a statutory VAT-rate change took effect: add the new rate window to `VAT_SLICES` in `src/lib/bgTaxPolicy.ts` first, then re-run.
- **Round-trip guard** — the engine at current law must reproduce the calibration row for the baseline year (catches slice-join breakage).
- **κ gate** — the fitted band grid at the flat 10% must reproduce the НАП employment-PIT line within ±8% (it landed at κ=1.000 on the 2024 anchors). A breach means the anchors disagree — re-check the СОД curation and the SES wave before touching tolerances.

Smoke checks: `npx tsx scripts/budget/__smoke_vat_model.ts` (calibration table + scored scenarios through the shared engine), `npx tsx scripts/budget/__smoke_mod_identity.ts` (МОД-cap identity backtest vs МФ's scoring of the 2025 raise), and `npx tsx scripts/budget/__smoke_earnings.ts` (fit diagnostics, fitted-α backtest, bracket + МОД scenarios over the bands).

Triggers: the `eurostat_policy` watcher (any of the four datasets release — note `earn_ses_hourly` is a 4-yearly SES wave, next 2026), a КФП ingest that closes a fiscal year (new December snapshot — the simulator re-bases to it), or a `nap_annual` re-ingest. When a year's МОД cap changes by law, also update `MOD_BY_YEAR` in `src/lib/bgTax.ts`.

Stamp with: `npx tsx scripts/stamp-ingest.ts update-budget --summary "policy baseline re-based to FY<year>, VAT factor <f>"`.

## Data sources — by source format

| Source                                  | Format                                                                                                                                                                                                                                                                                            | Reader                                                                                                                                            | Parser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| КФП feed                                | egov dataset (JSON)                                                                                                                                                                                                                                                                               | `fetchEgovResource`                                                                                                                               | `parseEgovResource` → `buildKfpFile` + `buildEconomicFacts`                                                                                                                                                                                                                                                                                                                                                                                                                                                              | data.egov.bg `79ce7de2-…`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| State Budget Law                        | HTML (ДВ)                                                                                                                                                                                                                                                                                         | `fetchLawHtml`                                                                                                                                    | `parseLawHtml` (cheerio walker for "Приема бюджета на X")                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=…`; curated in `LAW_DV_MATERIALS`                                                                                                                                                                                                                                                                                                                                                                               |
| DV amendments                           | HTML (ДВ)                                                                                                                                                                                                                                                                                         | — _(catalog-only)_                                                                                                                                | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | curated `idMat` list in `AMENDMENT_DV_MATERIALS`. Catalogued for provenance; figures NOT parsed (see `project_budget_dv_amendments` memory)                                                                                                                                                                                                                                                                                                                      |
| Bordered ministry PDF                   | PDF with cell-border rectangles                                                                                                                                                                                                                                                                   | `fetchExecutionPdf`                                                                                                                               | `pdf_table.ts` (pdfjs-dist) → `execution_pdf.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | per-ministry curated URL in `EXECUTION_REPORTS` (`format: "pdf"`)                                                                                                                                                                                                                                                                                                                                                                                                |
| Borderless ministry PDF                 | PDF with no cell borders (text-positioned tables)                                                                                                                                                                                                                                                 | `fetchExecutionPdf`                                                                                                                               | `pdf2array` → `execution_borderless_pdf.ts` (positional column convention via `trailingValueCount`)                                                                                                                                                                                                                                                                                                                                                                                                                      | `EXECUTION_REPORTS` (`format: "pdf-borderless"`)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Ministry XLSX in ZIP                    | ZIP containing XLSX                                                                                                                                                                                                                                                                               | `fetchExecutionZipXlsx` (unzipper)                                                                                                                | `xlsx` (SheetJS) → `execution_xlsx.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `EXECUTION_REPORTS` (`format: "xlsx-in-zip"`)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Manual PDF (WAF-blocked)                | bare PDF, no auto-fetch                                                                                                                                                                                                                                                                           | `readManualExecutionPdf` (cache only)                                                                                                             | `execution_pdf` OR `execution_borderless_pdf` based on `trailingValueCount`                                                                                                                                                                                                                                                                                                                                                                                                                                              | `EXECUTION_REPORTS` (`format: "manual-pdf"`); operator drops PDF at `raw_data/budget/exec-<adminId>-<fy>.pdf`                                                                                                                                                                                                                                                                                                                                                    |
| Сметна палата audit listing             | HTML                                                                                                                                                                                                                                                                                              | `fetchBulnaoAuditHtml`                                                                                                                            | best-effort regex; non-fatal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | bulnao.government.bg                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Митническа хроника                      | PDF (narrative + Table 1)                                                                                                                                                                                                                                                                         | inline `fetchPdf` in `run_customs_revenue.ts`                                                                                                     | `customs_revenue.ts` (pdfjs column-aware + Table 1 extraction)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | curated `MITNICHESKA_HRONIKA_REPORTS`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| НАП Годишен отчет                       | PDF (multi-table)                                                                                                                                                                                                                                                                                 | inline `fetchPdf` in `run_nap_annual.ts`                                                                                                          | `nap_annual.ts` (shells out to `pdftotext -layout`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | curated `NAP_ANNUAL_REPORTS`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Article 53 (per-municipality transfers) | HTML (same DV bytes as the law)                                                                                                                                                                                                                                                                   | reuses `fetchLawHtml`                                                                                                                             | `scripts/budget/municipal_transfers.ts` (cheerio walker with phrase-anchored "размерите на бюджетните взаимоотношения" matching — survives article-number drift between 53 / 51)                                                                                                                                                                                                                                                                                                                                         | emitted inside the main ingest into `data/budget/municipal_transfers/{year}/*.json` + `oblasts/{code}.json` shards                                                                                                                                                                                                                                                                                                                                               |
| Издръжка by spending unit (heatmap)     | HTML (same DV bytes as the law) + 2026 draft seed                                                                                                                                                                                                                                                | reuses cached `law-{year}.html.gz`                                                                                                               | `scripts/budget/__write_izdrazhka.ts` (flat-line residual: Текущи − Персонал − Субсидии − Лихви − трансфери за домакинства, per ПРБ; 2026 column from the committed `izdrazhka_2026_draft.json` seed until the real ЗДБ 2026 is cached)                                                                                                                                                                                                                                | `data/budget/izdrazhka_by_institution.json`; run `tsx scripts/budget/__write_izdrazhka.ts` after any `LAW_DV_MATERIALS` change — feeds the /indicators/budgets "Издръжка по ведомства" heatmap + the AI `institutionMaintenance` tool                                                                                                                                                                                                                            |
| Judiciary budget by органи (ВСС pack)   | HTML (same DV bytes as the law)                                                                                                                                                                                                                                                                  | reuses cached `law-{year}.html.gz`                                                                                                               | `scripts/budget/__write_judiciary.ts` (parses the ЗДБРБ „Бюджет на съдебната власт" article: own revenue incl. съдебни такси + the per-body expenditure split across ВСС/ВКС/ВАС/ПРБ/съдилища/НИП/ИВСС/резерв; asserts Σ bodies == total and Σ revenue == total. NB the per-body table is paragraph (2) up to 2024 and (3) from 2025, when a functional-area table was inserted). NOTE: `izdrazhka_by_institution.json` reports "Съдебна власт" as its **Текущи разходи**, not a personnel-excluded residual — the law prints no Персонал line for the judiciary — which is why this artifact exists | `data/budget/vss/budget.json` (2018–2025); run after any `LAW_DV_MATERIALS` change — feeds the ВСС sector pack on `/awarder/121513231` + the AI `judiciaryBudget` tool                                                                                                                                                                                                                                                                                              |
| Investment Program (Приложение III)     | PDF (DV annex)                                                                                                                                                                                                                                                                                    | manual fetch into `raw_data/budget/investment_program/{year}-annex-iii.pdf`                                                                       | `scripts/budget/investment_program/parse_annex_pdf.ts` (pdfjs text positioning, 4 x-bands, justified-glyph + hyphen-break repair) → `build_artifact.ts` (EKATTE join + 9-category classify)                                                                                                                                                                                                                                                                                                                              | curated `SOURCES` in `__write_program.ts`; runs separately via `tsx scripts/budget/investment_program/__write_program.ts`                                                                                                                                                                                                                                                                                                                                        |
| Sofia capital programme                 | XLSX (sofia.bg)                                                                                                                                                                                                                                                                                   | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/sofia-{year}.xlsx` (sofia.bg returns 403 to default UA)                     | `scripts/budget/capital_programs/sofia.ts` (xlsx package; tracks paragraph / function / activity headers as state; район tag extracted from free-text via `sofia_rayons.ts`)                                                                                                                                                                                                                                                                                                                                             | curated `SOURCE_URLS` in `sofia.ts`; runs separately via `tsx scripts/budget/capital_programs/sofia.ts --year YYYY`. **Re-ingest fallback:** `--source egov` pulls the same Приложение №3 from data.egov.bg (org 485) with no manual download — byte-identical except project names come ALL-CAPS (the sofia.bg XLSX is nicer title-case and lags ~0mo vs egov's ~12mo, so the XLSX stays primary; egov is only for rebuilding a back-year without the raw file) |
| Plovdiv capital programme               | PDF (plovdiv.bg)                                                                                                                                                                                                                                                                                  | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/plovdiv-{year}.pdf`                                                         | `scripts/budget/capital_programs/plovdiv.ts` (pdfjs-dist positional reader; column-D anchor rows; vertical-text col-A reassembly; район via `plovdiv_rayons.ts`)                                                                                                                                                                                                                                                                                                                                                         | `SOURCE_URLS` in `plovdiv.ts`; runs separately via `tsx scripts/budget/capital_programs/plovdiv.ts --year YYYY`                                                                                                                                                                                                                                                                                                                                                  |
| Burgas capital programme                | XLSX-in-budget-workbook (burgas.bg)                                                                                                                                                                                                                                                               | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/burgas-{year}.xlsx` (host redirects http→https + non-www→www; `-L` chases)  | `scripts/budget/capital_programs/burgas.ts` (xlsx package; project total = sum of 7 funding-source columns; village extraction against 11 known SO Бургас villages + city-quarter list aligned with Wikipedia category Квартали*на*Бургас)                                                                                                                                                                                                                                                                               | `SOURCE_URLS` in `burgas.ts`; runs separately via `tsx scripts/budget/capital_programs/burgas.ts --year YYYY`                                                                                                                                                                                                                                                                                                                                                    |
| Stara Zagora capital programme          | PDF inside council-decision ZIP (starazagora.bg)                                                                                                                                                                                                                                                  | manual `curl -A "Mozilla/5.0"` of the ZIP → `unzip "*pr 4 KV*"` → `raw_data/budget/capital_programs/stara_zagora-{year}.pdf`                      | `scripts/budget/capital_programs/stara_zagora.ts` (pdfjs-dist; recap-row LOCKED on first match to avoid §51 subtotal leakage; "closest col-A line" desc heuristic handles same-line / above / below layouts)                                                                                                                                                                                                                                                                                                             | `SOURCE_URLS` in `stara_zagora.ts`; runs separately via `tsx scripts/budget/capital_programs/stara_zagora.ts --year YYYY`                                                                                                                                                                                                                                                                                                                                        |
| Ruse capital programme                  | Multi-sheet XLSX (obshtinaruse.bg) — year-end revised plan + execution, ~70 sheets (one per spending unit + per-kmetstvo for each village)                                                                                                                                                        | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/ruse-{year}.xlsx` (filename has the publish date — update the URL annually) | `scripts/budget/capital_programs/ruse.ts` (xlsx package; reads recap from `Общо` sheet R8 col F; walks every other sheet for project rows where col C is a `YYYY-YYYY` period; village attribution via the sheet NAME — "Кметство X" / "с. X" / "гр. X" gives 100% localisation for the 12 villages + Мартен)                                                                                                                                                                                                            | `SOURCE_URLS` in `ruse.ts`; runs separately via `tsx scripts/budget/capital_programs/ruse.ts --year YYYY`                                                                                                                                                                                                                                                                                                                                                        |
| Varna capital programme                 | Rasterized PDF (varnacouncil.bg) — 71-page 200dpi scan, pdftotext returns ≈0 bytes                                                                                                                                                                                                                | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/varna-{year}.pdf`                                                           | TWO-STEP: `varna_ocr.ts` (Gemini 2.5 Pro Vision over the whole PDF — ~$0.30/year, ~5-10 min, writes `raw_data/budget/capital_programs/varna-{year}-ocr.json`), then `varna.ts` (deterministic rollup over the OCR JSON — produces the same per-район shape as Plovdiv). Requires GEMINI_API_KEY in .env.local                                                                                                                                                                                                            | `SOURCE_URLS` in both files; run `tsx scripts/budget/capital_programs/varna_ocr.ts --year YYYY` then `tsx scripts/budget/capital_programs/varna.ts --year YYYY`                                                                                                                                                                                                                                                                                                  |
| Pleven capital programme                | PDF (obs.pleven.bg) — 63-page budget docket; capital programme split across Прил. №4 (general capital, pp. 13-17, 7.59M BGN) + Прил. №10А (EU projects, pp. 35-37, 11.00M BGN). Text IS extractable but the layout is heavily fragmented (rotated funding-source labels, multi-line descriptions) | manual `curl -A "Mozilla/5.0"` into `raw_data/budget/capital_programs/pleven-{year}.pdf`                                                          | THREE-STEP: (1) slice pages 13-17+35-37 via `pypdf` into `pleven-{year}-capital-pages.pdf` (8 pages, ~360 KB); (2) `pleven_ocr.ts` (Gemini 2.5 Pro Vision — ~$0.04/year, ~30 sec, writes `raw_data/budget/capital_programs/pleven-{year}-ocr.json` with `appendix` + `fundingSource` fields); (3) `pleven.ts` (deterministic rollup — per-settlement + per-funding-source dimensions, no райони). Requires GEMINI_API_KEY in .env.local. Itemised sum exactly matches the published Прил. №4 + Прил. №10А ВСИЧКО totals. | `SOURCE_URLS` in both files; pypdf slice command in the `pleven_ocr.ts` header comment; then `tsx scripts/budget/capital_programs/pleven_ocr.ts --year YYYY` followed by `tsx scripts/budget/capital_programs/pleven.ts --year YYYY`                                                                                                                                                                                                                             |
| + 19 more oblast-centre municipalities  | mixed (XLSX / PDF / scan)                                                                                                                                                                                                                                                                         | manual `curl` into `raw_data/budget/capital_programs/<muni>-{year}.<ext>`                                                                         | `scripts/budget/capital_programs/<muni>.ts` — same per-muni pattern as the seven rows above; the scan-only / fragmented sources carry a `<muni>_ocr.ts` Gemini pre-step                                                                                                                                                                                                                                                                                                                                                  | asenovgrad, dobrich, dupnitsa, gabrovo, haskovo, kardzhali, karlovo, kazanlak, kyustendil, lovech, montana, pernik, samokov, shumen, sliven, veliko_tarnovo, velingrad, vidin, yambol. **Total coverage: 26 municipalities.** Full per-muni fetch URLs + run commands live in the `process-watch-report` skill's "Capital-programmes ingest" section (the operational source of truth); the seven rows above are representative format exemplars                 |

## Municipal cash-execution (касово изпълнение по ЕБК)

A separate side-ingest under `data/budget/municipal_execution/`. A handful of общини publish a MINFIN B3 ЕБК execution report per fiscal year to data.egov.bg — plan-vs-actual (Уточнен план vs Отчет) revenue & expense by economic paragraph. This is **fully automated from the portal API** (no manual download): the ingest resolves each muni's portal-hosted resource via `listDatasets`, fetches rows via `getResourceData`, and parses the B3 template.

```bash
tsx scripts/budget/municipal_execution/ingest.ts --all        # every muni, every year
tsx scripts/budget/municipal_execution/ingest.ts --muni ruse --year 2024
```

- **Coverage** is in the `REGISTRY` in `ingest.ts` — currently Русе (RSE27, org 157, 2016-2025) and Николаево (SZR38, org 281, 2019-2024). These are the only sizeable munis with fresh, portal-hosted, parseable B3; most общини either link out to their own site or stopped publishing ~2019-2020 (see the one-off survey in this conversation's history). To add a muni, append to `REGISTRY` with its org id, obshtina code, and the resource-name `resourcePref` regex; the parser is generic.
- **Watcher**: `egov_municipal_execution` flags new/re-uploaded muni-year reports → re-run `--all`.
- **The revenue side is OWN revenue** (собствени приходи: local taxes, fees, property income) — it funds only part of spending; the rest is state transfers + carry-over, which is why expense ≫ revenue. The tile labels and caption say so; don't "fix" the gap.
- Output `{muni}/{year}.json` is ~12 KB (paragraph rollups only — под-§§ detail and the 9000-row РАЗХОДИ ПО ДЕЙНОСТИ section are dropped), so no tile-shrink sidecar. `index.json` carries `latestFullYear` so the tile defaults to a complete year, not a mid-year partial.
- **§§ code format varies**: some files use dashed `01-00`, others no-dash `100`/`1300`; the parser normalizes both. Reads the §§ code from the §§ column only, so the `99-99` grand total (in the под-§§ column) is excluded and the paragraph sum equals the published ВСИЧКО.

## Adding a new ministry to EXECUTION_REPORTS

When the user asks to extend coverage:

1. **Find the ministry's full-year report URL.** Each ministry publishes on its own site (NOT minfin.bg — that's WAF-blocked). Look for the `31.12.<year>` ("отчет … към 31.12.YYYY") variant — the year-end. Common patterns:
   - mi.government.bg/files/useruploads/files/budget/
   - mh.government.bg/upload/…
   - tourism.government.bg/sites/…/uploads/Budjet/…
   - moew.government.bg/static/media/ups/articles/attachments/
   - mod.bg/documents/ (borderless format)
   - mlsp.government.bg/uploads/…/<year>-g.zip (XLSX-in-ZIP format)

2. **Parser-test before adding.** Cache the PDF/XLSX locally; run the relevant parser directly to verify the executed/amended/law numbers come out sane. Sanity ratios: `amended/planned` typically 0.5×–3.0×; `executed/amended` typically 0.7–1.3.

3. **Identify the format**:
   - PDF with visible cell borders → `format: "pdf"`
   - PDF with no borders (only row shading, like МО) → `format: "pdf-borderless"`. Set `trailingValueCount` to the number of trailing numeric cells per programme row (typically 6 for the quarterly-cumulative layout `[Закон, Уточнен план, Q1, H1, 9M, Y]`).
   - XLSX inside a ZIP → `format: "xlsx-in-zip"`. Set `entryName` to a SUFFIX of the .xlsx path inside the archive (the matcher is suffix-based for encoding-robustness).
   - WAF-blocked site → `format: "manual-pdf"` (commented out by default; operator activates per the manual-fetch workflow below).

4. **Look up the admin node id** from `data/budget/classification/admin.json`:

   ```bash
   node -e "const r=require('./data/budget/classification/admin.json'); r.nodes.filter(n => n.nameBg.includes('<ministry name fragment>')).forEach(n => console.log(n.id, '|', n.nameBg))"
   ```

5. **Add the entry** in `scripts/budget/fetch_sources.ts:EXECUTION_REPORTS` with `fiscalYear`, `adminId`, `unitNameBg`, `format`, `url`, and any format-specific fields.

6. **Sanity-check scope.** After ingest, the `⚠ admin-grain sanity` warning will fire if `amended/planned > 3.5×` or similar — that signals the отчет reports a wider scope (consolidated, with EU funds / transfers) than `law_html.ts` captures. The reconciler's "prefer the отчет's `Закон` column" rule handles this automatically when the отчет's law value is materially larger; the warning is the alert.

7. **Update the canary fixture** if the new ministry is also the pinned canary for its format (rare — only if you're rotating the canary target). To rotate: delete the relevant `tests/fixtures/budget/execution-*-canary.json` and re-run; the fixture seeds on first miss.

## Manual-fetch workflow (WAF-blocked ministries: МВР, МФ, …)

Some ministry sites (minfin.bg, mvr.bg) WAF-block automated clients on every endpoint, every UA. For these:

1. **Find the source URL** in a real browser (the `url` in the `manual-pdf` entry is informational).
2. **Download the PDF** in that browser.
3. **Save it** at exactly: `raw_data/budget/exec-<adminId>-<fy>.pdf`.
4. **Uncomment** the entry in `EXECUTION_REPORTS` (manual-pdf entries default to commented-out so they don't fire the missing-file warning until activated).
5. **Run** `npm run budget:ingest`. If the file isn't found, the run logs `⚠ <adminId> <year> [manual-pdf]: skipped — …` and continues (non-fatal); the rest of the pipeline still completes.

### Playwright discovery for JS-rendered budget sections

Several ministries (МОН, МРРБ, МК, МЕ, МС, МВнР, МТС) render their budget index client-side, so static HTML scraping returns the page shell without the PDF links. `scripts/budget/discover_execution_reports.ts` opens each in chromium, waits for JS to populate, follows one level of budget-keyworded sub-pages, and writes scored candidates to `data-reports/budget-discovery-<DATE>.md`.

```bash
# Headed: opens chromium, pauses between ministries for inspection
npx tsx scripts/budget/discover_execution_reports.ts --ministry mc

# Headless: batch sweep, writes the report and exits
npx tsx scripts/budget/discover_execution_reports.ts --headless
```

The scoring boosts canonical filename patterns (`<chapter>_Otchet_<date>.doc[x]`, `Otchet_programi_*`) and penalises known false-positive classes (АУЕР Forma ZEE energy-efficiency forms, EU operational-programme progress reports). The operator picks the right candidate from the report, saves to `raw_data/budget/exec-<adminId>-<fy>.pdf`, and adds a manual-pdf entry to EXECUTION_REPORTS. **This is a one-off discovery tool — not wired into the watcher or CI.**

Known parser gap surfaced by the tool: МК publishes binary `.doc` (Word 97-2003), not OOXML `.docx`. `headcount_docx.ts`'s unzipper path won't open them — they'd need a separate binary-doc parser (e.g., libreoffice convert or `textract`) before they can be ingested.

### Wayback fallback for МФ ProgOtchet

When the live minfin.bg is Cloudflare-challenged but the file already exists, the Internet Archive usually has a usable capture. The `minfin_program_otchet` watcher (`scripts/watch/sources/minfin_program_otchet.ts`) polls Wayback CDX for `1000_Pril-1-MoF_*ProgOtchet*.pdf` and surfaces the latest annual capture. When it flips, the operator can pull the file via the `id_` raw-flavor:

```bash
curl -sL "https://web.archive.org/web/<timestamp>id_/<original-url>" \
  -o raw_data/budget/exec-admin-ministerstvoto-na-finansite-<fy>.pdf
```

…then activate the matching manual-pdf entry in `EXECUTION_REPORTS` and re-ingest. The МФ FY2023 entry was seeded this way; FY2024 awaits a Wayback capture.

## Canaries — what each one guards

Six canaries fire every run. Any mismatch throws; the run halts before any write. To investigate, read the named parser; to deliberately re-seed (after a confirmed upstream format change), delete the fixture file and re-run.

| Canary                                      | Fixture                                                  | Guards                                                                          |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| egov КФП resource (2025-12)                 | `tests/fixtures/budget/canary.json`                      | The КФП monthly-snapshot parser (`scripts/budget/kfp.ts`) + currency conversion |
| State Budget Law 2024                       | `tests/fixtures/budget/law-canary.json`                  | `scripts/budget/law_html.ts` — per-unit appropriation extraction                |
| Execution report [pdf] (MH 2024)            | `tests/fixtures/budget/execution-canary.json`            | `pdf_table.ts` (border-aware extractor) + `execution_pdf.ts` (appendix parser)  |
| Execution report [pdf-borderless] (МО 2024) | `tests/fixtures/budget/execution-borderless-canary.json` | `pdf2array` + `execution_borderless_pdf.ts` (positional column convention)      |
| Execution report [xlsx-in-zip] (МТСП 2024)  | `tests/fixtures/budget/execution-xlsx-canary.json`       | `unzipper` + `xlsx` + `execution_xlsx.ts`                                       |
| Economic facts (2025)                       | `tests/fixtures/budget/economic-canary.json`             | `normalize_egov.ts` — economic-grain plan + execution                           |

## Sanity warnings vs. canary failures

These two signals catch different classes of drift:

- **Canary mismatch (HALT)** — byte-level parser drift on a pinned source. Triggers on a `String !== String` against the fixture. Almost always means: (a) the upstream changed its document structure, or (b) a parser code change unintentionally moved bytes. Investigate the named parser BEFORE re-running.

- **Sanity warning (CONTINUE)** — per-row ratio outside expected bounds at admin grain (`amended/planned` outside `[0.4, 3.5]`, `executed/amended` outside `[0.5, 1.6]`, `executed/planned` outside `[0.4, 4.0]`). The numbers reach disk; the warning prompts eyeballing before commit. A new ministry whose отчет reports a much wider scope than the law captures will fire this — the fix is usually to confirm the reconciliation looks right and accept, not to change the parser.

## Common pitfalls

### Canary mismatch

A pinned resource re-parses to bytes different from its committed fixture. Read the relevant parser source first; the fixture's pinned target tells you which one. To deliberately re-seed after confirming an upstream change: `rm tests/fixtures/budget/<the-canary>.json` and re-run.

### Currency switch

The 2025 КФП resources are in millions of BGN; 2026+ are in millions of EUR (Bulgaria joined the eurozone 2026-01-01). The КФП parser detects this from the header. Per-ministry execution parsers use `fiscalYear >= 2026 ? "EUR" : "BGN"` (no header to read). Both `amountEur` (the display value) and the native `amount`/`currency` are stored.

### Scope-mismatch survivor

If `amended/planned > 3.5×` fires a sanity warning, the ministry's `law_html.ts` planned (state-budget section II only) and its отчет's "Закон" column (consolidated, incl. EU funds + transfers) disagree on scope. The reconciler's "prefer the отчет's `Закон` when present" rule normally fixes this; the warning's job is to flag cases where the rule didn't engage cleanly. Inspect `data/budget/facts/<year>/admin.json` for the two `law`-stage facts (one from `law-<year>`, one from `exec-<adminId>-<year>`) and confirm the reconciler picked the right one.

### data.egov.bg API — which endpoints work

The CKAN-style GET routes (`searchDataset`, `getOrganisations`) return `success:false` ("Непознат метод"), so the КФП / budget-execution watcher and `/update-procurement` parse the dataset HTML for resource UUIDs. BUT the **POST** methods `/api/listDatasets` (body `{criteria:{org_ids:[N]}}`) and `/api/getResourceData` (body `{resource_uri}`) DO work and return structured JSON — `getResourceData` yields the resource as a 2D row array. These power the `scripts/budget/lib/egov_api.ts` client used by the municipal-execution ingest and the Sofia capital `--source egov` fallback. Do not "fix" those back to HTML scraping.

### minfin.bg WAF blocks everything

Every UA gets 403, even on static `/upload/*.pdf` URLs. Use the manual-fetch workflow for МФ (and any other minfin.bg-hosted ministry report).

### MOD (borderless PDF) column shift

МО's PDF has no cell borders — `pdf2array` clusters by text line. If МО adds/drops a column in next year's report, the `trailingValueCount` becomes wrong silently. The borderless canary catches byte drift; verify against a fresh download annually.

### MLSP (XLSX) header drift

МТСП's XLSX header sometimes shows stale year labels (e.g. "Закон 2023 г." in a 2024 file — template lag at the source). `findValueColumns` is whitespace-tolerant; the parser scans for the keyword anywhere in the cell. If МТСП restructures the workbook (renames sheets, splits Прогр. into multiple sheets), the XLSX canary catches drift.

### Diff cap aborts the run

Pre-existing condition the slice fixed: `writeIfChanged` now ignores `generatedAt`/`lastIngest`-only diffs, and `checkDiffSize` excludes gitignored shards from both baseline and touched counts. If the cap fires legitimately on a major restructure, bump the `maxFraction` in `validate.ts` temporarily for that run.

## File map

| Path                                                                 | Purpose                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/budget/ingest.ts`                                           | CLI entry — fetch, parse, validate, write, upload; per-row sanity warnings                                                                                                                                                                  |
| `scripts/budget/fetch_sources.ts`                                    | All curated source maps (`LAW_DV_MATERIALS`, `AMENDMENT_DV_MATERIALS`, `EXECUTION_REPORTS`) + fetchers (`fetchEgovResource`, `fetchLawHtml`, `fetchExecutionPdf`, `fetchExecutionZipXlsx`, `readManualExecutionPdf`)                        |
| `scripts/budget/kfp.ts`                                              | egov resource → `KfpObservation[]` + latest snapshot                                                                                                                                                                                        |
| `scripts/budget/law_html.ts`                                         | Държавен вестник HTML → `ParsedLawUnit[]` (per-unit I/II/III/IV + program tables)                                                                                                                                                           |
| `scripts/budget/pdf_table.ts`                                        | Border-aware PDF table extractor (pdfjs-dist) — used by bordered `execution_pdf.ts`                                                                                                                                                         |
| `scripts/budget/execution_pdf.ts`                                    | Bordered-PDF appendix parser → `ParsedExecutionUnit`                                                                                                                                                                                        |
| `scripts/budget/execution_borderless_pdf.ts`                         | Borderless-PDF parser (pdf2array, positional column convention) → `ParsedExecutionUnit`                                                                                                                                                     |
| `scripts/budget/execution_xlsx.ts`                                   | XLSX parser (SheetJS, rightmost Отчет + policy-area sum) → `ParsedExecutionUnit`                                                                                                                                                            |
| `scripts/budget/execution_facts.ts`                                  | `ParsedExecutionUnit` → admin + program-grain `BudgetFact[]`; emits law (from отчет's "Закон"), amendment (уточнен план), execution stages                                                                                                  |
| `scripts/budget/facts.ts`                                            | Law admin/program registries + law-stage facts; `LAW_PROMULGATION` dates                                                                                                                                                                    |
| `scripts/budget/normalize_egov.ts`                                   | КФП feed → economic-grain facts (plan + execution)                                                                                                                                                                                          |
| `scripts/budget/reconcile.ts`                                        | `buildAdminReconciliation`, `buildProgramReconciliation`, `buildEconomicReconciliation` — joins law + execution facts                                                                                                                       |
| `scripts/budget/ministries.ts`                                       | Per-ministry rollup builder (one file per spending unit; carries `execution: { revenue, expenditure }` when ingested)                                                                                                                       |
| `scripts/budget/cross_reference.ts`                                  | Phase 4 — admin → procurement awarder match (eik on admin nodes)                                                                                                                                                                            |
| `scripts/budget/documents.ts`                                        | Budget-journey document index (kfp-feed, law, amendment, execution-report, audit-report entries)                                                                                                                                            |
| `scripts/budget/classification.ts`                                   | Registry loader + `resolveCode` (fail-loud on unknown codes); `ensureScaffolds`                                                                                                                                                             |
| `scripts/budget/validate.ts`                                         | canonicalJson, canary, diff-cap (with gitignored-shard exclusion + volatile-key filter on writeIfChanged)                                                                                                                                   |
| `scripts/budget/types.ts`                                            | Shared type definitions (all phases)                                                                                                                                                                                                        |
| `scripts/watch/sources/egov_budget_execution.ts`                     | Watcher — КФП dataset resource-UUID list                                                                                                                                                                                                    |
| `scripts/watch/sources/ministry_execution_reports.ts`                | Watcher — HEAD-probes every fetchable URL in `EXECUTION_REPORTS` (skips manual-pdf)                                                                                                                                                         |
| `scripts/watch/sources/minfin_program_otchet.ts`                     | Watcher — Wayback CDX of `1000_Pril-1-MoF_*ProgOtchet*.pdf`, the МФ programme-budget execution reports (covers the WAF-blocked manual-pdf gap)                                                                                              |
| `scripts/watch/sources/mfa_program_otchet.ts`                        | Watcher — Wayback CDX of `mfa.bg/upload/<id>/*програмен отчет*.zip`, the МВнР programmatic execution reports. Complements `ministry_execution_reports` by surfacing NEW fiscal years (the existing watcher HEAD-probes already-listed URLs) |
| `scripts/budget/discover_execution_reports.ts`                       | One-off Playwright discovery aid — sweeps JS-rendered ministry budget sections and writes scored candidate URLs to `data-reports/budget-discovery-<DATE>.md`. Not wired into the watcher or CI.                                             |
| `data/budget/index.json`                                             | Year/period coverage summary — committed                                                                                                                                                                                                    |
| `data/budget/kfp.json`                                               | КФП observation series + snapshots — committed                                                                                                                                                                                              |
| `data/budget/documents.json`                                         | Budget-journey document index — committed                                                                                                                                                                                                   |
| `data/budget/classification/*.json`                                  | Classification registries — committed                                                                                                                                                                                                       |
| `data/budget/crosswalk-overrides.json`                               | Hand-curated parser corrections (code remaps, fact patches) — committed                                                                                                                                                                     |
| `data/budget/facts/<YYYY>/{admin,economic,program}.json`             | Per-year shards — **GITIGNORED** (regenerable, bulky)                                                                                                                                                                                       |
| `data/budget/reconciliation/<YYYY>/by-{admin,economic,program}.json` | Per-year reconciliation rows — **GITIGNORED**                                                                                                                                                                                               |
| `data/budget/ministries/<nodeId>.json`                               | Per-ministry rollups — **GITIGNORED**                                                                                                                                                                                                       |
| `data/budget/derived/ministry_procurement.json`                      | Phase 4 admin-grain procurement footprint — committed                                                                                                                                                                                       |
| `scripts/budget/run_consumption_coicop.ts`                           | Eurostat `nama_10_co3_p3` + `nama_10_gdp` → COICOP consumption structure + household totals (GDP-anchored unit detection)                                                                                                                   |
| `scripts/budget/run_policy_baseline.ts`                              | Joins КФП lines + НАП PIT split + Митница excise split + `gov_10a_taxag` + consumption → the /budget/simulator baseline; drift gate + round-trip guard                                                                                      |
| `scripts/watch/sources/eurostat_policy.ts`                           | Watcher — `updated` timestamps of the four policy-baseline Eurostat datasets                                                                                                                                                                |
| `data/budget/revenue_breakdown/consumption.json`                     | COICOP consumption structure (61 categories) + P31_S14 totals — committed                                                                                                                                                                   |
| `data/budget/derived/policy_baseline.json`                           | Tax-policy simulator baseline (revenue lines, VAT slices + calibration, МОД identity) — committed                                                                                                                                           |
| `tests/fixtures/budget/*-canary.json`                                | Pinned regression baselines — committed                                                                                                                                                                                                     |
| `raw_data/budget/`                                                   | Gzip cache of downloaded resources + manual-pdf operator drops — **GITIGNORED**                                                                                                                                                             |

## After a successful run

Stamp the ingest marker so `/process-watch-report` knows this skill is current:

```bash
npx tsx scripts/stamp-ingest.ts update-budget --summary "<one-line recap>"
```

Suggested recap formats:

- КФП-only refresh: `"КФП feed through YYYY-MM, N observations"`
- Ministry execution: `"N execution reports ingested for FY<year>"`
- Mixed: `"КФП through YYYY-MM + N execution reports for FY<year>"`

## What this skill does NOT do

- **No frontend.** The `/budget` dashboard consumes `data/budget/*.json` via React Query hooks once the data is on the bucket.
- **No DV-amendment parsing.** DV amendment laws are catalogued for provenance only — the per-ministry amended figure comes from the year-end execution report's "Уточнен план" column. See the `project_budget_dv_amendments` memory for the full rationale.
- **No automated download of WAF-blocked sources.** minfin.bg, mvr.bg, and similar sites need the manual-fetch workflow.
- **No cross-check against the КФП consolidated total** (yet). When КФП data starts covering FY2024+ years that also have execution reports ingested, a sum-of-admin-grain-executed vs КФП-consolidated-expenditure check would catch absolute-value parser-pollution bugs the per-row sanity warnings don't.

### Expenditure side of the policy baseline

`run_policy_baseline.ts` also emits an `expenditure` section for the simulator's spending levers. Inputs:

- **Pensions** — mass from `data/budget/noi/funds.json`; Swiss-rule inputs (trailing-4Q CPI and labour-income growth from `macro.json`); the COVID-supplement slice (curated).
- **Administration** — positions/vacancies from `personnel.json` national aggregates + payroll cost-per-FTE from the covered ministries; МРЗ formula value (КТ чл.244 recursion).
- **Personnel + capital** — the КФП Персонал and Капиталови lines (executed + planned) from the December snapshot; capital carries its historical execution rate.
- **Defense** — a curated NATO-definition % of GDP (`NATO_DEFENSE_PCT_GDP` — differs from COFOG GF02; bump when NATO publishes the new estimate).
- **SSC self-paid** — държавни служители count + average wage (curated from the НОИ SOD category).
- **Health** — the employee insurable base (from the earnings fit), for the per-pp health-contribution lever.
- **Pension floor** — the НОИ quarterly **STATB** bulletin (`NOI_STATB_URL`, fetched + cached under `raw_data/budget/`, parsed with SheetJS): pension-size bands + at-minimum counts for the минимална-пенсия lever. **A new quarter is a new filename — bump `NOI_STATB_URL` when the `policy_baseline_local` watcher flags it.**
- **Teachers' 125% peg** — live `educ_uoe_perp01` headcount (Eurostat) + NSI open-data id=612 wages (note: its JSON-stat `value` is a LIST, not Eurostat's dict).

Curated constants to maintain in the script: `PENSIONER_COUNT`, `COVID_SUPPLEMENT_EUR_MONTHLY`, `MIN_WAGE_EUR` (update when МРЗ changes by law), `NATO_DEFENSE_PCT_GDP`, `CIVIL_SERVANTS_COUNT`/`CIVIL_SERVANTS_AVG_WAGE_EUR`, `EXEMPT_PERSONNEL_SHARE`, and `NOI_STATB_URL`. Watched by `eurostat_policy` (the five Eurostat datasets, incl. `educ_uoe_perp01`) and `policy_baseline_local` (НОИ STATB current+next quarter, NSI id=612). Smoke: `npx tsx scripts/budget/__smoke_expenditure.ts` (CPI-only pension indexation ≈ −€480M/yr; a −5% administration cut ≈ €0, fully absorbed by vacancies; teachers at the current ratio = exactly €0; prints the НОИ pension-floor validation check). The pension-floor validation reproduces НОИ's published top-up cost only within ×0.65 — band-midpoint coarseness — so it WARNS rather than throws; the raise lever is insulated (scores from the minimum itself).
