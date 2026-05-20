---
name: update-procurement
description: Ingest new public-procurement (АОП) data from data.egov.bg into data/procurement/. Use when the daily watch report flags "data.egov.bg АОП" or "АОП debarred-suppliers register" as changed, when the user asks to refresh procurement data, backfill prior periods, or investigate flagged contracts (huge amounts, canary mismatch). Also use after a fresh clone if data/procurement/ is empty.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update Procurement skill

Pulls АОП (Агенция за обществени поръчки) fortnightly OCDS-standard bundles from `data.egov.bg`, normalizes each release into flat `Contract` rows, and writes canonical JSON to `data/procurement/`. Optionally uploads to the GCS bucket.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `data.egov.bg АОП: N new fortnight bundle(s) on top` | Incremental ingest (`npm run procurement:ingest`) |
| Daily watcher reports `data.egov.bg АОП: N new annual contracts dataset(s)` | Legacy discovery (`npm run procurement:ingest-legacy -- --discover`) — picks up a newly-published year; see "Pre-OCDS backfill" |
| Daily watcher reports `АОП debarred-suppliers register: N entries` changed | Re-scrape the debarred list (`npx tsx scripts/procurement/debarred.ts`) — see Step 5 below |
| User asks to "refresh procurement" / "ingest new contracts" | Same — incremental |
| `data/procurement/` empty (fresh clone) | Cold-start ingest of every visible bundle (~24 fortnights ≈ 1 year) |
| Canary mismatch warning surfaced | Investigate `scripts/procurement/normalize.ts` BEFORE re-running |
| Flagged >1B amount needs review | Inspect the row in the relevant `contracts/<YYYY>/<YYYY-MM>.json` — value may be a real megacontract or a source-side decimal-point error |

## Step 1 — Incremental ingest

```bash
npm run procurement:ingest-legacy -- --discover   # new annual-CSV years (usually a no-op)
npm run procurement:ingest                        # new OCDS fortnights + rebuild rollups
```

Run both, discovery first. `procurement:ingest` walks the АОП org's dataset listing on data.egov.bg, downloads any bundle whose `datasetUuid` is not already in `data/procurement/bundles.json`, normalizes its OCDS releases into `Contract` rows, and writes/merges month-shards. Then rebuilds per-EIK rollups under `contractors/` and `awarders/`.

`procurement:ingest-legacy -- --discover` exists because the OCDS ingester only consumes fortnight bundles — a newly-published *annual* CSV (e.g. when АОП posts the 2024 contracts dump) is skipped as "non-OCDS" and would otherwise sit uningested. Discovery walks the same listing, finds any `Договори и изменения на договори - YYYY` dataset whose year isn't in `LEGACY_DATASETS`, confirms its resource is a real `contracts*.csv` (not the out-of-scope `excl*` / `annexes*` dumps), and ingests it. On a normal day it finds nothing and exits in seconds; the `procurement:ingest` that follows rebuilds rollups + cross-reference over whatever it added.

Expected output on a normal day (one new fortnight published):

```
→ walking АОП dataset listing
  page 1: 6 bundle(s) collected
  7 bundle(s) listed
→ ingesting 1 bundle(s)
→ canary on bundle 1b347ef4-4384-4e6c-95cd-d9f850d2c545
  canary OK (sha256=… 1421 rows)
  • 2026-04-23…2026-05-06 (eed…)
    2380 release(s), emitted 1410 row(s) (c=980 a=1170 m=240, dropped 18)
→ wrote 1 new + 2 modified month-shard(s)
→ rebuilding contractor/awarder rollups
  4823 contractor file(s), 1102 awarder file(s)
✓ index.json + bundles.json updated
```

If the canary line is missing it's because the canary bundle's `datasetUuid` matched the only-new-bundles filter and the run intentionally re-ran the canary as part of normal ingest. Either is fine.

## Step 2 — Verify

```bash
node -e "
const idx = require('./data/procurement/index.json');
console.log('years:', idx.years.join(','), '| months:', idx.months.length);
console.log('totals:', idx.totals);
console.log('latest period:', idx.periods[0]);
"
```

You should see:
- `years:` listing every year with contract data on disk.
- `totals.contracts` + `totals.amendments` reflect everything ingested.
- `totals.byCurrency` shows BGN + EUR (Bulgaria's eurozone transition mixes both — do not coerce).

Check the diff:

```bash
git diff --stat data/procurement/
```

Expected: 1-2 month-shards modified or added, plus `index.json` + `bundles.json` + N changed `contractors/*.json` + N changed `awarders/*.json`. The diff-cap aborts the run if >5% of the existing tree touched.

## Step 3 — Upload to bucket

```bash
npm run procurement:ingest -- --upload
```

Or upload separately:

```bash
gsutil -m -h "Cache-Control:no-cache, max-age=0" rsync -r -J \
  data/procurement/ gs://data-electionsbg-com/procurement/
```

## Step 4 — Commit

```bash
git add data/procurement/ tests/fixtures/procurement/
git commit -m "procurement: ingest fortnight YYYY-MM-DD…YYYY-MM-DD"
```

The canary fixture is committed.

## Step 5 — Refresh АОП debarred-suppliers list (optional, gated on watcher)

The "Регистър на стопанските субекти с нарушения" on www2.aop.bg is a tiny upstream — typically 1-5 active entries — that AOП publishes when a КЗК ruling becomes final. The processed JSON is at `data/procurement/debarred.json` and drives the "В черен списък" red-flag chip on contract tables.

Run this step ONLY when the daily watcher reports the `aop_debarred` source as changed, or when explicitly asked to refresh the debarred list:

```bash
npx tsx scripts/procurement/debarred.ts
```

Expected output on a normal run:

```
→ fetching https://www2.aop.bg/stopanski-subekti/stopanski-subekti-s-narusheniya/
  parsed 2 row(s)
  0 new row(s); 2 total in snapshot (includes 0 historical entries no longer on the live page)
  wrote data/procurement/debarred.json
```

The scraper is merge-on-write: it preserves historical entries even after the upstream page purges them (the срок field expires automatically), so the file accumulates rather than overwrites. Commit alongside the procurement ingest:

```bash
git add data/procurement/debarred.json
git commit -m "procurement: refresh АОП debarred-suppliers list"
```

If the watcher flips and the scraper writes no changes (typical when the page is recompiled but the row set is the same), skip the commit. Use `git diff data/procurement/debarred.json` to verify.

## Backfill

To backfill prior OCDS periods (e.g. on first ingest), pass `--since` for a cutoff:

```bash
# Backfill everything published since the start of 2026 (when OCDS publishing began)
npm run procurement:ingest -- --since 2020-01-01

# Limit to N most recent bundles in one run (avoids long single runs)
npm run procurement:ingest -- --max-bundles 5
```

The walker emits oldest-first within the new-bundle filter so partial runs progress through history rather than re-fetching the same window.

### Pre-OCDS backfill (annual CSVs)

АОП only started publishing OCDS-standard fortnight bundles on 2026-01-01. Earlier years are published as annual CSV dumps (with shifting schemas). The `procurement:ingest-legacy` script handles these:

```bash
# Auto-discover + ingest any annual-CSV year not in LEGACY_DATASETS
npm run procurement:ingest-legacy -- --discover

# Ingest all known legacy years (2011-2015 bundled, 2016, 2017, 2019, 2020,
# 2021, 2022 CE+RL, 2023 CE+RL)
npm run procurement:ingest-legacy

# Or one year at a time (the РОП variant uses a "-RL" token)
npm run procurement:ingest-legacy -- --year 2023
npm run procurement:ingest-legacy -- --year 2023-RL

# Dry-run (parse + validate but don't write)
npm run procurement:ingest-legacy -- --year 2023 --dry-run
```

The legacy ingester:
- Resolves CSRF-protected download via the data.egov.bg form flow (GET resource page → POST `/resource/download` with `_token` + cookie).
- Caches the raw CSV under `raw_data/procurement/legacy/<year>.csv.gz`.
- Maps columns by name pattern (defensive against schema drift across years).
- Writes Contract rows into the same `data/procurement/contracts/<YYYY>/<YYYY-MM>.json` month-shards used by the OCDS ingest.
- Does NOT rebuild rollups + cross-reference + by-id files itself — run `npm run procurement:ingest -- --since 2020-01-01` afterward to refresh derived state from the expanded corpus.

`--discover` walks the listing and ingests any `Договори и изменения на договори - YYYY` dataset whose year isn't already in `LEGACY_DATASETS`, after confirming via the detail page that its resource is a `contracts*.csv` (the 2018 dataset is titled like an annual dump but actually carries the out-of-scope `excl2018.csv` — discovery rejects it). It's idempotent: a discovered year that hasn't been pinned into `LEGACY_DATASETS` is simply re-discovered and re-merged (no double-count) on the next run. Optionally pin a confirmed new year's UUID into `LEGACY_DATASETS` afterward.

2018 contracts are not published by АОП (only the out-of-scope file `excl2018.csv` exists). As of this writing 2024 and 2025 are not published in any form — the annual CSV series ends at 2023, the OCDS fortnight bundles start 2026-01-01. When АОП does post a 2024/2025 annual CSV, `--discover` (wired into Step 1) ingests it automatically.

## Single bundle (debugging)

```bash
# Re-ingest one specific dataset
npm run procurement:ingest -- --bundle 3edde0c3-80da-468c-8536-53db74680863

# Force a re-fetch even if the bundle is in the local cache
npm run procurement:ingest -- --bundle <UUID> --refresh-cache
```

The local cache lives under `raw_data/procurement/<resourceUuid>.json.gz` (gitignored — alongside `raw_data/tr/`).

## Data-integrity contract

This skill fails loud rather than write partial / corrupt data. Surfaces that halt before any write:

| Surface | Trigger | Action |
|---|---|---|
| HTTP error on data.egov.bg | non-200 on dataset listing or bundle download | Throws |
| Dataset page period label missing | Bundle's "...периода от DD-MM-YYYY до DD-MM-YYYY..." regex didn't match | Throws naming the dataset UUID |
| Negative amount on a contract | Source data error | Throws naming the release id |
| Canary mismatch | Pinned bundle (1b347ef4-…) produces bytes different from the committed fixture | Throws |
| Diff-cap exceeded | Run would touch > 5% of existing month-shards | Throws |

Surfaces that are **intentionally non-fatal**:

| Surface | Behaviour | Why not a hard fail |
|---|---|---|
| Release tag not in {award, contract, contractAmendment} | Skipped silently | Pure tender notices have no contractor + no money — nothing for us to record |
| Buyer EIK missing on a release | Counted in `releasesSkippedNoBuyer` | Rare; usually placeholder rows from system tests |
| Supplier EIK missing on a row | Counted in `rowsDroppedNoSupplierEik` | Cannot be cross-referenced against MP-companies anyway |
| Amount ≥ 1B (BGN or EUR) | Printed as "review manually" but ingested | Could be a real mega-contract OR a decimal-point error; both warrant a human glance, not an auto-block |

## Common pitfalls

### Canary mismatch
The canary bundle is re-normalized at the start of every run. If the output bytes drift from the committed fixture, the parser regressed. Steps:

1. Re-fetch + decompress the cached bundle:
   ```bash
   gunzip -c raw_data/procurement/1b347ef4-4384-4e6c-95cd-d9f850d2c545.json.gz | head -c 5000
   ```
2. Compare to what the normalizer produced — look for changes in the OCDS extension set or new tag values.
3. Update `scripts/procurement/normalize.ts` if the format genuinely changed.
4. Re-seed the fixture:
   ```bash
   rm tests/fixtures/procurement/canary.json
   npm run procurement:ingest -- --bundle 3edde0c3-80da-468c-8536-53db74680863 --skip-canary
   ```
5. Re-run `npm run procurement:ingest` — the canary will be re-seeded on the next run that includes the pinned bundle, or seeded fresh by deleting the fixture file.

### "could not parse period from label"
data.egov.bg occasionally publishes a bundle whose label doesn't follow the standard "периода от DD-MM-YYYY до DD-MM-YYYY" phrasing. The walker throws naming the offending UUID. Options:
1. Inspect the dataset page (https://data.egov.bg/data/view/<UUID>) — confirm what period it covers.
2. Skip that bundle with `--bundle <other-UUID>` for now and report the anomaly upstream.

### Currency mismatch in totals
On `data/procurement/index.json`, `totals.byCurrency` may show both BGN and EUR. This is correct — Bulgaria joined the eurozone on 2026-01-01 and the rollover spans the bundle data. Do NOT coerce; the SPA displays both.

### EIK length oddities
Most BG EIKs are 9 digits (parent legal entity). 13-digit EIKs are branch / clone forms and get canonicalized to 9 (the first 9 chars) in `Contract.contractorEik`, with the full 13-digit form preserved in `contractorEikFull` for source-link continuity. 10-digit EIKs (rare older BULSTAT) are kept as-is — the cross-reference against `companies-index.json` will miss them, which is the expected behaviour.

## Cross-reference output (Phase 2)

When `data/parliament/companies-index.json` is present, the ingest also runs the MP cross-reference and writes three derived files:

| Path | Purpose |
|---|---|
| `data/procurement/derived/mp_connected.json` | One entry per (mpId, contractor) pair: relations (TR roles + declared stakes), total awarded, top awarders, byYear. The journalism payload. |
| `data/procurement/derived/top_contractors.json` | Top-1000 contractors corpus-wide, each flagged `mpTied: boolean`. Powers the `/procurement` index page. |
| `data/procurement/derived/flow.json` | Sankey-shaped MP-tied flow (awarder → contractor → MP). Only MP-tied flows; full graph would be unreadable. |

The cross-reference reads `companies[].tr.uic` as the join key. The skill **hard-fails** if `companies-index.json` is present but TR enrichment is missing on >90% of entries — that's the silent "TR refresh wasn't run" failure mode where mp_connected.json would otherwise collapse to empty.

If `companies-index.json` is missing entirely, the procurement ingest still completes (raw contracts + rollups land on disk); the cross-reference step logs a skip with a hint to run /update-connections.

**Ordering dependency.** When the orchestrator queues both `/update-connections` and `/update-procurement` from a single watch report, `/update-connections` must run first — it produces `companies-index.json`, which the cross-reference reads. The watcher source list in `scripts/watch/sources/index.ts` already places `cacbgDeclarations` and `egovCommerce` (both → update-connections) before `egovProcurement`, so the natural source-order traversal handles this without explicit dependency declaration. If you reorder the SOURCES list, preserve this invariant.

The `crossReference` field on `data/procurement/index.json` is the at-a-glance summary: `{ mpCount, contractorCount, pairCount, byCurrency }`.

## What this skill does NOT do

- **Does not write frontend UI.** Phase 3+ of the PRD (per-MP tile, /procurement page, /company/:eik page) consume the data via React Query hooks once it's on the bucket.
- **Does not auto-fire.** The watcher reports new bundles; the orchestrator or the user decides when to run.
- **Does not run /update-connections.** The orchestrator runs it separately when declarations or Commerce Registry change. If a fresh clone runs /update-procurement without /update-connections having run first, the cross-reference step logs a skip and the journalism payload is empty until /update-connections produces companies-index.json.

## File map

| Path | Purpose |
|---|---|
| `scripts/procurement/ingest.ts` | CLI entry — walks listing, fetches, normalizes, writes, uploads |
| `scripts/procurement/fetch_dataset_index.ts` | Paginated walk of АОП org's dataset listing on data.egov.bg |
| `scripts/procurement/fetch_bundle.ts` | One bundle download + local gzipped cache |
| `scripts/procurement/normalize.ts` | OCDS release → Contract[] flattener |
| `scripts/procurement/rollups.ts` | Per-contractor / per-awarder JSON file builder |
| `scripts/procurement/cross_reference.ts` | EIK-keyed join against `data/parliament/companies-index.json` |
| `scripts/procurement/derived.ts` | Top-contractors + sankey-flow builders |
| `scripts/procurement/validate.ts` | Schema + canary + diff-cap checks |
| `scripts/procurement/eik.ts` | EIK canonicalization helpers (9-digit canonical) |
| `scripts/procurement/types.ts` | Shared Contract / rollup type definitions |
| `scripts/watch/sources/egov_procurement.ts` | Watcher source — fingerprints page 1 of АОП's data.egov.bg listing |
| `data/procurement/index.json` | Year/month/totals summary + crossReference summary — committed |
| `data/procurement/bundles.json` | Known fortnight bundles + their periods — committed |
| `data/procurement/contracts/<YYYY>/<YYYY-MM>.json` | One file per month, Contract[] — committed |
| `data/procurement/contractors/<EIK>.json` | Per-contractor rollup — committed |
| `data/procurement/awarders/<EIK>.json` | Per-awarding-body rollup — committed |
| `data/procurement/derived/mp_connected.json` | One entry per (mpId, contractor) — committed |
| `data/procurement/derived/top_contractors.json` | Top-N corpus-wide w/ MP-tied flag — committed |
| `data/procurement/derived/flow.json` | Sankey-shaped MP-tied flow — committed |
| `tests/fixtures/procurement/canary.json` | Pinned regression baseline — committed |
| `raw_data/procurement/<UUID>.json.gz` | Local cache of downloaded bundles — gitignored |

## Quick command reference

```bash
# Daily ingest after watcher flags new bundles
npm run procurement:ingest

# Ingest + upload + commit in one pass
npm run procurement:ingest -- --upload
git add data/procurement/ tests/fixtures/procurement/
git commit -m "procurement: ingest"

# Backfill from a cutoff
npm run procurement:ingest -- --since 2026-01-01

# Process one specific bundle (debug)
npm run procurement:ingest -- --bundle <UUID>

# Dry run (parse, validate, no writes)
npm run procurement:ingest -- --dry-run
```
