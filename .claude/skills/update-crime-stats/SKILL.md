---
name: update-crime-stats
description: Refresh the per-oblast crime statistics (data/crime/index.json) by re-fetching the BG government open-data-viz repo's MVR crime CSVs. Use when the daily watch report flags `govdataviz_crime` as changed, when the user asks to refresh crime stats / МВР statistics / criminal data, or after a fresh git clone if data/crime/index.json carries an empty `yearlyByOblast`.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update crime stats skill

Refreshes `data/crime/index.json` — per-oblast crime rates (per 10,000 inhabitants) covering 28 oblasts × 16 years (2000–2015) in this first cut. Powers the My-Area "Регистрирани престъпления" tile with the latest-year headline + 5-category breakdown + multi-year SVG sparkline.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `yearlyByOblast[<oblast>][<year>]` | [governmentbg/data-viz repo gh-pages branch, `assets/data/crime/mvr-aggr-13-perth-full.csv`](https://github.com/governmentbg/data-viz/tree/gh-pages/assets/data/crime) | per oblast (28 units, "Grad Sofiya" + "Sofia" split) × per year × per crime category (top-level codes 0–5) | upstream dormant since 2015 |

Why this source instead of mvr.bg directly: the BG government's own official data-viz visualisation (`viz.opendata.government.bg/visuals/crime.html`) reads the same CSVs from this gh-pages branch. Pulling from GitHub bypasses the Cloudflare Turnstile challenge on mvr.bg and gives us a stable URL pattern. The trade-off: the repo hasn't been refreshed since 2015 — the tile surfaces this via an "as of {year}" label.

`scripts/crime/build_index.ts` reads the `perth-full` CSV (rate per 10,000 inhabitants — the "per ten" suffix), takes only the top-level category columns (0 = total, 1 = against the person, 2 = against property, 3 = generally dangerous, 4 = other criminal, 5 = deaths without violence), and maps the 28 BG oblast names → our 3-letter oblast codes (with `Grad Sofiya` → `S23` so the Sofia район fallback in `useCrime` works, and `София` → `SFO` for the surrounding oblast).

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `governmentbg/data-viz — MVR crime CSVs` as changed | Step 1 |
| User asks to "refresh crime stats" / "update МВР data" | Step 1 |
| Fresh clone with empty `yearlyByOblast` | Step 1 |
| The Cloudflare-bypass follow-up lands (see "Future work") | Step 0 then Step 1 |

The watcher tracks GitHub file SHAs via the Contents API. Routine flips would only happen if the repo wakes up; otherwise this is dormant.

## Step 0 (future) — Add current MVR monthly bulletins

mvr.bg's `/dkiad/статистически-данни/статистика/месечен-бюлетин` lists per-month PDFs with current-year per-RDVR (~oblast) stats. Reach them requires a Cloudflare Turnstile bypass — the same Playwright pattern that `scripts/parsers_local/cik_fetch.ts` already uses for results.cik.bg. The current `build_index.ts` schema (yearly per oblast) accommodates monthly data by collapsing months to years; a future extension can add a `monthlyByOblast` parallel structure for the per-month detail. The tile reads from `latestYear` so adding monthly data doesn't break the existing render — see the "annual schema" comment in `useCrime`.

## Step 1 — Build

```bash
npx tsx scripts/crime/build_index.ts          # uses cached CSV when present
```

Force a fresh fetch:

```bash
rm -f raw_data/crime/mvr-aggr-13-perth-full.csv
npx tsx scripts/crime/build_index.ts
```

Expected output:

```
Wrote .../data/crime/index.json — 464 rows in, 448 mapped, 1 unmapped oblast names, latest year 2015, 28 oblasts
Unmapped oblast names: Общo
```

The 1 unmapped row is the source's own "Общo" (national total) row, which has no oblast code. Skip silently.

## Step 2 — Spot-check

```bash
python3 -c "
import json
d = json.load(open('data/crime/index.json'))
print('latestYear:', d['latestYear'])
print('oblasts:', len(d['yearlyByOblast']))
print('year span:', d['coverageYears'])
# Sample Sofia city + a small oblast
for code in ('S23', 'SFO', 'BLG'):
    if code in d['yearlyByOblast']:
        latest = d['yearlyByOblast'][code][d['latestYear']]
        print(f'  {code} {d[\"latestYear\"]}: total={latest.get(\"total\")} · property={latest.get(\"against_property\")} · person={latest.get(\"against_person\")}')
"
```

Sanity checks:
- 28 oblasts, latest year 2015 (until the upstream wakes up).
- Sofia city (`S23`) has the highest per-capita rates among the 28 (Sofia is a city; property crime concentrates there).
- All rates are positive numbers ≤ ~200 (≤ 200 crimes per 10K = ~2% of population, plausible upper bound).

## Step 3 — Commit + bucket sync

```bash
git add data/crime/index.json raw_data/crime/mvr-aggr-13-perth-full.csv
git commit -m "crime: refresh per-oblast rates through <latestYear>"
npm run bucket:sync:dry
npm run bucket:sync
```

## Step 4 — Stamp success

```bash
npx tsx scripts/stamp-ingest.ts update-crime-stats \
  --summary "28 oblasts × <N> years, latest <year>"
```

Append to the public data-changes log only when the upstream actually changed:

```bash
if [ -n "$(git diff --stat data/crime/)" ]; then
  npx tsx scripts/append-data-change.ts update-crime-stats \
    --summary "28 oblasts × <N> years, latest <year>" \
    --source "governmentbg/data-viz — MVR crime CSVs"
fi
```

## Known limitations

- **Upstream stalled at 2015.** The BG government open-data-viz repo's crime directory hasn't been touched in years. Current monthly stats are on mvr.bg, behind Cloudflare. The tile surfaces the staleness via "as of {year}".
- **Per-oblast grain, not per-município.** MVR doesn't publish official municipal-level monthly stats anywhere. The caveat is pinned in-tile.
- **Sofia split is unusual.** The source distinguishes "Grad Sofiya" (Sofia city, mapped to `S23`) from "Sofia" (the surrounding oblast that contains Samokov, Botevgrad etc., mapped to `SFO`). The Sofia район fallback in `useCrime` uses S23, not SFO — keep that in mind if you ever extend coverage.
- **Top-level categories only.** Sub-category codes (1.1.1 — murder, 2.1.2 — robbery, 3.5.4 — drug trafficking, …) are in the CSV but the tile renders only the top-level totals. Drilling deeper is a future tile extension; the build script extracts them into `yearlyByOblast[<oblast>][<year>][<key>]` as additional category keys if you extend `TOP_LEVEL_CATEGORIES`.

## What this skill does NOT do

- **Does not OCR МВР bulletin PDFs.** That's the future-work path documented in Step 0. Adding the Playwright-based fetcher is its own focused task — `scripts/parsers_local/cik_fetch.ts` is the template.
- **Does not modify the `_full.csv` rate convention.** The source publishes per-10K rates and per-100K rates; we keep `perth` (per-10K) as the canonical rate. Switching to percent would require a one-line normalisation step and a `unit` field flip in the output.

## File map

| Path | Purpose |
|---|---|
| `scripts/crime/build_index.ts` | CLI entry — fetch CSV, parse, map oblast names → 3-letter codes, write |
| `raw_data/crime/mvr-aggr-13-perth-full.csv` | cached source CSV from the gov data-viz repo |
| `data/crime/index.json` | output — `yearlyByOblast` + `latestYear` + `categories` |
| `scripts/watch/sources/govdataviz_crime.ts` | watcher — GitHub Contents API file SHAs |
| `src/data/crime/useCrime.tsx` | React Query hook with Sofia район → S23 fallback |
| `src/screens/myarea/MyAreaCrimeTile.tsx` | "Регистрирани престъпления" tile with multi-year sparkline |
