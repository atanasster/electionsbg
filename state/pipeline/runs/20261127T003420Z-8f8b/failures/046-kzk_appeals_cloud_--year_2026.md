# Repair packet — cloud › kzk:appeals:cloud --year 2026
Session `20261127T003420Z-8f8b`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `cloud`
- Step: `kzk:appeals:cloud --year 2026` (phase publish)
- Command: `pnpm run kzk:appeals:cloud --year 2026`
- Result: error, exit 1, after 1m 23s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
nc -z 127.0.0.1 5434 && pnpm run kzk:appeals:cloud --year 2026
```

## 3. Evidence
First error line: `name: 'TimeoutError'`
Log `logs/pipeline/20261127T003420Z-8f8b/046-kzk_appeals_cloud_--year_2026.log` — showing lines 1–39 of 39; the first error line is line 33.
```
    1  # step     kzk:appeals:cloud --year 2026
    2  # command  pnpm run kzk:appeals:cloud --year 2026
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   cloud
    5  # timeout  90 min
    6  # started  2026-11-27T01:15:40.183Z
    7  
    8  01:15:40.541 ! $ DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg tsx scripts/db/apply_functions.ts 042_kzk_appeals.sql && DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg tsx scripts/procurement/kzk_appeals.ts --apply --year 2026
    9  01:15:40.984   applying 1 file(s) to postgres://postgres@127.0.0.1:5434/electionsbg
   10  01:15:41.403 ! (node:537) DeprecationWarning: pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code.
   11  01:15:41.403 ! (Use `node --trace-deprecation ...` to show where the warning was created)
   12  01:15:42.590     applied 042_kzk_appeals.sql
   13  01:15:42.721   done
   14  01:15:43.352 ! (node:652) DeprecationWarning: pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code.
   15  01:15:43.352 ! (Use `node --trace-deprecation ...` to show where the warning was created)
   16  01:15:44.247 !   … kzk: incremental mode — 8331 complaint(s) already in the target DB; will stop at the first fully-known page (pass --full to force a complete crawl)
   17  01:17:02.729 ! node:internal/process/promises:394
   18  01:17:02.729 !     triggerUncaughtException(err, true /* fromPromise */);
   19  01:17:02.729 !     ^
   20  01:17:02.729 ! 
   21  01:17:02.729 ! locator.waitFor: Timeout 15000ms exceeded.
   22  01:17:02.729 ! Call log:
   23  01:17:02.729 !   - waiting for locator('a[href*=\'Complaint.aspx?ID=\']').first() to be visible
   24  01:17:02.729 ! 
   25  01:17:02.729 !     at crawlYear (/Users/atanasster/data-bg/scripts/procurement/kzk_appeals.ts:217:10)
   26  01:17:02.729 !     at async Object.handler (/Users/atanasster/data-bg/scripts/procurement/kzk_appeals.ts:982:24)
   27  01:17:02.729 !     at async Object.run (/Users/atanasster/data-bg/node_modules/cmd-ts/src/command.ts:186:24)
   28  01:17:02.729 !     at async runSafely (/Users/atanasster/data-bg/node_modules/cmd-ts/src/runner.ts:46:20)
   29  01:17:02.729 !     at async run (/Users/atanasster/data-bg/node_modules/cmd-ts/src/runner.ts:27:18) {
   30  01:17:02.729 !   log: [
   31  01:17:02.729 !     "  - waiting for locator('a[href*=\\'Complaint.aspx?ID=\\']').first() to be visible"
   32  01:17:02.729 !   ],
   33  01:17:02.729 !   name: 'TimeoutError'
   34  01:17:02.729 ! }
   35  01:17:02.729 ! 
   36  01:17:02.729 ! Node.js v22.23.4
   37  01:17:02.752 ! [ELIFECYCLE] Command failed with exit code 1.
   38  
   39  # ended    2026-11-27T01:17:02.771Z · error · exit 1 · 82573 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/db/apply_functions.ts`
- Local imports: `scripts/db/lib/collateral_drop.ts`, `scripts/db/lib/pg.ts`
- Tests: `scripts/db/lib/pg.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
b7c32578d1 2026-09-12 docs: consolidate completed implementation plans
94a06417d7 2026-08-20 council: reclaim the heap slack an every-row upsert leaves behind
d9e4f7a6ed 2026-08-19 db: the collateral-drop guard the loader never had, and it fires on ABORT
1f3d401aa8 2026-08-15 db: an apply that drops four matviews and recreates none now says so
```
This step's last outcomes in earlier sessions:
- 2026-11-15T09:34 ok 46s (20261115T093049Z-bf67)
- 2026-11-19T23:53 ok 39s (20261119T235039Z-3af7)
- 2026-11-20T00:05 skipped 0ms (20261120T000545Z-cf6e)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- state/upload/pending.json is left on disk — the publish is NOT complete.
- Steps after kzk:appeals:cloud --year 2026 in this publish were not run.
- Every :cloud loader is idempotent: re-running this one after the fix is safe.

## 9. Done means
- `pnpm run kzk:appeals:cloud --year 2026` exits 0.
- Then: `pnpm run pipeline:publish --yes --start-at "kzk:appeals:cloud --year 2026"` finishes with exit 0 and clears the manifest.
