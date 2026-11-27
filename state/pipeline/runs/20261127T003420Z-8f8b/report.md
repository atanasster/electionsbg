# Pipeline publish run — 20261127T003420Z-8f8b
Started 2026-11-27T00:34:20.271Z · ended 2026-11-27T01:17:08.309Z · git 09976d962c → 09976d962c

## Verdict
**FAILED** (exit 1) — 3 unit(s): 2 ok · 0 partial · 1 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
- **cloud › kzk:appeals:cloud --year 2026** — error, exit 1 after 1m 23s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `name: 'TimeoutError'`
  Repair packet: `state/pipeline/runs/20261127T003420Z-8f8b/failures/046-kzk_appeals_cloud_--year_2026.md` · log `logs/pipeline/20261127T003420Z-8f8b/046-kzk_appeals_cloud_--year_2026.log`

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### bucket — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | bucket:sync:paths:dry | ok | 11s |  |
| 2 | bucket:sync:paths parliament/votes | ok | 4s |  |
| 3 | bucket:sync:paths parliament/votes/derived/hub_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths financing | ok | 2s |  |
| 5 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 6 | bucket:sync:paths macro.json | ok | 2s |  |
| 7 | bucket:sync:paths macro_fdi.json | ok | 3s |  |
| 8 | bucket:sync:paths macro_peers.json | ok | 4s |  |
| 9 | bucket:sync:paths cofog.json | ok | 2s |  |
| 10 | bucket:sync:paths debt-emissions.json | ok | 3s |  |
| 11 | bucket:sync:paths debt-emissions-domestic.json | ok | 2s |  |
| 12 | bucket:sync:paths administration | ok | 3s |  |
| 13 | bucket:sync:paths social/poverty_impact.json | ok | 2s |  |
| 14 | bucket:sync:paths data_map.json | ok | 3s |  |
| 15 | bucket:sync:paths home | ok | 3s |  |
| 16 | bucket:sync:paths roads/derived/hub_stats.json | ok | 3s |  |
| 17 | bucket:sync:paths transport/derived/hub_stats.json | ok | 3s |  |
| 18 | bucket:sync:paths education/derived/hub_stats.json | ok | 3s |  |
| 19 | bucket:sync:paths health/derived/hub_stats.json | ok | 3s |  |
| 20 | bucket:sync:paths governance/hub_stats.json | ok | 2s |  |
| 21 | bucket:sync:paths home/flyover.json | ok | 2s |  |
| 22 | bucket:sync:paths home/hub_stats.json | ok | 2s |  |
| 23 | bucket:sync:paths home/feed.json | ok | 2s |  |
| 24 | bucket:sync:paths governance/declarations_hub_stats.json | ok | 2s |  |
| 25 | bucket:sync:paths procurement/roads.json | ok | 3s |  |
| 26 | bucket:sync:paths procurement/derived/mp_party.json | ok | 2s |  |
| 27 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 28 | bucket:sync:paths budget | ok | 8s |  |
| 29 | bucket:sync:paths polls | ok | 2s |  |
| 30 | bucket:gz | ok | 5m 11s |  |

### cloud — failed

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:load:place-dim:pg:cloud | ok | 8s |  |
| 32 | db:load:pg:cloud | ok | 16m 34s |  |
| 33 | db:load:tenders:pg:cloud | ok | 11m 33s |  |
| 34 | db:load:awarder-seats:pg:cloud | ok | 1m 54s |  |
| 35 | proc:verify-seats:cloud | ok | 2s |  |
| 36 | db:load:annexes:pg:cloud | ok | 28s |  |
| 37 | db:load:procurement-scopes:pg:cloud | ok | 3m 07s |  |
| 38 | db:load:nzok-hospital-map:pg:cloud | ok | 3s |  |
| 39 | db:load:water-operator-map:pg:cloud | ok | 2s |  |
| 40 | db:load:mvr-directorate-map:pg:cloud | ok | 12s |  |
| 41 | db:load:transport-project-map:pg:cloud | ok | 5s |  |
| 42 | db:load:transport-facility-map:pg:cloud | ok | 4s |  |
| 43 | db:load:cprs:pg:cloud | ok | 10s |  |
| 44 | db:load:ted:pg:cloud | ok | 15s |  |
| 45 | db:load:adfi:pg:cloud | ok | 6s |  |
| 46 | kzk:appeals:cloud --year 2026 | error | 1m 23s | name: 'TimeoutError' |
| 47 | db:load:funds:pg:cloud --full | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 48 | db:load:funds-fit:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 49 | db:load:clean-delivery:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 50 | db:load:budget:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 51 | db:load:budget-muni:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 52 | db:load:budget-hub:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 53 | db:load:budget-named:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 54 | db:load:budget-decrees:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 55 | db:load:open-calls:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 56 | db:load:rollcall:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 57 | db:load:rollcall-derived:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 58 | db:load:judicial-bodies:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 59 | db:load:tr-name-fold-people:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 60 | db:load:ds:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 61 | db:load:declarations:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 62 | db:resolve:persons:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 63 | db:load:declarations:pg:cloud --resolve | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 64 | db:load:company-politicians:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 65 | db:load:employer-links:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 66 | db:load:grant-links:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 67 | db:load:official-candidate-links:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 68 | db:load:person-elections:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 69 | db:load:council:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 70 | db:load:persons-browse:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 71 | db:load:person-search:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 72 | db:load:graph:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 73 | db:load:agri-hub-stats:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 74 | db:load:tr-company-place:pg:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 75 | person:slugs:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 76 | data:local-person-refresh:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 77 | prices:payloads:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |
| 78 | myarea:alerts:cloud | skipped | 0ms | not run: kzk:appeals:cloud --year 2026 failed earlier in this publish |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 79 | db:check-generated | ok | 3s |  |
| 80 | db:check-cloud | ok | 3s |  |

## Findings
- manifest cloud order differs from CLOUD_ORDER — reordered: manifest pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run prices:payloads:cloud → pnpm run myarea:alerts:cloud → pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:cprs:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run db:load:budget:pg:cloud → pnpm run db:load:budget-muni:pg:cloud → pnpm run db:load:budget-hub:pg:cloud → pnpm run db:load:budget-named:pg:cloud → pnpm run db:load:budget-decrees:pg:cloud; run as pnpm run db:load:place-dim:pg:cloud → pnpm run db:load:pg:cloud → pnpm run db:load:tenders:pg:cloud → pnpm run db:load:awarder-seats:pg:cloud → pnpm run proc:verify-seats:cloud → pnpm run db:load:annexes:pg:cloud → pnpm run db:load:procurement-scopes:pg:cloud → pnpm run db:load:nzok-hospital-map:pg:cloud → pnpm run db:load:water-operator-map:pg:cloud → pnpm run db:load:mvr-directorate-map:pg:cloud → pnpm run db:load:transport-project-map:pg:cloud → pnpm run db:load:transport-facility-map:pg:cloud → pnpm run db:load:cprs:pg:cloud → pnpm run db:load:ted:pg:cloud → pnpm run db:load:adfi:pg:cloud → pnpm run kzk:appeals:cloud --year 2026 → pnpm run db:load:funds:pg:cloud --full → pnpm run db:load:funds-fit:pg:cloud → pnpm run db:load:clean-delivery:pg:cloud → pnpm run db:load:budget:pg:cloud → pnpm run db:load:budget-muni:pg:cloud → pnpm run db:load:budget-hub:pg:cloud → pnpm run db:load:budget-named:pg:cloud → pnpm run db:load:budget-decrees:pg:cloud → pnpm run db:load:open-calls:pg:cloud → pnpm run db:load:rollcall:pg:cloud → pnpm run db:load:rollcall-derived:pg:cloud → pnpm run db:load:judicial-bodies:pg:cloud → pnpm run db:load:tr-name-fold-people:pg:cloud → pnpm run db:load:ds:pg:cloud → pnpm run db:load:declarations:pg:cloud → pnpm run db:resolve:persons:cloud → pnpm run db:load:declarations:pg:cloud --resolve → pnpm run db:load:company-politicians:pg:cloud → pnpm run db:load:employer-links:pg:cloud → pnpm run db:load:grant-links:pg:cloud → pnpm run db:load:official-candidate-links:pg:cloud → pnpm run db:load:person-elections:pg:cloud → pnpm run db:load:council:pg:cloud → pnpm run db:load:persons-browse:pg:cloud → pnpm run db:load:person-search:pg:cloud → pnpm run db:load:graph:pg:cloud → pnpm run db:load:agri-hub-stats:pg:cloud → pnpm run db:load:tr-company-place:pg:cloud → pnpm run person:slugs:cloud → pnpm run data:local-person-refresh:cloud → pnpm run prices:payloads:cloud → pnpm run myarea:alerts:cloud
- db:check-generated exited 1: it found something — read logs/pipeline/20261127T003420Z-8f8b/079-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 42m 48s over 48 step(s).
- slower than usual: bucket › bucket:gz 5m 11s vs median 1m 55s
- slower than usual: cloud › db:load:cprs:pg:cloud 10s vs median 5s
- slower than usual: cloud › db:load:ted:pg:cloud 15s vs median 9s
- slower than usual: cloud › kzk:appeals:cloud --year 2026 1m 23s vs median 43s

## Publish decision
**HELD**
- held: kzk:appeals:cloud --year 2026 failed — the manifest is left pending

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261127T003420Z-8f8b/failures/046-kzk_appeals_cloud_--year_2026.md
pnpm run pipeline:report --session 20261127T003420Z-8f8b
```
