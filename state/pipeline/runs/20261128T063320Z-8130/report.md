# Pipeline publish run — 20261128T063320Z-8130
Started 2026-11-28T06:33:20.186Z · ended 2026-11-28T07:16:08.856Z · git 9b70eea220 → 9b70eea220

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
| 1 | bucket:sync:paths:dry | ok | 8s |  |
| 2 | bucket:sync:paths parliament/votes | ok | 6s |  |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths macro.json | ok | 2s |  |
| 5 | bucket:sync:paths macro_fdi.json | ok | 3s |  |
| 6 | bucket:sync:paths macro_peers.json | ok | 3s |  |
| 7 | bucket:sync:paths cofog.json | ok | 3s |  |
| 8 | bucket:sync:paths debt-emissions.json | ok | 3s |  |
| 9 | bucket:sync:paths debt-emissions-domestic.json | ok | 3s |  |
| 10 | bucket:sync:paths administration | ok | 3s |  |
| 11 | bucket:sync:paths social/poverty_impact.json | ok | 3s |  |
| 12 | bucket:sync:paths data_map.json | ok | 2s |  |
| 13 | bucket:sync:paths home | ok | 3s |  |
| 14 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 15 | bucket:sync:paths home/flyover.json | ok | 3s |  |
| 16 | bucket:sync:paths home/price_events.json | ok | 2s |  |
| 17 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 18 | bucket:gz | ok | 2m 51s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:load:rollcall:pg:cloud | ok | 8m 49s |  |
| 20 | db:load:rollcall-derived:pg:cloud | ok | 3m 42s |  |
| 21 | db:load:council:pg:cloud | ok | 25s |  |
| 22 | prices:ingest:cloud | ok | 25m 35s |  |
| 23 | myarea:alerts:cloud | ok | 31s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:check-generated | ok | 2s |  |
| 25 | db:check-cloud | ok | 2s |  |

## Findings
- ran under the pipeline lock held by session 20261128T054138Z-116f
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud; run as pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 42m 49s over 25 step(s).
- slower than usual: cloud › db:load:rollcall:pg:cloud 8m 49s vs median 3m 05s
- slower than usual: cloud › db:load:council:pg:cloud 25s vs median 12s
- slower than usual: cloud › myarea:alerts:cloud 31s vs median 21s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261128T063320Z-8130
```
