# Repair packet — post:home › home:health
Session `20261112T224531Z-2bec`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:home`
- Step: `home:health` (phase verify)
- Command: `pnpm run home:health`
- Result: error, exit 1, after 472ms
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/electionsbg pnpm run home:health
```

## 3. Evidence
First error line: `home: stale — opencalls: last moved 2026-09-24, 49d behind, ceiling 45d`
Log `logs/pipeline/20261112T224531Z-2bec/027-home_health.log` — showing lines 1–23 of 23; the first error line is line 20.
```
    1  # step     home:health
    2  # command  pnpm run home:health
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-12T23:18:49.338Z
    7  
    8  23:18:49.658 ! $ tsx scripts/db/gen_home/health.ts
    9  23:18:49.803   home: hub_stats computedAt 2026-10-31
   10  23:18:49.804   home: feed computedAt 2026-11-12 · 23 events
   11  23:18:49.804     budget       ok  2026-09-30  43d behind · ceiling 120d
   12  23:18:49.804     council      ok  2026-11-05  7d behind · ceiling 45d
   13  23:18:49.804     debt         ok  2026-09-28  45d behind · ceiling 75d
   14  23:18:49.804     elections    ok  2026-04-19  207d behind · no cadence
   15  23:18:49.804     intl_debt    ok  —           no vintage
   16  23:18:49.804     macro        ok  2026-11-04  8d behind · ceiling 60d
   17  23:18:49.804     opencalls    ok  2026-09-24  49d behind · ceiling 45d  ⚠ STALE
   18  23:18:49.804     parliament   ok  2026-11-06  6d behind · ceiling 90d
   19  23:18:49.804     prices       ok  2026-11-12  0d behind · ceiling 5d
   20  23:18:49.804 ! home: stale — opencalls: last moved 2026-09-24, 49d behind, ceiling 45d
   21  23:18:49.808 ! [ELIFECYCLE] Command failed with exit code 1.
   22  
   23  # ended    2026-11-12T23:18:49.811Z · error · exit 1 · 472 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/db/gen_home/health.ts`
- Local imports: `scripts/db/gen_home/events/adapters.ts`, `scripts/db/gen_home/period.ts`, `scripts/db/lib/bucket.ts`, `src/data/home/homeTypes.ts`
- Tests: `scripts/db/gen_home/health.test.ts`, `scripts/db/gen_home/events/adapters.test.ts`, `src/data/home/homeTypes.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
2eab28d3ff 2026-09-27 home: retire the flyover band and freeze the money-map article images
1566f6fd0f 2026-09-06 flyover tier0 step 3: the artifact, and the numbers that name their basis
3fba99a545 2026-09-01 home KPIs land on their own number, not at the top of the page
95eaac2193 2026-09-01 home dashboard phase 6: watcher integration and operational hardening
```
This step's last outcomes in earlier sessions:
- 2026-11-01T01:46 ok 466ms (20261031T225018Z-4df0)
- 2026-11-06T01:09 ok 294ms (20261105T230228Z-3b4f)
- 2026-11-07T04:09 ok 194ms (20261107T024133Z-6aa7)
- 2026-11-08T00:15 ok 621ms (20261108T000126Z-6855)
- 2026-11-08T23:42 ok 291ms (20261108T225046Z-471d)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- Post-step post:home did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run home:health` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
