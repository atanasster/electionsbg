# Pipeline publish run — 20261115T193221Z-4539
Started 2026-11-15T19:32:21.294Z · ended 2026-11-15T19:59:44.599Z · git ca9828df3c → ca9828df3c

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
| 1 | bucket:sync:paths:dry | ok | 3s |  |
| 2 | bucket:sync:paths data_map.json | ok | 2s |  |
| 3 | bucket:sync:paths home | ok | 2s |  |
| 4 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 5 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 6 | bucket:sync:paths home/price_events.json | ok | 2s |  |
| 7 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 8 | bucket:gz | ok | 2m 13s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | prices:ingest:cloud | ok | 24m 25s |  |
| 10 | myarea:alerts:cloud | ok | 30s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | db:check-generated | ok | 771ms |  |
| 12 | db:check-cloud | ok | 912ms |  |

## Findings
- ran under the pipeline lock held by session 20261115T192334Z-16ab

## Timings vs median
Sum of step durations: 27m 23s over 12 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261115T193221Z-4539
```
