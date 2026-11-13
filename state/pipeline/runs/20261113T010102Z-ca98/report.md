# Pipeline publish run — 20261113T010102Z-ca98
Started 2026-11-13T01:01:02.874Z · ended 2026-11-13T01:35:44.507Z · git f7184fc654 → f7184fc654

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
| 2 | bucket:sync:paths procurement/derived/hub_stats.json | ok | 2s |  |
| 3 | bucket:sync:paths procurement/derived/sector_stats.json | ok | 2s |  |
| 4 | bucket:sync:paths procurement/derived/mp_party.json | ok | 1s |  |
| 5 | bucket:sync:paths budget | ok | 5s |  |
| 6 | bucket:sync:paths data-changes.json | ok | 1s |  |
| 7 | bucket:gz | ok | 1m 33s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | db:load:place-dim:pg:cloud | ok | 2s |  |
| 9 | db:load:pg:cloud | ok | 11m 44s |  |
| 10 | db:load:tenders:pg:cloud | ok | 9m 56s |  |
| 11 | db:load:awarder-seats:pg:cloud | ok | 1m 52s |  |
| 12 | proc:verify-seats:cloud | ok | 948ms |  |
| 13 | db:load:annexes:pg:cloud | ok | 26s |  |
| 14 | db:load:procurement-scopes:pg:cloud | ok | 2m 25s |  |
| 15 | db:load:nzok-hospital-map:pg:cloud | ok | 1s |  |
| 16 | db:load:water-operator-map:pg:cloud | ok | 1s |  |
| 17 | db:load:mvr-directorate-map:pg:cloud | ok | 4s |  |
| 18 | db:load:transport-project-map:pg:cloud | ok | 2s |  |
| 19 | db:load:transport-facility-map:pg:cloud | ok | 2s |  |
| 20 | db:load:ted:pg:cloud | ok | 10s |  |
| 21 | db:load:budget:pg:cloud | ok | 8s |  |
| 22 | db:load:budget-muni:pg:cloud | ok | 6s |  |
| 23 | db:load:budget-hub:pg:cloud | ok | 1s |  |
| 24 | db:load:employer-links:pg:cloud | ok | 34s |  |
| 25 | db:load:grant-links:pg:cloud | ok | 3s |  |
| 26 | db:load:persons-browse:pg:cloud | ok | 1m 13s |  |
| 27 | db:load:person-search:pg:cloud | ok | 1m 21s |  |
| 28 | db:load:graph:pg:cloud | ok | 1m 03s |  |
| 29 | db:load:agri-hub-stats:pg:cloud | ok | 57s |  |
| 30 | db:load:tr-company-place:pg:cloud | ok | 39s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 31 | db:check-generated | ok | 1s |  |
| 32 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261113T010102Z-ca98/031-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 34m 42s over 32 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261113T010102Z-ca98
```
