# Pipeline publish run — 20261127T111903Z-16a1
Started 2026-11-27T11:19:03.641Z · ended 2026-11-27T11:22:37.112Z · git 02c3d50f47 → 02c3d50f47

## Verdict
**CLEAN** (exit 0) — 2 unit(s): 2 ok · 0 partial · 0 failed · 0 blocked · 0 needs operator · 0 skipped

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
| 2 | bucket:sync:paths polls | ok | 4s |  |
| 3 | bucket:gz | ok | 3m 25s |  |

### verify — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | db:check-generated | ok | 1s |  |

## Findings
_(none)_

## Timings vs median
Sum of step durations: 3m 33s over 4 step(s).
- slower than usual: bucket › bucket:gz 3m 25s vs median 2m 15s

## Publish decision
**GO**

## Next commands
```bash
pnpm run pipeline:report --session 20261127T111903Z-16a1
```
