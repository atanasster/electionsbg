---
name: update-landuse
description: Refresh the per-oblast land-use composition data (data/landuse/index.json) — re-parse NSI's annual "Land use distribution of the Republic of Bulgaria" press-release annex PDF and rewrite per-oblast km²/% across 8 categories (urbanized, transport, agricultural, forest, water, protected, disturbed, unclassified) + population density. Use when the daily watch report flags `nsi_landuse` as changed (a new annual annex landed on nsi.bg), when the user asks to refresh land-use / cadastre / land cover / територии, when adding a new annual release, or after a fresh git clone if data/landuse/index.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Land-use skill

Refreshes `data/landuse/index.json` — the per-oblast land-composition backdrop rendered on the My-Area dashboard's "Имотен фонд" / "Property stock" tile. Source is NSI's annual press-release annex, computed by NSI from the digital cadastral map (АГКК) in BGS2005 UTM35N. Granularity: **28 oblasts** + national total. NSI computes município-level figures but does not publish them; this skill cannot fill that gap without a ЗДОИ FOI request or a custom GIS pipeline (out of scope).

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `nsi_landuse: new release (LANDUSE_YYYY)` | Step 1: add the new year to `LANDUSE_REPORTS`, then re-run |
| User asks "refresh land-use" / "update cadastre composition" / "add YYYY landuse" | Same |
| Adding a new year of NSI's annex (typically June of YYYY+1) | Operator pastes the new PDF URL into `scripts/landuse/sources.ts`, then runs |
| Fresh clone with no `data/landuse/index.json` | Same as step 1 (full ingest of every catalogued year) |

NSI publishes annually — the next release is announced on `https://www.nsi.bg/en/statistical-data/45` under "Upcoming press releases" (the schedule row is what the watcher fingerprints). Cadence ~12 months between drops; day-to-day this skill has nothing to do.

## Step 1 — Add the new year (if applicable)

When the watcher flags a new release, find the PDF URL:

1. Open https://www.nsi.bg/en/statistical-data/45
2. Click into the most-recent press release titled `Land use distribution of the Republic of Bulgaria as of 31.12.YYYY` under `/en/press-release/...`
3. Right-click the linked PDF → copy URL (the filename is opaque, e.g. `LANDUSE_2024_EN_<token>.pdf`)
4. Append to `LANDUSE_REPORTS` in `scripts/landuse/sources.ts`:

```ts
{
  year: 2024,
  publishedAt: "2025-06",
  pdfUrl: "https://www.nsi.bg/sites/default/files/files/pressreleases/LANDUSE_2024_EN_<token>.pdf",
},
```

If only an existing year was re-uploaded (correction), no source edit is needed — just run with `--refresh`.

## Step 2 — Fetch and parse

```bash
npx tsx scripts/landuse/fetch.ts                   # every catalogued year
npx tsx scripts/landuse/fetch.ts --year 2024       # just the newly added year
npx tsx scripts/landuse/fetch.ts --refresh         # re-download cached PDFs
```

Expected output on a normal incremental run:

```
[landuse 2024]
  fetching https://www.nsi.bg/sites/default/files/.../LANDUSE_2024_EN_*.pdf
  parsed 28 oblasts; national total 110996.76 sq.km

Wrote data/landuse/index.json (~15 KB; latest year 2024; 2 year(s) tracked)
```

Each ingested PDF caches under `raw_data/landuse/LANDUSE_<year>_EN.pdf`. Re-runs reuse the cache; pass `--refresh` to force re-download.

## Step 3 — Verify

```bash
node -e "
const d = require('./data/landuse/index.json');
console.log('latestYear:', d.latestYear, 'tracked years:', Object.keys(d.years).join(','));
const yr = d.years[d.latestYear];
console.log('oblasts:', Object.keys(yr.oblasts).length);
console.log('national totalKm2:', yr.national.totalKm2);
const sum = ['urbanized','transport','agricultural','forest','water','protected','disturbed','unclassified']
  .reduce((s,k)=>s+yr.national.byCategoryPct[k], 0);
console.log('national % sum:', sum.toFixed(2), '(must be 100.00 ± 0.05)');
console.log('Sofia stolitsa SOF urbanized %:', yr.oblasts.SOF.byCategoryPct.urbanized);
console.log('Smolyan SML forest %:', yr.oblasts.SML.byCategoryPct.forest);
"
```

Eyeball:
- `oblasts` must be **28** (BG row is broken out as `national`, not under `oblasts`).
- `national % sum` must be 100.00 ± 0.05 — the parser's safety check already enforces this per-oblast, but verifying the national row catches any silent column-shift regression.
- Sofia stolitsa urbanized % should be ~19 (dwarfs every other oblast). Smolyan forest % should be ~70 (highest forest share). If either flips, something is wrong with the column mapping.
- File size ~15 KB per year tracked. >100 KB total is a regression.

## Step 4 — Bucket sync + commit

```bash
npm run bucket:sync
git add scripts/landuse/sources.ts data/landuse/index.json raw_data/landuse/LANDUSE_<year>_EN.pdf
git commit -m "landuse: ingest <year> annex (<changed-count> oblasts updated)"
```

Then stamp the ingest marker:

```bash
npx tsx scripts/stamp-ingest.ts update-landuse --summary "ingested LANDUSE_<year> (28 oblasts, latest <year>)"
```

## What this skill does NOT do

- **Does not produce município-level figures.** NSI computes them internally but publishes only the 28-oblast tables; a município-grain ingest would require ЗДОИ FOI or a custom SHP intersection pipeline.
- **Does not ingest parcel boundaries.** АГКК's cadastral parcels are gated behind CAPTCHA on `kais.cadastre.bg` — no bulk feed is available.
- **Does not refresh the BG-language version.** The parser reads the EN annex because the 3-letter oblast codes are identical in both versions and the EN column headers are easier to anchor on. Bulgarian display names come from `scripts/lib/oblast_names.ts`.
- **Does not scrape historic releases (pre-2023) automatically.** Adding history means catalogu­ing each year's opaque PDF URL by hand. Not currently in scope.

## File map

| Path | Purpose |
|---|---|
| `scripts/landuse/sources.ts` | Year → PDF URL catalogue + category key/label table |
| `scripts/landuse/parse.ts` | `pdftotext -layout` + regex parser for the 3-table annex |
| `scripts/landuse/fetch.ts` | CLI entry; downloads, parses, writes `data/landuse/index.json` |
| `scripts/watch/sources/nsi_landuse.ts` | Daily watcher — fingerprints the upcoming-release schedule on `/en/statistical-data/45` |
| `data/landuse/index.json` | Generated payload (~15 KB / year); committed |
| `raw_data/landuse/LANDUSE_<year>_EN.pdf` | Cached source PDFs (~7 MB each); committed for reproducibility |
| `src/data/landuse/useLandUse.tsx` | React Query hook + oblast-code resolver (S23/S24/S25 → SOF, PDV-00 → PDV) |
| `src/screens/myarea/MyAreaPropertyStockTile.tsx` | Frontend tile rendered on `/my-area/:id` |
