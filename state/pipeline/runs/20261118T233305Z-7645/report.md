# Pipeline publish run — 20261118T233305Z-7645
Started 2026-11-18T23:33:05.374Z · ended 2026-11-19T00:18:39.967Z · git 0307ce6249 → 0307ce6249

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
| 2 | bucket:sync:paths macro.json | ok | 2s |  |
| 3 | bucket:sync:paths macro_fdi.json | ok | 2s |  |
| 4 | bucket:sync:paths macro_peers.json | ok | 2s |  |
| 5 | bucket:sync:paths cofog.json | ok | 2s |  |
| 6 | bucket:sync:paths debt-emissions.json | ok | 2s |  |
| 7 | bucket:sync:paths debt-emissions-domestic.json | ok | 2s |  |
| 8 | bucket:sync:paths administration | ok | 2s |  |
| 9 | bucket:sync:paths social/poverty_impact.json | ok | 2s |  |
| 10 | bucket:sync:paths data_map.json | ok | 2s |  |
| 11 | bucket:sync:paths home | ok | 2s |  |
| 12 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 13 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 14 | bucket:sync:paths home/hub_stats.json | ok | 2s |  |
| 15 | bucket:sync:paths home/price_events.json | ok | 2s |  |
| 16 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 17 | bucket:gz | ok | 2m 25s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | db:load:tr:pg:cloud | ok | 11m 39s |  |
| 19 | db:load:cr-nkid:pg:cloud | ok | 14s |  |
| 20 | db:load:company-founded:pg:cloud | ok | 11s |  |
| 21 | db:refresh:risk:cloud | ok | 1m 53s |  |
| 22 | db:load:council:pg:cloud | ok | 12s |  |
| 23 | db:load:persons-browse:pg:cloud | ok | 1m 16s |  |
| 24 | db:load:person-search:pg:cloud | ok | 1m 27s |  |
| 25 | db:load:graph:pg:cloud | ok | 48s |  |
| 26 | db:load:tr-company-place:pg:cloud | ok | 36s |  |
| 27 | prices:ingest:cloud | ok | 24m 06s |  |
| 28 | myarea:alerts:cloud | ok | 14s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | db:check-generated | ok | 1s |  |
| 30 | db:check-cloud | ok | 1s |  |

## Findings
- ran under the pipeline lock held by session 20261118T224713Z-a15e
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud; run as pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 45m 34s over 30 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261118T233305Z-7645
```
