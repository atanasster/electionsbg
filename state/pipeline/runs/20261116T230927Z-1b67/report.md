# Pipeline publish run — 20261116T230927Z-1b67
Started 2026-11-16T23:09:27.711Z · ended 2026-11-16T23:51:46.591Z · git b85b62e0bb → b85b62e0bb

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
| 1 | bucket:sync:paths:dry | ok | 3s |  |
| 2 | bucket:sync:paths macro.json | ok | 2s |  |
| 3 | bucket:sync:paths macro_fdi.json | ok | 2s |  |
| 4 | bucket:sync:paths macro_peers.json | ok | 2s |  |
| 5 | bucket:sync:paths cofog.json | ok | 2s |  |
| 6 | bucket:sync:paths debt-emissions.json | ok | 2s |  |
| 7 | bucket:sync:paths debt-emissions-domestic.json | ok | 2s |  |
| 8 | bucket:sync:paths administration | ok | 3s |  |
| 9 | bucket:sync:paths social/poverty_impact.json | ok | 2s |  |
| 10 | bucket:sync:paths data_map.json | ok | 2s |  |
| 11 | bucket:sync:paths home | ok | 2s |  |
| 12 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 13 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 14 | bucket:sync:paths home/price_events.json | ok | 2s |  |
| 15 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 16 | bucket:gz | ok | 2m 01s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 17 | db:load:tr:pg:cloud | ok | 10m 57s |  |
| 18 | db:load:cr-nkid:pg:cloud | ok | 13s |  |
| 19 | db:load:company-founded:pg:cloud | ok | 10s |  |
| 20 | db:refresh:risk:cloud | ok | 1m 45s |  |
| 21 | db:load:persons-browse:pg:cloud | ok | 1m 03s |  |
| 22 | db:load:person-search:pg:cloud | ok | 1m 17s |  |
| 23 | db:load:graph:pg:cloud | ok | 58s |  |
| 24 | db:load:tr-company-place:pg:cloud | ok | 35s |  |
| 25 | prices:ingest:cloud | ok | 22m 34s |  |
| 26 | myarea:alerts:cloud | ok | 13s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | db:check-generated | ok | 794ms |  |
| 28 | db:check-cloud | ok | 1s |  |

## Findings
- ran under the pipeline lock held by session 20261116T224945Z-38f9

## Timings vs median
Sum of step durations: 42m 19s over 28 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261116T230927Z-1b67
```
