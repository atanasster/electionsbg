---
name: update-macro
description: Refresh the macro indicators data (data/macro.json) — re-fetch Eurostat quarterly/annual series, World Bank WGI, and curated tables. Use when the daily watch report flags new Eurostat releases ("Eurostat macro (BG): new release"), when the user asks to refresh macro data, when adding a new indicator, or after the curated CPI / Eurobarometer tables get a new year's value pasted in.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Macro skill

Refreshes `data/macro.json` — the per-Bulgarian-cabinet macro/governance backdrop rendered on `/governments`. Pulls quarterly Eurostat series (GDP growth, HICP inflation, unemployment, gov debt, budget balance, current account), annual Eurostat GDP per capita, World Bank WGI, plus curated CPI / Eurobarometer trust / EU funds.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `Eurostat macro (BG): new release · namq_10_gdp <date>, ...` | Run `npx tsx scripts/macro/fetch_eurostat.ts` |
| User asks to "refresh macro" or "update macro data" | Same |
| Adding a new Eurostat indicator to the chart | Add an entry to `EUROSTAT_INDICATORS` in `scripts/macro/fetch_eurostat.ts`, then run |
| Annual TI CPI / Eurobarometer / EU funds figure published | Paste the new `{ year, value }` into the curated arrays at the top of `fetch_eurostat.ts`, then run |

## Step 1 — Fetch

```bash
npx tsx scripts/macro/fetch_eurostat.ts
```

Expected output on a normal day:

```
Loading gdpGrowth (eurostat)... 84 points (latest 2025 Q4)
Loading inflation (eurostat)... 85 points (latest 2026 Q1)
Loading unemployment (eurostat)... 68 points (latest 2025 Q4)
Loading gdpPerCapita (eurostat)... 21 points (latest 2025)
Loading govDebt (eurostat)... 84 points (latest 2025 Q4)
Loading budgetBalance (eurostat)... 84 points (latest 2025 Q4)
Loading currentAccount (eurostat)... 84 points (latest 2025 Q4)
Loading wgiRuleOfLaw (worldbank)... 20 points (latest 2024)
...
Wrote /Users/.../data/macro.json
```

The script auto-fails on a count regression — see "Data-integrity contract" below — so if you see "safety check: <key> dropped from N → M points (X% < -10%)", treat as a regression and investigate before re-running.

## Step 2 — Verify

Quick sanity check on the new file:

```bash
node -e "
const d = require('./data/macro.json');
for (const [k, s] of Object.entries(d.series)) {
  const last = s[s.length - 1];
  const tail = last.quarter ? last.year + ' Q' + last.quarter : last.year;
  console.log(k.padEnd(20), 'n=' + String(s.length).padStart(3), 'latest', tail, '=', last.value);
}
console.log('size:', require('fs').statSync('./data/macro.json').size, 'bytes');
"
```

Eyeball:
- `gdpGrowth`, `inflation`, `unemployment`, `govDebt`, `budgetBalance`, `currentAccount` should be quarterly (`latest YYYY Q[1-4]`).
- Latest quarter is at most 1-2 quarters behind current date — Eurostat publishes Q1 in late June, so May-June you see Q4 of prior year; Sep+ you see Q1 of current year.
- WGI / CPI / Eurobarometer are annual and lag by ~1 year — that's normal.
- File size should be ~40-50 KB. >100 KB is a regression.

## Step 3 — Upload to bucket

```bash
npm run bucket:sync
```

(Or `npm run bucket:sync:dry-run` first to preview.) This rsyncs `data/macro.json` (and any other changed data files) to `gs://data-electionsbg-com/`.

## Step 4 — Commit

```bash
git add data/macro.json
git commit -m "macro: refresh through <latest period>"
```

If you added a new indicator, also commit the script change:

```bash
git add scripts/macro/fetch_eurostat.ts data/macro.json
git commit -m "macro: add <indicatorKey> from Eurostat <dataset_code>"
```

## Adding a new indicator (advanced)

Add an entry to `EUROSTAT_INDICATORS` in `scripts/macro/fetch_eurostat.ts`:

```ts
{
  source: "eurostat",
  key: "newKey",                    // also add to MacroIndicatorKey in src/data/macro/useMacro.tsx
  dataset: "dataset_code",          // Eurostat code, e.g. "namq_10_gdp"
  query: { geo: "BG", /* ... */ }, // narrowing dim filters
  cadence: "quarterly",             // or "annual"
  // If the upstream dataset is monthly but the chart should show quarterly:
  // aggregate: "monthlyAvgToQuarter",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/<dataset>/default/table",
  unitLabelEn: "...", unitLabelBg: "...",
  titleEn: "...",    titleBg: "...",
},
```

Then:
1. Add the key to `MacroIndicatorKey` in `src/data/macro/useMacro.tsx`.
2. Add a colour in `SERIES_COLORS` in `src/screens/components/governments/GovernmentTimeline.tsx`.
3. Add the indicator to a section's `indicatorKeys` in `src/screens/GovernmentsScreen.tsx` (and source link in the `ChartSources`).
4. If the section needs its own chart, copy an existing `<section>` block.
5. Run this skill to regenerate `data/macro.json`.

Before adding a new dataset, verify the query against the Eurostat REST API:

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=EN&<query>&lastTimePeriod=4' | head -c 1500
```

A 400 `INVALID_QUERY_DIMENSION` means the dimension name is wrong — inspect the dataset's dimensions:

```bash
curl -s 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=EN&geo=BG&lastTimePeriod=1' | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
for k, v in d.get('dimension', {}).items():
  print(k, list(v.get('category', {}).get('index', {}).keys())[:15])
"
```

A 413 `EXTRACTION_TOO_BIG` means a dimension wasn't narrowed enough — add a filter.

## Data-integrity contract

The fetcher is designed to **fail loud rather than write a partial `data/macro.json`** when an indicator's upstream API returns errors or unexpected data.

Fail-loud surfaces (the script throws and writes nothing):

| Surface | Trigger |
|---|---|
| Eurostat HTTP non-2xx for any indicator | `Eurostat <key> returned <status> for <url>` |
| World Bank HTTP non-2xx for any WGI series | `World Bank <key> returned <status> for <url>` |
| Any per-indicator parsing exception | Logged as `failed: <message>` then re-thrown — halts the whole run |
| `process.exit(1)` from the top-level `.catch` | Any unhandled rejection during the run |

Two layers of count-based guards are enforced automatically (since adding the `minPoints` plumbing):

1. **Absolute floor.** Each Eurostat / WorldBank indicator must return at least its `minPoints` (or the cadence default: 60 quarterly, 12 annual). A fetch returning fewer points throws `safety check: <key> (<source>) returned N points, below floor F`. Catches the catastrophic case where the upstream query is silently rejected and returns near-empty data. Override per-indicator on series with known shorter history (e.g. `retailVolume` starts ~2014, override `minPoints: 35`).

2. **Regression vs. prior committed run.** Before writing, each fetched series is compared against the same `key` in the previously-committed `data/macro.json`. If the count dropped by more than 10%, throws `safety check: <key> dropped from P → C points (X% < -10%)`. Catches the gradual case where the upstream still answers but with a narrower window (dimension filter semantics changed). Run the same script after a clean fetch to re-seed the baseline.

Curated series (CPI, Eurobarometer, EU funds) bypass both checks — they're inline constants in `fetch_eurostat.ts` and self-validating.

Intentional non-fatal skips:

| Surface | Behaviour |
|---|---|
| Curated CPI / Eurobarometer / EU-funds entry missing for a year | The chart simply lacks that point; no error. These are inline constants edited by hand. |
| Quarterly Eurostat dataset returning a `null` last cell (publication lag) | Filtered out of the series; no warning needed. Standard Eurostat behaviour at the leading edge. |

After every run, eyeball the per-indicator `N points (latest …)` lines. If a series suddenly halves, the upstream query was rejected silently OR the dataset publisher changed dimensions — investigate before committing.

## What this skill does NOT do

- **Does not change the chart UI.** Adding a new indicator key requires hand-editing `useMacro.tsx`, `GovernmentTimeline.tsx`, and `GovernmentsScreen.tsx` (see above). The skill only refreshes data.
- **Does not redownload curated tables automatically.** TI CPI, Eurobarometer trust, and EU funds figures are inline constants in `fetch_eurostat.ts` and must be updated by hand when the publishing body releases a new year.
- **Does not auto-fire on its own.** The watcher reports new Eurostat releases; the user (or a GitHub Action) decides when to refresh.

## File map

| Path | Purpose |
|---|---|
| `scripts/macro/fetch_eurostat.ts` | CLI entry — fetch all macro series + curated tables, write `data/macro.json` |
| `scripts/watch/sources/eurostat.ts` | Daily watcher — fingerprints all 6 quarterly Eurostat datasets |
| `data/macro.json` | Generated payload (~40 KB, minified) — committed |
| `src/data/macro/useMacro.tsx` | React Query hook + types |
| `src/screens/components/governments/GovernmentTimeline.tsx` | Chart |
| `src/screens/GovernmentsScreen.tsx` | Page that hosts the chart sections |
