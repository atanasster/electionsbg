# Pipeline publish run — 20261117T003547Z-d415
Started 2026-11-17T00:35:47.311Z · ended 2026-11-17T01:07:53.819Z · git e30abce636 → e30abce636

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
| 1 | bucket:sync:paths:dry | ok | 175ms |  |
| 2 | bucket:sync:paths procurement/roads.json | ok | 2s |  |
| 3 | bucket:sync:paths procurement/derived/mp_party.json | ok | 1s |  |
| 4 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 1s |  |
| 5 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 6 | bucket:sync:paths culture/derived/hub_stats.json | ok | 1s |  |
| 7 | bucket:sync:paths roads/derived/hub_stats.json | ok | 2s |  |
| 8 | bucket:sync:paths water/derived/hub_stats.json | ok | 1s |  |
| 9 | bucket:sync:paths transport/derived/hub_stats.json | ok | 1s |  |
| 10 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 11 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 12 | bucket:sync:paths home/hub_stats.json | ok | 1s |  |
| 13 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 1s |  |
| 14 | bucket:gz | ok | 1m 43s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | db:load:pg:cloud | ok | 10m 44s |  |
| 16 | db:load:tenders:pg:cloud | ok | 9m 16s |  |
| 17 | db:load:awarder-seats:pg:cloud | ok | 1m 43s |  |
| 18 | proc:verify-seats:cloud | ok | 1s |  |
| 19 | db:load:annexes:pg:cloud | ok | 15s |  |
| 20 | db:load:procurement-scopes:pg:cloud | ok | 2m 16s |  |
| 21 | db:load:nzok-hospital-map:pg:cloud | ok | 2s |  |
| 22 | db:load:water-operator-map:pg:cloud | ok | 1s |  |
| 23 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 24 | db:load:transport-project-map:pg:cloud | ok | 3s |  |
| 25 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 26 | db:load:ted:pg:cloud | ok | 9s |  |
| 27 | db:load:employer-links:pg:cloud | ok | 33s |  |
| 28 | db:load:grant-links:pg:cloud | ok | 4s |  |
| 29 | db:load:persons-browse:pg:cloud | ok | 1m 16s |  |
| 30 | db:load:person-search:pg:cloud | ok | 1m 18s |  |
| 31 | db:load:graph:pg:cloud | ok | 49s |  |
| 32 | db:load:agri-hub-stats:pg:cloud | ok | 54s |  |
| 33 | db:load:tr-company-place:pg:cloud | ok | 34s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 34 | db:check-generated | ok | 955ms |  |
| 35 | db:check-cloud | ok | 1s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:ted:pg:cloud; run as pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud
- db:check-generated exited 1: it found something — read logs/pipeline/20261117T003547Z-d415/034-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 32m 06s over 35 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261117T003547Z-d415
```
