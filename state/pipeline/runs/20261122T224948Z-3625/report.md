# Pipeline publish run — 20261122T224948Z-3625
Started 2026-11-22T22:49:48.659Z · ended 2026-11-22T22:59:21.549Z · git 9d5929442b → 9d5929442b

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
| 2 | bucket:sync:paths data_map.json | ok | 1s |  |
| 3 | bucket:sync:paths home | ok | 2s |  |
| 4 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 5 | bucket:gz | ok | 1m 34s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | db:load:funds:pg:cloud --full | ok | 1m 17s |  |
| 7 | db:load:funds-fit:pg:cloud | ok | 5s |  |
| 8 | db:load:clean-delivery:pg:cloud | ok | 4s |  |
| 9 | db:load:grant-links:pg:cloud | ok | 8s |  |
| 10 | db:load:persons-browse:pg:cloud | ok | 1m 24s |  |
| 11 | db:load:person-search:pg:cloud | ok | 1m 33s |  |
| 12 | db:load:graph:pg:cloud | ok | 1m 25s |  |
| 13 | db:load:agri-hub-stats:pg:cloud | ok | 1m 02s |  |
| 14 | db:load:tr-company-place:pg:cloud | ok | 37s |  |
| 15 | myarea:alerts:cloud | ok | 14s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | db:check-generated | ok | 754ms |  |
| 17 | db:check-cloud | ok | 1s |  |

## Findings
- ran under the pipeline lock held by session 20261122T224518Z-66a2

## Timings vs median
Sum of step durations: 9m 33s over 17 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261122T224948Z-3625
```
