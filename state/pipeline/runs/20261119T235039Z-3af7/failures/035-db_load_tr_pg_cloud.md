# Repair packet — cloud › db:load:tr:pg:cloud
Session `20261119T235039Z-3af7`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `cloud`
- Step: `db:load:tr:pg:cloud` (phase publish)
- Command: `pnpm run db:load:tr:pg:cloud`
- Result: error, exit 1, after 1m 05s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
nc -z 127.0.0.1 5434 && pnpm run db:load:tr:pg:cloud
```

## 3. Evidence
First error line: `at emitErrorCloseNT (node:internal/streams/destroy:129:3)`
Log `logs/pipeline/20261119T235039Z-3af7/035-db_load_tr_pg_cloud.log` — showing lines 1–38 of 38; the first error line is line 27.
```
    1  # step     db:load:tr:pg:cloud
    2  # command  pnpm run db:load:tr:pg:cloud
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   cloud
    5  # timeout  90 min
    6  # started  2026-11-20T00:04:00.159Z
    7  
    8  00:04:00.696 ! $ DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg pnpm run db:load:tr:pg
    9  00:04:00.747 ! $ NODE_OPTIONS=--max-old-space-size=6144 tsx scripts/db/load_tr_pg.ts
   10  00:04:01.686 ! (node:37425) ExperimentalWarning: SQLite is an experimental feature and might change at any time
   11  00:04:01.686 ! (Use `node --trace-warnings ...` to show where the warning was created)
   12  00:04:02.129 ! (node:37425) DeprecationWarning: pgpass support is deprecated and will be removed in pg@9.0. You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code.
   13  00:04:02.624     phase  apply 000/003/005  0.4s
   14  00:04:30.310     phase  read 1031131 companies (sqlite)  27.7s
   15  00:05:04.695 ! node:events:497
   16  00:05:04.695 !       throw er; // Unhandled 'error' event
   17  00:05:04.695 !       ^
   18  00:05:04.695 ! 
   19  00:05:04.695 ! Error: write EPIPE
   20  00:05:04.695 !     at WriteWrap.onWriteComplete [as oncomplete] (node:internal/stream_base_commons:87:19)
   21  00:05:04.695 ! Emitted 'error' event on Client instance at:
   22  00:05:04.695 !     at Client._handleErrorEvent (/Users/atanasster/data-bg/node_modules/pg/lib/client.js:417:10)
   23  00:05:04.695 !     at Connection.emit (node:events:519:28)
   24  00:05:04.695 !     at Socket.reportStreamError (/Users/atanasster/data-bg/node_modules/pg/lib/connection.js:58:12)
   25  00:05:04.695 !     at Socket.emit (node:events:519:28)
   26  00:05:04.695 !     at emitErrorNT (node:internal/streams/destroy:170:8)
   27  00:05:04.695 !     at emitErrorCloseNT (node:internal/streams/destroy:129:3)
   28  00:05:04.695 !     at process.processTicksAndRejections (node:internal/process/task_queues:89:21) {
   29  00:05:04.695 !   errno: -32,
   30  00:05:04.695 !   code: 'EPIPE',
   31  00:05:04.695 !   syscall: 'write'
   32  00:05:04.695 ! }
   33  00:05:04.695 ! 
   34  00:05:04.695 ! Node.js v22.23.4
   35  00:05:04.873 ! [ELIFECYCLE] Command failed with exit code 1.
   36  00:05:04.876 ! [ELIFECYCLE] Command failed with exit code 1.
   37  
   38  # ended    2026-11-20T00:05:04.892Z · error · exit 1 · 64720 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
_(the command names no script file; start from the command above)_

## 6. What changed
Recent commits touching that code:
_(none found)_
This step's last outcomes in earlier sessions:
- 2026-11-12T23:47 ok 25m 07s (20261112T232015Z-29c9)
- 2026-11-15T09:53 ok 15m 45s (20261115T093049Z-bf67)
- 2026-11-16T23:22 ok 10m 57s (20261116T230927Z-1b67)
- 2026-11-18T00:35 ok 24m 22s (20261118T000118Z-e9e1)
- 2026-11-18T23:47 ok 11m 39s (20261118T233305Z-7645)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- state/upload/pending.json is left on disk — the publish is NOT complete.
- Steps after db:load:tr:pg:cloud in this publish were not run.
- Every :cloud loader is idempotent: re-running this one after the fix is safe.

## 9. Done means
- `pnpm run db:load:tr:pg:cloud` exits 0.
- Then: `pnpm run pipeline:publish --yes --start-at "db:load:tr:pg:cloud"` finishes with exit 0 and clears the manifest.
