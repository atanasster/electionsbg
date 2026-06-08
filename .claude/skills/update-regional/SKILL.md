---
name: update-regional
description: Refresh the sub-national (oblast / NUTS 3) indicators data (data/regional.json) — re-fetch Eurostat NUTS 3 annual series (GDP per capita, population, net migration, recorded-theft rate, active-enterprise density) and merge АЗ long-term unemployment plus three NSI JSON-stat open-data datasets (FDI per capita, museum visits, hospital beds). Use when the daily watch report flags new Eurostat regional releases ("Eurostat regional (BG): new release") or NSI regional open-data releases ("НСИ regional open-data (BG): new release"), when the user asks to refresh regional indicators, or when adding a new NUTS 3 / NSI oblast indicator.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Regional skill

Refreshes `data/regional.json` — the per-oblast indicator backdrop rendered on `/municipality/<oblast>` drilldowns and the `/demographics` regional choropleth. Pulls Eurostat NUTS 3 annual series: GDP per capita (`nama_10r_3gdp`), population (`nama_10r_3popgdp`), net migration rate (`demo_r_gind3`), recorded-theft rate (`crim_gen_reg`), plus a derived active-enterprise density (`bd_size_r3` ÷ population); merges one АЗ oblast series — long-term unemployment share (`ltUnemployment`); and merges three NSI JSON-stat open-data datasets — cumulative FDI per capita (id=629), museum visits per 1000 (id=844), hospital beds per 1000 (id=1206). Together these close the Regional-Profiles gap categories Security, Business environment, Investment, Culture and Health at oblast grain.

## When to run

| Trigger                                                                                 | Action                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daily watcher reports `Eurostat regional (BG): new release · nama_10r_3gdp <date>, ...` | Run Step 1 (both scripts)                                                                                                                                                                                                                                                                  |
| Daily watcher reports `AZ (Агенция по заетостта): new year(s)`                          | Run Step 1 — refreshes the `ltUnemployment` oblast series                                                                                                                                                                                                                                  |
| Daily watcher reports `НСИ regional open-data (BG): new release · …`                    | Run Step 1 — `fetch_nsi.ts` re-pulls the changed NSI dataset(s)                                                                                                                                                                                                                            |
| User asks to "refresh regional indicators" or "update regional data"                    | Same                                                                                                                                                                                                                                                                                       |
| Adding a new NUTS 3 indicator                                                           | Add an entry to `INDICATORS` in `scripts/regional/fetch_eurostat.ts` (Eurostat) or to `NSI_INDICATORS` in `scripts/regional/fetch_nsi.ts` (NSI open-data), extend the `RegionalIndicatorKey` union + `DELTA_KIND` + `formatRegionalValue` in `src/data/regional/useRegional.tsx`, then run |

Eurostat publishes these series on an annual cadence (typically February-March for the prior year); АЗ publishes its annual review in Q1. Day-to-day there is normally nothing to do.

## Step 1 — Fetch

```bash
npx tsx scripts/regional/fetch_eurostat.ts    # Eurostat NUTS 3 series
npx tsx scripts/regional/fetch_az_oblast.ts   # merge АЗ ltUnemployment
npx tsx scripts/regional/fetch_nsi.ts         # merge NSI open-data (FDI, museums, hospital beds)
```

Run **all three, in order** — `fetch_eurostat.ts` rewrites `data/regional.json` from scratch (the Eurostat NUTS3 series + the derived `theftRate` crime and `enterpriseDensity` business indicators), then the two mergers add their indicators into the file it wrote. `fetch_az_oblast.ts` reads the cached АЗ XLSX (downloaded by `update-indicators`) for `ltUnemployment`; `fetch_nsi.ts` pulls three NSI JSON-stat open-data datasets (`fdiPerCapita` id=629, `museumVisitsPer1000` id=844, `hospitalBedsPer1000` id=1206), normalising each against the population series the first script wrote. Running only the first drops `ltUnemployment` + the NSI indicators until the mergers re-run.

Expected output on a normal day:

```
NUTS3 → oblast mapping: 28 NUTS3 codes
Loading gdpPerCapita (nama_10r_3gdp)... 31 oblasts, 620 points
Loading population (nama_10r_3popgdp)... 31 oblasts, 620 points
Loading netMigration (demo_r_gind3)... 31 oblasts, 620 points
Loading theftRate (crim_gen_reg)... 31 oblasts, 248 points
Deriving enterpriseDensity (bd_size_r3 V11910)... 31 oblasts

Wrote /Users/.../data/regional.json
```

31 oblasts = 27 administrative oblasts + 3 Sofia city МИР (S23/S24/S25, all sharing BG411) + the Plovdiv city МИР (PDV-00, sharing BG421 with the rural PDV). Most indicators auto-fail on a per-oblast point regression or a >10% drop vs. the prior committed file — investigate before re-running if you see `safety check: <key> ...`. **Exception:** `enterpriseDensity` is a known-frozen supplementary indicator (`bd_size_r3` ended 2020) and degrades gracefully — if you see `! enterpriseDensity skipped — …`, Eurostat narrowed or retired the dataset; the rest of the refresh still completes.

## Step 2 — Verify

```bash
node -e "
const d = require('./data/regional.json');
for (const [k, byOblast] of Object.entries(d.series)) {
  const codes = Object.keys(byOblast);
  const sample = byOblast[codes[0]];
  const last = sample[sample.length - 1];
  console.log(k.padEnd(16), 'oblasts=' + codes.length, 'latest', last.year);
}
console.log('size:', require('fs').statSync('./data/regional.json').size, 'bytes');
"
```

Eyeball:

- Each indicator should report 31 oblasts — except `ltUnemployment` (30; АЗ doesn't split one Sofia МИР) and any indicator whose source froze (`enterpriseDensity` latest 2020).
- `latest` should be the prior calendar year (or two prior in Q1 if Eurostat hasn't released the latest annual figures yet). `enterpriseDensity` will show 2020 (upstream frozen).
- File size ~115 KB raw / ~16 KB gzipped (9 indicators). `regional.json` is in the `bucket:gz` hot-files list, so prod serves it compressed — run `npm run bucket:sync:all` (sync **then** gzip) so it doesn't ship uncompressed. >180 KB raw would indicate a regression.
- Spot-check a known-extreme oblast: Sofia city (S23) should have GDP/capita ~30,000+ EUR; Vidin (VID) ~8,000 EUR. If those flip, something is wrong with the NUTS 3 ↔ oblast mapping.

## Step 3 — Upload to bucket

```bash
npm run bucket:sync
```

(Or `npm run bucket:sync:dry-run` first to preview.) This rsyncs `data/regional.json` (and any other changed data files) to `gs://data-electionsbg-com/`.

## Step 4 — Commit

```bash
git add data/regional.json
git commit -m "regional: refresh through <latest year>"
```

If you added a new indicator, also commit the script + hook changes:

```bash
git add scripts/regional/fetch_eurostat.ts src/data/regional/useRegional.tsx data/regional.json
git commit -m "regional: add <indicatorKey> from Eurostat <dataset_code>"
```

## Adding a new indicator (advanced)

Add an entry to `INDICATORS` in `scripts/regional/fetch_eurostat.ts`:

```ts
{
  key: "newKey",                    // also add to RegionalIndicatorKey in src/data/regional/useRegional.tsx
  dataset: "dataset_code",          // Eurostat code, e.g. "nama_10r_3gva"
  query: { unit: "EUR_HAB", freq: "A" }, // narrowing dim filters
  titleEn: "...", titleBg: "...",
  unitLabelEn: "...", unitLabelBg: "...",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/<dataset>/default/table",
},
```

Then:

1. Add the key to `RegionalIndicatorKey` in `src/data/regional/useRegional.tsx`.
2. Add an entry to the `DELTA_KIND` map in the same file — `"percent"` for absolute counts (GDP, population), `"absolute"` for already-normalised rates (migration, unemployment rate).
3. Add the new code to the `DATASETS` array in `scripts/watch/sources/eurostat_regional.ts` so the watcher fingerprints it.
4. If the formatter needs a custom rule (anything that isn't "round to whole number with separators" or "signed rate with one decimal"), extend `formatRegionalValue` in `useRegional.tsx`.
5. Run this skill to regenerate `data/regional.json`.

Before adding a new dataset, verify the query against the Eurostat REST API:

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=EN&<query>&lastTimePeriod=4' | head -c 1500
```

Confirm the response covers all 28 BG NUTS 3 oblasts. If it only returns aggregates (BG, BG3, BG31, ...) or returns empty `value: {}`, Eurostat does not publish that indicator at NUTS 3 granularity for Bulgaria — try a NUTS 2 dataset (one of `_2*`) or skip the indicator.

## Data-integrity contract

The fetcher fails loud rather than write a partial `data/regional.json`:

| Surface                                                    | Trigger                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Eurostat HTTP non-2xx for any indicator                    | `Eurostat <key> returned <status> for <url>`                                        |
| Unexpected dimension order in the response                 | `Eurostat <key>: unexpected dimension order ... — expected geo,time as last two`    |
| Per-oblast point floor breach                              | `safety check: <key> weakest oblast <code> has N points (floor 10)`                 |
| 10% regression vs. prior `data/regional.json` total points | `safety check: <key> total points dropped P → C (X% > 10%). Refusing to overwrite.` |
| `process.exit(1)` from the top-level `.catch`              | Any unhandled rejection                                                             |

Two important quirks of this data set:

1. **The app's `data/municipalities.json` uses non-standard `nuts3` codes** (BG416/417/418 for Sofia МИР; BG421-1 for Plovdiv-minus-city). The fetcher does NOT derive the NUTS 3 → oblast mapping from that file. Instead, an explicit `EUROSTAT_NUTS3_TO_OBLAST` table at the top of `scripts/regional/fetch_eurostat.ts` maps Eurostat's real NUTS 3 codes to app oblast codes (with Sofia stolitsa BG411 fanning out to S23/S24/S25).

2. **Sofia stolitsa is one Eurostat entity, three app entities.** The same series value is duplicated to S23, S24, and S25. The drilldown tile and choropleth render a footnote noting this.

## What this skill does NOT do

- **Does not refresh macro indicators.** That's `update-macro` — separate watcher source, separate skill.
- **Does not scrape NSI or other Bulgarian government portals.** NUTS 3 (oblast-level) data comes from Eurostat. Sub-municipal (LAU 2 / per-обштина) data — registered unemployment per ОНС, DZI scores, EU funds absorption — would need a separate ingest path and is currently out of scope.
- **Does not change the SPA UI.** Adding a new indicator key requires hand-editing the type union and (if needed) the formatter in `useRegional.tsx`. The skill only refreshes data.

## File map

| Path                                                            | Purpose                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `scripts/regional/fetch_eurostat.ts`                            | CLI entry — fetch all NUTS 3 series, write `data/regional.json` |
| `scripts/watch/sources/eurostat_regional.ts`                    | Daily watcher — fingerprints the 3 NUTS 3 datasets              |
| `data/regional.json`                                            | Generated payload (~50 KB, minified) — committed                |
| `src/data/regional/useRegional.tsx`                             | React Query hook + types + `formatRegionalValue` helper         |
| `src/screens/dashboard/RegionalIndicatorsTile.tsx`              | Drilldown tile (geography section of `/municipality/<code>`)    |
| `src/screens/components/regional/RegionalChoroplethMap.tsx`     | Choropleth on `/demographics`                                   |
| `src/screens/components/regional/RegionalIndicatorSelector.tsx` | Indicator dropdown for the choropleth                           |
