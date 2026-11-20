# Pipeline publish run — 20261120T000545Z-cf6e
Started 2026-11-20T00:05:45.655Z · ended 2026-11-20T01:10:38.450Z · git f6edc9651a → 9d1be95dfd

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
| 1 | bucket:sync:paths:dry | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 2 | bucket:sync:paths parliament/votes | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 4 | bucket:sync:paths procurement/derived/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 5 | bucket:sync:paths macro.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 6 | bucket:sync:paths macro_fdi.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 7 | bucket:sync:paths macro_peers.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 8 | bucket:sync:paths cofog.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 9 | bucket:sync:paths debt-emissions.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 10 | bucket:sync:paths debt-emissions-domestic.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 11 | bucket:sync:paths administration | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 12 | bucket:sync:paths social/poverty_impact.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 13 | bucket:sync:paths financing | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 14 | bucket:sync:paths defense | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 15 | bucket:sync:paths tourism | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 16 | bucket:sync:paths data_map.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 17 | bucket:sync:paths home | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 18 | bucket:sync:paths roads/derived/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 19 | bucket:sync:paths water/derived/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 20 | bucket:sync:paths transport/derived/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 21 | bucket:sync:paths governance/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 22 | bucket:sync:paths home/flyover.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 23 | bucket:sync:paths home/hub_stats.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 24 | bucket:sync:paths home/price_events.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 25 | bucket:sync:paths home/feed.json | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 26 | bucket:gz | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | kzk:appeals:cloud --year 2026 | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 28 | db:load:kzk-decisions:pg:cloud | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 29 | kzk:rejoin:cloud --apply | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 30 | db:load:funds:pg:cloud --full | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 31 | db:load:funds-fit:pg:cloud | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 32 | db:load:clean-delivery:pg:cloud | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 33 | db:load:rollcall:pg:cloud | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 34 | db:load:rollcall-derived:pg:cloud | skipped | 0ms | --start-at db:load:tr:pg:cloud (done in 20261119T235039Z-3af7) |
| 35 | db:load:tr:pg:cloud | ok | 30m 41s |  |
| 36 | db:load:cr-nkid:pg:cloud | ok | 11s |  |
| 37 | db:load:company-founded:pg:cloud | ok | 17s |  |
| 38 | db:refresh:risk:cloud | ok | 1m 54s |  |
| 39 | db:load:grant-links:pg:cloud | ok | 8s |  |
| 40 | db:load:council:pg:cloud | ok | 12s |  |
| 41 | db:load:persons-browse:pg:cloud | ok | 1m 10s |  |
| 42 | db:load:person-search:pg:cloud | ok | 1m 31s |  |
| 43 | db:load:graph:pg:cloud | ok | 57s |  |
| 44 | db:load:agri-hub-stats:pg:cloud | ok | 1m 04s |  |
| 45 | db:load:tr-company-place:pg:cloud | ok | 37s |  |
| 46 | prices:ingest:cloud | ok | 25m 55s |  |
| 47 | myarea:alerts:cloud | ok | 15s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 48 | db:check-generated | ok | 1s |  |
| 49 | db:check-cloud | ok | 1s |  |

## Findings
- resumed publish 20261119T235039Z-3af7 at db:load:tr:pg:cloud
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud; run as pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud
- db:check-generated exited 1: it found something — read logs/pipeline/20261120T000545Z-cf6e/048-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 1h 04m 53s over 15 step(s).
- slower than usual: cloud › db:load:tr:pg:cloud 30m 41s vs median 13m 13s
- slower than usual: cloud › db:load:company-founded:pg:cloud 17s vs median 11s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261120T000545Z-cf6e
```
