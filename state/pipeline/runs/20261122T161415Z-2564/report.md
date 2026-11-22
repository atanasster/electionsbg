# Pipeline ingest run — 20261122T161415Z-2564
Started 2026-11-22T16:14:15.841Z · ended 2026-11-22T17:28:34.345Z · git 90bd4d8c11 → 56a3d0ca34

## Verdict
**FAILED** (exit 1) — 23 unit(s): 17 ok · 1 partial · 1 failed · 0 blocked · 3 needs operator · 1 skipped

## Failures
- **post:data-map › data:map** — error, exit 1 after 2s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole corpus with no node is a MISSING DATASET, not an UNCLAIMED entry.`
  Repair packet: `state/pipeline/runs/20261122T161415Z-2564/failures/056-data_map.md` · log `logs/pipeline/20261122T161415Z-2564/056-data_map.log`

## Needs operator
- **update-funds** (interreg-crawl): Probe with `pnpm run funds:crawl-interreg --index-only --max-pages 1`; if healthy run `pnpm run funds:crawl-interreg --full` (~2 h), then ack — the ingest and loads run on the next pipeline run. Then: `pnpm run pipeline:ack update-funds interreg-crawl`
- **update-noi** (noi-yearbook-and-kfn): Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`. Then: `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-rollcall** (pin-rollcall-counts): Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output. Runbook: `.claude/skills/update-rollcall/SKILL.md (Step 5c)`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### update-rollcall — ok · marker stamped
Sources: `parliament_votes`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | rollcall:scrape | ok | 2m 28s |  |
| 2 | parliament:bills | ok | 4m 19s |  |
| 3 | db:load:rollcall:pg | ok | 17s |  |
| 4 | db:load:rollcall-derived:pg | ok | 1m 30s |  |
Files changed: `data/parliament/votes/derived/attendance.json`, `data/parliament/votes/derived/cohesion.json`, `data/parliament/votes/derived/dissents.json`, `data/parliament/votes/derived/embedding.json`, `data/parliament/votes/derived/hub_feed/44.json`, `data/parliament/votes/derived/hub_feed/45.json`, `data/parliament/votes/derived/hub_feed/46.json`, `data/parliament/votes/derived/hub_feed/47.json`, `data/parliament/votes/derived/hub_feed/48.json`, `data/parliament/votes/derived/hub_feed/49.json`, `data/parliament/votes/derived/hub_feed/50.json`, `data/parliament/votes/derived/hub_feed/51.json`, `data/parliament/votes/derived/hub_feed/52.json`, `data/parliament/votes/derived/hub_stats.json`, `data/parliament/votes/derived/important_votes/44.json`, `data/parliament/votes/derived/important_votes/45.json`, `data/parliament/votes/derived/important_votes/46.json`, `data/parliament/votes/derived/important_votes/47.json`, `data/parliament/votes/derived/important_votes/48.json`, `data/parliament/votes/derived/important_votes/49.json` … +29

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 8m 51s |  |
| 6 | tr:daily-refresh › db:pg:up | ok | 560ms |  |
| 7 | tr:daily-refresh › db:load:tr:pg | ok | 4m 40s |  |
| 8 | tr:daily-refresh › db:load:cr-founding:pg | ok | 15s |  |
| 9 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 27s |  |
| 10 | tr:daily-refresh › db:load:graph:pg | ok | 22s |  |
| 11 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 10s |  |
| 12 | db:load:company-founded:pg | ok | 493ms |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`

### update-funds — partial · marker NOT stamped
Why: marker not stamped: keep_eu_interreg deferred to an operator item
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `keep_eu_interreg`, `isun_clean_delivery`
Summary: 14 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 13 | funds:ingest | ok | 15s |  |
| 14 | funds:ingest-projects | ok | 1m 51s |  |
| 15 | build_geo_pins | ok | 4s |  |
| 16 | db:load:funds:pg | ok | 1m 20s |  |
| 17 | db:load:grant-links:pg | ok | 2s |  |
| 18 | db:load:funds-fit:pg | ok | 3s |  |
| 19 | funds:parity | ok | 4m 14s |  |
| 20 | funds:clean-delivery | ok | 22s |  |
| 21 | db:load:clean-delivery:pg | ok | 3s |  |
| 22 | db:load:persons-browse:pg | ok | 29s |  |
| 23 | db:load:person-search:pg | ok | 35s |  |
| 24 | db:load:graph:pg | ok | 20s |  |
| 25 | db:load:agri-hub-stats:pg | ok | 24s |  |
| 26 | db:load:tr-company-place:pg | ok | 9s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/BGS01.json`, `data/funds/projects/changes/BGS04.json` … +188

### update-open-calls — ok · marker stamped
Sources: `isun_procedures`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | opencalls:isun | ok | 59s |  |
| 28 | opencalls:az | ok | 21s |  |
| 29 | db:load:open-calls:pg | ok | 692ms |  |
| 30 | open_calls.data.test | ok | 37s |  |
Files changed: `data/opencalls/az.json`, `data/opencalls/isun.json`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | fetch_eurostat | ok | 8s |  |
| 32 | fetch_cofog | ok | 2s |  |
| 33 | fetch_eu_peers | ok | 9s |  |
| 34 | fetch_food_pli | ok | 2s |  |
| 35 | admin:build-context | ok | 587ms |  |
| 36 | social:poverty_impact | ok | 818ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-administration — ok · marker stamped
Sources: `iisda_services`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 37 | admin:fetch_egov | ok | 2s |  |
| 38 | admin:fetch_digital_skills | ok | 2s |  |
| 39 | admin:fetch_services | ok | 46s |  |
| 40 | admin:parse_service_quality | ok | 898ms |  |
| 41 | admin:build-context | ok | 459ms |  |
| 42 | db:load:admin-services:pg | ok | 623ms |  |
| 43 | admin:eforms | ok | 4s |  |
| 44 | db:load:admin-service-requests:pg | ok | 771ms |  |
Files changed: `data/administration/context.json`, `data/administration/digital_skills.json`, `data/administration/egov.json`, `data/administration/service_quality.json`, `data/administration/services_catalog.json`, `data/administration/services_overview.json`

### update-noi — needs-operator
Why: Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`.
Sources: `nssi_yearbook`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 45 | prices | ok | 25m 03s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 46 | council:scrape | ok | 10m 49s |  |
| 47 | db:load:council:pg | ok | 3s |  |
| 48 | council:index_corpus.test | ok | 27s |  |
Files changed: `data/council/index.json`, `state/ingest/council_BGS01.json`, `state/ingest/council_DOB28.json`, `state/ingest/council_GAB05.json`, `state/ingest/council_HKV09.json`, `state/ingest/council_HKV34.json`, `state/ingest/council_PDV01.json`, `state/ingest/council_PER32.json`, `state/ingest/council_PVN01.json`, `state/ingest/council_RAZ26.json`, `state/ingest/council_RSE01.json`, `state/ingest/council_SLV01.json`, `state/ingest/council_SOF.json`, `state/ingest/council_SZR01.json`, `state/ingest/council_SZR12.json`, `state/ingest/council_VAR01.json`, `state/ingest/council_VTR01.json`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 49 | db:gen-roads-hub-stats | ok | 12s |  |

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 50 | db:gen-water-flood | ok | 6s |  |
| 51 | db:gen-water-hub-stats | ok | 2s |  |

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 52 | db:gen-transport-hub-stats | ok | 2s |  |

### post:edu-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 53 | db:gen-edu-hub-stats | ok | 3s |  |
Files changed: `data/education/derived/hub_stats.json`

### post:health-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 54 | db:gen-health-hub-stats | ok | 2s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 55 | myarea:alerts | ok | 14s |  |

### post:data-map — failed
Why: data:map failed

| # | step | status | time | note |
|---|---|---|---|---|
| 56 | data:map | error | 2s | Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 57 | db:gen-governance-hub-stats | ok | 749ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 58 | db:gen-home-hub-stats | ok | 596ms |  |
| 59 | db:gen-home-flyover | ok | 11s |  |
| 60 | db:gen-home-price-events | ok | 4s |  |
| 61 | db:gen-home-feed | ok | 1s |  |
| 62 | home:health | ok | 509ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/hub_stats.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 63 | db:check-generated | ok | 852ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 64 | db:check-cloud | ok | 2s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261122T161415Z-2564/063-db_check-generated.log
- db:check-cloud exited 1: it found something — read logs/pipeline/20261122T161415Z-2564/064-db_check-cloud.log
- post-step(s) owed to the next run: data-map (state/pipeline/owed_post_steps.json)

## Timings vs median
Sum of step durations: 1h 14m 10s over 64 step(s).
- slower than usual: update-funds › funds:ingest-projects 1m 51s vs median 1m 14s
- slower than usual: update-funds › db:load:funds:pg 1m 20s vs median 34s
- slower than usual: update-funds › funds:parity 4m 14s vs median 1m 05s
- slower than usual: update-funds › funds:clean-delivery 22s vs median 13s
- slower than usual: update-funds › db:load:persons-browse:pg 29s vs median 15s
- slower than usual: update-funds › db:load:person-search:pg 35s vs median 20s
- slower than usual: update-open-calls › open_calls.data.test 37s vs median 18s
- slower than usual: update-prices › prices 25m 03s vs median 7m 39s
- slower than usual: update-council-minutes › council:index_corpus.test 27s vs median 10s

## Publish decision
**HELD**
- held: post-step data-map: data:map failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261122T161415Z-2564/failures/056-data_map.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261122T161415Z-2564
```
