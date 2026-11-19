# Pipeline publish run — 20261119T013451Z-261e
Started 2026-11-19T01:34:51.850Z · ended 2026-11-19T02:09:52.304Z · git 66887d0c99 → 66887d0c99

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
| 2 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 3 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths roads/derived/hub_stats.json | ok | 2s |  |
| 5 | bucket:sync:paths water/derived/hub_stats.json | ok | 2s |  |
| 6 | bucket:sync:paths water/flood_maintenance.json | ok | 2s |  |
| 7 | bucket:sync:paths transport/derived/hub_stats.json | ok | 2s |  |
| 8 | bucket:sync:paths culture/derived | ok | 2s |  |
| 9 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 10 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 2s |  |
| 11 | bucket:sync:paths home | ok | 2s |  |
| 12 | bucket:sync:paths energy | ok | 2s |  |
| 13 | bucket:sync:paths data-changes.json | ok | 2s |  |
| 14 | bucket:sync:paths data_map.json | ok | 2s |  |
| 15 | bucket:sync:paths culture/derived/hub_stats.json | ok | 2s |  |
| 16 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 17 | bucket:sync:paths home/hub_stats.json | ok | 2s |  |
| 18 | bucket:gz | ok | 2m 22s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:load:pg:cloud | ok | 12m 02s |  |
| 20 | db:load:tenders:pg:cloud | ok | 10m 43s |  |
| 21 | db:load:awarder-seats:pg:cloud | ok | 2m 19s |  |
| 22 | proc:verify-seats:cloud | ok | 1s |  |
| 23 | db:load:annexes:pg:cloud | ok | 16s |  |
| 24 | db:load:procurement-scopes:pg:cloud | ok | 2m 27s |  |
| 25 | db:load:water-operator-map:pg:cloud | ok | 2s |  |
| 26 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 27 | db:load:transport-project-map:pg:cloud | ok | 3s |  |
| 28 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 29 | db:load:employer-links:pg:cloud | ok | 37s |  |
| 30 | db:load:grant-links:pg:cloud | ok | 4s |  |
| 31 | db:load:persons-browse:pg:cloud | ok | 1m 23s |  |
| 32 | db:load:graph:pg:cloud | ok | 1m 02s |  |
| 33 | db:load:tr-company-place:pg:cloud | ok | 37s |  |
| 34 | myarea:alerts:cloud | ok | 20s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 35 | db:check-generated | ok | 1s |  |
| 36 | db:check-cloud | ok | 2s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run myarea:alerts:cloud; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 35m 00s over 36 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261119T013451Z-261e
```
