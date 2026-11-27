# Pipeline ingest run — 20261127T084406Z-3b83
Started 2026-11-27T08:45:56.252Z · ended 2026-11-27T09:31:40.355Z · git 37c26e5428 → e103e52e63

## Verdict
**FAILED** (exit 1) — 14 unit(s): 7 ok · 0 partial · 3 failed · 0 blocked · 2 needs operator · 2 skipped

## Failures
- **update-prices › prices** — error, exit 1 after 1m 57s; class `egress`. A connect timeout — usually the wrong exit country (parliament.bg/МО/ЦИК need non-BG, КЗК/АСП/ГИТ need BG); run `pnpm run pipeline:doctor`.
  First error: `[errors]: [ [Error], [Error], [Error], [Error] ]`
  Repair packet: `state/pipeline/runs/20261127T084406Z-3b83/failures/020-prices.md` · log `logs/pipeline/20261127T084406Z-3b83/020-prices.log`
- **update-prices › prices › via BG proxy** — error, exit 1 after 2m 27s; class `missing-input`. An input file is missing — check the handler's operator step (a manual download?) before re-running.
  First error: `at emitErrorCloseNT (node:internal/streams/destroy:129:3)`
  Repair packet: `state/pipeline/runs/20261127T084406Z-3b83/failures/021-prices_via_BG_proxy.md` · log `logs/pipeline/20261127T084406Z-3b83/021-prices_via_BG_proxy.log`
- **post:data-map › data:map** — error, exit 1 after 1s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `Error [TransformError]: The service was stopped`
  Repair packet: `state/pipeline/runs/20261127T084406Z-3b83/failures/023-data_map.md` · log `logs/pipeline/20261127T084406Z-3b83/023-data_map.log`
- **post:governance-hub-stats › db:gen-governance-hub-stats** — timeout, exit signal after 30m 00s; class `timeout`. The step exceeded its timeout and was killed — check whether it hung (no output for a long stretch) or is just slower than its budget.
  First error: `$ tsx scripts/db/gen_governance/hub_stats.ts`
  Repair packet: `state/pipeline/runs/20261127T084406Z-3b83/failures/024-db_gen-governance-hub-stats.md` · log `logs/pipeline/20261127T084406Z-3b83/024-db_gen-governance-hub-stats.log`

## Needs operator
- **update-polls** (polls-accept-inbox): Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports. Then: `pnpm run pipeline:ack update-polls polls-accept-inbox`
- **update-zdoi** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-zdoi --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-zdoi bootstrap`
- **update-vaccines** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-vaccines --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-vaccines bootstrap`

## Needs agent
- **update-polls** (run-runbook): Run update-polls for polls_market_links, polls_gallup. Planned steps: pnpm exec tsx scripts/polls/backlog.ts → pnpm run polls:fetch → pnpm run polls:extract → pnpm run polls:review --prepare → pnpm run polls:crosscheck → pnpm run polls:analyze → pnpm run polls:analyze --race presidential → pnpm run polls:presidential:coverage. Runbook: `.claude/skills/update-polls/SKILL.md`
- **update-procurement** (run-runbook): Run update-procurement for ted_bg. Planned steps: pnpm run ted:ingest --apply → pnpm run db:load:ted:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### watcher — ok
Summary: 3 changed, 1 error, 132 skipped, 7 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | watch | ok | 1m 28s |  |

### update-polls — skipped
Why: delegated to the update-polls runbook (not yet a script)
Sources: `polls_market_links`, `polls_gallup`

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 9 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 3m 59s |  |
| 3 | tr:daily-refresh › db:pg:up | ok | 658ms |  |
| 4 | tr:daily-refresh › db:load:tr:pg | ok | 2m 59s |  |
| 5 | tr:daily-refresh › db:load:cr-founding:pg | ok | 8s |  |
| 6 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 9s |  |
| 7 | tr:daily-refresh › db:load:graph:pg | ok | 17s |  |
| 8 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 11s |  |
| 9 | tr:daily-refresh › db:load:tr-announced-acts:pg | ok | 23s |  |
| 10 | db:load:company-founded:pg | ok | 1s |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `ted_bg`

### update-zdoi — needs-operator
Why: no marker yet — choose run or seed
Sources: `zdoi_pitay`

### update-administration — ok · marker stamped
Sources: `iisda_services`
Summary: 9 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | admin:fetch_egov | ok | 3s |  |
| 12 | admin:fetch_digital_skills | ok | 2s |  |
| 13 | admin:fetch_services | ok | 1m 18s |  |
| 14 | admin:parse_service_quality | ok | 1s |  |
| 15 | admin:build-context | ok | 578ms |  |
| 16 | db:load:admin-services:pg | ok | 507ms |  |
| 17 | admin:eforms | ok | 2s |  |
| 18 | admin:eforms › via BG proxy | ok | 14s |  |
| 19 | db:load:admin-service-requests:pg | ok | 2s |  |
Warning (admin:eforms): failed direct (unknown: Error: POST listDatasets → 403 Forbidden); succeeded via BG proxy mac:8118
Files changed: `data/administration/context.json`, `data/administration/digital_skills.json`, `data/administration/egov.json`, `data/administration/service_quality.json`, `data/administration/services_catalog.json`, `data/administration/services_overview.json`

### update-vaccines — needs-operator
Why: no marker yet — choose run or seed
Sources: `his_immunizations_daily`, `his_immunization_app`, `ial_shortage_list`, `ncipd_flu_weekly`, `eurostat_vaccine_trade`, `eurostat_flu_coverage`

### update-prices — failed · marker NOT stamped
Why: prices failed
Sources: `kzp_prices`

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | prices | error | 1m 57s | [errors]: [ [Error], [Error], [Error], [Error] ] |
| 21 | prices › via BG proxy | error | 2m 27s | at emitErrorCloseNT (node:internal/streams/destroy:129:3) |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | myarea:alerts | ok | 36s |  |

### post:data-map — failed
Why: data:map failed

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | data:map | error | 1s | Error [TransformError]: The service was stopped |

### post:governance-hub-stats — failed
Why: db:gen-governance-hub-stats failed

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:gen-governance-hub-stats | timeout | 30m 00s | $ tsx scripts/db/gen_governance/hub_stats.ts |

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 25 | db:gen-home-hub-stats | ok | 688ms |  |
| 26 | db:gen-home-flyover | ok | 28s |  |
| 27 | db:gen-home-price-events | ok | 12s |  |
| 28 | db:gen-home-feed | ok | 2s |  |
| 29 | home:health | ok | 780ms |  |
Files changed: `data/home/feed.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 30 | db:check-generated | ok | 2s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:check-cloud | ok | 3s |  |

## Findings
- previous run s3 died without a report during starting; last sign of life 2026-11-13T16:13:46.579Z — its live log is logs/pipeline/s3/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- watcher: his_immunization_app errored (2 run(s) in a row): his_infoapp: Sheet_1 row 111439 has an out-of-range string index null (retried: via BG proxy: his_infoapp: Sheet_1 row 111439 has an out-of-range string index null)
- db:check-generated exited 1: it found something — read logs/pipeline/20261127T084406Z-3b83/030-db_check-generated.log
- post-step(s) owed to the next run: data-map, governance-hub-stats (state/pipeline/owed_post_steps.json)

## Timings vs median
Sum of step durations: 47m 08s over 31 step(s).
- slower than usual: update-administration › admin:fetch_services 1m 18s vs median 46s
- slower than usual: post:myarea-alerts › myarea:alerts 36s vs median 14s
- slower than usual: post:home › db:gen-home-flyover 28s vs median 8s

## Publish decision
**HELD**
- held: update-prices: prices failed
- held: post-step data-map: data:map failed
- held: post-step governance-hub-stats: db:gen-governance-hub-stats failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261127T084406Z-3b83/failures/020-prices.md
# fix, then re-run: see state/pipeline/runs/20261127T084406Z-3b83/failures/021-prices_via_BG_proxy.md
# fix, then re-run: see state/pipeline/runs/20261127T084406Z-3b83/failures/023-data_map.md
# fix, then re-run: see state/pipeline/runs/20261127T084406Z-3b83/failures/024-db_gen-governance-hub-stats.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261127T084406Z-3b83
```
