# Pipeline publish run — 20261128T120031Z-b5af
Started 2026-11-28T12:00:31.843Z · ended 2026-11-28T12:07:24.733Z · git 569e523657 → 569e523657

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
| 1 | bucket:sync:paths:dry | ok | 5s |  |
| 2 | bucket:sync:paths data_map.json | ok | 4s |  |
| 3 | bucket:sync:paths home | ok | 4s |  |
| 4 | bucket:sync:paths governance/hub_stats.json | ok | 3s |  |
| 5 | bucket:gz | ok | 3m 57s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | db:load:zdoi:pg:cloud | ok | 2m 10s |  |
| 7 | myarea:alerts:cloud | ok | 26s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | db:check-generated | ok | 2s |  |
| 9 | db:check-cloud | ok | 3s |  |

## Findings
_(none)_

## Timings vs median
Sum of step durations: 6m 53s over 9 step(s).
- slower than usual: bucket › bucket:gz 3m 57s vs median 2m 26s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261128T120031Z-b5af
```
