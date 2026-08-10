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
| Daily watcher reports `ЦАИС ЕОП open data: N new publication day(s)` | Incremental EOP gap-fill (Step 1b) **and** tender-stage ingest (Step 1f) — both read the same storage.eop.bg buckets |
| User asks to "refresh procurement" / "ingest new contracts" | Same — incremental |
| `data/procurement/` empty (fresh clone) | Cold-start ingest of every visible bundle (~24 fortnights ≈ 1 year) |
| Canary mismatch warning surfaced | Investigate `scripts/procurement/normalize.ts` BEFORE re-running |
| Flagged >1B amount needs review | Inspect the row in the relevant `contracts/<YYYY>/<YYYY-MM>.json` — value may be a real megacontract or a source-side decimal-point error |

## Step 1 — Incremental ingest

```bash
npm run procurement:ingest-legacy -- --discover   # new annual-CSV years (a no-op unless АОП posts a year we've never ingested)
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

**The per-settlement shards no longer exist.** `data/procurement/by_settlement/` and its writer were retired: /procurement/by-settlement, the settlement detail pages and the My-Area alert feed all read the same rollup from **Postgres** now (`procurement_by_settlement()` in migration 030, precomputed per `?pscope` window by migration 119). The ingest still resolves each awarder's `geo` block via `scripts/procurement/resolve_ekatte.ts` — that is what the SQL groups by — so nothing about the METHODOLOGY changed: central ministries and national state companies are still not pinned to settlements, they are aggregated into the national rollup. See [[project_procurement_geo]] and the curated tier overrides in `scripts/procurement/awarder_tier.ts`.

After an ingest, publish the per-scope precomputes with `npm run db:load:procurement-scopes:pg` (local; `db:refresh` runs it) and `npm run db:load:procurement-scopes:pg:cloud` (prod) — otherwise the pages keep serving the previous corpus. This one loader refreshes ALL the per-scope precomputes — the by-settlement views (119), the `/procurement/contractors` leaderboard + KPIs (`contractor_rank` / `contractor_scope_kpis`, 122), the per-settlement page payloads (`procurement_settlement_payloads`, 123) and the six `/procurement` dashboard payloads (`procurement_payloads`, 124: overview / flow / rankings / concentration / sectors / benchmarks). So a contracts ingest that skips the `:cloud` step leaves the "Топ изпълнители" table, the settlement pages AND the whole `/procurement` dashboard stale on prod while local is current. The authoritative list is `SCOPED_MATVIEWS` in `scripts/db/lib/scopedMatviews.ts` — check there rather than trusting this sentence, which has gone stale twice.

**Notice type on the rollup rows:** since 2026 the slim `topContracts` rows in the contractor / awarder / by_settlement rollups carry the OCDS `tag` (`award` = announced/обявена, `contract` = awarded/възложена, `contractAmendment` = annex/анекс), and value-bearing `award` rows are no longer discarded. This lets the place dashboards and the My-Area alert feed (`scripts/myarea/build_alerts.ts`) label each contract announced / awarded / annex. No new ingest — a normal `procurement:ingest` rebuild populates it; publish via `db:refresh` (local) + the `db:load:*:cloud` loaders (prod), per the Deployment note in Step 1e.

**One-shot enrichment after this commit:** existing awarder rollups built before this code change have no `geo` block (the normalizer wasn't capturing locality/postalCode). Run `npx tsx scripts/procurement/enrich_awarders_geo.ts` once to backfill from the cached fortnight bundles in `raw_data/procurement/`. From the next `procurement:ingest` onward the rollup builder applies geo automatically.

**Curating the awarder_tier "other" bucket:** the enrichment writes `data/procurement/awarder_tier_unclassified.json` with every awarder whose name didn't match a tier heuristic. Skim it for entities that should be classified (e.g. new ministry sub-units), add an `OVERRIDES` entry in `scripts/procurement/awarder_tier.ts`, and re-run the enrichment (cheap — re-reads the same cached bundles).

If the canary line is missing it's because the canary bundle's `datasetUuid` matched the only-new-bundles filter and the run intentionally re-ran the canary as part of normal ingest. Either is fine.

## Step 1b — ЦАИС ЕОП gap-fill (storage.eop.bg)

АОП's OCDS "обявления" export (the data.egov.bg feed Step 1 ingests) is a strict **subset** of what ЦАИС ЕОП itself publishes. ЦАИС ЕОП's own daily open-data buckets (`storage.eop.bg/open-data-<YYYY-MM-DD>/`) carry a flat **`договори`** file that lists ~900 small contracting authorities — overwhelmingly schools & kindergartens — whose signed contracts never appear in the OCDS обявления export. The `eop_procurement` watcher source tracks that feed.

Run the **self-heal** cadence, then rebuild (the rebuild is single-sourced in Step 1's `procurement:ingest`, which re-reads every month-shard including the new EOP rows):

```bash
npx tsx scripts/procurement/ingest_eop.ts --self-heal --apply   # covered-buyer gap-heal, last ~75 days
npm run procurement:ingest                                       # rebuild rollups/derived/by-settlement/index
```

**Why `--self-heal` (shipped 2026-07-26; replaces the old two-step).** `--self-heal` implies `--cross-source-dedup` over a **~75-day** window (wide enough to span АОП's OCDS-export lag behind the live ЦАИС feed; 90-day guard cap, no `--backfill`), keeping **all** buyers and content-deduping against the corpus. It is double-count-**safe** because `ingest.ts::writeMonthShards` evicts each `eop-` row once its authoritative OCDS twin lands (see the OCDS-lag section below). This single command subsumes both halves of the previous runbook:
- the plain absent-buyer gap-fill (`--apply` with no dedup), and
- the scoped infra-buyer recovery (`--cross-source-dedup --only-buyers "000695089,175203478,130823243,106513772,000695388,000696327"` — АПИ, Булгартрансгаз, НКЖИ, АЕЦ Козлодуй, Мин. транспорт, Столична община). Those authorities are covered by OCDS yet ЦАИС carries large consortium road/rail contracts the OCDS export omits; the old plain guard dropped them every fortnight. `--self-heal` now recovers them — and every *other* covered buyer (hospitals under ПЛС/ДСП, ministries) that had the identical gap — without a whitelist. (These infra records are historical — 2020/21, e.g. `00044-2020-0085` Русе–Бяла €785.8M, recovered once via the `--backfill` one-off in Step 1f and already correct on disk; the rolling ~75-day nightly window doesn't reprocess them.)

`--only-buyers` still exists for a targeted re-run but is no longer part of the nightly path. **Multi-buyer attribution** (changed with the whitelist drop, then mitigated): a multi-EIK `buyerRegistryNumber` like `00044-2020-0085`'s `"175076479999; 000695089"` (АДФИ + АПИ) has no whitelist under `--self-heal`, so `resolvePrimaryBuyer`'s `recoverToPrimary` branch attributes it to the first **real** buyer — skipping co-listed financial-control organs via `CONTROL_ORGAN_EIKS` (АДФИ 175076479999) so it lands on **АПИ**, matching the retired `--only-buyers` attribution rather than the control organ that happens to be listed first. This recovers ~653 rows / €1.16bn the plain feed dropped. Extend `CONTROL_ORGAN_EIKS` (in `normalize_eop.ts`) as new co-listed oversight bodies surface.

`ingest_eop --self-heal` fetches the flat `договори` feed and, for each buyer, adds only the contracts not already in the corpus on a content key. New rows get well-formed `Contract` rows (synthetic `eop-<УНП>` ids, namespaced away from OCDS) in the same month-shards, so the existing rollup machinery picks them up with no special handling. The flat feed carries no buyer address, so these awarders won't resolve to an EKATTE (absent from the by-settlement map, present everywhere else) — see Step 1c geo-enrichment.

Caveat — years with **no** OCDS at all (2024/2025): the `--include-existing-buyers` one-off (below) is still the tool there. For every year OCDS covers, `--self-heal` is the base cadence and the eviction guard keeps it from double-counting.

**OCDS-lag covered-buyer gap + the eviction guard (2026-07-26).** АОП publishes the data.egov.bg OCDS export on a multi-week lag behind the live ЦАИС ЕОП feed (which is what `sigma.midt.bg` reads). While a fortnight sits published in the flat feed but not yet in OCDS, the incremental gap-fill drops every *covered* buyer's new contracts (deferring to the OCDS that hasn't arrived) — so recent contracts of hospitals, ministries etc. go missing and we lag SIGMA by weeks. Symptom: `SELECT max(date) FROM contracts WHERE contractor_eik=<supplier>` trails SIGMA; the missing УНП is in the cached flat feed (`gzcat raw_data/procurement/eop/<day>.json.gz | grep <unp>`) but absent from our corpus.

The nightly `--self-heal` run (above) covers this automatically for any lag up to ~75 days. Only if the OCDS lag ever **exceeds** the self-heal window (the missing `date` predates `today − 75d`) widen it explicitly:

```bash
npx tsx scripts/procurement/ingest_eop.ts --apply --cross-source-dedup --backfill \
  --from <ocds-periodEnd+1> --to <newest-flat-day>   # only when the gap is older than 75 days
npm run procurement:ingest                            # rebuild; then db:load:pg (+ :cloud) to publish
```

It is double-count-**safe** because `ingest.ts::writeMonthShards` runs `evictSupersededEopTwins` (`content_key.ts`): when АОП's OCDS export finally publishes that fortnight, the arriving OCDS row **evicts** the `eop-` twin it stood in for (content match, OCDS authoritative — the two feeds namespace `key`s disjointly, so the key merge alone would keep both). Validated on the real 2026-05-21…06-03 fortnight: 1827/1832 flat rows twin an OCDS row. **Shipped (2026-07-26):** the nightly cadence is now `--self-heal` (implemented in `eop_window.ts` / `ingest_eop.ts`), so the covered-buyer gap self-heals without a manual recovery and the old `--only-buyers` infra step is retired from the nightly path.

## Step 1c — Awarder geo-enrichment (place-view coverage)

The flat ЦАИС ЕОП feed carries no buyer address, so the gap-fill schools (and legacy-only buyers) have no `geo` → they're dropped from `by_settlement` and the my-area place tiles. Two map-builders harvest geo from the same storage.eop.bg buckets, then `scripts/procurement/awarder_geo_map.ts` combines all tiers into an EKATTE override map; `buildRollups` applies it **fill-missing** (an address-derived geo always wins). Run after new buyers land, then rebuild:

```bash
npx tsx scripts/procurement/build_ocds_party_geo.ts      # Tier E: OCDS обявления party addresses → settlement (storage.eop.bg, 2026+)
npx tsx scripts/procurement/build_tender_oblast_map.ts   # Tier D: поръчки executionPlaceNuts → buyer oblast (--backfill for full history)
npx tsx scripts/procurement/awarder_geo_map.ts           # combines tiers → data/procurement/awarder_geo_overrides.json
npm run procurement:ingest                                # rebuild applies the overrides to by_settlement
```

Tiers, in resolution order (most authoritative first; see `docs/plans/procurement-awarder-geo-v2.md`). `awarder_geo_map.ts` reads them all and the first that resolves wins:
- **Tier R — МОН institution register crosswalk** (`derived/mon_ri_eik_crosswalk.json`, built by the SEPARATE headed-Playwright crawl `scripts/procurement/mon_ri_crawl.ts` — see below). Exact ЕИК→EKATTE from each institution's own registry card; **the top lever for schools/kindergartens — resolves ~1,285 buyers**, incl. the ambiguous shared-name schools (Паисий Хилендарски, Св. св. Кирил и Методий) no other tier can pin. Optional; skipped if the crosswalk file is absent.
- **Tier F — TR registered seat** (`raw_data/tr/state.sqlite`, `companies.seat`). Exact ЕИК → registered settlement; recovers читалища/companies (NOT schools — those are БУЛСТАТ budget entities, not in ТР). Optional; skipped if the sqlite is absent.
- **Tier S — our schools register** (`data/schools/index.json`, eik→address from `match_eik.ts`). Exact but secondary-schools-only and name-matched (fuzzier than Tier R, which corrects it). ~5% of its EIKs were wrong; Tier R above supersedes it.
- **Tier E — OCDS party addresses** (`build_ocds_party_geo.ts` → `derived/ocds_party_geo_map.json`). `parties[].address.locality`+NUTS by EIK. 2026+ only.
- **Tier B — МОН open-data register name-match** (resource `cac4d569-…` via egov `getResourceData`). The register **dropped its ЕИК column** (now only НЕИСПУО + place), so Tier B can no longer key by EIK — it now matches the awarder NAME by legal-form-stripped name-core → settlement, accepted only on a globally-unique name or a Tier-D oblast pin. Degrades to zero entries when data.egov.bg blocks the host's egress IP — see the merge note below.
- **Tier D — tenders oblast** (`build_tender_oblast_map.ts` → `derived/buyer_oblast_map.json`). Modal oblast per buyer; not a settlement — **disambiguates** Tier B and the Tier-A name parse (`name+oblast`).
- **Tier A — name-embedded settlement** (a "гр.X"/"с.X" token or a bare "- City" tail in the awarder name → resolver, any case; unique-match or Tier-D-confirmed). Fully local.

Full stack resolves ~2,109 of the 2,753 no-geo buyers → `by_settlement` local-tier pinned to ~3,074, only 644 dropped. The storage.eop.bg crawls cache to `raw_data/procurement/eop_ocds/` + `eop_tenders/`.

**Every one of those tiers is optional, and the builder MERGES rather than rebuilds — do not "fix" that.** A tier whose input is unreachable contributes zero entries, and until 2026-08-10 the run simply wrote whatever it had: measured that day, data.egov.bg 403'd this host, Tier B went `mon 35 + monOblast 58 → 0`, and the map shrank **2,164 → 2,071** at exit 0 with every other tier byte-identical. Those 93 awarders left `by_settlement` and the place / My-Area tiles, and only a diff of the committed file caught it. Four things now hold:

- **`awarder_geo_map.ts` merges into the committed map** (`awarder_geo_merge.ts`). A prior entry survives when the tier that produced it could not run this time, and is dropped only when that tier ran and no longer resolves the awarder. ЕИК↔EKATTE is stable — an institution does not move — so a carried-over entry is still correct.
- **`tiers` in the output says which happened**, per tier: `status: ok | unavailable`, the `reason`, and `lastFreshAt` — the date that tier's entries were last freshly resolved. That is how you tell "tier ran and found nothing" from "tier was down", and how you see a block that has persisted for weeks.
- **A shrink >5% refuses to write** (exit 1), with `--allow-shrink` for a real contraction and `--dry-run` to preview the merge. The tolerance is deliberately tighter than the 25% ratios elsewhere in the repo: the incident was 4.3%, which a 25% guard cannot see. It measures GROSS loss of prior entries (`retired + vanished + unresolved + malformed`), never net map size — the candidate pool grows every ingest, so a net guard lets growth mask loss.
- **The `mon` counts can be inherited**, so read `carriedOver` beside `sources`. `run` (candidates / resolved / unresolved) is a separate block because it describes THIS run and disagrees with `sources` exactly when a tier is down.

**An EMPTY derived input counts as unavailable, not as "ran, found nothing" — and that is the door the first version left open.** `build_tender_oblast_map.ts` and `build_ocds_party_geo.ts` both write `awarders: {}` unconditionally when their gz cache yields nothing, and neither has a completeness guard, so a valid-but-empty file cannot be told from a failed rebuild. Reading it as a successful run is the one verdict that lets the merge drop that tier's entries: measured, emptying `buyer_oblast_map.json` dropped 16 unrecoverable entries at 0.7% — under the shrink guard, at exit 0. `readTierJson` now refuses an absent, unparseable, shape-drifted **or empty** payload for all four JSON tiers (R/S/D/E).

The block is intermittent and environment-dependent — a BG residential IP is the documented workaround (see [[reference_egov_api_endpoints]]) — so the safe move on a blocked run is to let the merge carry the tier and re-run later, not to commit a shrunk map. Two gates: `scripts/procurement/awarder_geo_merge.test.ts` covers the merge rule, the tier-availability relation and the shrink verdict; `awarder_geo_overrides.test.ts` covers the committed artifact's own invariants (count/sources reconcile, no unrecognised tier, every tier declared, an unavailable tier carries a reason).

**Refreshing Tier R (the RI crosswalk).** `mon_ri_crawl.ts` is NOT part of the normal ingest — it drives a **headed Playwright** browser (ri.mon.bg is an Angular SPA behind Cloudflare; the JSON API 403s a plain fetch, so we clear CF once with the `cik_fetch.ts` stealth pattern and call `ri-api.mon.bg` via `page.evaluate`). Reachable from any egress (no BG requirement). ЕИК↔EKATTE is stable, so it only needs re-running when schools open/close — the `mon_ri_register` watch source flags this, and process-watch-report re-runs the crawl + `awarder_geo_map.ts` + `procurement:ingest`. See [[reference_mon_ri_register]].

## Step 1d — Derived risk + feed indices (automatic)

`procurement:ingest` (Step 1) already emits these — no separate command. They power the risk index, the explorable pages, and the AI tool. Listed here so you know what changed and when to force a rebuild:

| File | Builder | Feeds |
|---|---|---|
| `derived/cpv_competition.json` | `cpv_competition.ts` | Per-2-digit-CPV single-bid baseline; gates the single-bidder risk flag (a division ≥80% single-bid is "structural" → flag suppressed) |
| `derived/pep_connected.json` + `derived/pep-by-eik/` (reverse, contractor→officials) + `derived/pep-by-slug/` (forward, official→contractors) | `pep_connected.ts` | Officials (non-MP: mayors / councillors / ministers / governors / agency heads) → contractor links, HIGH-confidence only. `pep-by-eik` surfaces on `/company/:eik` + adds the `pepConnected` risk component; `pep-by-slug` powers the procurement section on `/officials/:slug` + the official rows in the `/procurement/people` scanner. Each entry carries `byYear` + `topAwarders` (from the contractor rollup) so the official profile renders the same per-company history card as the MP procurement page |
| `derived/risk_feed.json` | `risk_feed.ts` | Slim top-50 concentration + top-50 MP-tied for `/procurement/flags` + the `procurementRedFlags` AI tool (so neither loads the ~1 MB `awarder_concentration.json`) |
| `derived/person_procurement_index.json` | `risk_feed.ts` | Slim per-person roster (MPs from `mp_connected.json` + officials from `pep_connected.json`, each row tagged `kind`) for the `/procurement/people` scanner |

Two dependencies to remember:
- **Single-bidder reads `release.bids.statistics[]`** (the OCDS field that's actually populated — `tender.numberOfTenderers` is ~0%). New fortnights pick it up automatically. To back-fill bid counts onto **already-ingested** rows after the parser changed, run the manual re-normalize (skips the diff-cap; cache-only, no network; never in CI per [[feedback_one_off_backfills]]):
  ```bash
  npm run procurement:ingest -- --renormalize   # re-process every cached bundle + full rebuild
  ```
- **`pep_connected` reads `data/officials/derived/company_links.json`** (produced by `/update-officials`). It only rebuilds when `procurement:ingest` runs, so after a `cacbg`/officials refresh changes that file, re-run `procurement:ingest` to refresh the officials→procurement links. Not gated on `companies-index.json` (uses the officials declarations tree).

## Step 1e — Sector / procedure / EU enrichment + breakdowns + contracts browser

The legacy CSV (2011–23) and the АОП OCDS export don't carry CPV / procedure / EU
fields uniformly — only the ЦАИС ЕОП flat feed does. Three offline, **map-safe**
passes (they write only per-contract fields + their own derived files; they never
touch rollups / `by_settlement` / the awarder geo) bring the corpus to SIGMA-level
field coverage. Run after Steps 1–1c (they read the on-disk shards):

```bash
npx tsx scripts/procurement/eop_field_map.ts --apply   # CPV/procedure/bids/euFunded onto contracts — content-join on (buyer,supplier,date) with a consortium value-date fallback. 2020–26 CPV 34%→98%
npx tsx scripts/procurement/contract_index.ts          # per-year slim shards (derived/contract_index/) for the faceted /procurement/contracts browser
npx tsx scripts/procurement/by_id_shards.ts            # prefix-sharded per-contract detail store (contracts/by-id/shard/) — the PG load source for /procurement/contract/:key
```

**Current (post-annex) value — the headline basis.** `amountEur` is the CURRENT contract value ("текуща стойност"), matching SIGMA's default list value. It is derived from the ЦАИС ЕОП `анекси` feed and must be (re)applied AFTER every base normalization (`procurement:ingest` and any re-ingest reset `amountEur` back to `toEur(amount)` = the signing value):

```bash
npx tsx scripts/procurement/ingest_anexi.ts                    # fetch+cache annex feed (~30d incremental by default; --backfill --from 2020-01-01 once for full history; no --apply flag)
npx tsx scripts/procurement/anexi_current_value.ts --apply     # FLIP amountEur → current value in place; original signing value kept in signingAmountEur
npx tsx scripts/procurement/backfill_unp.ts --apply            # УНП onto the shards — the OCDS export carries none at parse time
npx tsx scripts/procurement/reconcile_cross_source.ts --apply  # cross-source dedup; MUST follow backfill_unp (see below)
npx tsx scripts/procurement/rebuild_from_cache.ts              # rebuild rollups/by-id/index from the FLIPPED shards (this pass is flip-aware; see below)
npx tsx scripts/procurement/rebuild_derived.ts                 # link-dependent files (mp_connected/pep/flow/top_contractors)
```

- **THE RECONCILE IS NOT OPTIONAL AFTER AN INGEST, and its position is fixed.** The corpus is built
  from four feeds (`aop-legacy-` / `eop-` / `ocds-` / `rop-`), each of which splits a contract's
  value across its OWN view of the supplier set — so when one contract arrives from two feeds the
  rows cannot be summed and the corpus over-states. An ingest re-introduces those mixes; only
  `reconcile_cross_source.ts` removes them. Skipping it is invisible to row counts: it shows up as
  a slowly inflating headline. `db:refresh` already sequences it; this manual path is the one that
  used to miss it.
- It must run **AFTER `backfill_unp.ts`** and it refuses to run otherwise (a УНП-coverage
  preflight). The identity it reconciles on needs the УНП, which does not exist at parse time —
  `normalize.ts` never sets it, because the АОП OCDS export carries none. Run before the backfill
  and the pass is a silent no-op on a corpus it has no keys for.
- It is idempotent and dry-run by default. A second run over its own output finds nothing; the
  permanently-unresolvable groups it prints (7 ambiguous + 5 blocked today) are expected output,
  not failures. See `docs/plans/procurement-cross-source-dedup-v2.md`.
- Then **`db:load:annexes:pg` must follow the contracts reload**: an eviction orphans the evicted
  row's `procurement_annexes` rows (16 across 9 keys on the last run), and only that loader
  re-resolves them.

- Every builder that writes `derived/mp_connected.json` goes through `buildNamesakeFilteredLinkageMap` (`cross_reference.ts`), which is the ONLY sanctioned way to construct the linkage map — it bundles the TR-namesake counts with `buildEikLinkageMap`. `rebuild_from_cache.ts` used to call `buildEikLinkageMap` bare and published the inflated 134 MPs / €2,964M instead of the correct 54 / €1,958M whenever it ran last. `cross_reference.test.ts` now fails on any builder that reaches past the helper.


- ORDER MATTERS. Run the fold LAST (after `eop_field_map` and any `procurement:ingest`), because base normalization recomputes `amountEur = toEur(amount)` and drops the flip. `rebuild_from_cache.ts`'s euro-backfill is now **flip-aware** (it refreshes `signingAmountEur` from the native amount and leaves the current `amountEur` intact when a row is annexed), so the fold → rebuild order preserves the current basis; the reconcile then holds (`index.json.totals.totalEur` == PG `SUM(amount_eur)` to the euro).
- Do NOT use `rebuild_derived` for rollups — it doesn't rebuild them; and do NOT rely on `procurement:ingest` alone for the current basis (it rebuilds rollups from the signed shards before the fold runs).
- The euro-peg canary (`contracts_aggregate.ts`) checks `signingAmountEur ?? amountEur` against the native `amount` (the annexed `amountEur` no longer pegs to `amount`).

> **RETIRED:** `eop_breakdowns.ts` (the per-entity 'Какво купува'/'Как купува' + `derived/sector_totals.json` builder) was removed in commit `7258bd1e` — breakdowns are now served from Postgres (`company_procurement` / `awarder_procurement`), so there is no JSON step. Do NOT re-add it; `derived/breakdowns/` + `derived/sector_totals.json` are gitignored leftovers.

Notes:
- `eop_field_map` is idempotent; `euFunded` is tri-state (known true/false vs unmatched). The EOP flat feed lacks some big legacy consortium contracts (e.g. АПИ roads), so the per-entity EU% is gated by value-coverage in the breakdown tile.
- Each `contract_index/<year>.json` is `{ awarders, contractors, rows }`: awarder/contractor names are dictionary-encoded (eik→name maps) and the compact row carries only the eik — the browser hook (`useContractBrowser.tsx`) rehydrates by reference so ~40k rows share a few thousand name strings (parse + memory win). The compact row is `[date, awarderEik, contractorEik, amountEur, cpvDivision, procedureBucket, euFunded, title, key, bidCount, cpv, euProgram]` — `key` deep-links each row to `/procurement/contract/:key`, `bidCount` (numberOfTenderers) lets the table compute the single-bidder red flag inline (the entity flags — debarred / MP-tied / official-tied / concentration — join by EIK/name from the risk-index files), `cpv` is the full 8-digit code (shown under the sector name; `cpvDivision` stays its 2-digit prefix for the sector facet), and `euProgram` is the operational-programme name shown in the EU-badge tooltip. All four are **appended** (positions 10–13) so a pre-bump shard still rehydrates; readers must treat them as optional. The "All years" facet (`?year=all`) merges every shard client-side (`useAllContractYears`, ~85 MB) for cross-year text search — opt-in, since it loads + risk-scores the whole corpus. `procedureBucket`/category labels resolve in the UI; English OCDS enums (`open`/`limited`/`selective`) are mapped to families in `cpvSectors.ts` (so the flat-feed years don't read as "Друга").
- `contracts/by-id/shard/<3-hex>.json` is a `{ key → Contract }` map (4096 shards, ~70 rows each) covering the **whole** corpus. `writeByIdShards` runs automatically inside `ingest.ts`, `rebuild_derived.ts`, `dedup_legacy_twins.ts`, and `rebuild_from_cache.ts` (alongside `writeByIdContracts`); run it standalone after a manual `contract_index` rebuild. The shard tree is **gitignored** and is now a **local PG-load source only** — `/procurement/contract/:key` (`useContract`) reads Postgres via `/api/db`. It is NOT bucket-synced (see the Deployment note below).
- `derived/contract_index/` is **gitignored** (bulky — 15 shards) and, like the by-id shards, is a **local source that `db:load:pg` reads**; the `/procurement/contracts` browser reads the resulting PG table via `/api/db`. It is NOT bucket-synced.

> **Deployment (READ THIS before syncing):** the entire `data/procurement/` tree is served from **Cloud SQL** (Firebase fn `/api/db/*`), **not GCS**. `bucket:sync` **excludes** all of `procurement/` except `roads.json` + `derived/mp_party.json` + `derived/hub_stats.json` + `derived/sector_stats.json` (the `-x` regex in package.json), and `bucket_gzip.ts` ships **no** procurement dir. The ingest's JSON shards are the **local source** `db:load:*:pg` reads to populate Postgres. So the prod-deploy path for procurement is **`db:load:pg:cloud && db:load:tenders:pg:cloud && db:load:awarder-seats:pg:cloud`** (Cloud SQL proxy on `127.0.0.1:5434`), NOT `bucket:sync:all`. Ignore any older "finish with `bucket:sync:all`" phrasing in this doc.

## Step 1f — Tender-stage ingest (procedures, not signed contracts)

The corpus above is **signed contracts**. The sibling **`поръчки`** file in the same `storage.eop.bg` daily buckets is the tender STAGE — the procedure before any contract: estimated (прогнозна) value, lots, status. `ingest_tenders.ts` writes a **parallel** `data/procurement/tenders/` tree that NEVER touches the contracted-spend rollups (estimated value is a forecast, kept in its own aggregate). Tracked by the **same `eop_procurement` watcher** (it fingerprints all three EOP files — договори + **поръчки** + OCDS), so a `ЦАИС ЕОП open data` change should refresh tenders too. Self-contained: it does **not** rebuild the contracts rollups, so run it independently of Step 1's `procurement:ingest`.

```bash
npx tsx scripts/procurement/ingest_tenders.ts --apply            # incremental: last ~30 days (then db:load:tenders:pg to publish)
```

Output `data/procurement/tenders/`: `<YYYY>/<YYYY-MM>.json` month-shards + `by-tender/shard/` (per-procedure, keyed sha256(УНП)) + `by-ocid/shard/` (contract→tender lineage, keyed by the ocid's last 2 chars) + `by_year/<year>.json` (the slim search shards the FE `/procurement/tenders` search + the `openTenders` AI tool read) + `index.json`. All bulky shards are **gitignored** (see `.gitignore` — `tenders/{20*,by-tender,by-ocid,by_year}`); only the ~390 KB `index.json` is committed. They are the **local source for `db:load:tenders:pg`** — the `/procurement/tenders` search + `/tenders/:unp` read Postgres via `/api/db`, not GCS (tenders is inside the `procurement/` bucket exclusion). Lineage to a signed contract is free: a contract's `ocid` = `ocds-e82gsb-<parentTenderId>`. See `docs/plans/procurement-tenders-ingest-v1.md`.

**Full 2020→ history is a one-off, flag-gated operator backfill — never in the watcher/CI** (it crawls ~2,300 daily `поръчки` buckets; raw days cache to `raw_data/procurement/eop_tenders/` so re-runs are offline):

```bash
npx tsx scripts/procurement/ingest_tenders.ts --from 2020-01-01 --to <today> --backfill --apply --upload
```

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

## Step 2b — Refresh the local SQL store

The local Postgres store (docker `electionsbg-pg`, see docs/plans/postgres-migration-v1.md) is loaded from the just-written shards, so a fresh ingest leaves it stale — **for BOTH the `contracts` and the `tenders` tables** (this ingest refreshes both trees). Reload both:

```bash
npm run db:refresh   # db:pg:up + db:load:pg (contracts) + db:load:tenders:pg + test:data
```

`db:refresh` rebuilds the `contracts` table (~10 s) AND the `tenders` table (~18 s) from the fresh shards, then `test:data` confirms the SQL captured them losslessly (it does NOT compare against the committed manifest/goldens baseline, so it won't false-fail on new data). Postgres is local + gitignored — **no commit or bucket sync needed** (it powers `/db`, the `/api/db` live pages, and the `db:gen-*` generators). Run after every procurement ingest — it's the ONLY thing that keeps `contracts` + `tenders` fresh; if a table's loader isn't in `db:refresh`, that table silently goes stale (the tenders-stale bug, fixed 2026-07-02).

## Step 2c — Regenerate the /procurement hub stat tiles

The `/procurement` HUB reads its stat-tile numbers (money, contracts, contractors, connected, tenders, appeals, NGOs, flags, places — per `?pscope` scope) from **one pre-generated file**, `data/procurement/derived/hub_stats.json`, instead of live DB calls. It's built from Postgres (so it runs AFTER Step 2b's `db:refresh`) and — unlike the rest of the PG-served procurement tree — it is **committed AND bucket-synced** (it's in the `bucket:sync` procurement allowlist alongside `roads.json` / `mp_party.json`), because the hub fetches it as a static file:

```bash
npm run db:gen-hub-stats      # ~22 s: reads PG, writes data/procurement/derived/hub_stats.json (one entry per parliament / year / all)
npm run db:gen-sector-stats   # ~1 s: writes data/procurement/derived/sector_stats.json — per-sector all-time procurement € for the /governance/sectors + featured-sectors tiles
```

`sector_stats.json` is the sibling of `hub_stats.json` for the government-sector
tiles (same committed + bucket-synced serving). Commit + `bucket:sync` both files
with the ingest. If it goes stale the hub tiles just show older numbers (no breakage) — but it should refresh on every procurement ingest, so run it here. The two heavy counts (flags = single-supplier concentration cases via `procurement_risk_feed`; places = settlements with procurement via `procurement_by_settlement`) are computed offline here precisely because they're too expensive to query live per hub load.

## Step 3 — Publish to prod (Cloud SQL, not the bucket)

Procurement is served from **Postgres**, so publishing means reloading the Cloud SQL tables from the fresh on-disk shards — NOT an rsync to GCS. Local PG is refreshed by Step 2b's `db:refresh`; for prod, run the Cloud SQL loaders (proxy on `127.0.0.1:5434`, `.pgpass` set):

```bash
npm run db:load:pg:cloud            # contracts
npm run db:load:tenders:pg:cloud    # tenders
npm run db:load:awarder-seats:pg:cloud
npm run db:load:persons-browse:pg:cloud   # /persons money column — see below
npm run db:load:graph:pg:cloud            # /connections company money — see below
```

The last TWO are not procurement tables and are easy to forget for exactly that reason.
`person_browse_table` (migration 120, the `/persons` browser) computes `public_money_eur`
from the contracts corpus you just replaced. Skip it and the money column on `/persons`
keeps serving the previous corpus while `/procurement/contracts` shows the new one — two
pages disagreeing about the same person, with nothing failing. `update-persons` carries the
same note from the other side.

`db:load:graph:pg:cloud` is the same trap for `/connections`: the graph's company nodes
(via `company_public_money`, 127) carry the broad public money summed from this same
contracts corpus, so a procurement reload that skips it leaves every connection company's
money — and the `/person` "Свързани лица" tile — on the previous vintage. It re-derives
`graph_*` + `graph_payloads` from the tr / persons / procurement layers; run it after
`persons-browse` (whose facets it reads). `update-persons` carries it as its last step.

The **only** procurement files that still belong on GCS are `roads.json` + `derived/mp_party.json` + `derived/hub_stats.json` + `derived/sector_stats.json` (frontend) — a normal `bucket:sync` already ships exactly those (its `-x` regex excludes the rest of `procurement/`). The AI-tool files `debarred.json`, `derived/kzk_appeals_summary.json`, `tenders/index.json` are bundled/PG-served, not fetched from GCS. **Do NOT** `gsutil rsync data/procurement/ → gs://…/procurement/` — that re-pushes the whole PG-served tree the sync deliberately excludes.

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

`--discover` walks the listing and ingests any `Договори и изменения на договори - YYYY` dataset whose year isn't already in `LEGACY_DATASETS`, after confirming via the detail page that its resource is a `contracts*.csv` (the 2018 dataset is titled like an annual dump but actually carries the out-of-scope `excl2018.csv` — discovery rejects it).

**Already-ingested years are skipped via `data/procurement/legacy_ingested.json`.** That manifest is the legacy counterpart of `bundles.json`: every dataset a run actually ingests is recorded there (after the shards land, so a mid-write failure doesn't mark it done), and discovery dedupes against it as well as against `LEGACY_DATASETS`. Before this existed, a discovered-but-unpinned year was re-nominated, re-downloaded and re-merged on **every** run — harmless for the corpus (the month-shard merge keys on `Contract.key`, so nothing double-counted) but it burned a fetch per run and made a routine no-op run report "2 new dataset(s)", which reads as new data. 2024-RL and 2025-RL did this for weeks.

- Pinning a confirmed year into `LEGACY_DATASETS` is still fine but no longer required to stop the re-pull.
- `--year <token>` resolves against the manifest too, so a discovered-but-unpinned year (e.g. `--year 2024-RL`) stays addressable once discovery starts skipping it.
- `--discover --rediscover` ignores the manifest and re-nominates everything — use it when АОП **restates** a dump and you deliberately want it re-pulled.
- `--dry-run` never records, so a dry discovery run doesn't poison the guard.

2018 contracts are not published by АОП (only the out-of-scope file `excl2018.csv` exists). For 2024 and 2025 АОП publishes **only a РОП (RL) annual CSV** — no ЦАИС ЕОП (CE) file and no OCDS bundle (OCDS fortnight bundles start 2026-01-01). Crucially these RL dumps are a **tiny old-register tail, not a full-year corpus**: `contracts2024_RL` ≈ 136 rows / €37.6M, `contracts2025_RL` ≈ 50 rows / €23.4M (mostly sectoral/utility buyers like АЕЦ Козлодуй still filing in РОП). The full ЦАИС-era 2024/2025 corpus is gap-filled from the ЦАИС ЕОП flat feed via the `--include-existing-buyers` one-off (below) — that fill is **vastly more complete**, so:

- **Do NOT drop the `eop-` 2024/2025 shards** to swap in the RL dumps — that would discard the full year for a ~136-row tail. (The earlier "drop the eop- shards first" note assumed the RL file would be a full CE-style corpus; it isn't.)
- The RL dumps are at most an **additive supplement** in their own `2024-RL`/`2025-RL` namespace (the same role the 2022-RL/2023-RL files play next to their CE files). РОП vs ЦАИС ЕОП are near-disjoint by construction, and at €37.6M/€23.4M even full overlap is <0.1% of the corpus — but the eop↔RL overlap is unmeasured, so spot-check before pinning them in. `--discover` finds both (UUIDs `88ea1672…` for 2024-RL, `7990cb41…` for 2025-RL) but is operator-run, never the watcher, so ingesting them stays a deliberate choice.

Download-flow note: data.egov.bg's per-resource `/resource/download` endpoint broke server-side around June 2026 (it 302-redirects to the portal HTML shell with a "Грешка при вземане на метаданни за ресурс" flash for **every** file resource — not a CSRF/session issue we can satisfy from the client). `fetchLegacyCsv` now routes through the dataset-level **bulk-zip** export (`/dataset/{uuid}/resources/download/{fmt}` → zip), which is a separate, still-working endpoint; no action needed unless that one breaks too.

### ЦАИС ЕОП full-history gap-fill (one-off)

To capture the ~900 small authorities the OCDS feed omits across the full 2020→ history (not just the rolling incremental window of Step 1b), run the backfill once. It crawls ~1,600 daily flat-`договори` buckets (network-heavy, ~30-60 min; raw days cache to `raw_data/procurement/eop/` so re-runs are fast) and is **flag-gated and operator-run — never in the watcher or CI**:

```bash
npx tsx scripts/procurement/ingest_eop.ts --from 2020-01-01 --to <today> --backfill --apply
npm run procurement:ingest      # rebuild rollups/derived/by-settlement/index from the new shards
```

### 2024/2025 coverage — ЦАИС ЕОП for buyers we already have (one-off)

АОП has no OCDS bundle or annual CSV for 2024/2025, but the ЦАИС ЕОП flat `договори` feed carries both years in full. Step 1b's gap-fill drops those rows because their buyers already exist in our corpus (from other years) — yet with **no OCDS for 2024/2025 there is nothing to double-count**, so the absent-buyer guard is wrong for exactly that window. `--include-existing-buyers` lifts it for a bounded range; all 731 days are already cached, so this runs offline:

```bash
npx tsx scripts/procurement/ingest_eop.ts --from 2024-01-01 --to 2025-12-31 \
  --backfill --include-existing-buyers --apply       # ~82k rows from raw_data/procurement/eop/
npx tsx scripts/procurement/rebuild_from_cache.ts     # offline rebuild — use THIS, not procurement:ingest, while data.egov.bg IP-blocks us
```

**Only ever pass `--include-existing-buyers` for OCDS-gap years.** For 2020–2023 or 2026 it would double-count the whole corpus against the OCDS base.

**Multi-supplier value split.** The flat feed — like the OCDS export — repeats one award's *full* value on every supplier row of a consortium / parallel framework. `normalize.ts` + `normalize_eop.ts` split that value across the suppliers (`amount / N`) so the rows sum back to the award total. Without it, 2024/2025's drug-procurement mega-frameworks alone inflated the corpus headline to €120.6bn (vs €80.0bn split; the 2020–2026 window then matches SIGMA's €51.7bn). Changing that logic needs a full re-normalize — `rebuild_from_cache` reads the already-split shards and won't recompute it.

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

The ingest always runs the officials cross-reference (`pep_connected.json`, from the officials declarations tree); when `data/parliament/companies-index.json` is also present it runs the MP cross-reference too. Together they write these derived files:

| Path | Purpose |
|---|---|
| `data/procurement/derived/mp_connected.json` | One entry per (mpId, contractor) pair: relations (TR roles + declared stakes), total awarded, top awarders, byYear. The journalism payload. |
| `data/procurement/derived/pep_connected.json` (+ `pep-by-eik/`, `pep-by-slug/` shards) | One entry per (official, contractor) pair — the **non-MP** political class (cabinet, deputy ministers, agency heads, governors, mayors, deputy-mayors, council chairs, councillors, chief architects). HIGH-confidence links only. |
| `data/procurement/derived/top_contractors.json` | Top-1000 contractors corpus-wide, each flagged `mpTied: boolean`. Powers the `/procurement` index page. |
| `data/procurement/derived/contractors_search.json` | Slim `{eik,name}` index of **all** ~26k contractors (not just the top-1000), value-ranked. Backs the `/procurement` dashboard's company-name search + the chat `contractSearch` long-tail resolver, which now query Postgres via `/api/db`. Emitted by `writeDerived` via `build_contractors_search.ts` as a **local PG-load source** (not bucket-served — `procurement/` is excluded from `bucket:sync`). |
| `data/procurement/derived/flow.json` | Sankey-shaped money flow (awarder → contractor → **MP or official**), trimmed to the top ~150 links by value — the eager preview the `/procurement` landing tile loads. |
| `data/procurement/derived/flow_full.json` | The complete flow graph (all MP- and official-tied links), lazy-loaded only by the `/procurement/flows` explorer. |

Per-election `by_ns/<election>.json` files also gain officials totals (`officialCount`, `officialConnected*`, de-duplicated `connected*`) and a `topOfficials[]` ranking alongside the existing `topMps[]`. `buildByNs` additionally emits five per-election sidecars from the same date-filtered walk, each the date-scoped sibling of a corpus derived file — so every `/procurement` section page honours the `?pscope` scope toggle (default `ns`, the selected parliament's contract window):

- `by_ns/flow/<election>.json` — date-scoped sankey (awarder → connected company → person), sibling of `derived/flow_full.json`.
- `by_ns/people/<election>.json` — the "public money scanner" index, sibling of `derived/person_procurement_index.json`.
- `by_ns/concentration/<election>.json` — single-supplier concentration table (≥30% of in-range spend, buyer ≥ €100k), sibling of `derived/concentration_full.json`.
- `by_ns/risk_feed/<election>.json` — red-flag feed (top concentration + MP-tied + counts + per-oblast tally), sibling of `derived/risk_feed.json`. (Debarred suppliers stay corpus — a "currently barred" register has no date dimension.)
- `by_ns/by_settlement/<election>.json` — the "procurement by settlement" landing index (local-tier buyers pinned to their seat EKATTE via the awarder-rollup geo join + national rollup), sibling of `by_settlement/index.json`. Only the index is sliced; the per-EKATTE detail drill-down has no scope toggle and stays corpus.

These `by_ns/` sidecars are **gitignored local PG-load sources** — the `/procurement` section pages read the scoped data from Postgres via `/api/db`. They are NOT bucket-synced or gzip-shipped (procurement is served from Cloud SQL; see the Deployment note in Step 1e).

The cross-reference reads `companies[].tr.uic` as the join key. The skill **hard-fails** if `companies-index.json` is present but TR enrichment is missing on >90% of entries — that's the silent "TR refresh wasn't run" failure mode where mp_connected.json would otherwise collapse to empty.

**TR-namesake filter (name-collision guard).** `cross_reference.ts` only keeps an MP↔company link when the relation is a declared stake OR the MP's name maps to a **single** TR company (`buildTrNamesakeCounts(raw_data/tr/state.sqlite)`, the same bar `/update-connections` applies). This drops name-only matches against big state firms (e.g. an MP namesake "directing" Автомагистрали / Български пощи / НЕК) — the inflation that took the headline from 38 MPs / €533M up to a false 55 / €711M. The filter degrades gracefully (keeps all matches, logs a warning) when the TR SQLite is absent, but in that case `companies-index.json`'s `mpRoles` must already be clean — i.e. `/update-connections` ran post-fix. So keep the ordering invariant below. `pep_connected` (officials) is already filtered upstream in `company_links.json` (HIGH-only).

**Offline rebuild.** When data.egov.bg is IP-blocked (the АОП org listing 403s) but the link tables changed, `npx tsx scripts/procurement/rebuild_derived.ts` regenerates every link-dependent derived artifact (pep/mp connected + shards, top_contractors, flow + flow_full, by_ns, by-id, risk_feed, concentration_full, person_procurement_index) from disk — no network, no contract re-parse. It mirrors the no-new-bundles branch of `ingest.ts`. Pass **`--reuse-mp`** to load the existing `mp_connected.json` instead of recomputing it from `companies-index.json` + the TR-namesake filter — use this when only the **officials** side changed, so the published MP figures stay byte-stable (the namesake filter is sensitive to the exact TR snapshot on disk and can otherwise shift the MP headline by a pair or two). With `--reuse-mp` the `index.json` `crossReference` is left untouched; `officialsCrossReference` is still refreshed.

**Legacy "-x" twin guard (de-dup).** An early legacy-CSV ingest emitted blank-document-id rows that took the `documentId || "x"` ocid fallback in `legacy_csv.ts` (e.g. `aop-legacy-2019-x`); a later run re-ingested the same contracts with their real document number, and because `writeMonthShards` merges on `key` (which embeds the document id) the two never collapsed — ~34,091 duplicate pairs across 2016/2017/2019/2021 that double-counted ~€11bn. `dropSyntheticLegacyTwins` (`validate.ts`) drops the `-x` member of any pair sharing (date, awarderEik, contractorEik, amount, title) with a real twin; it is wired into **both** `writeMonthShards` paths (`ingest.ts` + `ingest_legacy.ts`), so every future ingest self-heals — no watcher/process-watch-report change needed. The corpus was cleaned once via `npx tsx scripts/procurement/dedup_legacy_twins.ts` (phase 1 strips `-x` from all shards; phase 2 full offline rebuild — same steps as `ingest.ts` minus the network walk; `--dry-run` to report, `--recompute-mp` to rebuild the MP roster instead of the default reuse-and-refresh). Unlike `rebuild_derived.ts --reuse-mp`, this runner's reuse mode **does** refresh the MP `crossReference` euro totals (contracts changed, so the inflated totals must drop) while keeping the namesake roster byte-stable. This was a one-time cleanup — the guard makes a re-run unnecessary.

If `companies-index.json` is missing entirely, the procurement ingest still completes (raw contracts + rollups land on disk); the cross-reference step logs a skip with a hint to run /update-connections.

**Ordering dependency.** When the orchestrator queues both `/update-connections` and `/update-procurement` from a single watch report, `/update-connections` must run first — it produces `companies-index.json`, which the cross-reference reads. The watcher source list in `scripts/watch/sources/index.ts` already places `cacbgDeclarations` and `egovCommerce` (both → update-connections) before `egovProcurement`, so the natural source-order traversal handles this without explicit dependency declaration. If you reorder the SOURCES list, preserve this invariant.

The `crossReference` field on `data/procurement/index.json` is the at-a-glance MP summary: `{ mpCount, contractorCount, pairCount, byCurrency }`. A sibling `officialsCrossReference` (`{ officialCount, contractorCount, pairCount, totalEur }`, de-duplicated by contractor EIK) carries the same for the non-MP officials; both power the `/procurement` "Свързани лица / Connected people" headline card and the AI `procurementTotals` tool.

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
| `scripts/procurement/derived.ts` | Top-contractors + sankey-flow builders (flow = MP + official terminals; emits the trimmed `flow.json` preview + the full `flow_full.json`) |
| `scripts/procurement/build_contractors_search.ts` | Slim `{eik,name}` company-search index from all `contractors/` shards → `derived/contractors_search.json`. Imported + called by `writeDerived` (every ingest/rebuild incl. the dedup one-offs), or run standalone. |
| `scripts/procurement/pep_connected.ts` | Officials (non-MP) ↔ contractor join + reverse/forward shards |
| `scripts/procurement/rebuild_derived.ts` | Offline rebuild of all link-dependent artifacts (`--reuse-mp` to keep MP figures stable) |
| `scripts/procurement/dedup_legacy_twins.ts` | One-shot: strip synthetic `-x` legacy-twin duplicates from all shards + full offline rebuild (guard now in `writeMonthShards`, so re-run normally unnecessary) |
| `scripts/procurement/validate.ts` | Schema + canary + diff-cap checks |
| `scripts/procurement/eik.ts` | EIK canonicalization helpers (9-digit canonical) |
| `scripts/procurement/types.ts` | Shared Contract / rollup type definitions |
| `scripts/procurement/ingest_eop.ts` | ЦАИС ЕОП flat-`договори` gap-fill CLI (incremental default + `--backfill` one-off) |
| `scripts/procurement/normalize_eop.ts` | Flat `договори` record → `Contract[]` mapper (splits multi-supplier consortia) |
| `scripts/procurement/ingest_tenders.ts` | Tender-STAGE ingest CLI — ЦАИС ЕОП `поръчки` feed → parallel `data/procurement/tenders/` tree (Step 1f; incremental default + `--backfill` one-off; estimated value quarantined) |
| `scripts/procurement/normalize_eop_tender.ts` | Flat `поръчки` records → `Tender[]` (one per УНП, nested lots, ocid lineage); raw shape in `eop_tender_types.ts` |
| `src/lib/tenderTopics.ts` | Shared topic-alias map (slug→regex+CPV set) for the FE tender search + the `openTenders` AI tool — robust phrasing match (e.g. `guardrails` → мантинели) |
| `scripts/procurement/awarder_geo_map.ts` | EKATTE override builder for address-less buyers — combines Tier B (МОН) + E (OCDS party-geo) + D (tenders oblast) + A (name-parse) |
| `scripts/procurement/awarder_geo_merge.ts` | The merge half of the above: carries a prior entry when its tier could not run, drops it only when the tier ran and no longer resolves it. Pure + tested — an unreachable tier must not shrink the committed map |
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
| `data/procurement/derived/mp_connected.json` | One entry per (mpId, contractor) — committed. The **aggregate fallback** only; the candidate page reads the per-MP shard below and pulls this (~70 KB) only when the shard is absent. |
| `data/procurement/derived/per-mp/<mpId>.json` + `per-mp/index.json` | **Data-diet shard + manifest** the `/candidate/:id` procurement tile reads (carries the scorecard rank/cohort). Regenerated **every** ingest by `cross_reference.ts` (write-if-changed), so a normal `bucket:sync` keeps them in step with `mp_connected.json` — see "Per-MP shard invariant" in process-watch-report. Committed. |
| `data/procurement/derived/per-eik/<EIK>.json` + `index.json`, `pep-by-eik/<EIK>.json`, `pep-by-slug/<slug>.json` (+ their `index.json`) | Reverse/forward shards for `/company/:eik` and `/officials/:slug` — also regenerated every ingest by `cross_reference.ts` / `pep_connected.ts`. Committed. |
| `data/procurement/derived/top_contractors.json` | Top-N corpus-wide w/ MP-tied flag — committed |
| `data/procurement/derived/pep_connected.json` | Officials (non-MP) ↔ contractor pairs — committed |
| `data/procurement/derived/flow.json` | Sankey flow (awarder → contractor → MP/official), trimmed top-~150 preview — committed |
| `data/procurement/derived/flow_full.json` | Complete flow graph for the `/procurement/flows` explorer — committed |
| `tests/fixtures/procurement/canary.json` | Pinned regression baseline — committed |
| `raw_data/procurement/<UUID>.json.gz` | Local cache of downloaded bundles — gitignored |

## Quick command reference

```bash
# Daily ingest after watcher flags new bundles
npm run procurement:ingest

# Ingest, publish to Postgres (local + prod), commit
npm run procurement:ingest
npm run db:refresh                  # local PG (Step 2b)
npm run db:load:pg:cloud && npm run db:load:tenders:pg:cloud && npm run db:load:awarder-seats:pg:cloud   # prod Cloud SQL
git add data/procurement/ tests/fixtures/procurement/
git commit -m "procurement: ingest"

# Backfill from a cutoff
npm run procurement:ingest -- --since 2026-01-01

# Process one specific bundle (debug)
npm run procurement:ingest -- --bundle <UUID>

# Dry run (parse, validate, no writes)
npm run procurement:ingest -- --dry-run
```
