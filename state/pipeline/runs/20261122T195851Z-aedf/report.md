# Pipeline ingest run — 20261122T195851Z-aedf
Started 2026-11-22T19:58:52.182Z · ended 2026-11-22T20:15:35.325Z · git add29d0ea3 → 103a56a83f

## Verdict
**FAILED** (exit 1) — 19 unit(s): 13 ok · 1 partial · 1 failed · 0 blocked · 3 needs operator · 1 skipped

## Failures
- **post:data-map › data:map** — error, exit 1 after 2s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole corpus with no node is a MISSING DATASET, not an UNCLAIMED entry.`
  Repair packet: `state/pipeline/runs/20261122T195851Z-aedf/failures/045-data_map.md` · log `logs/pipeline/20261122T195851Z-aedf/045-data_map.log`

## Needs operator
- **update-funds** (interreg-crawl): Probe with `pnpm run funds:crawl-interreg --index-only --max-pages 1`; if healthy run `pnpm run funds:crawl-interreg --full` (~2 h), then ack — the ingest and loads run on the next pipeline run. Then: `pnpm run pipeline:ack update-funds interreg-crawl`
- **update-noi** (noi-yearbook-and-kfn): Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`. Then: `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### update-persons — ok · marker stamped
Sources: `comdos_ds`
Summary: 21 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | comdos:crawl --refresh | ok | 1m 40s |  |
| 2 | comdos:parse | ok | 2s |  |
| 3 | db:load:place-dim:pg | ok | 613ms |  |
| 4 | db:load:judicial-bodies:pg | ok | 345ms |  |
| 5 | db:load:declarations:pg | ok | 13s |  |
| 6 | db:load:employer-links:pg | ok | 16s |  |
| 7 | db:load:tr-name-fold-people:pg | ok | 2s |  |
| 8 | db:load:ds:pg | ok | 2s |  |
| 9 | db:resolve:persons | ok | 2m 34s |  |
| 10 | db:load:declarations:pg --resolve | ok | 1m 05s |  |
| 11 | db:load:company-politicians:pg | ok | 1m 00s |  |
| 12 | db:load:person-elections:pg | ok | 39s |  |
| 13 | db:load:official-candidate-links:pg | ok | 1s |  |
| 14 | db:load:council:pg | ok | 3s |  |
| 15 | db:load:persons-browse:pg | ok | 15s |  |
| 16 | db:load:person-search:pg | ok | 21s |  |
| 17 | db:load:graph:pg | ok | 11s |  |
| 18 | db:load:agri-hub-stats:pg | ok | 16s |  |
| 19 | db:load:tr-company-place:pg | ok | 9s |  |
| 20 | data:local-person-refresh | ok | 28s |  |
| 21 | test:person | ok | 32s |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`

### update-funds — partial · marker NOT stamped
Why: marker not stamped: keep_eu_interreg deferred to an operator item
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `keep_eu_interreg`, `isun_clean_delivery`
Summary: 14 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | funds:ingest | ok | 17s |  |
| 23 | funds:ingest-projects | ok | 1m 12s |  |
| 24 | build_geo_pins | ok | 2s |  |
| 25 | db:load:funds:pg | ok | 38s |  |
| 26 | db:load:grant-links:pg | ok | 1s |  |
| 27 | db:load:funds-fit:pg | ok | 2s |  |
| 28 | funds:parity | ok | 2m 08s |  |
| 29 | funds:clean-delivery | ok | 12s |  |
| 30 | db:load:clean-delivery:pg | ok | 1s |  |
| 31 | db:load:persons-browse:pg | ok | 15s |  |
| 32 | db:load:person-search:pg | ok | 21s |  |
| 33 | db:load:graph:pg | ok | 12s |  |
| 34 | db:load:agri-hub-stats:pg | ok | 19s |  |
| 35 | db:load:tr-company-place:pg | ok | 10s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/BGS04.json`, `data/funds/projects/changes/BGS06.json` … +72

### update-noi — needs-operator
Why: Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`.
Sources: `nssi_yearbook`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:funds-political-links — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 36 | funds:political-links | ok | 11s |  |
Files changed: `data/funds/derived/political_links.json`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 37 | db:gen-roads-hub-stats | ok | 2s |  |
Files changed: `data/roads/derived/hub_stats.json`

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 38 | db:gen-water-flood | ok | 5s |  |
| 39 | db:gen-water-hub-stats | ok | 1s |  |
Files changed: `data/water/derived/hub_stats.json`, `data/water/flood_maintenance.json`

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 40 | db:gen-transport-hub-stats | ok | 1s |  |
Files changed: `data/transport/derived/hub_stats.json`

### post:edu-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 41 | db:gen-edu-hub-stats | ok | 1s |  |
Files changed: `data/education/derived/hub_stats.json`

### post:health-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 42 | db:gen-health-hub-stats | ok | 1s |  |
Files changed: `data/health/derived/hub_stats.json`

### post:declarations-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 43 | db:gen-declarations-hub-stats | ok | 722ms |  |
Files changed: `data/governance/declarations_hub_stats.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 44 | myarea:alerts | ok | 11s |  |

### post:data-map — failed
Why: data:map failed

| # | step | status | time | note |
|---|---|---|---|---|
| 45 | data:map | error | 2s | Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 46 | db:gen-governance-hub-stats | ok | 571ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 47 | db:gen-home-hub-stats | ok | 196ms |  |
| 48 | db:gen-home-flyover | ok | 6s |  |
| 49 | db:gen-home-price-events | ok | 7s |  |
| 50 | db:gen-home-feed | ok | 1s |  |
| 51 | home:health | ok | 609ms |  |
Files changed: `data/home/flyover.json`, `data/home/hub_stats.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 52 | db:check-generated | ok | 1s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 53 | db:check-cloud | ok | 2s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261122T195851Z-aedf/052-db_check-generated.log
- post-step(s) owed to the next run: data-map (state/pipeline/owed_post_steps.json)

## Timings vs median
Sum of step durations: 16m 37s over 53 step(s).
- slower than usual: update-persons › db:load:employer-links:pg 16s vs median 9s
- slower than usual: update-funds › funds:parity 2m 08s vs median 1m 17s

## Publish decision
**HELD**
- held: post-step data-map: data:map failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261122T195851Z-aedf/failures/045-data_map.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261122T195851Z-aedf
```
