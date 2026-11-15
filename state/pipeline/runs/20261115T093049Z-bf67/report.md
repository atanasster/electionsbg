# Pipeline publish run — 20261115T093049Z-bf67
Started 2026-11-15T09:30:49.637Z · ended 2026-11-15T10:06:24.779Z · git c072327513 → c072327513

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
| 1 | bucket:sync:paths:dry | ok | 7s |  |
| 2 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 3 | bucket:sync:paths financing | ok | 2s |  |
| 4 | bucket:sync:paths data_map.json | ok | 2s |  |
| 5 | bucket:sync:paths home | ok | 2s |  |
| 6 | bucket:sync:paths roads/derived/hub_stats.json | ok | 2s |  |
| 7 | bucket:sync:paths transport/derived/hub_stats.json | ok | 2s |  |
| 8 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 9 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 10 | bucket:sync:paths home/hub_stats.json | ok | 2s |  |
| 11 | bucket:sync:paths macro.json | ok | 2s |  |
| 12 | bucket:sync:paths macro_fdi.json | ok | 2s |  |
| 13 | bucket:sync:paths macro_peers.json | ok | 2s |  |
| 14 | bucket:sync:paths cofog.json | ok | 2s |  |
| 15 | bucket:sync:paths debt-emissions.json | ok | 2s |  |
| 16 | bucket:sync:paths debt-emissions-domestic.json | ok | 2s |  |
| 17 | bucket:sync:paths administration | ok | 3s |  |
| 18 | bucket:sync:paths social/poverty_impact.json | ok | 2s |  |
| 19 | bucket:sync:paths home/feed.json | ok | 3s |  |
| 20 | bucket:gz | ok | 2m 17s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | kzk:appeals:cloud --year 2026 | ok | 46s |  |
| 22 | db:load:kzk-decisions:pg:cloud | ok | 4s |  |
| 23 | kzk:rejoin:cloud --apply | ok | 2m 09s |  |
| 24 | db:load:funds:pg:cloud --full | ok | 1m 08s |  |
| 25 | db:load:funds-fit:pg:cloud | ok | 6s |  |
| 26 | db:load:clean-delivery:pg:cloud | ok | 4s |  |
| 27 | db:load:admin-services:pg:cloud | ok | 2s |  |
| 28 | db:load:admin-service-requests:pg:cloud | ok | 2s |  |
| 29 | db:load:tr:pg:cloud | ok | 15m 45s |  |
| 30 | db:load:cr-nkid:pg:cloud | ok | 11s |  |
| 31 | db:load:company-founded:pg:cloud | ok | 13s |  |
| 32 | db:refresh:risk:cloud | ok | 1m 50s |  |
| 33 | db:load:grant-links:pg:cloud | ok | 8s |  |
| 34 | db:load:council:pg:cloud | ok | 13s |  |
| 35 | db:load:persons-browse:pg:cloud | ok | 1m 21s |  |
| 36 | db:load:person-search:pg:cloud | ok | 1m 28s |  |
| 37 | db:load:graph:pg:cloud | ok | 1m 10s |  |
| 38 | db:load:agri-hub-stats:pg:cloud | ok | 1m 01s |  |
| 39 | db:load:tr-company-place:pg:cloud | ok | 36s |  |
| 40 | prices:payloads:cloud | ok | 4m 01s |  |
| 41 | myarea:alerts:cloud | ok | 14s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 42 | db:check-generated | ok | 834ms |  |
| 43 | db:check-cloud | ok | 937ms |  |

## Findings
- ran under the pipeline lock held by session 20261115T085013Z-669e
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run myarea:alerts:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run prices:payloads:cloud; run as pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:payloads:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 35m 35s over 43 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261115T093049Z-bf67
```
