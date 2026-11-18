# Pipeline publish run — 20261118T000118Z-e9e1
Started 2026-11-18T00:01:18.193Z · ended 2026-11-18T00:46:16.812Z · git f53491c067 → f53491c067

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
| 14 | bucket:gz | ok | 8m 56s |  |

### cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | db:load:tr:pg:cloud | ok | 24m 22s |  |
| 16 | db:load:cr-nkid:pg:cloud | ok | 11s |  |
| 17 | db:load:company-founded:pg:cloud | ok | 10s |  |
| 18 | db:refresh:risk:cloud | ok | 1m 39s |  |
| 19 | db:load:persons-browse:pg:cloud | ok | 1m 03s |  |
| 20 | db:load:person-search:pg:cloud | ok | 1m 16s |  |
| 21 | db:load:graph:pg:cloud | ok | 57s |  |
| 22 | db:load:tr-company-place:pg:cloud | ok | 35s |  |
| 23 | prices:payloads:cloud | ok | 5m 08s |  |
| 24 | myarea:alerts:cloud | ok | 13s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 25 | db:check-generated | ok | 971ms |  |
| 26 | db:check-cloud | ok | 1s |  |

## Findings
- ran under the pipeline lock held by session 20261117T232740Z-4070
- db:check-generated exited 1: it found something — read logs/pipeline/20261118T000118Z-e9e1/025-db_check-generated.log and act on what it names

## Timings vs median
Sum of step durations: 44m 59s over 26 step(s).
- slower than usual: bucket › bucket:gz 8m 56s vs median 2m 16s
- slower than usual: cloud › db:load:tr:pg:cloud 24m 22s vs median 12m 13s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261118T000118Z-e9e1
```
