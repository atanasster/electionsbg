---
name: update-energy
description: Refresh the Енергетика (energy) data behind /sector/energy — the physical-system tiles that sit beside the procurement pack. Two ingested artifacts, each with its own watcher: data/energy/generation.json (Bulgaria's electricity generation mix, net electricity trade and CO2 intensity, 2007-latest, from Ember's Yearly Electricity Data CC BY 4.0 — watcher `ember_generation`) and data/energy/prices.json (household electricity price BG vs EU27, all taxes, EUR/kWh, from Eurostat nrg_pc_204 — watcher `eurostat_energy_prices`). Use when the daily watch report flags `ember_generation` or `eurostat_energy_prices` as changed, when the user asks to refresh energy / електроенергия / generation mix / ток prices data, or after a fresh git clone if data/energy/generation.json is missing. NOTE: the БЕХ procurement pack (9-EIK group) renders off the live contracts corpus and needs NO ingest here — its hub headline € rides `db:gen-sector-stats`, and the МЕ/БЕХ budget slice rides update-budget. The Козлодуй 7/8 (~€14bn) call-out is a curated constant in EnergyThematicTiles, not a feed.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Energy skill

Two watched artifacts, independent triggers. Both are small hand-verifiable JSON
served via the `dataUrl` seam at `/energy/*.json`, committed + bucket-synced (no
PG, so no `recordIngestBatch`).

| Artifact                      | Source                                                                           | Watcher                  | Script                                       |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| `data/energy/generation.json` | Ember Yearly Electricity Data (global long-format CSV, CC BY 4.0)                | `ember_generation`       | `npx tsx scripts/energy/fetch_generation.ts` |
| `data/energy/prices.json`     | Eurostat `nrg_pc_204` (household electricity, all taxes, 2500-4999 kWh, EUR/kWh) | `eurostat_energy_prices` | `npx tsx scripts/energy/fetch_prices.ts`     |

Both scripts are fully automated (download → parse → write); a schema change
upstream makes them throw (thin-series / missing-field asserts) rather than write
garbage.

## When to run

- The daily watch report flags `ember_generation` or `eurostat_energy_prices`.
- The user asks to refresh energy / generation mix / electricity-price data.
- After a fresh clone if `data/energy/generation.json` is missing.

## What is NOT in this skill

- **The procurement pack** at `/sector/energy` (the €9.76bn БЕХ-group KPIs,
  per-unit spend, single-bid gauge, top contractors) renders off the **live
  contracts corpus** via `awarder_group_model` — no ingest. Its EIK universe is
  `src/lib/energyReferenceData.ts`.
- **The hub-tile headline €** (`/governance/sectors`, `/procurement`) comes from
  `data/procurement/derived/sector_stats.json` → rebuild with
  `npm run db:gen-sector-stats` (needs local PG), NOT this skill. `energy` is
  already in that generator's `SECTOR_EIKS` map.
- **The МЕ / БЕХ budget line** rides `update-budget`.
- **The Козлодуй 7/8 (~€14bn) invisible-capex call-out** is a curated constant in
  `EnergyThematicTiles.tsx` (it is absent from ЦАИС by design — the pack's thesis),
  not a feed.

## Step 1 — Generation mix (`ember_generation`)

```
npx tsx scripts/energy/fetch_generation.ts
```

Downloads Ember's global long-format CSV (~49MB, one fetch), filters `Area ==
"Bulgaria"`, and writes per-year `byFuel` (nuclear/coal/gas/hydro/solar/wind/
bioenergy/otherFossil/otherRenewables, TWh), `totalGen`, `demand`, `netImports`
(negative = net exporter), `co2Intensity` (gCO2/kWh) and `totalEmissions` (mtCO2)
for 2007-latest. Attribution "Ember — Yearly Electricity Data (CC BY 4.0)" is
required on the tile and is baked into the JSON `source` field.

## Step 2 — Household electricity price (`eurostat_energy_prices`)

```
npx tsx scripts/energy/fetch_prices.ts
```

Fetches Eurostat `nrg_pc_204` for BG + EU27_2020 (band 2500-4999 kWh, all taxes,
EUR/kWh, bi-annual) and writes `series.BG` / `series.EU27` since 2007. The tile
shows BG vs the EU average and BG's % of it (~47% — among the lowest in the EU).
`nrg_pc_205` is INDUSTRIAL electricity (not gas); household gas is `nrg_pc_202` —
add only if the bill-decomposition tile grows.

## Step 3 — Verify, stamp, commit, sync

1. Sanity-check both files load and the latest year/period is present:
   `for f in data/energy/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))"; done`
2. `npx tsc -b` (the hooks in `src/data/energy/*` read the exact field names).
3. Stamp the ingest:
   ```
   npx tsx scripts/stamp-ingest.ts update-energy --summary "gen <first>-<last>, price <period>"
   ```
4. Commit `data/energy/` + `npm run bucket:sync` (served from the bucket in prod;
   `data/energy/*.json` is included by the sync's include-list). The `/sector/energy`
   tiles pick up the new data on next load.

## One-off backfill

The Ember CSV already carries full history (2000+); the ingest floors at 2007 to
align with the procurement corpus window (`FIRST_YEAR` in `fetch_generation.ts`).
Widen that constant for a one-off deeper backfill; the watcher only tracks the
latest republish.
