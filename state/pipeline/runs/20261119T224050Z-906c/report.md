# Pipeline ingest run — 20261119T224050Z-906c
Started 2026-11-19T22:49:20.263Z · ended 2026-11-19T23:41:46.533Z · git dc6caf1e92 → b8424ffe1f

## Verdict
**FAILED** (exit 1) — 33 unit(s): 22 ok · 2 partial · 1 failed · 1 blocked · 3 needs operator · 4 skipped

## Failures
- **ec_forecast_bg › check_policy_anchors** — error, exit 1 after 1s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `1 anchor(s) drifted or failed to probe — manual edit required (see lines above), then re-run with --stamp.`
  Repair packet: `state/pipeline/runs/20261119T224050Z-906c/failures/036-check_policy_anchors.md` · log `logs/pipeline/20261119T224050Z-906c/036-check_policy_anchors.log`

## Needs operator
- **update-polls** (polls-accept-inbox): Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports. Then: `pnpm run pipeline:ack update-polls polls-accept-inbox`
- **update-funds** (interreg-crawl): Probe with `pnpm run funds:crawl-interreg --index-only --max-pages 1`; if healthy run `pnpm run funds:crawl-interreg --full` (~2 h), then ack — the ingest and loads run on the next pipeline run. Then: `pnpm run pipeline:ack update-funds interreg-crawl`
- **update-budget** (revenue-new-year): On a new report year: add the PDF URL to the catalogue and hand-refresh data/budget/agencies/{nap,customs}.json, then db:gen-sector-stats. Then: `pnpm run pipeline:ack update-budget revenue-new-year`
- **update-noi** (noi-yearbook-and-kfn): Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`. Then: `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-rollcall** (pin-rollcall-counts): Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output. Runbook: `.claude/skills/update-rollcall/SKILL.md (Step 5c)`
- **update-polls** (run-runbook): Run update-polls for polls_alpha_research. Planned steps: pnpm exec tsx scripts/polls/backlog.ts → pnpm run polls:fetch → pnpm run polls:extract → pnpm run polls:review --prepare → pnpm run polls:crosscheck → pnpm run polls:analyze → pnpm run polls:analyze --race presidential → pnpm run polls:presidential:coverage. Runbook: `.claude/skills/update-polls/SKILL.md`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg, adfi_inspections. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg → pnpm run adfi:ingest --apply → pnpm run db:load:adfi:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`
- **update-budget** (run-runbook): Run update-budget for ministry_execution_reports, customs_revenue, capital_programs, egov_municipal_execution. Planned steps: pnpm run budget:ingest → pnpm run budget:revenue-breakdown → pnpm exec tsx scripts/budget/run_consumption_coicop.ts → pnpm exec tsx scripts/budget/run_policy_baseline.ts → pnpm exec tsx scripts/budget/municipal_execution/ingest.ts --all → pnpm run db:load:budget:pg → pnpm run db:load:budget-muni:pg → pnpm run db:load:budget-hub:pg. Runbook: `.claude/skills/update-budget/SKILL.md`
- **update-transparency-lisi** (run-runbook): Run update-transparency-lisi for ti_bg_lisi. Planned steps: pnpm exec tsx scripts/transparency/build_lisi.ts. Runbook: `.claude/skills/update-transparency-lisi/SKILL.md`

## What ran
### watcher — partial
Why: standing problem(s): nfc_film_register failing 10 runs in a row; nfc_commissions failing 10 runs in a row; oecd_pit_params failing 10 runs in a row
Summary: 23 changed, 5 error, 50 skipped, 58 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | watch | ok | 8m 12s |  |

### update-rollcall — ok · marker stamped
Sources: `parliament_votes`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | rollcall:scrape | ok | 2m 46s |  |
| 3 | parliament:bills | ok | 4m 23s |  |
| 4 | db:load:rollcall:pg | ok | 25s |  |
| 5 | db:load:rollcall-derived:pg | ok | 3m 52s |  |
Files changed: `data/parliament/bills/ns52.json`, `data/parliament/votes/derived/attendance.json`, `data/parliament/votes/derived/cohesion.json`, `data/parliament/votes/derived/dissents.json`, `data/parliament/votes/derived/embedding.json`, `data/parliament/votes/derived/hub_feed/44.json`, `data/parliament/votes/derived/hub_feed/45.json`, `data/parliament/votes/derived/hub_feed/46.json`, `data/parliament/votes/derived/hub_feed/47.json`, `data/parliament/votes/derived/hub_feed/48.json`, `data/parliament/votes/derived/hub_feed/49.json`, `data/parliament/votes/derived/hub_feed/50.json`, `data/parliament/votes/derived/hub_feed/51.json`, `data/parliament/votes/derived/hub_feed/52.json`, `data/parliament/votes/derived/hub_stats.json`, `data/parliament/votes/derived/important_votes/44.json`, `data/parliament/votes/derived/important_votes/45.json`, `data/parliament/votes/derived/important_votes/46.json`, `data/parliament/votes/derived/important_votes/47.json`, `data/parliament/votes/derived/important_votes/48.json` … +29

### update-polls — skipped
Why: delegated to the update-polls runbook (not yet a script)
Sources: `polls_alpha_research`

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 7m 40s |  |
| 7 | tr:daily-refresh › db:pg:up | ok | 574ms |  |
| 8 | tr:daily-refresh › db:load:tr:pg | ok | 5m 01s |  |
| 9 | tr:daily-refresh › db:load:cr-founding:pg | ok | 909ms |  |
| 10 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 1s |  |
| 11 | tr:daily-refresh › db:load:graph:pg | ok | 29s |  |
| 12 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 20s |  |
| 13 | db:load:company-founded:pg | ok | 717ms |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`, `adfi_inspections`

### kzk_appeals — ok · marker stamped
Sources: `kzk_appeals`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 14 | kzk_appeals | ok | 38s |  |
| 15 | kzk:gates | ok | 14s |  |
| 16 | kzk:summary | ok | 800ms |  |
Files changed: `data/procurement/derived/kzk_appeals_summary.json`

### kzk_decisions — ok · marker stamped
Sources: `kzk_decisions`
Summary: 5 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 17 | kzk:decisions | ok | 16s |  |
| 18 | db:load:kzk-decisions:pg | ok | 1s |  |
| 19 | kzk:rejoin | ok | 42s |  |
| 20 | kzk:gates | ok | 11s |  |
| 21 | kzk:summary | ok | 769ms |  |
Files changed: `data/procurement/derived/kzk_appeals_summary.json`, `data/procurement/derived/kzk_baselines.json`

### update-funds — partial · marker NOT stamped
Why: marker not stamped: keep_eu_interreg deferred to an operator item
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `keep_eu_interreg`, `isun_clean_delivery`
Summary: 14 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | funds:ingest | ok | 20s |  |
| 23 | funds:ingest-projects | ok | 1m 12s |  |
| 24 | build_geo_pins | ok | 1s |  |
| 25 | db:load:funds:pg | ok | 19s |  |
| 26 | db:load:grant-links:pg | ok | 1s |  |
| 27 | db:load:funds-fit:pg | ok | 1s |  |
| 28 | funds:parity | ok | 54s |  |
| 29 | funds:clean-delivery | ok | 14s |  |
| 30 | db:load:clean-delivery:pg | ok | 1s |  |
| 31 | db:load:persons-browse:pg | ok | 15s |  |
| 32 | db:load:person-search:pg | ok | 21s |  |
| 33 | db:load:graph:pg | ok | 11s |  |
| 34 | db:load:agri-hub-stats:pg | ok | 19s |  |
| 35 | db:load:tr-company-place:pg | ok | 13s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/BGS01.json`, `data/funds/projects/changes/BGS04.json` … +222

### update-budget — skipped
Why: delegated to the update-budget runbook (not yet a script)
Sources: `ministry_execution_reports`, `customs_revenue`, `capital_programs`, `egov_municipal_execution`

### ec_forecast_bg — failed · marker NOT stamped
Why: check_policy_anchors failed
Sources: `ec_forecast_bg`

| # | step | status | time | note |
|---|---|---|---|---|
| 36 | check_policy_anchors | error | 1s | 1 anchor(s) drifted or failed to probe — manual edit required (see lines above), then re-run with --stamp. |

### update-macro — ok · marker stamped
Sources: `eurostat`, `eurobarometer`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 37 | fetch_eurostat | ok | 1m 19s |  |
| 38 | fetch_cofog | ok | 3s |  |
| 39 | fetch_eu_peers | ok | 29s |  |
| 40 | fetch_food_pli | ok | 1s |  |
| 41 | admin:build-context | ok | 480ms |  |
| 42 | social:poverty_impact | ok | 588ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-administration — blocked
Why: runs after update-budget, which is delegated to an agent
Sources: `iisda_services`

### update-noi — needs-operator
Why: Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`.
Sources: `nssi_yearbook`

### update-financing — ok · marker stamped
Sources: `smetna_palata`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 43 | financing:scrape_index | ok | 883ms |  |
Files changed: `data/financing/index.json`

### update-defense — ok · marker stamped
Sources: `mod_defense_report`
Summary: 0 step(s) ok

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — skipped
Why: delegated to the update-transparency-lisi runbook (not yet a script)
Sources: `ti_bg_lisi`

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 44 | prices | ok | 6m 41s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 45 | council:scrape | ok | 10m 24s |  |
| 46 | db:load:council:pg | ok | 5s |  |
| 47 | council:index_corpus.test | ok | 13s |  |
Files changed: `data/council/GAB05/2026/GAB05-2026-prot9-r109.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r110.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r111.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r112.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r113.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r114.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r115.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r118.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r119.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r120.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r121.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r122.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r123.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r124.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r125.json`, `data/council/GAB05/2026/GAB05-2026-prot9-r126.json`, `data/council/SLV01/2026/SLV01-2026-prot20261112-r1360.json`, `data/council/SLV01/2026/SLV01-2026-prot20261112-r1361.json`, `data/council/SLV01/2026/SLV01-2026-prot20261112-r1362.json`, `data/council/SLV01/2026/SLV01-2026-prot20261112-r1363.json` … +74

### eurostat_tourism — ok · marker stamped
Sources: `eurostat_tourism`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 48 | eurostat_tourism | ok | 3s |  |
Files changed: `data/tourism/visitors.json`

### oecd_family_leave — ok · marker stamped
Sources: `oecd_family_leave`
Summary: 0 step(s) ok

### imf_weo_bg — ok · marker stamped
Sources: `imf_weo_bg`
Summary: 0 step(s) ok

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:procurement-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 49 | db:gen-hub-stats | ok | 21s |  |
Files changed: `data/procurement/derived/hub_stats.json`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 50 | db:gen-roads-hub-stats | ok | 1s |  |
Files changed: `data/roads/derived/hub_stats.json`

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 51 | db:gen-water-flood | ok | 6s |  |
| 52 | db:gen-water-hub-stats | ok | 2s |  |
Files changed: `data/water/derived/hub_stats.json`

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 53 | db:gen-transport-hub-stats | ok | 2s |  |
Files changed: `data/transport/derived/hub_stats.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 54 | myarea:alerts | ok | 17s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 55 | data:map | ok | 7s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 56 | db:gen-governance-hub-stats | ok | 907ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 57 | db:gen-home-hub-stats | ok | 704ms |  |
| 58 | db:gen-home-flyover | ok | 11s |  |
| 59 | db:gen-home-price-events | ok | 12s |  |
| 60 | db:gen-home-feed | ok | 1s |  |
| 61 | home:health | ok | 487ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/hub_stats.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 62 | db:check-generated | ok | 911ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 63 | db:check-cloud | ok | 1s |  |

## Findings
- previous run 20261112T160550Z-2ef1 died without a report during ingest (step 8 fetch_eurostat); last sign of life 2026-11-12T16:21:38.287Z — its live log is logs/pipeline/20261112T160550Z-2ef1/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- previous run s3 died without a report during starting; last sign of life 2026-11-13T16:13:46.579Z — its live log is logs/pipeline/s3/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- watcher: ofac_sanctions errored (1 run(s) in a row): The operation was aborted due to timeout
- watcher: nfc_film_register errored (10 run(s) in a row): HTTP 520 <none>
- watcher: nfc_commissions errored (10 run(s) in a row): HTTP 520 <none>
- watcher: oecd_pit_params errored (10 run(s) in a row): OECD SDMX unreachable after 6 tries: https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_CENT/all?startPeriod=2025&format=jsondata
- watcher: minfin_program_otchet errored (2 run(s) in a row): The operation was aborted due to timeout
- watcher STANDING: nfc_film_register failing 10 runs in a row
- watcher STANDING: nfc_commissions failing 10 runs in a row
- watcher STANDING: oecd_pit_params failing 10 runs in a row
- db:check-generated exited 1: it found something — read logs/pipeline/20261119T224050Z-906c/062-db_check-generated.log

## Timings vs median
Sum of step durations: 1h 00m 22s over 63 step(s).
- slower than usual: watcher › watch 8m 12s vs median 2m 30s
- slower than usual: update-rollcall › db:load:rollcall-derived:pg 3m 52s vs median 1m 40s
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:tr:pg 5m 01s vs median 2m 53s
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:tr-company-place:pg 20s vs median 11s
- slower than usual: kzk_appeals › kzk_appeals 38s vs median 25s
- slower than usual: kzk_decisions › kzk:decisions 16s vs median 10s
- slower than usual: update-funds › funds:clean-delivery 14s vs median 7s
- slower than usual: update-macro › fetch_eurostat 1m 19s vs median 19s

## Publish decision
**HELD**
- held: ec_forecast_bg: check_policy_anchors failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261119T224050Z-906c/failures/036-check_policy_anchors.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261119T224050Z-906c
```
