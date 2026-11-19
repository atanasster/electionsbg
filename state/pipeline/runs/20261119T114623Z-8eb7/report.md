# Pipeline publish run — 20261119T114623Z-8eb7
Started 2026-11-19T11:46:23.284Z · ended 2026-11-19T11:57:44.300Z · git 1383c6b2f2 → 1383c6b2f2

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
| 1 | bucket:sync:paths:dry | ok | 11s |  |
| 2 | bucket:sync:paths parliament/votes | ok | 4s |  |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | ok | 3s |  |
| 4 | bucket:sync:paths data_map.json | ok | 3s |  |
| 5 | bucket:sync:paths home | ok | 3s |  |
| 6 | bucket:sync:paths governance/hub_stats.json | ok | 3s |  |
| 7 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 8 | bucket:gz | ok | 3m 12s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | db:load:rollcall:pg:cloud | ok | 3m 22s |  |
| 10 | db:load:rollcall-derived:pg:cloud | ok | 3m 54s |  |
| 11 | myarea:alerts:cloud | ok | 21s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 12 | db:check-generated | ok | 910ms |  |
| 13 | db:check-cloud | ok | 1s |  |

## Findings
_(none)_

## Timings vs median
Sum of step durations: 11m 21s over 13 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261119T114623Z-8eb7
```
