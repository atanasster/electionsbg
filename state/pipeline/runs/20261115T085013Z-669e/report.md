# Pipeline ingest run — 20261115T085013Z-669e
Started 2026-11-15T08:52:45.617Z · ended 2026-11-15T10:06:25.927Z · git c03db9ec1a → a6fa6af360

## Verdict
**DEGRADED** (exit 0) — 22 unit(s): 11 ok · 1 partial · 0 failed · 2 blocked · 7 needs operator · 1 skipped

## Failures
_(none)_

## Needs operator
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for egov_procurement, eop_procurement, cprs_register, ted_bg, adfi_inspections. Planned steps: pnpm run procurement:ingest-legacy --discover → pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run cprs:ingest --apply --refresh → pnpm run db:load:cprs:pg → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg → pnpm run adfi:ingest --apply → pnpm run db:load:adfi:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### watcher — partial
Why: standing problem(s): parliament_votes not probed 3 runs in a row (wrong exit country — switch the VPN for one run); parliament_mps not probed 3 runs in a row (wrong exit country — switch the VPN for one run); nfc_film_register failing 4 runs in a row; nfc_commissions failing 4 runs in a row; oecd_pit_params failing 4 runs in a row; cik_results not probed 3 runs in a row (wrong exit country — switch the VPN for one run); cik_presidential not probed 3 runs in a row (wrong exit country — switch the VPN for one run)
Summary: 4 blocked, 5 changed, 3 error, 94 skipped, 30 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | watch | ok | 2m 30s |  |

### update-rollcall — blocked
Why: egress:non-bg: exit IP country BG; parliament.bg, МО and ЦИК time out behind a Bulgarian exit
Sources: `parliament_votes`

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 7m 40s |  |
| 3 | tr:daily-refresh › db:pg:up | ok | 676ms |  |
| 4 | tr:daily-refresh › db:load:tr:pg | ok | 3m 25s |  |
| 5 | tr:daily-refresh › db:load:cr-founding:pg | ok | 695ms |  |
| 6 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 1s |  |
| 7 | tr:daily-refresh › db:load:graph:pg | ok | 30s |  |
| 8 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 11s |  |
| 9 | db:load:company-founded:pg | ok | 531ms |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `egov_procurement`, `eop_procurement`, `cprs_register`, `ted_bg`, `adfi_inspections`

### update-budget — needs-operator
Why: Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts.
Sources: `capital_programs`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | fetch_eurostat | ok | 10m 08s |  |
| 11 | fetch_cofog | ok | 4s |  |
| 12 | fetch_eu_peers | ok | 13s |  |
| 13 | fetch_food_pli | ok | 1s |  |
| 14 | admin:build-context | ok | 672ms |  |
| 15 | social:poverty_impact | ok | 737ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-administration — ok · marker stamped
Sources: `iisda_services`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | admin:fetch_egov | ok | 3s |  |
| 17 | admin:fetch_digital_skills | ok | 2s |  |
| 18 | admin:fetch_services | ok | 46s |  |
| 19 | admin:parse_service_quality | ok | 906ms |  |
| 20 | admin:build-context | ok | 469ms |  |
| 21 | db:load:admin-services:pg | ok | 854ms |  |
| 22 | admin:eforms | ok | 4s |  |
| 23 | db:load:admin-service-requests:pg | ok | 659ms |  |
Files changed: `data/administration/context.json`, `data/administration/digital_skills.json`, `data/administration/egov.json`, `data/administration/service_quality.json`, `data/administration/services_catalog.json`, `data/administration/services_overview.json`

### update-defense — needs-operator
Why: pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.
Sources: `mod_defense_report`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — needs-operator
Why: Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.
Sources: `ti_bg_lisi`

### update-prices — blocked
Why: drive:prices: raw_data/prices → /Volumes/Storage/data-bg/raw_data/prices: the link's target is not reachable — mount the external drive
Sources: `kzp_prices`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | council:scrape | ok | 11m 14s |  |
| 25 | db:load:council:pg | ok | 3s |  |
| 26 | council:index_corpus.test | ok | 8s |  |
Files changed: `data/council/index.json`, `state/ingest/council_BGS01.json`, `state/ingest/council_DOB28.json`, `state/ingest/council_GAB05.json`, `state/ingest/council_HKV09.json`, `state/ingest/council_HKV34.json`, `state/ingest/council_PDV01.json`, `state/ingest/council_PER32.json`, `state/ingest/council_PVN01.json`, `state/ingest/council_RAZ26.json`, `state/ingest/council_RSE01.json`, `state/ingest/council_SLV01.json`, `state/ingest/council_SOF.json`, `state/ingest/council_SZR01.json`, `state/ingest/council_VAR01.json`, `state/ingest/council_VTR01.json`

### oecd_family_leave — needs-operator
Why: OECD family-leave table moved: review the simulator anchors and edit the curated constants.
Sources: `oecd_family_leave`

### imf_weo_bg — needs-operator
Why: A new IMF WEO vintage: update the curated forecast rows.
Sources: `imf_weo_bg`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:price-hub-payloads — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | prices:payloads | ok | 2m 22s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | myarea:alerts | ok | 21s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | data:map | ok | 8s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 30 | db:gen-governance-hub-stats | ok | 1s |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:gen-home-hub-stats | ok | 812ms |  |
| 32 | db:gen-home-flyover | ok | 15s |  |
| 33 | db:gen-home-price-events | ok | 4s |  |
| 34 | db:gen-home-feed | ok | 2s |  |
| 35 | home:health | ok | 732ms |  |
Files changed: `data/home/flyover.json`, `data/home/hub_stats.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 36 | db:check-generated | ok | 1s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 37 | db:check-cloud | ok | 2s |  |

## Findings
- previous run 20261112T160550Z-2ef1 died without a report during ingest (step 8 fetch_eurostat); last sign of life 2026-11-12T16:21:38.287Z — its live log is logs/pipeline/20261112T160550Z-2ef1/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- previous run s3 died without a report during starting; last sign of life 2026-11-13T16:13:46.579Z — its live log is logs/pipeline/s3/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- publish prerequisite missing at start: pending-manifest: an unpublished manifest is 51 h old
- watcher: nfc_film_register errored (4 run(s) in a row): HTTP 520 <none>
- watcher: nfc_commissions errored (4 run(s) in a row): HTTP 520 <none>
- watcher: oecd_pit_params errored (4 run(s) in a row): OECD SDMX unreachable after 6 tries: https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_CENT/all?startPeriod=2025&format=jsondata
- watcher: 4 source(s) not probed from exit BG: parliament_votes, parliament_mps, cik_results, cik_presidential
- watcher STANDING: parliament_votes not probed 3 runs in a row (wrong exit country — switch the VPN for one run)
- watcher STANDING: parliament_mps not probed 3 runs in a row (wrong exit country — switch the VPN for one run)
- watcher STANDING: nfc_film_register failing 4 runs in a row
- watcher STANDING: nfc_commissions failing 4 runs in a row
- watcher STANDING: oecd_pit_params failing 4 runs in a row
- watcher STANDING: cik_results not probed 3 runs in a row (wrong exit country — switch the VPN for one run)
- watcher STANDING: cik_presidential not probed 3 runs in a row (wrong exit country — switch the VPN for one run)
- db:check-generated exited 1: it found something — read logs/pipeline/20261115T085013Z-669e/036-db_check-generated.log

## Timings vs median
Sum of step durations: 40m 29s over 37 step(s).
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:graph:pg 30s vs median 17s
- slower than usual: update-macro › fetch_eurostat 10m 08s vs median 14s
- slower than usual: post:myarea-alerts › myarea:alerts 21s vs median 14s
- slower than usual: post:home › db:gen-home-flyover 15s vs median 7s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261115T093049Z-bf67/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261115T085013Z-669e
```
