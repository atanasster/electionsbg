# Pipeline ingest run — 20261113T071716Z-4a87
Started 2026-11-13T07:17:39.081Z · ended 2026-11-13T07:21:40.584Z · git 30f7100765 → 8cd853137a

## Verdict
**FAILED** (exit 1) — 8 unit(s): 5 ok · 0 partial · 2 failed · 0 blocked · 0 needs operator · 1 skipped

## Failures
- **post:price-hub-payloads › prices:payloads** — error, exit 1 after 1m 33s; class `db-local-down`. Local Postgres is down — `pnpm run db:pg:up`. The step is pinned to the local database, so this dropped connection was the docker Postgres (restarted, OOM-killed, or its container removed) — `docker ps -a | grep electionsbg-pg`.
  First error: `Error: Connection terminated unexpectedly`
  Repair packet: `state/pipeline/runs/20261113T071716Z-4a87/failures/003-prices_payloads.md` · log `logs/pipeline/20261113T071716Z-4a87/003-prices_payloads.log`
- **post:myarea-alerts › myarea:alerts** — error, exit 1 after 21s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `` Error: [alerts] municipal awarders: Postgres unavailable — refusing to rewrite every alerts file without procurement data. Run `pnpm run db:pg:up` (and db:load:awarder-seats:pg), or set ALERTS_ALLOW_EMPTY=1 to accept empty alerts. Cause: the database system is in recovery mode ``
  Repair packet: `state/pipeline/runs/20261113T071716Z-4a87/failures/004-myarea_alerts.md` · log `logs/pipeline/20261113T071716Z-4a87/004-myarea_alerts.log`

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### update-macro — ok · marker stamped
Sources: `bnb_auctions`
Summary: 2 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | fetch_bnb_auctions | ok | 55s |  |
| 2 | fetch_eurostat | ok | 19s |  |
Files changed: `data/debt-emissions-domestic.json`, `data/macro.json`

### post:price-hub-payloads — failed
Why: prices:payloads failed

| # | step | status | time | note |
|---|---|---|---|---|
| 3 | prices:payloads | error | 1m 33s | Error: Connection terminated unexpectedly |

### post:myarea-alerts — failed
Why: myarea:alerts failed

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | myarea:alerts | error | 21s | Error: [alerts] municipal awarders: Postgres unavailable — refusing to rewrite every alerts file without procurement data. Run `pnpm run db:pg:up` (and db:load: |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | data:map | ok | 8s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | db:gen-governance-hub-stats | ok | 4s |  |

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | db:gen-home-hub-stats | ok | 695ms |  |
| 8 | db:gen-home-flyover | ok | 25s |  |
| 9 | db:gen-home-price-events | ok | 4s |  |
| 10 | db:gen-home-feed | ok | 1s |  |
| 11 | home:health | ok | 473ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 12 | db:check-generated | ok | 745ms |  |

### post:check-cloud — skipped

| # | step | status | time | note |
|---|---|---|---|---|
| 13 | db:check-cloud | skipped | 0ms | unmet need(s): proxy |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261113T071716Z-4a87/012-db_check-generated.log

## Timings vs median
Sum of step durations: 3m 52s over 12 step(s).
- slower than usual: update-macro › fetch_eurostat 19s vs median 10s
- slower than usual: post:myarea-alerts › myarea:alerts 21s vs median 14s
- slower than usual: post:home › db:gen-home-flyover 25s vs median 7s

## Publish decision
**HELD**
- held: post-step price-hub-payloads: prices:payloads failed
- held: post-step myarea-alerts: myarea:alerts failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261113T071716Z-4a87/failures/003-prices_payloads.md
# fix, then re-run: see state/pipeline/runs/20261113T071716Z-4a87/failures/004-myarea_alerts.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261113T071716Z-4a87
```
