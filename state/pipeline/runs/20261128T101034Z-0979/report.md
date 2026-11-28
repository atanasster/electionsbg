# Pipeline ingest run — 20261128T101034Z-0979
Started 2026-11-28T10:10:37.117Z · ended 2026-11-28T10:12:05.973Z · git cfdcce46c3 → 64f124051f

## Verdict
**DEGRADED** (exit 4) — 7 unit(s): 6 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 1 skipped

## Failures
_(none)_

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### update-vaccines — ok · marker stamped
Sources: `his_immunizations_daily`, `his_immunization_app`, `ial_shortage_list`, `ncipd_flu_weekly`, `eurostat_vaccine_trade`, `eurostat_flu_coverage`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | vaccines:snapshot --only his | ok | 3s |  |
| 2 | vaccines:snapshot --only infoapp | ok | 13s |  |
| 3 | vaccines:snapshot --only sespa | ok | 4s |  |
| 4 | vaccines:snapshot --only ncipd | ok | 3s |  |
| 5 | vaccines:snapshot --only eurostat | ok | 10s |  |
| 6 | db:load:vaccines:pg | ok | 2s |  |
Files changed: `data/health/vaccines/flu_weeks.jsonl`, `data/health/vaccines/his_daily.jsonl`, `data/health/vaccines/shortage_weeks.jsonl`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | myarea:alerts | ok | 34s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | data:map | ok | 5s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | db:gen-governance-hub-stats | ok | 578ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:gen-home-hub-stats | ok | 456ms |  |
| 11 | db:gen-home-flyover | ok | 6s |  |
| 12 | db:gen-home-price-events | ok | 3s |  |
| 13 | db:gen-home-feed | ok | 998ms |  |
| 14 | home:health | ok | 185ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | db:check-generated | ok | 1s |  |

### post:check-cloud — skipped
Why: not run: proxy — owed to the next run

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | db:check-cloud | skipped | 0ms | unmet need(s): proxy |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261128T101034Z-0979/015-db_check-generated.log
- post-step(s) owed to the next run: check-cloud (state/pipeline/owed_post_steps.json)

## Timings vs median
Sum of step durations: 1m 27s over 15 step(s).
- slower than usual: post:myarea-alerts › myarea:alerts 34s vs median 17s

## Publish decision
**HELD**
- held: post-step check-cloud: not run: proxy — owed to the next run

## Next commands
```bash
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261128T101034Z-0979
```
