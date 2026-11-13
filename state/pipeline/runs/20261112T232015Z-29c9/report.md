# Pipeline publish run — 20261112T232015Z-29c9
Started 2026-11-12T23:20:15.196Z · ended 2026-11-13T00:23:42.580Z · git 37080d0804 → 37080d0804

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
| 2 | bucket:sync:paths macro.json | ok | 2s |  |
| 3 | bucket:sync:paths macro_fdi.json | ok | 1s |  |
| 4 | bucket:sync:paths macro_peers.json | ok | 2s |  |
| 5 | bucket:sync:paths cofog.json | ok | 2s |  |
| 6 | bucket:sync:paths debt-emissions.json | ok | 1s |  |
| 7 | bucket:sync:paths debt-emissions-domestic.json | ok | 1s |  |
| 8 | bucket:sync:paths administration | ok | 2s |  |
| 9 | bucket:sync:paths social/poverty_impact.json | ok | 1s |  |
| 10 | bucket:sync:paths transport | ok | 2s |  |
| 11 | bucket:sync:paths environment | ok | 2s |  |
| 12 | bucket:sync:paths data_map.json | ok | 2s |  |
| 13 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 14 | bucket:sync:paths home | ok | 2s |  |
| 15 | bucket:sync:paths data-changes.json | ok | 1s |  |
| 16 | bucket:sync:paths home/flyover.json | ok | 1s |  |
| 17 | bucket:sync:paths home/price_events.json | ok | 1s |  |
| 18 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 19 | bucket:gz | ok | 1m 28s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | db:load:open-calls:pg:cloud | ok | 2s |  |
| 21 | db:load:tr:pg:cloud | ok | 25m 07s |  |
| 22 | db:load:cr-nkid:pg:cloud | ok | 11s |  |
| 23 | db:refresh:risk:cloud | ok | 1m 49s |  |
| 24 | db:load:persons-browse:pg:cloud | ok | 1m 11s |  |
| 25 | db:load:person-search:pg:cloud | ok | 1m 25s |  |
| 26 | db:load:graph:pg:cloud | ok | 1m 25s |  |
| 27 | db:load:tr-company-place:pg:cloud | ok | 47s |  |
| 28 | prices:ingest:cloud | ok | 28m 43s |  |
| 29 | db:load:council:pg:cloud | ok | 12s |  |
| 30 | myarea:alerts:cloud | ok | 33s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:check-generated | ok | 885ms |  |
| 32 | db:check-cloud | ok | 1s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER (run as written): manifest pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud; registry order pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 1h 03m 27s over 32 step(s).
- slower than usual: cloud › db:load:tr:pg:cloud 25m 07s vs median 11m 01s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261112T232015Z-29c9
```
