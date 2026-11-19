# Pipeline ingest run — 20261119T113147Z-ad3f
Started 2026-11-19T11:31:48.732Z · ended 2026-11-19T11:42:49.637Z · git b17db0a5aa → 3f8122aa90

## Verdict
**DEGRADED** (exit 0) — 7 unit(s): 7 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
_(none)_

## Needs operator
_(none)_

## Needs agent
- **update-rollcall** (pin-rollcall-counts): Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output. Runbook: `.claude/skills/update-rollcall/SKILL.md (Step 5c)`

## What ran
### update-rollcall — ok · marker stamped
Sources: `parliament_votes`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | rollcall:scrape | ok | 2m 21s |  |
| 2 | parliament:bills | ok | 4m 28s |  |
| 3 | db:load:rollcall:pg | ok | 25s |  |
| 4 | db:load:rollcall-derived:pg | ok | 2m 23s |  |
Files changed: `data/parliament/bills/ns52.json`, `data/parliament/votes/derived/attendance.json`, `data/parliament/votes/derived/cohesion.json`, `data/parliament/votes/derived/dissents.json`, `data/parliament/votes/derived/embedding.json`, `data/parliament/votes/derived/hub_feed/44.json`, `data/parliament/votes/derived/hub_feed/45.json`, `data/parliament/votes/derived/hub_feed/46.json`, `data/parliament/votes/derived/hub_feed/47.json`, `data/parliament/votes/derived/hub_feed/48.json`, `data/parliament/votes/derived/hub_feed/49.json`, `data/parliament/votes/derived/hub_feed/50.json`, `data/parliament/votes/derived/hub_feed/51.json`, `data/parliament/votes/derived/hub_feed/52.json`, `data/parliament/votes/derived/hub_stats.json`, `data/parliament/votes/derived/important_votes/44.json`, `data/parliament/votes/derived/important_votes/45.json`, `data/parliament/votes/derived/important_votes/46.json`, `data/parliament/votes/derived/important_votes/47.json`, `data/parliament/votes/derived/important_votes/48.json` … +28

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | myarea:alerts | ok | 53s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | data:map | ok | 7s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | db:gen-governance-hub-stats | ok | 602ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | db:gen-home-hub-stats | ok | 208ms |  |
| 9 | db:gen-home-flyover | ok | 10s |  |
| 10 | db:gen-home-price-events | ok | 6s |  |
| 11 | db:gen-home-feed | ok | 1s |  |
| 12 | home:health | ok | 484ms |  |
Files changed: `data/home/feed.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 13 | db:check-generated | ok | 978ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 14 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261119T113147Z-ad3f/013-db_check-generated.log

## Timings vs median
Sum of step durations: 10m 57s over 14 step(s).
- slower than usual: post:myarea-alerts › myarea:alerts 53s vs median 13s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:publish
pnpm run pipeline:report --session 20261119T113147Z-ad3f
```
