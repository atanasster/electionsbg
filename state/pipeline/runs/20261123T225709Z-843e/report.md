# Pipeline publish run — 20261123T225709Z-843e
Started 2026-11-23T22:57:09.475Z · ended 2026-11-23T23:23:08.794Z · git 6922cce15d → 6922cce15d

## Verdict
**CLEAN** (exit 0) — 3 unit(s): 3 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
_(none)_

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### bucket — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | bucket:sync:paths:dry | ok | 2s |  |
| 2 | bucket:sync:paths data_map.json | ok | 2s |  |
| 3 | bucket:sync:paths home | ok | 2s |  |
| 4 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 5 | bucket:sync:paths home/flyover.json | ok | 1s |  |
| 6 | bucket:sync:paths home/price_events.json | ok | 1s |  |
| 7 | bucket:sync:paths home/feed.json | ok | 1s |  |
| 8 | bucket:gz | ok | 1m 38s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | db:load:open-calls:pg:cloud | ok | 2s |  |
| 10 | prices:ingest:cloud | ok | 23m 52s |  |
| 11 | myarea:alerts:cloud | ok | 14s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 12 | db:check-generated | ok | 863ms |  |
| 13 | db:check-cloud | ok | 983ms |  |

## Findings
- ran under the pipeline lock held by session 20261123T224804Z-8290

## Timings vs median
Sum of step durations: 25m 59s over 13 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261123T225709Z-843e
```
