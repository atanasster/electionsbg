# Pipeline publish run — 20261122T210256Z-b7d4
Started 2026-11-22T21:02:56.128Z · ended 2026-11-22T22:34:33.373Z · git 844c114aff → 844c114aff

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
| 1 | bucket:sync:paths:dry | ok | 4s |  |
| 2 | bucket:sync:paths parliament/votes | ok | 2s |  |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | ok | 1s |  |
| 4 | bucket:sync:paths macro.json | ok | 1s |  |
| 5 | bucket:sync:paths macro_fdi.json | ok | 2s |  |
| 6 | bucket:sync:paths macro_peers.json | ok | 1s |  |
| 7 | bucket:sync:paths cofog.json | ok | 1s |  |
| 8 | bucket:sync:paths debt-emissions.json | ok | 1s |  |
| 9 | bucket:sync:paths debt-emissions-domestic.json | ok | 1s |  |
| 10 | bucket:sync:paths administration | ok | 2s |  |
| 11 | bucket:sync:paths social/poverty_impact.json | ok | 1s |  |
| 12 | bucket:sync:paths home | ok | 2s |  |
| 13 | bucket:sync:paths education/derived/hub_stats.json | ok | 1s |  |
| 14 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 15 | bucket:sync:paths home/flyover.json | ok | 1s |  |
| 16 | bucket:sync:paths home/hub_stats.json | ok | 1s |  |
| 17 | bucket:sync:paths home/price_events.json | ok | 1s |  |
| 18 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 19 | bucket:sync:paths roads/derived/hub_stats.json | ok | 1s |  |
| 20 | bucket:sync:paths water/flood_maintenance.json | ok | 2s |  |
| 21 | bucket:sync:paths water/derived/hub_stats.json | ok | 1s |  |
| 22 | bucket:sync:paths transport/derived/hub_stats.json | ok | 1s |  |
| 23 | bucket:sync:paths health/derived/hub_stats.json | ok | 1s |  |
| 24 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 1s |  |
| 25 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 1s |  |
| 26 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 1s |  |
| 27 | bucket:sync:paths culture/derived/hub_stats.json | ok | 1s |  |
| 28 | bucket:sync:paths data-changes.json | ok | 1s |  |
| 29 | bucket:gz | ok | 1m 37s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 30 | db:load:place-dim:pg:cloud | ok | 2s |  |
| 31 | db:load:tenders:pg:cloud | ok | 12m 02s |  |
| 32 | db:load:annexes:pg:cloud | ok | 16s |  |
| 33 | db:load:ted:pg:cloud | ok | 12s |  |
| 34 | db:load:funds:pg:cloud --full | ok | 1m 05s |  |
| 35 | db:load:funds-fit:pg:cloud | ok | 6s |  |
| 36 | db:load:clean-delivery:pg:cloud | ok | 5s |  |
| 37 | db:load:admin-services:pg:cloud | ok | 2s |  |
| 38 | db:load:admin-service-requests:pg:cloud | ok | 2s |  |
| 39 | db:load:open-calls:pg:cloud | ok | 2s |  |
| 40 | db:load:rollcall:pg:cloud | ok | 2m 57s |  |
| 41 | db:load:rollcall-derived:pg:cloud | ok | 3m 39s |  |
| 42 | db:load:judicial-bodies:pg:cloud | ok | 2s |  |
| 43 | db:load:tr:pg:cloud | ok | 12m 24s |  |
| 44 | db:load:cr-nkid:pg:cloud | ok | 11s |  |
| 45 | db:load:company-founded:pg:cloud | ok | 13s |  |
| 46 | db:refresh:risk:cloud | ok | 2m 05s |  |
| 47 | db:load:tr-name-fold-people:pg:cloud | ok | 7s |  |
| 48 | db:load:ds:pg:cloud | ok | 8s |  |
| 49 | db:load:declarations:pg:cloud | ok | 41s |  |
| 50 | db:resolve:persons:cloud | ok | 8m 02s |  |
| 51 | db:load:declarations:pg:cloud --resolve | ok | 5m 35s |  |
| 52 | db:load:company-politicians:pg:cloud | ok | 1m 59s |  |
| 53 | db:load:employer-links:pg:cloud | ok | 31s |  |
| 54 | db:load:grant-links:pg:cloud | ok | 9s |  |
| 55 | db:load:official-candidate-links:pg:cloud | ok | 5s |  |
| 56 | db:load:person-elections:pg:cloud | ok | 1m 16s |  |
| 57 | db:load:council:pg:cloud | ok | 14s |  |
| 58 | db:load:persons-browse:pg:cloud | ok | 1m 11s |  |
| 59 | db:load:person-search:pg:cloud | ok | 1m 33s |  |
| 60 | db:load:graph:pg:cloud | ok | 57s |  |
| 61 | db:load:agri-hub-stats:pg:cloud | ok | 1m 04s |  |
| 62 | db:load:tr-company-place:pg:cloud | ok | 1m 01s |  |
| 63 | person:slugs:cloud | ok | 3s |  |
| 64 | data:local-person-refresh:cloud | ok | 24s |  |
| 65 | prices:ingest:cloud | ok | 28m 03s |  |
| 66 | myarea:alerts:cloud | ok | 46s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 67 | db:check-generated | ok | 811ms |  |
| 68 | db:check-cloud | ok | 1s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud → pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:ted:pg:cloud; run as pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 1h 31m 37s over 68 step(s).
- slower than usual: cloud › db:load:tr-company-place:pg:cloud 1m 01s vs median 37s
- slower than usual: cloud › myarea:alerts:cloud 46s vs median 20s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261122T210256Z-b7d4
```
