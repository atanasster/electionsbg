---
name: update-census
description: Rebuild the NSI Census 2021 demographics data (data/census_2021.json, data/census_2021_settlements.json, and the per-entity slices under data/census/) from the raw NSI XLSX publications. Use when the user asks to refresh or rebuild census data, when NSI re-releases a corrected Census 2021 publication, when adding a new census dimension (e.g. health status), after a fresh git clone if data/census_2021.json or data/census/ is missing, or when a future decennial census (2031) is published.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Census skill

Rebuilds the NSI Census 2021 artifacts from the raw NSI XLSX publications:

| Output | Grain | Dimensions |
|---|---|---|
| `data/census_2021.json` | country + 28 oblasts + 265 municipalities | population, age, gender, ethnic, mother tongue, religion, education, employment |
| `data/census_2021_settlements.json` | 5,257 settlements (EKATTE) | population, age, gender only |
| `data/census/oblasts/*.json` | 28 per-oblast ~1 KB slices | same as oblast row above |
| `data/census/municipalities/*.json` | 265 per-municipality ~1 KB slices | same as municipality row above |

NSI publishes ethnocultural / education / employment breakdowns only down to the municipality level — the settlement sidecar therefore carries only population, age and sex (see `CensusSettlementEntity` in `src/data/census/censusTypes.ts`).

The per-entity slices exist so a region/municipality/settlement dashboard tile fetches a single ~1 KB file instead of the full payload.

## When to run

| Trigger | Action |
|---|---|
| Fresh git clone with no `data/census_2021.json` or empty `data/census/` | Steps 1–5 (full rebuild) |
| NSI re-releases a corrected Census 2021 XLSX | Replace the file in `raw_data/census_2021/`, then steps 2–5 |
| User asks to "refresh census" / "rebuild census data" | Steps 2–5 |
| Adding a new census dimension (health status, ...) | See "Adding a dimension" below |
| A future decennial census (2031) is published | See "A new census" below |

The census is **decennial** — NSI ran Census 2021 and the next is 2031. The daily watcher does **not** fingerprint a census source, so day-to-day there is nothing to do. This skill is event-driven, not scheduled.

## Step 1 — Place the raw files

The build reads four NSI Census 2021 English-language XLSX publications from `raw_data/census_2021/`:

| File | Required | Source |
|---|---|---|
| `Census2021_Population_EN.xlsx` | yes | population / age / sex, hierarchical down to settlement |
| `Census2021_Ethnocultural characteristics_EN.xlsx` | yes | ethnic group, mother tongue, religion |
| `Census2021_Economic characteristics_EN.xlsx` | yes | education, employment rates |
| `Census2021_Health status_EN.xlsx` | not yet parsed | present in `raw_data/` but no parser wired up — see "Adding a dimension" |

Download the EN publications from NSI's Census 2021 portal at <https://census2021.bg/> (the "Final results" / data tables section). Keep the file names exactly as above — the build looks them up by name. The three required files are already committed under `raw_data/census_2021/`; you only place files here when NSI issues a correction or for a new census.

## Step 2 — Build

```bash
npx tsx scripts/census/build_census.ts
```

Expected output:

```
Wrote /Users/.../data/census_2021.json: country + 28 oblasts + 265 municipalities
Wrote /Users/.../data/census_2021_settlements.json: 5257 settlements
Wrote 28 oblast slices to /Users/.../data/census/oblasts/ and 265 municipality slices to /Users/.../data/census/municipalities/
```

The build is deterministic — re-running with unchanged XLSX produces byte-identical output except the `generatedAt` timestamp in `census_2021.json`. If `git diff data/census_2021.json` shows only that one field changed, nothing material happened; you can `git checkout data/census_2021.json` to drop the churn.

The script throws (and writes nothing) if `raw_data/census_2021/` is missing, if a required XLSX is absent, or if it cannot locate the expected header rows inside a sheet.

## Step 3 — Verify

```bash
node -e "
const c = require('./data/census_2021.json');
const s = require('./data/census_2021_settlements.json');
console.log('country pop      ', c.country.population.toLocaleString());
console.log('oblasts          ', c.oblasts.length);
console.log('municipalities   ', c.municipalities.length);
console.log('settlements      ', s.length);
const fs = require('fs');
console.log('oblast slices    ', fs.readdirSync('./data/census/oblasts').length);
console.log('muni slices      ', fs.readdirSync('./data/census/municipalities').length);
"
```

Eyeball:
- Country population ≈ **6,519,789** (Census 2021 final figure).
- 28 oblasts, 265 municipalities, ~5,257 settlements.
- 28 oblast slices, 265 municipality slices (slice counts must match the array lengths).
- Spot-check a known oblast: Burgas (`BGS`) population ≈ 380,286. If a major oblast is missing or off by an order of magnitude, the Population sheet layout changed — inspect `parsePopulationSheet` in `scripts/census/build_census.ts`.

## Step 4 — Regenerate derived demographics

`scripts/parties/build_demographics.ts` reads `data/census_2021.json` to compute the per-party vote↔demographics Pearson correlations (the `/demographics` scatter, the party-dashboard fingerprint tile, and the home cleavages tile) across all 265 municipalities. It is the only downstream artifact whose content depends on the census. If the census **content** changed — an NSI correction, a new dimension, the 2031 census — regenerate it:

```bash
npx tsx scripts/parties/build_demographics.ts
```

This rewrites `data/<election>/parties/demographics/*.json`, `data/<election>/dashboard/demographic_cleavages.json` and `data/<election>/dashboard/demographic_scatter.json` for every election.

Skip this on a pure no-op rebuild (fresh clone where `git diff data/census_2021.json` shows only the `generatedAt` timestamp churned) — the correlations are unchanged. The census is not a daily-watcher source, so the `process-watch-report` orchestrator never triggers this; it is a manual follow-up to a census rebuild.

## Step 5 — Upload to bucket

```bash
npm run bucket:sync:dry   # preview
npm run bucket:sync       # rsync data/ to gs://data-electionsbg-com/
```

This pushes the changed census JSON (and any other changed `data/` files) to the bucket the SPA fetches from.

## Step 6 — Commit

```bash
git add data/census_2021.json data/census_2021_settlements.json data/census/
git commit -m "census: rebuild from NSI Census 2021 publications"
```

If you placed corrected raw files, add those too:

```bash
git add raw_data/census_2021/
```

## Adding a dimension (advanced)

To surface a new census dimension (e.g. health status / disability from `Census2021_Health status_EN.xlsx`):

1. Add the type to `src/data/census/censusTypes.ts` — a new `CensusHealth` type and an optional field on `CensusEntity`.
2. In `scripts/census/build_census.ts`, add a `FILE_HEALTH` constant and a `parseHealth()` function. Most dimensions follow the `parseSimpleSheet` pattern (find the `BG` data row, pick fixed columns). Inspect the sheet layout first:
   ```bash
   node -e "
   const X = require('xlsx');
   const wb = X.read(require('fs').readFileSync('raw_data/census_2021/Census2021_Health status_EN.xlsx'));
   console.log(wb.SheetNames);
   "
   ```
3. Thread the new map through `buildEntity` and the `country` / `oblasts` / `munis` construction in `main()`.
4. If the dimension should appear on the choropleth, add a `CensusMetric` key in `censusTypes.ts` and wire `censusMetricValue` / `CENSUS_METRICS` in the frontend.
5. Run steps 2–5.

NSI publishes health status only down to the oblast/municipality level — do not expect a settlement breakdown.

## A new census (advanced)

When NSI publishes the 2031 census, this becomes a versioned rebuild rather than an in-place refresh: the artifacts are named `census_2021*` throughout (data files, query keys in `src/data/census/useCensus.tsx`, the `censusDate` field). Adding a second census year means parameterising the year across the script, the data hooks, and the UI — scope that as its own task, not a drop-in raw-file swap.

## What this skill does NOT do

- **Does not refresh the annual sub-national indicators.** Registered unemployment, DZI scores and yearly population change are `update-indicators`; NUTS 3 Eurostat series are `update-regional`. The census is a one-off decennial snapshot.
- **Does not scrape NSI.** The raw XLSX are downloaded by hand from census2021.bg and committed to `raw_data/census_2021/`.
- **Does not change the SPA UI.** Adding a dimension or a metric requires hand-editing the types and hooks as described above.

## File map

| Path | Purpose |
|---|---|
| `raw_data/census_2021/*.xlsx` | NSI source publications (committed) |
| `scripts/census/build_census.ts` | CLI entry — parse XLSX, write all census artifacts |
| `scripts/parties/build_demographics.ts` | downstream — recomputes party↔demographics correlations from `census_2021.json` (re-run after a census rebuild) |
| `data/census_2021.json` | country + oblast + municipality payload |
| `data/census_2021_settlements.json` | settlement sidecar (population/age/sex) |
| `data/census/oblasts/*.json`, `data/census/municipalities/*.json` | per-entity ~1 KB slices |
| `src/data/census/censusTypes.ts` | shared TypeScript types |
| `src/data/census/useCensus.tsx` | React Query hooks (full payload, slices, settlement sidecar) |
| `src/screens/DemographicsScreen.tsx` | `/demographics` screen consuming the data |
| `src/screens/dashboard/CensusDemographicsTile.tsx` | drilldown tile (region / municipality / settlement) |
