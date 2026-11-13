# Repair packet — post:myarea-alerts › myarea:alerts
Session `20261113T071716Z-4a87`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:myarea-alerts`
- Step: `myarea:alerts` (phase derive)
- Command: `pnpm run myarea:alerts`
- Result: error, exit 1, after 21s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/electionsbg pnpm run myarea:alerts
```

## 3. Evidence
First error line: `` Error: [alerts] municipal awarders: Postgres unavailable — refusing to rewrite every alerts file without procurement data. Run `pnpm run db:pg:up` (and db:load:awarder-seats:pg), or set ALERTS_ALLOW_EMPTY=1 to accept empty alerts. Cause: the database system is in recovery mode ``
Log `logs/pipeline/20261113T071716Z-4a87/004-myarea_alerts.log` — showing lines 1–15 of 15; the first error line is line 9.
```
    1  # step     myarea:alerts
    2  # command  pnpm run myarea:alerts
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-13T07:20:30.480Z
    7  
    8  07:20:37.047 ! $ tsx ./scripts/myarea/build_alerts.ts
    9  07:20:51.224 ! Error: [alerts] municipal awarders: Postgres unavailable — refusing to rewrite every alerts file without procurement data. Run `pnpm run db:pg:up` (and db:load:awarder-seats:pg), or set ALERTS_ALLOW_EMPTY=1 to accept empty alerts. Cause: the database system is in recovery mode
   10  07:20:51.225 !     at readMunicipalAwardersByEkatte (/Users/atanasster/data-bg/scripts/db/lib/muni_awarders.ts:82:11)
   11  07:20:51.226 !     at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
   12  07:20:51.226 !     at async main (/Users/atanasster/data-bg/scripts/myarea/build_alerts.ts:772:32)
   13  07:20:51.253 ! [ELIFECYCLE] Command failed with exit code 1.
   14  
   15  # ended    2026-11-13T07:20:51.255Z · error · exit 1 · 20773 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/myarea/build_alerts.ts`
- Local imports: `scripts/db/lib/council_alerts.ts`, `scripts/db/lib/interreg_alerts.ts`, `scripts/db/lib/muni_awarders.ts`, `scripts/db/lib/opencalls_alerts.ts`, `scripts/db/lib/pg.ts`, `src/lib/obshtinaPlace.ts`
- Tests: `scripts/myarea/build_alerts.test.ts`, `scripts/db/lib/pg.test.ts`, `src/lib/obshtinaPlace.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
b7c32578d1 2026-09-12 docs: consolidate completed implementation plans
8ef4e80cda 2026-09-01 home dashboard phase 0: contracts, alert-kind registry, baselines
0f625bc56f 2026-08-25 council: name the repair tool, and stop the docs saying six
84199d8ebf 2026-08-22 T4b: the My-Area activity feed moves to Postgres — storage only, not the composition
```
This step's last outcomes in earlier sessions:
- 2026-11-07T04:08 ok 8s (20261107T024133Z-6aa7)
- 2026-11-08T00:14 ok 24s (20261108T000126Z-6855)
- 2026-11-08T23:41 ok 10s (20261108T225046Z-471d)
- 2026-11-12T23:18 ok 9s (20261112T224531Z-2bec)
- 2026-11-13T06:23 ok 10s (20261113T061351Z-5c11)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- Post-step post:myarea-alerts did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run myarea:alerts` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
