# Pipeline publish run — 20261127T094929Z-fab0
Started 2026-11-27T09:49:29.598Z · ended 2026-11-27T11:18:07.592Z · git b5d3379c0c → fd08da5dd2

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
| 1 | bucket:sync:paths:dry | ok | 11s |  |
| 2 | bucket:sync:paths administration | ok | 11s |  |
| 3 | bucket:sync:paths home | ok | 10s |  |
| 4 | bucket:sync:paths home/price_events.json | ok | 6s |  |
| 5 | bucket:sync:paths home/feed.json | ok | 6s |  |
| 6 | bucket:sync:paths data_map.json | ok | 8s |  |
| 7 | bucket:sync:paths governance/hub_stats.json | ok | 5s |  |
| 8 | bucket:sync:paths home/flyover.json | ok | 4s |  |
| 9 | bucket:gz | ok | 6m 00s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:load:ted:pg:cloud | ok | 31s |  |
| 11 | db:load:admin-services:pg:cloud | ok | 5s |  |
| 12 | db:load:admin-service-requests:pg:cloud | ok | 8s |  |
| 13 | db:load:tr:pg:cloud | ok | 16m 46s |  |
| 14 | db:load:cr-nkid:pg:cloud | ok | 40s |  |
| 15 | db:load:company-founded:pg:cloud | ok | 36s |  |
| 16 | db:refresh:risk:cloud | ok | 2m 32s |  |
| 17 | db:load:tr-announced-acts:pg:cloud | ok | 26s |  |
| 18 | db:load:persons-browse:pg:cloud | ok | 1m 48s |  |
| 19 | db:load:person-search:pg:cloud | ok | 2m 08s |  |
| 20 | db:load:graph:pg:cloud | ok | 1m 32s |  |
| 21 | db:load:tr-company-place:pg:cloud | ok | 1m 05s |  |
| 22 | prices:ingest:cloud | ok | 52m 28s |  |
| 23 | myarea:alerts:cloud | ok | 50s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:check-generated | ok | 2s |  |
| 25 | db:check-cloud | ok | 2s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:tr-announced-acts:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run myarea:alerts:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:ted:pg:cloud; run as pnpm run db:load:ted:pg:cloud → pnpm run db:load:admin-services:pg:cloud → pnpm run db:load:admin-service-requests:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:tr-announced-acts:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud
- pending.json gained a newer ingest commit (636cdc32e4e0a3ef6095716381703502507ff561 → fd08da5dd2) during the publish — kept in full, since a re-touched path cannot be told apart from a published one; still pending: 8 path(s), 14 cloud command(s)

## Timings vs median
Sum of step durations: 1h 28m 38s over 25 step(s).
- slower than usual: bucket › bucket:gz 6m 00s vs median 2m 07s
- slower than usual: cloud › db:load:ted:pg:cloud 31s vs median 9s
- slower than usual: cloud › db:load:cr-nkid:pg:cloud 40s vs median 11s
- slower than usual: cloud › db:load:company-founded:pg:cloud 36s vs median 12s
- slower than usual: cloud › db:load:tr-company-place:pg:cloud 1m 05s vs median 37s
- slower than usual: cloud › prices:ingest:cloud 52m 28s vs median 23m 59s
- slower than usual: cloud › myarea:alerts:cloud 50s vs median 21s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261127T094929Z-fab0
```
