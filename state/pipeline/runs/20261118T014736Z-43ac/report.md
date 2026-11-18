# Pipeline publish run — 20261118T014736Z-43ac
Started 2026-11-18T01:47:36.340Z · ended 2026-11-18T02:20:13.852Z · git cee84a04f8 → cee84a04f8

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
| 1 | bucket:sync:paths:dry | ok | 234ms |  |
| 2 | bucket:sync:paths procurement/roads.json | ok | 3s |  |
| 3 | bucket:sync:paths procurement/derived/mp_party.json | ok | 2s |  |
| 4 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 5 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 6 | bucket:sync:paths culture/derived/hub_stats.json | ok | 2s |  |
| 7 | bucket:sync:paths culture/derived/fund_sources.json | ok | 2s |  |
| 8 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 9 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 1s |  |
| 10 | bucket:sync:paths home/hub_stats.json | ok | 1s |  |
| 11 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 12 | bucket:sync:paths roads/derived/hub_stats.json | ok | 1s |  |
| 13 | bucket:sync:paths transport/derived/hub_stats.json | ok | 1s |  |
| 14 | bucket:sync:paths water/derived/hub_stats.json | ok | 2s |  |
| 15 | bucket:sync:paths water/flood_maintenance.json | ok | 2s |  |
| 16 | bucket:sync:paths data-changes.json | ok | 2s |  |
| 17 | bucket:gz | ok | 1m 49s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | db:load:pg:cloud | ok | 11m 08s |  |
| 19 | db:load:tenders:pg:cloud | ok | 9m 20s |  |
| 20 | db:load:awarder-seats:pg:cloud | ok | 1m 35s |  |
| 21 | proc:verify-seats:cloud | ok | 984ms |  |
| 22 | db:load:annexes:pg:cloud | ok | 20s |  |
| 23 | db:load:procurement-scopes:pg:cloud | ok | 2m 26s |  |
| 24 | db:load:nzok-hospital-map:pg:cloud | ok | 1s |  |
| 25 | db:load:water-operator-map:pg:cloud | ok | 1s |  |
| 26 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 27 | db:load:transport-project-map:pg:cloud | ok | 2s |  |
| 28 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 29 | db:load:ted:pg:cloud | ok | 8s |  |
| 30 | db:load:employer-links:pg:cloud | ok | 32s |  |
| 31 | db:load:grant-links:pg:cloud | ok | 3s |  |
| 32 | db:load:persons-browse:pg:cloud | ok | 1m 06s |  |
| 33 | db:load:person-search:pg:cloud | ok | 1m 16s |  |
| 34 | db:load:graph:pg:cloud | ok | 47s |  |
| 35 | db:load:agri-hub-stats:pg:cloud | ok | 55s |  |
| 36 | db:load:tr-company-place:pg:cloud | ok | 34s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 37 | db:check-generated | ok | 873ms |  |
| 38 | db:check-cloud | ok | 958ms |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:ted:pg:cloud; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud

## Timings vs median
Sum of step durations: 32m 37s over 38 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261118T014736Z-43ac
```
