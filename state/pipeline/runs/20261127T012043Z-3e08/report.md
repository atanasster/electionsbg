# Pipeline publish run — 20261127T012043Z-3e08
Started 2026-11-27T01:20:43.637Z · ended 2026-11-27T02:09:50.361Z · git 8547214116 → 8547214116

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
| 1 | bucket:sync:paths:dry | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 2 | bucket:sync:paths parliament/votes | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 4 | bucket:sync:paths financing | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 5 | bucket:sync:paths procurement/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 6 | bucket:sync:paths macro.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 7 | bucket:sync:paths macro_fdi.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 8 | bucket:sync:paths macro_peers.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 9 | bucket:sync:paths cofog.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 10 | bucket:sync:paths debt-emissions.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 11 | bucket:sync:paths debt-emissions-domestic.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 12 | bucket:sync:paths administration | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 13 | bucket:sync:paths social/poverty_impact.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 14 | bucket:sync:paths data_map.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 15 | bucket:sync:paths home | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 16 | bucket:sync:paths roads/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 17 | bucket:sync:paths transport/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 18 | bucket:sync:paths education/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 19 | bucket:sync:paths health/derived/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 20 | bucket:sync:paths governance/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 21 | bucket:sync:paths home/flyover.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 22 | bucket:sync:paths home/hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 23 | bucket:sync:paths home/feed.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 24 | bucket:sync:paths governance/declarations_hub_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 25 | bucket:sync:paths procurement/roads.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 26 | bucket:sync:paths procurement/derived/mp_party.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 27 | bucket:sync:paths procurement/derived/sector_stats.json | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 28 | bucket:sync:paths budget | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 29 | bucket:sync:paths polls | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 30 | bucket:gz | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:load:place-dim:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 32 | db:load:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 33 | db:load:tenders:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 34 | db:load:awarder-seats:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 35 | proc:verify-seats:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 36 | db:load:annexes:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 37 | db:load:procurement-scopes:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 38 | db:load:nzok-hospital-map:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 39 | db:load:water-operator-map:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 40 | db:load:mvr-directorate-map:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 41 | db:load:transport-project-map:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 42 | db:load:transport-facility-map:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 43 | db:load:cprs:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 44 | db:load:ted:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 45 | db:load:adfi:pg:cloud | skipped | 0ms | --start-at kzk:appeals:cloud --year 2026 (done in 20261127T003420Z-8f8b) |
| 46 | kzk:appeals:cloud --year 2026 | ok | 50s |  |
| 47 | db:load:funds:pg:cloud --full | ok | 2m 16s |  |
| 48 | db:load:funds-fit:pg:cloud | ok | 13s |  |
| 49 | db:load:clean-delivery:pg:cloud | ok | 9s |  |
| 50 | db:load:budget:pg:cloud | ok | 24s |  |
| 51 | db:load:budget-muni:pg:cloud | ok | 15s |  |
| 52 | db:load:budget-hub:pg:cloud | ok | 3s |  |
| 53 | db:load:budget-named:pg:cloud | ok | 4s |  |
| 54 | db:load:budget-decrees:pg:cloud | ok | 13s |  |
| 55 | db:load:open-calls:pg:cloud | ok | 5s |  |
| 56 | db:load:rollcall:pg:cloud | ok | 8m 51s |  |
| 57 | db:load:rollcall-derived:pg:cloud | ok | 3m 38s |  |
| 58 | db:load:judicial-bodies:pg:cloud | ok | 4s |  |
| 59 | db:load:tr-name-fold-people:pg:cloud | ok | 10s |  |
| 60 | db:load:ds:pg:cloud | ok | 13s |  |
| 61 | db:load:declarations:pg:cloud | ok | 1m 33s |  |
| 62 | db:resolve:persons:cloud | ok | 8m 32s |  |
| 63 | db:load:declarations:pg:cloud --resolve | ok | 5m 41s |  |
| 64 | db:load:company-politicians:pg:cloud | ok | 2m 20s |  |
| 65 | db:load:employer-links:pg:cloud | ok | 32s |  |
| 66 | db:load:grant-links:pg:cloud | ok | 9s |  |
| 67 | db:load:official-candidate-links:pg:cloud | ok | 5s |  |
| 68 | db:load:person-elections:pg:cloud | ok | 1m 36s |  |
| 69 | db:load:council:pg:cloud | ok | 27s |  |
| 70 | db:load:persons-browse:pg:cloud | ok | 1m 15s |  |
| 71 | db:load:person-search:pg:cloud | ok | 1m 25s |  |
| 72 | db:load:graph:pg:cloud | ok | 1m 11s |  |
| 73 | db:load:agri-hub-stats:pg:cloud | ok | 1m 01s |  |
| 74 | db:load:tr-company-place:pg:cloud | ok | 52s |  |
| 75 | person:slugs:cloud | ok | 9s |  |
| 76 | data:local-person-refresh:cloud | ok | 25s |  |
| 77 | prices:payloads:cloud | ok | 3m 56s |  |
| 78 | myarea:alerts:cloud | ok | 24s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 79 | db:check-generated | ok | 3s |  |
| 80 | db:check-cloud | ok | 2s |  |

## Findings
- resumed publish 20261127T003420Z-8f8b at kzk:appeals:cloud --year 2026
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run prices:payloads:cloud → pnpm run myarea:alerts:cloud → pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:cprs:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run db:load:budget:pg:cloud → pnpm run db:load:budget-muni:pg:cloud → pnpm run db:load:budget-hub:pg:cloud → pnpm run db:load:budget-named:pg:cloud → pnpm run db:load:budget-decrees:pg:cloud; run as pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:cprs:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:budget:pg:cloud → pnpm run db:load:budget-muni:pg:cloud → pnpm run db:load:budget-hub:pg:cloud → pnpm run db:load:budget-named:pg:cloud → pnpm run db:load:budget-decrees:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run prices:payloads:cloud → pnpm run myarea:alerts:cloud
- db:check-generated exited 1: it found something — read logs/pipeline/20261127T012043Z-3e08/079-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 49m 07s over 35 step(s).
- slower than usual: cloud › db:load:funds:pg:cloud --full 2m 16s vs median 1m 07s
- slower than usual: cloud › db:load:funds-fit:pg:cloud 13s vs median 6s
- slower than usual: cloud › db:load:budget:pg:cloud 24s vs median 9s
- slower than usual: cloud › db:load:budget-muni:pg:cloud 15s vs median 6s
- slower than usual: cloud › db:load:rollcall:pg:cloud 8m 51s vs median 3m 03s
- slower than usual: cloud › db:load:ds:pg:cloud 13s vs median 8s
- slower than usual: cloud › db:load:declarations:pg:cloud 1m 33s vs median 40s
- slower than usual: cloud › db:load:council:pg:cloud 27s vs median 12s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261127T012043Z-3e08
```
