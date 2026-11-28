# Pipeline publish run — 20261128T101829Z-9dd0
Started 2026-11-28T10:18:29.431Z · ended 2026-11-28T10:22:28.514Z · git 0a64afddec → 0a64afddec

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
| 2 | bucket:sync:paths data_map.json | ok | 3s |  |
| 3 | bucket:sync:paths home | ok | 4s |  |
| 4 | bucket:sync:paths governance/hub_stats.json | ok | 3s |  |
| 5 | bucket:gz | ok | 2m 46s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | db:load:place-dim:pg:cloud | ok | 4s |  |
| 7 | db:load:vaccines:pg:cloud | ok | 24s |  |
| 8 | myarea:alerts:cloud | ok | 22s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | db:check-generated | ok | 1s |  |
| 10 | db:check-cloud | ok | 8s |  |

## Findings
_(none)_

## Timings vs median
Sum of step durations: 3m 59s over 10 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261128T101829Z-9dd0
```
