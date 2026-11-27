# Pipeline ingest run — 20261127T054056Z-ed76
Started 2026-11-27T05:40:56.713Z · ended 2026-11-27T05:41:03.444Z · git f4ac2838b6 → f4ac2838b6

## Verdict
**FAILED** (exit 3) — 1 unit(s): 0 ok · 0 partial · 1 failed · 0 blocked · 0 needs operator · 0 skipped

## Failures
- **preflight** — failed: refused to start: pg-local: port 5433 is open but SELECT 1 failed: could not open file "base/16384/2601": Read-only file system — start it with `pnpm run db:pg:up`; disk: repo volume 3.7 GB free (min 10); Docker VM ? GB free (min 8; `docker builder prune -af` frees space)

## Needs operator
_(none)_

## Needs agent
_(none)_

## What ran
### preflight — failed
Why: refused to start: pg-local: port 5433 is open but SELECT 1 failed: could not open file "base/16384/2601": Read-only file system — start it with `pnpm run db:pg:up`; disk: repo volume 3.7 GB free (min 10); Docker VM ? GB free (min 8; `docker builder prune -af` frees space)

## Findings
- previous run s3 died without a report during starting; last sign of life 2026-11-13T16:13:46.579Z — its live log is logs/pipeline/s3/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- preflight started local Postgres (ok); it was down at the start of the run
- preflight refused: pg-local: port 5433 is open but SELECT 1 failed: could not open file "base/16384/2601": Read-only file system — start it with `pnpm run db:pg:up`
- preflight refused: disk: repo volume 3.7 GB free (min 10); Docker VM ? GB free (min 8; `docker builder prune -af` frees space)

## Timings vs median
Sum of step durations: 0ms over 0 step(s).
No step ran more than 1.5× its median.

## Publish decision
_(not applicable to this run)_

## Next commands
```bash
# preflight: refused to start: pg-local: port 5433 is open but SELECT 1 failed: could not open file "base/16384/2601": Read-only file system — start it with `pnpm run db:pg:up`; disk: repo volume 3.7 GB free (min 10); Docker VM ? GB free (min 8; `docker builder prune -af` frees space)
pnpm run pipeline:report --session 20261127T054056Z-ed76
```
