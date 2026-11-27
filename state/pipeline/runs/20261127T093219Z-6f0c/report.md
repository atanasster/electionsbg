# Pipeline ingest run — 20261127T093219Z-6f0c
Started 2026-11-27T09:32:21.656Z · ended 2026-11-27T09:41:05.332Z · git 9f8920227f → 836304e1d8

## Verdict
**CLEAN** (exit 0) — 7 unit(s): 7 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
_(none)_

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | prices | ok | 8m 00s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | myarea:alerts | ok | 17s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 3 | data:map | ok | 6s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | db:gen-governance-hub-stats | ok | 636ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | db:gen-home-hub-stats | ok | 230ms |  |
| 6 | db:gen-home-flyover | ok | 11s |  |
| 7 | db:gen-home-price-events | ok | 2s |  |
| 8 | db:gen-home-feed | ok | 1s |  |
| 9 | home:health | ok | 507ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:check-generated | ok | 1s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | db:check-cloud | ok | 2s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261127T093219Z-6f0c/010-db_check-generated.log

## Timings vs median
Sum of step durations: 8m 42s over 11 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:publish
pnpm run pipeline:report --session 20261127T093219Z-6f0c
```
