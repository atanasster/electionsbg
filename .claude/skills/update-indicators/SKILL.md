---
name: update-indicators
description: Refresh the annual sub-national indicators data (data/indicators.json) — registered unemployment per municipality from Агенция по заетостта and DZI (state matura exam) average scores per municipality from МОН via data.egov.bg. Use when the daily watch report flags new annual reviews ("AZ (Агенция по заетостта)" or "МОН: ДЗИ резултати"), when the user asks to refresh indicators, when adding a new annual sub-national indicator (EU funds, healthcare access), or after a fresh git clone if data/indicators.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Indicators skill

Refreshes `data/indicators.json` — annual sub-national indicators rendered on municipality drilldowns, `/sofia`, and (in Phase 3) the `/demographics` muni choropleth.

Source contract:

| Indicator | Source | Granularity | Cadence |
|---|---|---|---|
| `unemployment` | AZ годишен обзор (`/stats/4/`) | 265 municipalities (Sofia as one city aggregate under `SOF00`) | annual |
| `dzi` | МОН via data.egov.bg dataset `066b4b04` | ~243 municipalities (rural munis without upper-secondary schools omitted) | annual (May-June primary session) |
| `populationChange` | НСИ `Pop_6.1.1_Pop_DR.xlsx` (one sheet per year) | 264 municipalities (Sofia as one city aggregate under `SOF00`); value is YoY % change | annual |

Future indicators (EU funds, healthcare) plug in by adding a `SOURCES` entry in `scripts/indicators/fetch.ts`. Cadence is annual for everything in this pipeline.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `AZ (Агенция по заетостта): new year(s) YYYY` | Step 1 below |
| User asks "refresh indicators" / "update unemployment" / "add YYYY annual data" | Same |
| Adding a new indicator (DZI, EU funds, ...) | Implement the source under `scripts/indicators/sources/`, append to `SOURCES`, run |
| Fresh clone with no `data/indicators.json` | Same as step 1 (full backfill) |

AZ publishes its annual review in Q1 of the following year. Day-to-day this skill has nothing to do.

## Step 1 — Fetch

```bash
npx tsx scripts/indicators/fetch.ts
```

Expected output for a normal incremental run:

```
[unemployment] scraping...
AZ /stats/4/: 18 annual reviews found (2008..2025), processing 18.
  2008..2015: no muni-level XLSX, skipping.
  2016: ...
  ...
  2025: 530 rows, years 2024,2025
[unemployment] parsed N raw rows
[unemployment] normalize: N matched, 0 unmatched

Wrote /Users/.../data/indicators.json (≈75 KB)
  unemployment: 265 munis, years 2016..YYYY
```

If `unmatched > 0`: a row's municipality name doesn't map to an obshtina code. Add an entry to `scripts/indicators/sources/_name_aliases.json` and re-run. Common reasons:

- AZ renamed or relocated a municipality (rare).
- A new annual review uses a parenthetical disambiguator that doesn't already match (e.g. `Бяла (Русе)`) — the normalizer already strips that suffix, but new patterns may need explicit aliases.
- 2008-2015 backfill: those years are PDF-only and currently skipped. Don't add aliases for them until PDF parsing lands.

If the safety floor trips (`safety check: ...`): investigate before re-running. The floors are 260 munis covered and median-muni ≥ 2 years.

### Useful flags

- `--max-years N` — only ingest the N most recent annual reviews. Useful for quick smoke tests.
- `--force` — re-download cached XLSX files in `raw_data/indicators/az/`. Default is to reuse the local copy.
- `--source <id>` — limit to one source (e.g. `unemployment`).
- `--quiet` — suppress progress output.

## Step 2 — Verify

```bash
node -e "
const d = require('./data/indicators.json');
for (const [k, meta] of Object.entries(d.indicators)) {
  const muniN = Object.keys(d.series[k]).length;
  console.log(k.padEnd(16), 'munis=' + muniN, 'years', meta.years[0] + '..' + meta.years[1]);
}
console.log('size:', require('fs').statSync('./data/indicators.json').size, 'bytes');
"
```

Spot-check known extremes:

- `unemployment.VID09` (Видин) should be ~7-13% in the latest decade.
- `unemployment.SOF00` (София-град aggregate) should be under 3% — Sofia city has the lowest unemployment in the country.
- `unemployment.PAZ39` (Сърница, aliased from AZ's `PAZ30`) should be 15-30% — historically the highest in Bulgaria.

File size is ~75 KB for one indicator × 10 years × 265 munis. >200 KB suggests a duplicate-write bug.

## Step 3 — Stamp ingest + commit

```bash
npx tsx scripts/stamp-ingest.ts update-indicators --summary "refresh through <latest year>"
git add data/indicators.json state/ingest/update-indicators.json
git commit -m "indicators: refresh through <latest year>"
```

If you added a new indicator, also commit the source scripts:

```bash
git add scripts/indicators/ src/data/indicators/ data/indicators.json
git commit -m "indicators: add <indicatorId> from <source>"
```

## Step 4 — Upload to bucket (when applicable)

```bash
npm run bucket:sync
```

(Or `npm run bucket:sync:dry-run` first.)

## Adding a new indicator (advanced)

1. **Identify the source.** Verify the publisher offers structured (XLSX/CSV/JSON) annual data per municipality. PDF-only sources require a separate parsing path and shouldn't go through this pipeline.
2. **Implement the scraper.** Add `scripts/indicators/sources/<source>.ts` exporting a function that returns `NormalizeInput[]` rows. Use `raw_data/indicators/<source>/` for cached downloads.
3. **Register in `fetch.ts`.** Append to `SOURCES` with the indicator id, scrape function, labels in both BG and EN, unit strings, and safety floors.
4. **Register the watcher.** Add `scripts/watch/sources/indicators_<source>.ts` fingerprinting the source's release page, then add it to `scripts/watch/sources/index.ts`.
5. **Update the consumer.** Add the indicator id + delta-kind + formatter rule in `src/data/indicators/useIndicators.tsx` (Phase 2).
6. **Run this skill** to regenerate `data/indicators.json`.

## What this skill does NOT do

- **Does not refresh oblast-level (NUTS3) indicators.** Those come from Eurostat via `update-regional` — separate pipeline, separate file (`data/regional.json`).
- **Does not refresh macro-level indicators.** Those come from `update-macro`.
- **Does not parse PDF-only sources.** AZ's 2008-2015 annual reviews are PDF — coverage starts at 2016. PDF parsing is a future enhancement, not core to this skill.
- **Does not split Sofia into 24 districts.** No public source publishes per-район data; the Sofia city aggregate is stored under `SOF00` and the consumer-side hook falls back from any S2xxx district code.

## Data-integrity contract

| Surface | Trigger |
|---|---|
| HTTP non-2xx for the listing or any XLSX | `HTTP <status> ... for <url>` |
| Unrecognised XLSX layout | `parseXlsx(...): could not find header row (NUTS or ПОКАЗАТЕЛИ)` |
| Per-source muni floor breach | `safety check: [<id>] covered <N> obshtina codes (floor M)` |
| Median-years floor breach | `safety check: [<id>] median muni has <N> years (floor M)` |
| Unmatched name with no alias | Logged, not fatal — investigate and update `_name_aliases.json` before committing |

## File map

| Path | Purpose |
|---|---|
| `scripts/indicators/fetch.ts` | CLI orchestrator |
| `scripts/indicators/sources/az_unemployment.ts` | AZ discovery + XLSX parse |
| `scripts/indicators/sources/_name_aliases.json` | Manual code / name → obshtina overrides |
| `scripts/indicators/normalize.ts` | Apply aliases, validate |
| `scripts/indicators/build.ts` | Merge per-source rows → payload |
| `scripts/watch/sources/indicators_az.ts` | Daily watcher fingerprint |
| `raw_data/indicators/az/<year>.xlsx` | Cached downloads (gitignored) |
| `data/indicators.json` | Generated payload (~75 KB, minified) — committed |
| `src/data/indicators/useIndicators.tsx` | Consumer hook (Phase 2) |
| `src/screens/dashboard/IndicatorsTile.tsx` | Drilldown tile (Phase 2) |
