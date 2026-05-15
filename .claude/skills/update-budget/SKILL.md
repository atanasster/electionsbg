---
name: update-budget
description: Ingest Bulgarian state-budget data into data/budget/. Two ingest paths share one CLI — the data.egov.bg КФП feed (consolidated state-budget execution time series + monthly snapshot) and per-ministry "Отчет за изпълнението на програмния бюджет" reports (admin + program grain reconciliation against the State Budget Law). Use when the daily watcher flags `data.egov.bg бюджет` or `ministry_execution_reports` as changed, when the user asks to "refresh budget" / "update budget data", when adding a new fiscal year of execution reports, after a fresh clone if `data/budget/` is empty, or to investigate a canary mismatch or sanity-warning surfaced by a previous run.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Budget skill

Ingests the Bulgarian state budget into `data/budget/`. **Three pillars** run from one CLI (`npm run budget:ingest`):

1. **КФП feed** (data.egov.bg) — monthly consolidated execution snapshots → time series, economic-grain plan-vs-actual, fiscal-year roll-ups, latest snapshot.
2. **State Budget Law** (Държавен вестник HTML) — per-spending-unit appropriations → admin-grain + program-grain BudgetFacts at `stage: "law"`, the administrative + program classification registries, the law/amendment document index.
3. **Per-ministry execution reports** — each first-level spending unit's "Отчет за изпълнението на програмния бюджет" → admin + program-grain BudgetFacts at `stage: "amendment"` (уточнен план) and `stage: "execution"` (отчет), joined against the law facts for the full law → amended → executed reconciliation. **Four source formats supported**, hand-curated in `EXECUTION_REPORTS`.

Plus the budget-journey document index, procurement cross-link (Phase 4), and per-ministry rollups (sliced files the ministry detail screen reads).

## When to run

| Trigger | Action |
|---|---|
| `data.egov.bg бюджет: N new monthly snapshot(s)` | Incremental ingest (`npm run budget:ingest`) |
| `Per-ministry execution reports: N updated` | Same — the watcher's `describe()` names the changed ministries |
| User says "refresh budget" / "update budget data" | Same — incremental |
| New fiscal year's reports publish (mid-year) | Update each ministry's URL in `EXECUTION_REPORTS`; ingest; re-seed canaries |
| `data/budget/` empty (fresh clone) | Cold-start ingest of every visible monthly resource + curated reports |
| Canary mismatch warning surfaced | Investigate the named parser in `scripts/budget/` BEFORE re-running |
| Sanity-warning `⚠ admin-grain sanity (…)` surfaced | Investigate that ministry's report manually before committing |

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

## Data sources — by source format

| Source | Format | Reader | Parser | Where |
|---|---|---|---|---|
| КФП feed | egov dataset (JSON) | `fetchEgovResource` | `parseEgovResource` → `buildKfpFile` + `buildEconomicFacts` | data.egov.bg `79ce7de2-…` |
| State Budget Law | HTML (ДВ) | `fetchLawHtml` | `parseLawHtml` (cheerio walker for "Приема бюджета на X") | `dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=…`; curated in `LAW_DV_MATERIALS` |
| DV amendments | HTML (ДВ) | — *(catalog-only)* | — | curated `idMat` list in `AMENDMENT_DV_MATERIALS`. Catalogued for provenance; figures NOT parsed (see `project_budget_dv_amendments` memory) |
| Bordered ministry PDF | PDF with cell-border rectangles | `fetchExecutionPdf` | `pdf_table.ts` (pdfjs-dist) → `execution_pdf.ts` | per-ministry curated URL in `EXECUTION_REPORTS` (`format: "pdf"`) |
| Borderless ministry PDF | PDF with no cell borders (text-positioned tables) | `fetchExecutionPdf` | `pdf2array` → `execution_borderless_pdf.ts` (positional column convention via `trailingValueCount`) | `EXECUTION_REPORTS` (`format: "pdf-borderless"`) |
| Ministry XLSX in ZIP | ZIP containing XLSX | `fetchExecutionZipXlsx` (unzipper) | `xlsx` (SheetJS) → `execution_xlsx.ts` | `EXECUTION_REPORTS` (`format: "xlsx-in-zip"`) |
| Manual PDF (WAF-blocked) | bare PDF, no auto-fetch | `readManualExecutionPdf` (cache only) | `execution_pdf` OR `execution_borderless_pdf` based on `trailingValueCount` | `EXECUTION_REPORTS` (`format: "manual-pdf"`); operator drops PDF at `raw_data/budget/exec-<adminId>-<fy>.pdf` |
| Сметна палата audit listing | HTML | `fetchBulnaoAuditHtml` | best-effort regex; non-fatal | bulnao.government.bg |

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

## Canaries — what each one guards

Six canaries fire every run. Any mismatch throws; the run halts before any write. To investigate, read the named parser; to deliberately re-seed (after a confirmed upstream format change), delete the fixture file and re-run.

| Canary | Fixture | Guards |
|---|---|---|
| egov КФП resource (2025-12) | `tests/fixtures/budget/canary.json` | The КФП monthly-snapshot parser (`scripts/budget/kfp.ts`) + currency conversion |
| State Budget Law 2024 | `tests/fixtures/budget/law-canary.json` | `scripts/budget/law_html.ts` — per-unit appropriation extraction |
| Execution report [pdf] (MH 2024) | `tests/fixtures/budget/execution-canary.json` | `pdf_table.ts` (border-aware extractor) + `execution_pdf.ts` (appendix parser) |
| Execution report [pdf-borderless] (МО 2024) | `tests/fixtures/budget/execution-borderless-canary.json` | `pdf2array` + `execution_borderless_pdf.ts` (positional column convention) |
| Execution report [xlsx-in-zip] (МТСП 2024) | `tests/fixtures/budget/execution-xlsx-canary.json` | `unzipper` + `xlsx` + `execution_xlsx.ts` |
| Economic facts (2025) | `tests/fixtures/budget/economic-canary.json` | `normalize_egov.ts` — economic-grain plan + execution |

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

### data.egov.bg API is broken
The CKAN-style `/api` endpoints return `success:false`. The fetcher parses the dataset HTML page for resource UUIDs — same approach as `/update-procurement`.

### minfin.bg WAF blocks everything
Every UA gets 403, even on static `/upload/*.pdf` URLs. Use the manual-fetch workflow for МФ (and any other minfin.bg-hosted ministry report).

### MOD (borderless PDF) column shift
МО's PDF has no cell borders — `pdf2array` clusters by text line. If МО adds/drops a column in next year's report, the `trailingValueCount` becomes wrong silently. The borderless canary catches byte drift; verify against a fresh download annually.

### MLSP (XLSX) header drift
МТСП's XLSX header sometimes shows stale year labels (e.g. "Закон 2023 г." in a 2024 file — template lag at the source). `findValueColumns` is whitespace-tolerant; the parser scans for the keyword anywhere in the cell. If МТСП restructures the workbook (renames sheets, splits Прогр. into multiple sheets), the XLSX canary catches drift.

### Diff cap aborts the run
Pre-existing condition the slice fixed: `writeIfChanged` now ignores `generatedAt`/`lastIngest`-only diffs, and `checkDiffSize` excludes gitignored shards from both baseline and touched counts. If the cap fires legitimately on a major restructure, bump the `maxFraction` in `validate.ts` temporarily for that run.

## File map

| Path | Purpose |
|---|---|
| `scripts/budget/ingest.ts` | CLI entry — fetch, parse, validate, write, upload; per-row sanity warnings |
| `scripts/budget/fetch_sources.ts` | All curated source maps (`LAW_DV_MATERIALS`, `AMENDMENT_DV_MATERIALS`, `EXECUTION_REPORTS`) + fetchers (`fetchEgovResource`, `fetchLawHtml`, `fetchExecutionPdf`, `fetchExecutionZipXlsx`, `readManualExecutionPdf`) |
| `scripts/budget/kfp.ts` | egov resource → `KfpObservation[]` + latest snapshot |
| `scripts/budget/law_html.ts` | Държавен вестник HTML → `ParsedLawUnit[]` (per-unit I/II/III/IV + program tables) |
| `scripts/budget/pdf_table.ts` | Border-aware PDF table extractor (pdfjs-dist) — used by bordered `execution_pdf.ts` |
| `scripts/budget/execution_pdf.ts` | Bordered-PDF appendix parser → `ParsedExecutionUnit` |
| `scripts/budget/execution_borderless_pdf.ts` | Borderless-PDF parser (pdf2array, positional column convention) → `ParsedExecutionUnit` |
| `scripts/budget/execution_xlsx.ts` | XLSX parser (SheetJS, rightmost Отчет + policy-area sum) → `ParsedExecutionUnit` |
| `scripts/budget/execution_facts.ts` | `ParsedExecutionUnit` → admin + program-grain `BudgetFact[]`; emits law (from отчет's "Закон"), amendment (уточнен план), execution stages |
| `scripts/budget/facts.ts` | Law admin/program registries + law-stage facts; `LAW_PROMULGATION` dates |
| `scripts/budget/normalize_egov.ts` | КФП feed → economic-grain facts (plan + execution) |
| `scripts/budget/reconcile.ts` | `buildAdminReconciliation`, `buildProgramReconciliation`, `buildEconomicReconciliation` — joins law + execution facts |
| `scripts/budget/ministries.ts` | Per-ministry rollup builder (one file per spending unit; carries `execution: { revenue, expenditure }` when ingested) |
| `scripts/budget/cross_reference.ts` | Phase 4 — admin → procurement awarder match (eik on admin nodes) |
| `scripts/budget/documents.ts` | Budget-journey document index (kfp-feed, law, amendment, execution-report, audit-report entries) |
| `scripts/budget/classification.ts` | Registry loader + `resolveCode` (fail-loud on unknown codes); `ensureScaffolds` |
| `scripts/budget/validate.ts` | canonicalJson, canary, diff-cap (with gitignored-shard exclusion + volatile-key filter on writeIfChanged) |
| `scripts/budget/types.ts` | Shared type definitions (all phases) |
| `scripts/watch/sources/egov_budget_execution.ts` | Watcher — КФП dataset resource-UUID list |
| `scripts/watch/sources/ministry_execution_reports.ts` | Watcher — HEAD-probes every fetchable URL in `EXECUTION_REPORTS` |
| `data/budget/index.json` | Year/period coverage summary — committed |
| `data/budget/kfp.json` | КФП observation series + snapshots — committed |
| `data/budget/documents.json` | Budget-journey document index — committed |
| `data/budget/classification/*.json` | Classification registries — committed |
| `data/budget/crosswalk-overrides.json` | Hand-curated parser corrections (code remaps, fact patches) — committed |
| `data/budget/facts/<YYYY>/{admin,economic,program}.json` | Per-year shards — **GITIGNORED** (regenerable, bulky) |
| `data/budget/reconciliation/<YYYY>/by-{admin,economic,program}.json` | Per-year reconciliation rows — **GITIGNORED** |
| `data/budget/ministries/<nodeId>.json` | Per-ministry rollups — **GITIGNORED** |
| `data/budget/derived/ministry_procurement.json` | Phase 4 admin-grain procurement footprint — committed |
| `tests/fixtures/budget/*-canary.json` | Pinned regression baselines — committed |
| `raw_data/budget/` | Gzip cache of downloaded resources + manual-pdf operator drops — **GITIGNORED** |

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
