# Repair packet — post:governance-hub-stats › db:gen-governance-hub-stats
Session `20261127T084406Z-3b83`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:governance-hub-stats`
- Step: `db:gen-governance-hub-stats` (phase derive)
- Command: `pnpm run db:gen-governance-hub-stats`
- Result: timeout, exit signal, after 30m 00s
- Class: `timeout` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm run db:gen-governance-hub-stats
```

## 3. Evidence
First error line: `$ tsx scripts/db/gen_governance/hub_stats.ts`
Log `logs/pipeline/20261127T084406Z-3b83/024-db_gen-governance-hub-stats.log` — showing lines 1–11 of 11; the first error line is line 8.
```
    1  # step     db:gen-governance-hub-stats
    2  # command  pnpm run db:gen-governance-hub-stats
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-27T09:00:50.195Z
    7  
    8  09:00:50.584 ! $ tsx scripts/db/gen_governance/hub_stats.ts
    9  09:30:50.224 # TIMEOUT after 30 min — SIGTERM to the process group
   10  
   11  # ended    2026-11-27T09:30:50.297Z · timeout · exit signal SIGTERM · 1800101 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/db/gen_governance/hub_stats.ts`
- Local imports: `scripts/db/gen_procurement/preflight.ts`, `scripts/db/lib/pg.ts`
- Tests: `scripts/db/lib/pg.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
b7c32578d1 2026-09-12 docs: consolidate completed implementation plans
9c2525f328 2026-08-25 gen_governance: prettier reflow of the pick block
23393b61e9 2026-08-25 budget hub head: the share card, and the same false caption one hub up
89e1381d4e 2026-08-24 governance: one blob, a finder, and figures on the tiles
```
This step's last outcomes in earlier sessions:
- 2026-11-22T22:49 ok 585ms (20261122T224518Z-66a2)
- 2026-11-23T02:08 ok 614ms (20261123T020043Z-c698)
- 2026-11-23T22:56 ok 632ms (20261123T224804Z-8290)
- 2026-11-23T23:55 ok 311ms (20261123T232336Z-09f2)
- 2026-11-26T21:11 ok 604ms (20261126T194848Z-0f39)

## 7. Guidance
- Classifier hint (timeout): The step exceeded its timeout and was killed — check whether it hung (no output for a long stretch) or is just slower than its budget.

## 8. State left behind
- Post-step post:governance-hub-stats did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run db:gen-governance-hub-stats` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
