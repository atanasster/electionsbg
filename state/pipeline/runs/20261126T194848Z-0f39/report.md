# Pipeline ingest run — 20261126T194848Z-0f39
Started 2026-11-26T20:05:57.492Z · ended 2026-11-26T21:11:42.764Z · git d32c671076 → cdccc22ce7

## Verdict
**DEGRADED** (exit 4) — 33 unit(s): 24 ok · 0 partial · 0 failed · 2 blocked · 2 needs operator · 5 skipped

## Failures
_(none)_

## Needs operator
- **update-polls** (polls-accept-inbox): Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports. Then: `pnpm run pipeline:ack update-polls polls-accept-inbox`
- **update-zdoi** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-zdoi --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-zdoi bootstrap`
- **update-budget** (investment-annex-pdf): Fetch the Приложение III PDF, add it to the SOURCES maps and run scripts/budget/investment_program/__write_program.ts. Then: `pnpm run pipeline:ack update-budget investment-annex-pdf`
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-budget** (revenue-new-year): On a new report year: add the PDF URL to the catalogue and hand-refresh data/budget/agencies/{nap,customs}.json, then db:gen-sector-stats. Then: `pnpm run pipeline:ack update-budget revenue-new-year`
- **update-vaccines** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-vaccines --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-vaccines bootstrap`
- **update-culture** (ncf-grant-results-url): Results on konkursi.ncf.bg are ingested automatically. Only if the post links a класиране PDF instead, add it to NCF_RESULTS in scripts/culture/ncf_grants.ts and re-run pnpm run culture:ncf-grants. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`

## Needs agent
- **update-rollcall** (pin-rollcall-counts): Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output. Runbook: `.claude/skills/update-rollcall/SKILL.md (Step 5c)`
- **update-polls** (run-runbook): Run update-polls for polls_market_links, polls_gallup. Planned steps: pnpm exec tsx scripts/polls/backlog.ts → pnpm run polls:fetch → pnpm run polls:extract → pnpm run polls:review --prepare → pnpm run polls:crosscheck → pnpm run polls:analyze → pnpm run polls:analyze --race presidential → pnpm run polls:presidential:coverage. Runbook: `.claude/skills/update-polls/SKILL.md`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, cprs_register, ted_bg, adfi_inspections. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run cprs:ingest --apply --refresh → pnpm run db:load:cprs:pg → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg → pnpm run adfi:ingest --apply → pnpm run db:load:adfi:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`
- **update-budget** (run-runbook): Run update-budget for ministry_execution_reports, customs_revenue, nap_annual, dv_investment_annex, ipop_mrrb, capital_programs. Planned steps: pnpm run budget:ingest → pnpm run budget:revenue-breakdown → pnpm exec tsx scripts/budget/run_consumption_coicop.ts → pnpm exec tsx scripts/budget/run_policy_baseline.ts → pnpm run ipop:fetch → pnpm exec tsx scripts/budget/ipop/ingest.ts --year 2026 → pnpm run db:load:budget:pg → pnpm run db:load:budget-muni:pg → pnpm run db:load:budget-hub:pg → pnpm run db:load:budget-named:pg → pnpm run budget:dv-decrees → pnpm run db:load:budget-decrees:pg. Runbook: `.claude/skills/update-budget/SKILL.md`
- **update-culture** (run-runbook): Run update-culture for ncf_grant_results. Planned steps: pnpm run culture:ncf-grants → pnpm exec vitest run scripts/culture/ncf_konkursi.test.ts. Runbook: `.claude/skills/update-culture/SKILL.md`

## What ran
### watcher — ok
Summary: 28 changed, 9 error, 1 first-run, 57 skipped, 48 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | watch | ok | 17m 04s |  |

### update-rollcall — ok · marker stamped
Sources: `parliament_votes`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | rollcall:scrape | ok | 4m 50s |  |
| 3 | parliament:bills | ok | 5m 09s |  |
| 4 | db:load:rollcall:pg | ok | 21s |  |
| 5 | db:load:rollcall-derived:pg | ok | 1m 26s |  |
Files changed: `data/parliament/bills/ns52.json`, `data/parliament/votes/derived/attendance.json`, `data/parliament/votes/derived/cohesion.json`, `data/parliament/votes/derived/dissents.json`, `data/parliament/votes/derived/embedding.json`, `data/parliament/votes/derived/hub_feed/44.json`, `data/parliament/votes/derived/hub_feed/45.json`, `data/parliament/votes/derived/hub_feed/46.json`, `data/parliament/votes/derived/hub_feed/47.json`, `data/parliament/votes/derived/hub_feed/48.json`, `data/parliament/votes/derived/hub_feed/49.json`, `data/parliament/votes/derived/hub_feed/50.json`, `data/parliament/votes/derived/hub_feed/51.json`, `data/parliament/votes/derived/hub_feed/52.json`, `data/parliament/votes/derived/hub_stats.json`, `data/parliament/votes/derived/important_votes/44.json`, `data/parliament/votes/derived/important_votes/45.json`, `data/parliament/votes/derived/important_votes/46.json`, `data/parliament/votes/derived/important_votes/47.json`, `data/parliament/votes/derived/important_votes/48.json` … +31

### update-polls — skipped
Why: delegated to the update-polls runbook (not yet a script)
Sources: `polls_market_links`, `polls_gallup`

### update-financing — ok · marker stamped
Sources: `smetna_palata`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | financing:scrape_index | ok | 2s |  |
Files changed: `data/financing/index.json`

### update-persons — ok · marker stamped
Sources: `comdos_ds`
Summary: 21 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | comdos:crawl --refresh | ok | 2m 33s |  |
| 8 | comdos:parse | ok | 4s |  |
| 9 | db:load:place-dim:pg | ok | 1s |  |
| 10 | db:load:judicial-bodies:pg | ok | 949ms |  |
| 11 | db:load:declarations:pg | ok | 16s |  |
| 12 | db:load:employer-links:pg | ok | 11s |  |
| 13 | db:load:tr-name-fold-people:pg | ok | 2s |  |
| 14 | db:load:ds:pg | ok | 2s |  |
| 15 | db:resolve:persons | ok | 2m 28s |  |
| 16 | db:load:declarations:pg --resolve | ok | 53s |  |
| 17 | db:load:company-politicians:pg | ok | 48s |  |
| 18 | db:load:person-elections:pg | ok | 37s |  |
| 19 | db:load:official-candidate-links:pg | ok | 1s |  |
| 20 | db:load:council:pg | ok | 3s |  |
| 21 | db:load:persons-browse:pg | ok | 15s |  |
| 22 | db:load:person-search:pg | ok | 21s |  |
| 23 | db:load:graph:pg | ok | 12s |  |
| 24 | db:load:agri-hub-stats:pg | ok | 22s |  |
| 25 | db:load:tr-company-place:pg | ok | 9s |  |
| 26 | data:local-person-refresh | ok | 29s |  |
| 27 | test:person | ok | 24s |  |
Files changed: `data/comdos/decisions.json`, `data/comdos/persons.jsonl`

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `cprs_register`, `ted_bg`, `adfi_inspections`

### kzk_appeals — ok · marker stamped
Sources: `kzk_appeals`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | kzk_appeals | ok | 36s |  |
| 29 | kzk:gates | ok | 31s |  |
| 30 | kzk:summary | ok | 715ms |  |
Files changed: `data/procurement/derived/kzk_appeals_summary.json`

### update-funds — ok · marker stamped
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `isun_clean_delivery`
Summary: 14 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | funds:ingest | ok | 42s |  |
| 32 | funds:ingest-projects | ok | 3m 15s |  |
| 33 | build_geo_pins | ok | 1s |  |
| 34 | db:load:funds:pg | ok | 20s |  |
| 35 | db:load:grant-links:pg | ok | 2s |  |
| 36 | db:load:funds-fit:pg | ok | 2s |  |
| 37 | funds:parity | ok | 1m 08s |  |
| 38 | funds:clean-delivery | ok | 51s |  |
| 39 | db:load:clean-delivery:pg | ok | 1s |  |
| 40 | db:load:persons-browse:pg | ok | 15s |  |
| 41 | db:load:person-search:pg | ok | 20s |  |
| 42 | db:load:graph:pg | ok | 12s |  |
| 43 | db:load:agri-hub-stats:pg | ok | 18s |  |
| 44 | db:load:tr-company-place:pg | ok | 10s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/BGS01.json`, `data/funds/projects/changes/BGS04.json` … +133

### update-open-calls — ok · marker stamped
Sources: `isun_procedures`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 45 | opencalls:isun | ok | 1m 09s |  |
| 46 | opencalls:az | ok | 24s |  |
| 47 | db:load:open-calls:pg | ok | 1s |  |
| 48 | open_calls.data.test | ok | 1m 18s |  |
Files changed: `data/opencalls/az.json`, `data/opencalls/isun.json`

### update-zdoi — needs-operator
Why: no marker yet — choose run or seed
Sources: `zdoi_pitay`

### update-budget — skipped
Why: delegated to the update-budget runbook (not yet a script)
Sources: `ministry_execution_reports`, `customs_revenue`, `nap_annual`, `dv_investment_annex`, `ipop_mrrb`, `capital_programs`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 49 | fetch_eurostat | ok | 15s |  |
| 50 | fetch_cofog | ok | 9s |  |
| 51 | fetch_eu_peers | ok | 13s |  |
| 52 | fetch_food_pli | ok | 2s |  |
| 53 | admin:build-context | ok | 527ms |  |
| 54 | social:poverty_impact | ok | 925ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-administration — blocked
Why: runs after update-budget, which is delegated to an agent
Sources: `iisda_services`

### update-vaccines — needs-operator
Why: no marker yet — choose run or seed
Sources: `his_immunizations_daily`, `his_immunization_app`, `ial_shortage_list`, `ncipd_flu_weekly`, `eurostat_vaccine_trade`, `eurostat_flu_coverage`

### fiscal_council_bg — ok · marker stamped
Sources: `fiscal_council_bg`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 55 | fiscal-council:triage | ok | 2s |  |

### update-culture — skipped
Why: delegated to the update-culture runbook (not yet a script)
Sources: `ncf_grant_results`

### update-prices — blocked
Why: drive:prices: raw_data/prices → /Volumes/Storage/data-bg/raw_data/prices: the link's target is not reachable — mount the external drive
Sources: `kzp_prices`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 56 | council:scrape | ok | 28m 27s |  |
| 57 | db:load:council:pg | ok | 3s |  |
| 58 | council:index_corpus.test | ok | 27s |  |
Files changed: `data/council/RAZ26/2026/RAZ26-2026-prot40-r588.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r589.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r590.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r591.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r592.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r593.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r594.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r595.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r596.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r597.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r598.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r599.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r600.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r601.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r602.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r603.json`, `data/council/RAZ26/2026/RAZ26-2026-prot40-r604.json`, `data/council/index.json`, `state/ingest/council_BGS01.json`, `state/ingest/council_GAB05.json` … +12

### post:funds-political-links — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 59 | funds:political-links | ok | 11s |  |
Files changed: `data/funds/derived/political_links.json`

### post:procurement-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 60 | db:gen-hub-stats | ok | 25s |  |
Files changed: `data/procurement/derived/hub_stats.json`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 61 | db:gen-roads-hub-stats | ok | 1s |  |
Files changed: `data/roads/derived/hub_stats.json`

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 62 | db:gen-water-flood | ok | 5s |  |
| 63 | db:gen-water-hub-stats | ok | 1s |  |

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 64 | db:gen-transport-hub-stats | ok | 1s |  |
Files changed: `data/transport/derived/hub_stats.json`

### post:edu-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 65 | db:gen-edu-hub-stats | ok | 1s |  |
Files changed: `data/education/derived/hub_stats.json`

### post:health-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 66 | db:gen-health-hub-stats | ok | 992ms |  |
Files changed: `data/health/derived/hub_stats.json`

### post:declarations-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 67 | db:gen-declarations-hub-stats | ok | 1s |  |
Files changed: `data/governance/declarations_hub_stats.json`

### post:price-hub-payloads — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 68 | prices:payloads | ok | 54s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 69 | myarea:alerts | ok | 11s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 70 | data:map | ok | 5s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 71 | db:gen-governance-hub-stats | ok | 604ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 72 | db:gen-home-hub-stats | ok | 197ms |  |
| 73 | db:gen-home-flyover | ok | 6s |  |
| 74 | db:gen-home-price-events | ok | 2s |  |
| 75 | db:gen-home-feed | ok | 1s |  |
| 76 | home:health | ok | 182ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/hub_stats.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 77 | db:check-generated | ok | 2s |  |

### post:check-cloud — skipped
Why: not run: proxy — owed to the next run

| # | step | status | time | note |
|---|---|---|---|---|
| 78 | db:check-cloud | skipped | 0ms | unmet need(s): proxy |

## Findings
- previous run s3 died without a report during starting; last sign of life 2026-11-13T16:13:46.579Z — its live log is logs/pipeline/s3/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- publish prerequisite missing at start: proxy: Cloud SQL proxy is down (nothing listens on 127.0.0.1:5434) — a publish needs `pnpm run db:proxy:cloud`
- watcher: egov_commerce errored (1 run(s) in a row): HTTP 403 Forbidden (retried: via BG proxy: HTTP 403 Forbidden)
- watcher: egov_procurement errored (1 run(s) in a row): HTTP 403 Forbidden (retried: via BG proxy: HTTP 403 Forbidden)
- watcher: mon_ri_register errored (1 run(s) in a row): POST getResourceData → 403 Forbidden (retried: via BG proxy: POST getResourceData → 403 Forbidden)
- watcher: dfz_subsidies errored (1 run(s) in a row): POST listDatasets → 403 Forbidden (retried: via BG proxy: POST listDatasets → 403 Forbidden)
- watcher: egov_budget_execution errored (1 run(s) in a row): HTTP 403 Forbidden (retried: via BG proxy: HTTP 403 Forbidden)
- watcher: egov_municipal_execution errored (1 run(s) in a row): POST listDatasets → 403 Forbidden (retried: via BG proxy: POST listDatasets → 403 Forbidden)
- watcher: indicators_mon_dzi errored (1 run(s) in a row): HTTP 403 Forbidden (retried: via BG proxy: HTTP 403 Forbidden)
- watcher: indicators_mon_nvo errored (1 run(s) in a row): HTTP 403 Forbidden (retried: via BG proxy: HTTP 403 Forbidden)
- watcher: his_immunization_app errored (1 run(s) in a row): his_infoapp: Sheet_1 row 111439 has an out-of-range string index null (retried: via BG proxy: his_infoapp: Sheet_1 row 111439 has an out-of-range string index null)
- db:check-generated exited 1: it found something — read logs/pipeline/20261126T194848Z-0f39/077-db_check-generated.log
- post-step(s) owed to the next run: check-cloud (state/pipeline/owed_post_steps.json)

## Timings vs median
Sum of step durations: 1h 22m 35s over 77 step(s).
- slower than usual: watcher › watch 17m 04s vs median 2m 54s
- slower than usual: update-rollcall › rollcall:scrape 4m 50s vs median 2m 18s
- slower than usual: update-persons › comdos:crawl --refresh 2m 33s vs median 1m 40s
- slower than usual: kzk_appeals › kzk:gates 31s vs median 11s
- slower than usual: update-funds › funds:ingest 42s vs median 17s
- slower than usual: update-funds › funds:ingest-projects 3m 15s vs median 1m 14s
- slower than usual: update-funds › funds:clean-delivery 51s vs median 12s
- slower than usual: update-open-calls › open_calls.data.test 1m 18s vs median 23s
- slower than usual: update-council-minutes › council:scrape 28m 27s vs median 10m 41s
- slower than usual: update-council-minutes › council:index_corpus.test 27s vs median 11s
- slower than usual: post:procurement-hub-stats › db:gen-hub-stats 25s vs median 15s

## Publish decision
**HELD**
- held: post-step check-cloud: not run: proxy — owed to the next run

## Next commands
```bash
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261126T194848Z-0f39
```
