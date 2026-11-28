# Pipeline ingest run — 20261128T102550Z-5645
Started 2026-11-28T10:25:52.832Z · ended 2026-11-28T12:00:00.288Z · git ea4e164eed → 22c2f9695b

## Verdict
**CLEAN** (exit 0) — 7 unit(s): 7 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
_(none)_

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### update-zdoi — ok · marker stamped
Sources: `zdoi_pitay`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | zdoi:fetch --refresh | ok | 1h 31m 36s |  |
| 2 | db:load:zdoi:pg | ok | 48s |  |
| 3 | zdoi.data.test | ok | 49s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | myarea:alerts | ok | 19s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | data:map | ok | 6s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | db:gen-governance-hub-stats | ok | 691ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | db:gen-home-hub-stats | ok | 437ms |  |
| 8 | db:gen-home-flyover | ok | 10s |  |
| 9 | db:gen-home-price-events | ok | 6s |  |
| 10 | db:gen-home-feed | ok | 3s |  |
| 11 | home:health | ok | 483ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 12 | db:check-generated | ok | 2s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 13 | db:check-cloud | ok | 3s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261128T102550Z-5645/012-db_check-generated.log

## Timings vs median
Sum of step durations: 1h 34m 04s over 13 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:publish
pnpm run pipeline:report --session 20261128T102550Z-5645
```
