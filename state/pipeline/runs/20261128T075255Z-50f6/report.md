# Pipeline publish run — 20261128T075255Z-50f6
Started 2026-11-28T07:52:55.505Z · ended 2026-11-28T08:39:20.194Z · git 1fd140d152 → 1fd140d152

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
| 1 | bucket:sync:paths:dry | ok | 189ms |  |
| 2 | bucket:sync:paths procurement/roads.json | ok | 4s |  |
| 3 | bucket:sync:paths procurement/derived/mp_party.json | ok | 2s |  |
| 4 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 5 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 3s |  |
| 6 | bucket:sync:paths culture/derived/hub_stats.json | ok | 3s |  |
| 7 | bucket:sync:paths culture/derived/fund_sources.json | ok | 3s |  |
| 8 | bucket:sync:paths roads/derived/hub_stats.json | ok | 3s |  |
| 9 | bucket:sync:paths water/flood_maintenance.json | ok | 3s |  |
| 10 | bucket:sync:paths water/derived/hub_stats.json | ok | 3s |  |
| 11 | bucket:sync:paths transport/derived/hub_stats.json | ok | 3s |  |
| 12 | bucket:sync:paths education/derived/hub_stats.json | ok | 3s |  |
| 13 | bucket:sync:paths health/derived/hub_stats.json | ok | 3s |  |
| 14 | bucket:sync:paths governance/hub_stats.json | ok | 3s |  |
| 15 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 2s |  |
| 16 | bucket:sync:paths home/flyover.json | ok | 3s |  |
| 17 | bucket:sync:paths home/hub_stats.json | ok | 3s |  |
| 18 | bucket:sync:paths data-changes.json | ok | 3s |  |
| 19 | bucket:gz | ok | 2m 28s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | db:load:pg:cloud | ok | 17m 31s |  |
| 21 | db:load:tenders:pg:cloud | ok | 11m 37s |  |
| 22 | db:load:awarder-seats:pg:cloud | ok | 1m 55s |  |
| 23 | proc:verify-seats:cloud | ok | 2s |  |
| 24 | db:load:annexes:pg:cloud | ok | 25s |  |
| 25 | db:load:procurement-scopes:pg:cloud | ok | 3m 07s |  |
| 26 | db:load:nzok-hospital-map:pg:cloud | ok | 3s |  |
| 27 | db:load:water-operator-map:pg:cloud | ok | 3s |  |
| 28 | db:load:mvr-directorate-map:pg:cloud | ok | 12s |  |
| 29 | db:load:transport-project-map:pg:cloud | ok | 6s |  |
| 30 | db:load:transport-facility-map:pg:cloud | ok | 4s |  |
| 31 | db:load:employer-links:pg:cloud | ok | 37s |  |
| 32 | db:load:grant-links:pg:cloud | ok | 7s |  |
| 33 | db:load:persons-browse:pg:cloud | ok | 2m 14s |  |
| 34 | db:load:person-search:pg:cloud | ok | 1m 48s |  |
| 35 | db:load:graph:pg:cloud | ok | 1m 20s |  |
| 36 | db:load:agri-hub-stats:pg:cloud | ok | 1m 02s |  |
| 37 | db:load:tr-company-place:pg:cloud | ok | 54s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 38 | db:check-generated | ok | 2s |  |
| 39 | db:check-cloud | ok | 2s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud

## Timings vs median
Sum of step durations: 46m 25s over 39 step(s).
- slower than usual: cloud › db:load:persons-browse:pg:cloud 2m 14s vs median 1m 15s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261128T075255Z-50f6
```
