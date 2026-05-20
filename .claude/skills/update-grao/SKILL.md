---
name: update-grao
description: Refresh the ГРАО settlement-level registered-population data (data/grao_population.json) — re-fetch the latest quarterly "по постоянен и настоящ адрес" table from grao.bg and join settlement names to EKATTE. Use when the daily watch report flags "ГРАО" as changed, when the user asks to refresh ГРАО / settlement population data, or after a fresh git clone if data/grao_population.json is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update ГРАО skill

Refreshes `data/grao_population.json` — per-settlement (EKATTE) population by **permanent** and **current** address, the only frequently-updated population source below municipality grain between the decennial censuses.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `permanent`, `current` | ГРАО `t41nm-DD-MM-YYYY_N.txt` table at [grao.bg/tables.html](https://www.grao.bg/tables.html) | settlement (EKATTE) — ~5,100 settlements | quarterly (+ annual 15 Dec) |

The ГРАО file is plain text, **Windows-1251** encoded, pipe-delimited, organised as per-municipality `област … община …` blocks. It carries no EKATTE codes — `scripts/grao/fetch.ts` joins each settlement name to EKATTE within its oblast via `data/settlements.json`.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `ГРАО: ... new quarterly table` | Step 1 |
| User asks to "refresh ГРАО" / "update settlement population" | Step 1 |
| Fresh clone with no `data/grao_population.json` | Step 1 |

ГРАО publishes the settlement table four times a year (quarterly, plus a year-end table on 15 December). Day-to-day there is nothing to do.

## Step 1 — Fetch

```bash
npx tsx scripts/grao/fetch.ts          # uses the cached raw file if present
npx tsx scripts/grao/fetch.ts --force  # re-download the raw .txt
```

The script resolves the most recent `t41nm` file from the ГРАО index, downloads it to `raw_data/grao/`, decodes Windows-1251, parses the per-municipality blocks, joins settlement names → EKATTE, and writes the full bundle `data/grao_population.json` plus one ~1 KB slice per municipality under `data/grao/<obshtina>.json` (what the settlement pages actually fetch).

Expected output:

```
ГРАО latest settlement table: t41nm-15-03-2026_2.txt (2026-03-15)
Parsed ~5,140 settlement rows.
Joined ~5,115 / ~5,140 rows to EKATTE (~23 unmatched, ~22 ambiguous).
Wrote .../data/grao_population.json + ~272 per-municipality slices to .../data/grao/ (~5,106 settlements as of 2026-03-15).
```

## Step 2 — Verify

```bash
node -e "
const g = require('./data/grao_population.json');
const codes = Object.keys(g.settlements);
console.log('asOf      ', g.asOf);
console.log('settlements', codes.length);
const s = g.settlements['56784']; // Plovdiv
console.log('Plovdiv (56784)', JSON.stringify(s));
"
```

Eyeball:
- `asOf` is the most recent quarterly date (15 Mar / 15 Jun / 15 Sep / 15 Dec).
- ~5,100 settlements (full coverage is ~5,250 — Sofia city and its квартали are **not** in `settlements.json` and are expected to be unmatched; a handful of name-format variants also drop out).
- Plovdiv (`56784`) permanent ≈ 388,000.
- The fetch logs `unmatched` and `ambiguous` rows — a normal run shows ~20 of each (Sofia + name variants). A sharp rise means the ГРАО file layout changed — inspect `scripts/grao/fetch.ts`.

## Step 3 — Upload to bucket

```bash
npm run bucket:sync:dry   # preview
npm run bucket:sync       # rsync data/ to gs://data-electionsbg-com/
```

## Step 4 — Commit

```bash
git add data/grao_population.json data/grao/
git commit -m "grao: refresh settlement population through <asOf>"
```

## Known limitations

- **Sofia city** has no entry in `data/settlements.json` (the project models Sofia through election rayoni S23/S24/S25), so ГРАО's "Столична община" settlement rows do not join. Sofia is intentionally absent from `grao_population.json`.
- ГРАО settlement names occasionally carry a parenthetical or resort suffix (`ОРЕШЕЦ (ГАРА ОРЕШЕЦ)`, `ОБРОЧИЩЕ,К.К.АЛБЕНА`); those few rows drop out as unmatched. Add a name override to `scripts/grao/fetch.ts` if a specific settlement matters.

## What this skill does NOT do

- **Does not build a time series.** Each run overwrites `grao_population.json` with the latest quarterly snapshot (the `asOf` field dates it). Historical ГРАО tables exist back to 1998 if a series is ever wanted — that would be a separate ingest.
- **Does not touch census data.** Census 2021 settlement population (decennial, age/sex breakdown) is `update-census`; ГРАО is the between-census refresh of the headline count only.

## File map

| Path | Purpose |
|---|---|
| `scripts/grao/fetch.ts` | CLI entry — fetch, decode, parse, join, write |
| `raw_data/grao/t41nm-*.txt` | cached raw ГРАО file (Windows-1251) |
| `data/grao_population.json` | full bundle — per-EKATTE permanent + current population |
| `data/grao/<obshtina>.json` | per-municipality slices (~1 KB) — fetched by settlement pages |
| `scripts/watch/sources/grao.ts` | daily watcher — fingerprints the latest quarterly table |
| `src/data/grao/useGraoPopulation.tsx` | React Query hook |
