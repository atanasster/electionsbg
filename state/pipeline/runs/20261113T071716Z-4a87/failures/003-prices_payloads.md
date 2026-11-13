# Repair packet — post:price-hub-payloads › prices:payloads
Session `20261113T071716Z-4a87`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:price-hub-payloads`
- Step: `prices:payloads` (phase derive)
- Command: `pnpm run prices:payloads`
- Result: error, exit 1, after 1m 33s
- Class: `db-local-down` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/electionsbg pnpm run prices:payloads
```

## 3. Evidence
First error line: `Error: Connection terminated unexpectedly`
Log `logs/pipeline/20261113T071716Z-4a87/003-prices_payloads.log` — showing lines 1–18 of 18; the first error line is line 9.
```
    1  # step     prices:payloads
    2  # command  pnpm run prices:payloads
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  60 min
    6  # started  2026-11-13T07:18:57.007Z
    7  
    8  07:18:57.326 ! $ NODE_OPTIONS=--max-old-space-size=8192 tsx ./scripts/prices/build_payloads.ts
    9  07:20:26.186 ! Error: Connection terminated unexpectedly
   10  07:20:26.211 !     at /Users/atanasster/data-bg/node_modules/pg-pool/index.js:45:11
   11  07:20:26.211 !     at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
   12  07:20:26.211 !     at async allRows (/Users/atanasster/data-bg/scripts/db/lib/pg.ts:266:21)
   13  07:20:26.211 !     at async Promise.all (index 0)
   14  07:20:26.211 !     at async loadGridsFromPg (/Users/atanasster/data-bg/scripts/prices/lib/grids_pg.ts:48:54)
   15  07:20:26.211 !     at async buildPayloads (/Users/atanasster/data-bg/scripts/prices/build_payloads.ts:167:17)
   16  07:20:29.115 ! [ELIFECYCLE] Command failed with exit code 1.
   17  
   18  # ended    2026-11-13T07:20:30.257Z · error · exit 1 · 93158 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/prices/build_payloads.ts`
- Local imports: `scripts/db/lib/copy.ts`, `scripts/db/lib/pg.ts`, `scripts/db/lib/stage_merge.ts`, `scripts/prices/build_index.ts`, `scripts/prices/lib/grids_pg.ts`, `scripts/prices/promoGate.ts`, `src/data/prices/headline.ts`, `src/lib/priceStaleness.ts`
- Tests: `scripts/db/lib/copy.test.ts`, `scripts/db/lib/pg.test.ts`, `scripts/prices/build_index.test.ts`, `src/lib/priceStaleness.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
b7c32578d1 2026-09-12 docs: consolidate completed implementation plans
32cc2c31ae 2026-09-01 home dashboard phase 5: prices, budget and debt events
fe3afcf863 2026-08-31 products search: the box could not see шльокавица, because the title had no fold
1c687acc89 2026-08-25 consumption hub head: the cheapest-basket aside, and the ranking it had to correct
```
This step's last outcomes in earlier sessions:
_(no earlier runs of this step)_

## 7. Guidance
- Classifier hint (db-local-down): Local Postgres is down — `pnpm run db:pg:up`. The step is pinned to the local database, so this dropped connection was the docker Postgres (restarted, OOM-killed, or its container removed) — `docker ps -a | grep electionsbg-pg`.

## 8. State left behind
- Post-step post:price-hub-payloads did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run prices:payloads` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
