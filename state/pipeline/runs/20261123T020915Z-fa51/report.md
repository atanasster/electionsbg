# Pipeline publish run — 20261123T020915Z-fa51
Started 2026-11-23T02:09:15.140Z · ended 2026-11-23T02:22:56.190Z · git 46893d5cb9 → 46893d5cb9

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
| 1 | bucket:sync:paths:dry | ok | 6s |  |
| 2 | bucket:sync:paths budget | ok | 4s |  |
| 3 | bucket:sync:paths data_map.json | ok | 3s |  |
| 4 | bucket:sync:paths home | ok | 3s |  |
| 5 | bucket:sync:paths roads/derived/hub_stats.json | ok | 3s |  |
| 6 | bucket:sync:paths transport/derived/hub_stats.json | ok | 3s |  |
| 7 | bucket:sync:paths education/derived/hub_stats.json | ok | 3s |  |
| 8 | bucket:sync:paths health/derived/hub_stats.json | ok | 3s |  |
| 9 | bucket:sync:paths governance/hub_stats.json | ok | 3s |  |
| 10 | bucket:gz | ok | 3m 18s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | db:load:place-dim:pg:cloud | ok | 2s |  |
| 12 | db:load:funds:pg:cloud --full | ok | 1m 06s |  |
| 13 | db:load:funds-fit:pg:cloud | ok | 6s |  |
| 14 | db:load:clean-delivery:pg:cloud | ok | 4s |  |
| 15 | db:load:grant-links:pg:cloud | ok | 11s |  |
| 16 | db:load:persons-browse:pg:cloud | ok | 1m 37s |  |
| 17 | db:load:person-search:pg:cloud | ok | 1m 29s |  |
| 18 | db:load:interreg:pg:cloud | ok | 27s |  |
| 19 | db:load:graph:pg:cloud | ok | 1m 18s |  |
| 20 | db:load:agri-hub-stats:pg:cloud | ok | 1m 01s |  |
| 21 | db:load:tr-company-place:pg:cloud | ok | 35s |  |
| 22 | myarea:alerts:cloud | ok | 48s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | db:check-generated | ok | 2s |  |
| 24 | db:check-cloud | ok | 1m 07s |  |

## Findings
- ran under the pipeline lock held by session 20261123T020043Z-c698

## Timings vs median
Sum of step durations: 13m 41s over 24 step(s).
- slower than usual: bucket › bucket:gz 3m 18s vs median 2m 07s
- slower than usual: cloud › myarea:alerts:cloud 48s vs median 19s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261123T020915Z-fa51
```
