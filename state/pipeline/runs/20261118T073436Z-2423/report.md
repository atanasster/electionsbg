# Pipeline ingest run — 20261118T073436Z-2423
Started 2026-11-18T07:34:37.443Z · ended 2026-11-18T08:18:28.033Z · git fcc42d5631 → f07e5d9627

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
| 1 | prices | ok | 12m 20s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | myarea:alerts | ok | 26s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 3 | data:map | ok | 7s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | db:gen-governance-hub-stats | ok | 670ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | db:gen-home-hub-stats | ok | 195ms |  |
| 6 | db:gen-home-flyover | ok | 11s |  |
| 7 | db:gen-home-price-events | ok | 5s |  |
| 8 | db:gen-home-feed | ok | 1s |  |
| 9 | home:health | ok | 524ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:check-generated | ok | 1s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261118T073436Z-2423/010-db_check-generated.log

## Timings vs median
Sum of step durations: 13m 15s over 11 step(s).
- slower than usual: update-prices › prices 12m 20s vs median 7m 09s
- slower than usual: post:myarea-alerts › myarea:alerts 26s vs median 13s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261118T074755Z-ec9b/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261118T073436Z-2423
```
