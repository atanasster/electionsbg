# Pipeline publish run — 20261116T033610Z-e751
Started 2026-11-16T03:36:10.751Z · ended 2026-11-16T04:07:21.656Z · git bdd02c5b80 → bdd02c5b80

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
| 1 | bucket:sync:paths:dry | ok | 204ms |  |
| 2 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 3 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths culture/derived/hub_stats.json | ok | 2s |  |
| 5 | bucket:sync:paths roads/derived/hub_stats.json | ok | 2s |  |
| 6 | bucket:sync:paths water/flood_maintenance.json | ok | 2s |  |
| 7 | bucket:sync:paths water/derived/hub_stats.json | ok | 2s |  |
| 8 | bucket:sync:paths transport/derived/hub_stats.json | ok | 2s |  |
| 9 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 10 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 11 | bucket:sync:paths home/hub_stats.json | ok | 2s |  |
| 12 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 2s |  |
| 13 | bucket:gz | ok | 2m 22s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 14 | db:load:pg:cloud | ok | 12m 02s |  |
| 15 | db:load:tenders:pg:cloud | ok | 10m 13s |  |
| 16 | db:load:awarder-seats:pg:cloud | ok | 1m 57s |  |
| 17 | proc:verify-seats:cloud | ok | 957ms |  |
| 18 | db:load:annexes:pg:cloud | ok | 20s |  |
| 19 | db:load:water-operator-map:pg:cloud | ok | 1s |  |
| 20 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 21 | db:load:transport-project-map:pg:cloud | ok | 2s |  |
| 22 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 23 | db:load:cprs:pg:cloud --allow-shrink | ok | 5s |  |
| 24 | db:load:ted:pg:cloud | ok | 8s |  |
| 25 | db:load:adfi:pg:cloud | ok | 3s |  |
| 26 | db:load:employer-links:pg:cloud | ok | 36s |  |
| 27 | db:load:grant-links:pg:cloud | ok | 3s |  |
| 28 | db:load:persons-browse:pg:cloud | ok | 1m 13s |  |
| 29 | db:load:graph:pg:cloud | ok | 57s |  |
| 30 | db:load:tr-company-place:pg:cloud | ok | 40s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:check-generated | ok | 907ms |  |
| 32 | db:check-cloud | ok | 2s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run db:load:cprs:pg:cloud --allow-shrink; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:cprs:pg:cloud --allow-shrink → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud

## Timings vs median
Sum of step durations: 31m 11s over 32 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261116T033610Z-e751
```
