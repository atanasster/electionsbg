# Pipeline publish run — 20261119T235039Z-3af7
Started 2026-11-19T23:50:39.537Z · ended 2026-11-20T00:05:12.246Z · git 58c53ea96a → 58c53ea96a

## Verdict
**FAILED** (exit 1) — 3 unit(s): 2 ok · 0 partial · 1 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
- **cloud › db:load:tr:pg:cloud** — error, exit 1 after 1m 05s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `at emitErrorCloseNT (node:internal/streams/destroy:129:3)`
  Repair packet: `state/pipeline/runs/20261119T235039Z-3af7/failures/035-db_load_tr_pg_cloud.md` · log `logs/pipeline/20261119T235039Z-3af7/035-db_load_tr_pg_cloud.log`

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### bucket — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | bucket:sync:paths:dry | ok | 8s |  |
| 2 | bucket:sync:paths parliament/votes | ok | 2s |  |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 1s |  |
| 5 | bucket:sync:paths macro.json | ok | 2s |  |
| 6 | bucket:sync:paths macro_fdi.json | ok | 2s |  |
| 7 | bucket:sync:paths macro_peers.json | ok | 2s |  |
| 8 | bucket:sync:paths cofog.json | ok | 2s |  |
| 9 | bucket:sync:paths debt-emissions.json | ok | 2s |  |
| 10 | bucket:sync:paths debt-emissions-domestic.json | ok | 2s |  |
| 11 | bucket:sync:paths administration | ok | 2s |  |
| 12 | bucket:sync:paths social/poverty_impact.json | ok | 2s |  |
| 13 | bucket:sync:paths financing | ok | 2s |  |
| 14 | bucket:sync:paths defense | ok | 2s |  |
| 15 | bucket:sync:paths tourism | ok | 2s |  |
| 16 | bucket:sync:paths data_map.json | ok | 2s |  |
| 17 | bucket:sync:paths home | ok | 2s |  |
| 18 | bucket:sync:paths roads/derived/hub_stats.json | ok | 2s |  |
| 19 | bucket:sync:paths water/derived/hub_stats.json | ok | 2s |  |
| 20 | bucket:sync:paths transport/derived/hub_stats.json | ok | 2s |  |
| 21 | bucket:sync:paths governance/hub_stats.json | ok | 1s |  |
| 22 | bucket:sync:paths home/flyover.json | ok | 1s |  |
| 23 | bucket:sync:paths home/hub_stats.json | ok | 1s |  |
| 24 | bucket:sync:paths home/price_events.json | ok | 1s |  |
| 25 | bucket:sync:paths home/feed.json | ok | 1s |  |
| 26 | bucket:gz | ok | 1m 50s |  |

### cloud — failed

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | kzk:appeals:cloud --year 2026 | ok | 39s |  |
| 28 | db:load:kzk-decisions:pg:cloud | ok | 4s |  |
| 29 | kzk:rejoin:cloud --apply | ok | 2m 03s |  |
| 30 | db:load:funds:pg:cloud --full | ok | 1m 07s |  |
| 31 | db:load:funds-fit:pg:cloud | ok | 5s |  |
| 32 | db:load:clean-delivery:pg:cloud | ok | 4s |  |
| 33 | db:load:rollcall:pg:cloud | ok | 3m 04s |  |
| 34 | db:load:rollcall-derived:pg:cloud | ok | 3m 37s |  |
| 35 | db:load:tr:pg:cloud | error | 1m 05s | at emitErrorCloseNT (node:internal/streams/destroy:129:3) |
| 36 | db:load:cr-nkid:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 37 | db:load:company-founded:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 38 | db:refresh:risk:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 39 | db:load:grant-links:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 40 | db:load:council:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 41 | db:load:persons-browse:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 42 | db:load:person-search:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 43 | db:load:graph:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 44 | db:load:agri-hub-stats:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 45 | db:load:tr-company-place:pg:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 46 | prices:ingest:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |
| 47 | myarea:alerts:cloud | skipped | 0ms | not run: db:load:tr:pg:cloud failed earlier in this publish |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 48 | db:check-generated | ok | 2s |  |
| 49 | db:check-cloud | ok | 5s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run prices:ingest:cloud → pnpm run db:load:council:pg:cloud → pnpm run myarea:alerts:cloud; run as pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:kzk-decisions:pg:cloud → pnpm run kzk:rejoin:cloud --apply → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:tr:pg:cloud → pnpm run db:load:cr-nkid:pg:cloud → pnpm run db:load:company-founded:pg:cloud → pnpm run db:refresh:risk:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run prices:ingest:cloud → pnpm run myarea:alerts:cloud

## Timings vs median
Sum of step durations: 14m 33s over 37 step(s).
No step ran more than 1.5× its median.

## Publish decision
**HELD**
- held: db:load:tr:pg:cloud failed — the manifest is left pending

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261119T235039Z-3af7/failures/035-db_load_tr_pg_cloud.md
pnpm run pipeline:report --session 20261119T235039Z-3af7
```
