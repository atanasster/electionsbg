# Pipeline publish run — 20261124T000351Z-3c5d
Started 2026-11-24T00:03:51.655Z · ended 2026-11-24T00:42:13.635Z · git 1dc4d92d56 → 1dc4d92d56

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
| 1 | bucket:sync:paths:dry | ok | 184ms |  |
| 2 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 3 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths procurement/derived/mp_party.json | ok | 2s |  |
| 5 | bucket:sync:paths data-changes.json | ok | 2s |  |
| 6 | bucket:sync:paths culture/derived/hub_stats.json | ok | 2s |  |
| 7 | bucket:sync:paths roads/derived/hub_stats.json | ok | 1s |  |
| 8 | bucket:sync:paths water/flood_maintenance.json | ok | 2s |  |
| 9 | bucket:sync:paths water/derived/hub_stats.json | ok | 2s |  |
| 10 | bucket:sync:paths transport/derived/hub_stats.json | ok | 1s |  |
| 11 | bucket:sync:paths education/derived/hub_stats.json | ok | 1s |  |
| 12 | bucket:sync:paths health/derived/hub_stats.json | ok | 1s |  |
| 13 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 14 | bucket:sync:paths home/flyover.json | ok | 1s |  |
| 15 | bucket:sync:paths home/hub_stats.json | ok | 1s |  |
| 16 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 1s |  |
| 17 | bucket:sync:paths culture/derived/fund_sources.json | ok | 1s |  |
| 18 | bucket:gz | ok | 1m 41s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:load:pg:cloud | ok | 13m 58s |  |
| 20 | db:load:tenders:pg:cloud | ok | 10m 28s |  |
| 21 | db:load:awarder-seats:pg:cloud | ok | 1m 48s |  |
| 22 | proc:verify-seats:cloud | ok | 973ms |  |
| 23 | db:load:annexes:pg:cloud | ok | 19s |  |
| 24 | db:load:procurement-scopes:pg:cloud | ok | 2m 24s |  |
| 25 | db:load:nzok-hospital-map:pg:cloud | ok | 1s |  |
| 26 | db:load:water-operator-map:pg:cloud | ok | 1s |  |
| 27 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 28 | db:load:transport-project-map:pg:cloud | ok | 2s |  |
| 29 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 30 | db:load:ted:pg:cloud | ok | 8s |  |
| 31 | db:load:employer-links:pg:cloud | ok | 49s |  |
| 32 | db:load:grant-links:pg:cloud | ok | 5s |  |
| 33 | db:load:persons-browse:pg:cloud | ok | 1m 32s |  |
| 34 | db:load:person-search:pg:cloud | ok | 1m 35s |  |
| 35 | db:load:graph:pg:cloud | ok | 1m 00s |  |
| 36 | db:load:agri-hub-stats:pg:cloud | ok | 1m 08s |  |
| 37 | db:load:tr-company-place:pg:cloud | ok | 47s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 38 | db:check-generated | ok | 851ms |  |
| 39 | db:check-cloud | ok | 1s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:ted:pg:cloud; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud

## Timings vs median
Sum of step durations: 38m 22s over 39 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261124T000351Z-3c5d
```
