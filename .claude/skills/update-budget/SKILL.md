---
name: update-budget
description: Ingest Bulgarian state-budget data into data/budget/. Phase 1 pulls the data.egov.bg КФП feed (state budget execution by major budget indicators) into the KfpObservation time series + document index. Use when the daily watch report flags "data.egov.bg бюджет" as changed, when the user asks to refresh budget data, or after a fresh clone if data/budget/ is empty.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Budget skill

Ingests the Bulgarian state budget into `data/budget/`. **Phase 1** (current)
pulls the data.egov.bg КФП feed — "state budget execution by major budget
indicators" — and builds the KfpObservation time series, the latest detailed
snapshot, the budget-journey document index, and the (empty) classification
registry scaffolds.

Later phases add ministry-level execution + variance (P2), program/line-item
PDF-annex reconciliation (P3), and the procurement cross-link (P4). They are
not built yet — this skill only does Phase 1.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `data.egov.bg бюджет: N new monthly snapshot(s)` | Incremental ingest (`npm run budget:ingest`) |
| User asks to "refresh budget" / "update budget data" | Same — incremental |
| `data/budget/` empty (fresh clone) | Cold-start ingest of every visible monthly resource |
| Canary mismatch warning surfaced | Investigate `scripts/budget/kfp.ts` BEFORE re-running |

## Step 1 — Ingest

```bash
npm run budget:ingest
```

Walks the egov dataset listing, downloads each monthly resource (gzip-cached
under `raw_data/budget/`), parses every resource into the five
top-level sections (revenue / expenditure / EU contribution / balance /
financing), and writes canonical JSON to `data/budget/`.

Expected output on a normal day (one new monthly snapshot published):

```
→ walking egov budget dataset
  10 resource(s) listed
  • 2026-03 (EUR) — 5 section(s), ba988f39-…
  …
→ canary on resource 817cf3fb-7e59-4cf7-9f50-8cbccd11bb60
  canary OK (sha256=…)
  kfp.json: 50 observation(s), latest 2026-03
→ building document index
  documents.json: 4 document(s)
→ wrote N file(s) under data/budget/
✓ budget ingest complete — 50 observation(s), 2 year(s), 4 document(s)
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

Expect: `kfp.json` + `documents.json` + `index.json` modified, possibly the
`classification/*.json` scaffolds on first run. The diff-cap aborts the run if
it would touch >5% of the existing tree.

## Step 3 — Upload + commit

```bash
npm run budget:ingest -- --upload
git add data/budget/ tests/fixtures/budget/
git commit -m "budget: ingest КФП feed through YYYY-MM"
```

The canary fixture (`tests/fixtures/budget/canary.json`) is committed.

## Data-integrity contract

Fails loud rather than write partial data. Surfaces that halt before any write:

| Surface | Trigger |
|---|---|
| HTTP error on data.egov.bg | non-200 on the dataset page or a resource download |
| Resource not a 2D array | upstream changed the resource format |
| Missing "Изпълнение" column | header structure changed — `parseHeader` throws naming the resource |
| Missing section (I–V) | the five-section table structure changed |
| Canary mismatch | the pinned 2025-12 resource re-parses to bytes different from the committed fixture |
| Diff-cap exceeded | run would touch >5% of `data/budget/` |

Intentionally non-fatal:

| Surface | Behaviour |
|---|---|
| bulnao audit-report listing unreachable / changed | document index built without audit entries; warning logged |
| minfin.bg unreachable (403s automated clients) | skipped — the egov feed already carries the state-budget series |
| empty `Закон` column (2026 post-euro resources) | `planned` is null for those observations — honest, not an error |

## Common pitfalls

### Canary mismatch
The 2025-12 resource (`817cf3fb-…`) is re-parsed every run. If output bytes
drift, the parser regressed. To re-seed after a genuine upstream format change:
delete `tests/fixtures/budget/canary.json` and re-run.

### Currency switch
The 2025 resources are in millions of BGN; 2026+ are in millions of EUR
(Bulgaria joined the eurozone 2026-01-01). The parser detects this from the
header and folds BGN→EUR via `src/lib/currency.ts`. Both `amountEur` (the
display value) and the native `amount`/`currency` are stored.

### data.egov.bg API is broken
The CKAN-style `/api` endpoints return `success:false`. The fetcher parses the
dataset HTML page for resource UUIDs — same approach as `/update-procurement`.

## File map

| Path | Purpose |
|---|---|
| `scripts/budget/ingest.ts` | CLI entry — fetch, parse, validate, write, upload |
| `scripts/budget/fetch_sources.ts` | egov resource list + download + gzip cache; bulnao fetch |
| `scripts/budget/kfp.ts` | egov resource → KfpObservation[] + latest snapshot |
| `scripts/budget/documents.ts` | budget-journey document index builder |
| `scripts/budget/classification.ts` | registry loader + resolver + scaffold creation (Phase 2+ consumer) |
| `scripts/budget/validate.ts` | canonicalJson, canary, diff-cap |
| `scripts/budget/types.ts` | shared type definitions (all phases) |
| `scripts/watch/sources/egov_budget_execution.ts` | watcher source — fingerprints the egov budget dataset |
| `data/budget/index.json` | year/period coverage summary — committed |
| `data/budget/kfp.json` | КФП observation series + latest snapshot — committed |
| `data/budget/documents.json` | budget-journey document index — committed |
| `data/budget/classification/*.json` | classification registries (empty in Phase 1) — committed |
| `data/budget/crosswalk-overrides.json` | hand-curated parser corrections — committed |
| `tests/fixtures/budget/canary.json` | pinned regression baseline — committed |
| `raw_data/budget/` | gzip cache of downloaded resources — gitignored |

## After a successful run

Stamp the ingest marker so `/process-watch-report` knows this skill is current:

```bash
npx tsx scripts/stamp-ingest.ts update-budget --summary "КФП feed through YYYY-MM, N observations"
```

## What this skill does NOT do

- **No frontend.** The `/budget` dashboard consumes `data/budget/*.json` via
  React Query hooks once the data is on the bucket.
- **No PDF parsing.** Budget-law / amendment / execution-report annex parsing
  is Phase 3. The `law-<year>` entries in `documents.json` are placeholders.
- **No ministry / program breakdown.** That is Phase 2+. Phase 1 is the
  top-level КФП series only.
