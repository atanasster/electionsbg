---
name: update-procurement
description: Ingest new public-procurement (АОП) data from data.egov.bg into data/procurement/. Use when the daily watch report flags "data.egov.bg АОП", "АОП debarred-suppliers register", or "ЦАИС ЕОП open data" (the storage.eop.bg flat-договори gap-fill) as changed, when the user asks to refresh procurement data, backfill prior periods, or investigate flagged contracts (huge amounts, canary mismatch). Also use after a fresh clone if data/procurement/ is empty.
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
| Daily watcher reports `ЦАИС ЕОП open data: N new publication day(s)` | Incremental EOP gap-fill — see Step 1b |
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
→ building per-settlement procurement shards
  by_settlement/: 388 settlement file(s); 1460 local-tier buyer(s) pinned, 346 aggregated into _national.json, 1586 dropped (no cached address)
✓ index.json + bundles.json updated
```

The per-settlement step (added 2026) reads each awarder rollup's `geo` block (set by `buildRollups` via the resolver in `scripts/procurement/resolve_ekatte.ts`) and groups local-tier buyers by EKATTE. Output lives at `data/procurement/by_settlement/{ekatte}.json` + `index.json` + `_national.json` — drives the /procurement/by-settlement landing and the procurement tile on the existing settlement detail pages. Central ministries and national state companies are *not* pinned to settlements — they're aggregated into the national rollup. See [[project_procurement_geo]] for the methodology + the curated tier overrides in `scripts/procurement/awarder_tier.ts`.

**One-shot enrichment after this commit:** existing awarder rollups built before this code change have no `geo` block (the normalizer wasn't capturing locality/postalCode). Run `npx tsx scripts/procurement/enrich_awarders_geo.ts` once to backfill from the cached fortnight bundles in `raw_data/procurement/`. From the next `procurement:ingest` onward the rollup builder applies geo automatically.

**Curating the awarder_tier "other" bucket:** the enrichment writes `data/procurement/awarder_tier_unclassified.json` with every awarder whose name didn't match a tier heuristic. Skim it for entities that should be classified (e.g. new ministry sub-units), add an `OVERRIDES` entry in `scripts/procurement/awarder_tier.ts`, and re-run the enrichment (cheap — re-reads the same cached bundles).

If the canary line is missing it's because the canary bundle's `datasetUuid` matched the only-new-bundles filter and the run intentionally re-ran the canary as part of normal ingest. Either is fine.

## Step 1b — ЦАИС ЕОП gap-fill (storage.eop.bg)

АОП's OCDS "обявления" export (the data.egov.bg feed Step 1 ingests) is a strict **subset** of what ЦАИС ЕОП itself publishes. ЦАИС ЕОП's own daily open-data buckets (`storage.eop.bg/open-data-<YYYY-MM-DD>/`) carry a flat **`договори`** file that lists ~900 small contracting authorities — overwhelmingly schools & kindergartens — whose signed contracts never appear in the OCDS обявления export. The `eop_procurement` watcher source tracks that feed.

Run the incremental gap-fill, then rebuild (the rebuild is single-sourced in Step 1's `procurement:ingest`, which re-reads every month-shard including the new EOP rows):

```bash
npx tsx scripts/procurement/ingest_eop.ts --apply   # incremental: last ~30 days
npm run procurement:ingest                           # rebuild rollups/derived/by-settlement/index
```

`ingest_eop` fetches the flat `договори` feed and gap-fills **only buyers entirely absent from our corpus** — an absent buyer has zero OCDS rows, so an EOP row can never double-count an existing contract. New buyers get well-formed `Contract` rows (synthetic `eop-<УНП>` ids, namespaced away from OCDS) in the same month-shards, so the existing rollup machinery picks them up with no special handling. The flat feed carries no buyer address, so these awarders won't resolve to an EKATTE (absent from the by-settlement map, present everywhere else).

Caveats: the gap-fill adds buyers we *lack*; it does not (yet) fill missing contracts of buyers we already have (that would need cross-feed УНП-level dedup). It's the gap-fill, not a re-platform — the OCDS feed stays the base.

## Step 1c — Awarder geo-enrichment (place-view coverage)

The flat ЦАИС ЕОП feed carries no buyer address, so the gap-fill schools (and legacy-only buyers) have no `geo` → they're dropped from `by_settlement` and the my-area place tiles. Two map-builders harvest geo from the same storage.eop.bg buckets, then `scripts/procurement/awarder_geo_map.ts` combines all tiers into an EKATTE override map; `buildRollups` applies it **fill-missing** (an address-derived geo always wins). Run after new buyers land, then rebuild:

```bash
npx tsx scripts/procurement/build_ocds_party_geo.ts      # Tier E: OCDS обявления party addresses → settlement (storage.eop.bg, 2026+)
npx tsx scripts/procurement/build_tender_oblast_map.ts   # Tier D: поръчки executionPlaceNuts → buyer oblast (--backfill for full history)
npx tsx scripts/procurement/awarder_geo_map.ts           # combines tiers → data/procurement/awarder_geo_overrides.json
npm run procurement:ingest                                # rebuild applies the overrides to by_settlement
```

Tiers, in resolution order (see `docs/plans/procurement-awarder-geo-v2.md`):
- **Tier B — МОН school register** (data.egov.bg open-data resource `cac4d569-…`, via the egov `getResourceData` POST). Authoritative school/kindergarten EIK→settlement (~58% of the no-geo set). Degrades gracefully — when data.egov.bg blocks the host the script logs `Tier B skipped`; re-run from a reachable environment to land it.
- **Tier E — OCDS party addresses** (`build_ocds_party_geo.ts` → `derived/ocds_party_geo_map.json`). Harvests `parties[].address.locality`+NUTS from the OCDS обявления file by EIK across ALL parties → settlement. **High confidence; the biggest reachable lever — recovered ~1,232 buyers.** 2026+ only.
- **Tier D — tenders oblast** (`build_tender_oblast_map.ts` → `derived/buyer_oblast_map.json`). `executionPlaceNuts` modal oblast per buyer; not a settlement on its own — used to **disambiguate** the Tier-A name parse (`name+oblast`).
- **Tier A — name-suffix parse** ("- гр.X" / "- с.X" in the awarder name → resolver). Fully local; unique-match only.

Reachable tiers (A+D+E) resolve ~1,490 of the 3,533 no-geo buyers → `by_settlement` local-tier pinned 712 → 1,836. Tier B (МОН) adds the schools on top once reachable. The storage.eop.bg crawls cache to `raw_data/procurement/eop_ocds/` + `eop_tenders/`.

## Step 1d — Derived risk + feed indices (automatic)

`procurement:ingest` (Step 1) already emits these — no separate command. They power the risk index, the explorable pages, and the AI tool. Listed here so you know what changed and when to force a rebuild:

| File | Builder | Feeds |
|---|---|---|
| `derived/cpv_competition.json` | `cpv_competition.ts` | Per-2-digit-CPV single-bid baseline; gates the single-bidder risk flag (a division ≥80% single-bid is "structural" → flag suppressed) |
| `derived/pep_connected.json` + `derived/pep-by-eik/` | `pep_connected.ts` | Officials (non-MP: mayors / councillors / ministers / governors / agency heads) → contractor links, HIGH-confidence only. Surfaces on `/company/:eik` + adds the `pepConnected` risk component |
| `derived/risk_feed.json` | `risk_feed.ts` | Slim top-50 concentration + top-50 MP-tied for `/procurement/flags` + the `procurementRedFlags` AI tool (so neither loads the ~1 MB `awarder_concentration.json`) |
| `derived/person_procurement_index.json` | `risk_feed.ts` | Slim per-MP roster for the `/procurement/people` scanner |

Two dependencies to remember:
- **Single-bidder reads `release.bids.statistics[]`** (the OCDS field that's actually populated — `tender.numberOfTenderers` is ~0%). New fortnights pick it up automatically. To back-fill bid counts onto **already-ingested** rows after the parser changed, run the manual re-normalize (skips the diff-cap; cache-only, no network; never in CI per [[feedback_one_off_backfills]]):
  ```bash
  npm run procurement:ingest -- --renormalize   # re-process every cached bundle + full rebuild
  ```
- **`pep_connected` reads `data/officials/derived/company_links.json`** (produced by `/update-officials`). It only rebuilds when `procurement:ingest` runs, so after a `cacbg`/officials refresh changes that file, re-run `procurement:ingest` to refresh the officials→procurement links. Not gated on `companies-index.json` (uses the officials declarations tree).

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

### ЦАИС ЕОП full-history gap-fill (one-off)

To capture the ~900 small authorities the OCDS feed omits across the full 2020→ history (not just the rolling incremental window of Step 1b), run the backfill once. It crawls ~1,600 daily flat-`договори` buckets (network-heavy, ~30-60 min; raw days cache to `raw_data/procurement/eop/` so re-runs are fast) and is **flag-gated and operator-run — never in the watcher or CI**:

```bash
npx tsx scripts/procurement/ingest_eop.ts --from 2020-01-01 --to <today> --backfill --apply
npm run procurement:ingest      # rebuild rollups/derived/by-settlement/index from the new shards
```

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
| `scripts/procurement/ingest_eop.ts` | ЦАИС ЕОП flat-`договори` gap-fill CLI (incremental default + `--backfill` one-off) |
| `scripts/procurement/normalize_eop.ts` | Flat `договори` record → `Contract[]` mapper (splits multi-supplier consortia) |
| `scripts/procurement/awarder_geo_map.ts` | EKATTE override builder for address-less buyers — combines Tier B (МОН) + E (OCDS party-geo) + D (tenders oblast) + A (name-parse) |
| `scripts/procurement/build_ocds_party_geo.ts` | Tier E — harvests OCDS обявления party addresses (storage.eop.bg, 2026+) → `derived/ocds_party_geo_map.json` (eik→locality+NUTS) |
| `scripts/procurement/build_tender_oblast_map.ts` | Tier D — harvests поръчки `executionPlaceNuts` → `derived/buyer_oblast_map.json` (eik→modal oblast) |
| `data/procurement/awarder_geo_overrides.json` | `eik → {ekatte,source,confidence}` fill-missing geo map consumed by `buildRollups` |
| `scripts/watch/sources/egov_procurement.ts` | Watcher source — fingerprints page 1 of АОП's data.egov.bg listing |
| `scripts/watch/sources/eop_procurement.ts` | Watcher source — fingerprints the latest storage.eop.bg publication day; freshness proxy for ALL three EOP files (договори + поръчки + OCDS) |
| `raw_data/procurement/eop/<YYYY-MM-DD>.json.gz` | Cache of flat `договори` days — gitignored (siblings: `eop_tenders/`, `eop_ocds/`) |
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
