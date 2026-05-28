---
name: update-air-quality
description: Refresh the air-quality monitoring-station data (data/air/index.json) by fetching the latest quarterly PM10 + PM2.5 CSVs from ИАОС via data.egov.bg. Use when the daily watch report flags `iaos_air_quality` as changed, when the user asks to refresh air quality / atmospheric monitoring / ИАОС data, when adding a new pollutant (NO₂ / O₃ / SO₂ / CO) to the index, or after a fresh git clone if data/air/index.json has zero stations.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update air quality skill

Refreshes `data/air/index.json` — the per-município air-quality monitoring-station index that powers the My-Area "Качество на въздуха" tile. Covers ~37 município-attributed stations + ~14 background/mountain stations (Витиня, Копитото, Рожен — КФС, Гара Яна) from ИАОС's quarterly publication on data.egov.bg.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `latestReadings.pm10`, `maxObserved.pm10` | [data.egov.bg resource 452acfd4](https://data.egov.bg/data/resourceView/452acfd4-9fa1-4ab8-9213-f1b2736ce143) | station | quarterly |
| `latestReadings.pm25`, `maxObserved.pm25` | [data.egov.bg resource 0eefa354](https://data.egov.bg/data/resourceView/0eefa354-495f-4a2d-a40f-846e11dd396a) | station | quarterly |

The CSVs **do not carry station coordinates**. Stations are identified by name only (`София - Хиподрума`, `Пловдив - Каменица`, `В.Търново - РИОСВ`, …); `scripts/air/build_index.ts` parses `<município> - <subname>` and looks up the município name in `data/municipalities.json`, with a small alias map for abbreviations (`В.Търново` → `Велико Търново`, `Г.Оряховица` → `Горна Оряховица`, …). Sofia citywide stations key under `SOF00` and fan out to the 24 районы via the `useAirQuality` hook fallback.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `ИАОС air quality (data.egov.bg)` as changed | Step 1 |
| User asks to "refresh air quality" / "update ИАОС stations" / "new air-quality quarter" | Step 1 |
| Adding NO₂ / O₃ / SO₂ / CO to the per-station record | Step 0 then Step 1 |
| Fresh clone with no `data/air/index.json` or zero stations | Step 1 |

ИАОС publishes once per quarter. A weekly check window catches in-quarter corrections (which do happen).

## Step 0 (optional) — Add a new pollutant

ИАОС exposes NO₂, CO, O₃, SO₂ datasets on the same portal but the build script today reads only PM10 + PM2.5. To extend:

1. Open the dataset page for the pollutant in the ИАОС data.egov.bg organisation listing (e.g. `data.egov.bg/data?org[0]=76`).
2. Click the latest quarterly resource; copy its UUID from the URL `data/resourceView/<uuid>`.
3. Append the entry to `POLLUTANTS` at the top of `scripts/air/build_index.ts`:

   ```ts
   const POLLUTANTS = {
     pm10: "452acfd4-9fa1-4ab8-9213-f1b2736ce143",
     pm25: "0eefa354-495f-4a2d-a40f-846e11dd396a",
     no2:  "<new-uuid>",
   } as const;
   ```

4. Add the matching key to the `Pollutant` type and the `pollutants` block in `data/air/index.json`'s output (the script already passes these through).

The watcher only tracks PM10 — all ИАОС pollutants publish on the same cadence, so adding NO₂ resources here doesn't need a new watch source.

## Step 1 — Build

```bash
npx tsx scripts/air/build_index.ts          # uses cached CSVs when present
```

Force a fresh fetch (skip the disk cache):

```bash
rm -rf raw_data/air/iaos
npx tsx scripts/air/build_index.ts
```

Expected output:

```
pm10: 47 stations
pm25: 10 stations
Wrote .../data/air/index.json — 37 município stations, 14 background stations, asOf 2026-03-31
```

## Step 2 — Spot-check

```bash
python3 -c "
import json
d = json.load(open('data/air/index.json'))
print('snapshotAsOf:', d['snapshotAsOf'])
print('stations:', len(d['stations']))
print('background:', len(d['backgroundStations']))
# Sample a Sofia + a non-Sofia station
for s in d['stations']:
    if s['name'].startswith('София'):
        print(f'  {s[\"name\"]} → {s[\"obshtina\"]} · PM10={s[\"latestReadings\"].get(\"pm10\")}')
        break
"
```

Sanity checks:
- `snapshotAsOf` is the period-end date of the latest CSV (`YYYY-03-31`, `-06-30`, `-09-30`, or `-12-31`).
- 30–45 município stations (varies as ИАОС adds/retires sites).
- Sofia stations all map to `SOF00`.
- No station mapped to an oblast code (`BLG`, `VAR`, …) — only obshtina codes (`BLG03`, `VAR06`, …).

If the município-mapped count drops sharply, ИАОС likely renamed a station or added a new town not in the alias map — inspect the script's `STATION_PREFIX_ALIASES` and `BACKGROUND` set.

## Step 3 — Commit + bucket sync

```bash
git add data/air/index.json raw_data/air/iaos/
git commit -m "air: refresh ИАОС stations through <snapshotAsOf>"
npm run bucket:sync:dry
npm run bucket:sync
```

## Step 4 — Stamp success

```bash
npx tsx scripts/stamp-ingest.ts update-air-quality \
  --summary "37 município stations + 14 background, asOf <snapshotAsOf>"
```

Append to the public data-changes log only when readings actually changed:

```bash
if [ -n "$(git diff --stat data/air/)" ]; then
  npx tsx scripts/append-data-change.ts update-air-quality \
    --summary "37 município stations + 14 background, asOf <snapshotAsOf>" \
    --source "ИАОС air quality (data.egov.bg)"
fi
```

## Known limitations

- **No station coordinates in the source.** Município attribution is via station-name parsing. A handful of stations whose names break the `<município> - <subname>` convention (e.g. "Девня - Изворите" — the "Изворите" suffix is a quarter, not the município) need alias entries; current coverage is ~80% of the active station list.
- **Background stations don't bind to a município.** They go into a separate `backgroundStations` list and the tile renders them only on a future "regional context" expansion.
- **PM10 + PM2.5 only.** NO₂ / CO / O₃ / SO₂ datasets exist on data.egov.bg but their per-resource UUIDs need discovery. See Step 0 above.

## What this skill does NOT do

- **Does not OCR МВР crime PDFs.** Air-quality only; crime stats live under `update-crime-stats`.
- **Does not normalise to EU thresholds in the data.** Thresholds (`euLimit`) are part of the `pollutants` metadata in the output; the tile colour-codes against them client-side.

## File map

| Path | Purpose |
|---|---|
| `scripts/air/build_index.ts` | CLI entry — fetch, parse, map → obshtina, write |
| `raw_data/air/iaos/{pm10,pm25}.csv` | cached source CSVs |
| `data/air/index.json` | output — `stations[]` + `backgroundStations[]` |
| `scripts/watch/sources/iaos_air_quality.ts` | watcher — fingerprints PM10 dataset resource UUIDs |
| `src/data/air/useAirQuality.tsx` | React Query hook with Sofia район → SOF00 fallback |
| `src/screens/myarea/MyAreaAirTile.tsx` | "Качество на въздуха" tile |
