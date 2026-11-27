# Repair packet — post:data-map › data:map
Session `20261127T084406Z-3b83`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:data-map`
- Step: `data:map` (phase derive)
- Command: `pnpm run data:map`
- Result: error, exit 1, after 1s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm run data:map
```

## 3. Evidence
First error line: `Error [TransformError]: The service was stopped`
Log `logs/pipeline/20261127T084406Z-3b83/023-data_map.log` — showing lines 1–24 of 24; the first error line is line 13.
```
    1  # step     data:map
    2  # command  pnpm run data:map
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-27T09:00:48.569Z
    7  
    8  09:00:49.094 ! $ tsx ./scripts/data_map/build_manifest.ts
    9  09:00:49.851 ! 
   10  09:00:49.851 ! node:internal/modules/run_main:123
   11  09:00:49.851 !     triggerUncaughtException(
   12  09:00:49.851 !     ^
   13  09:00:49.851 ! Error [TransformError]: The service was stopped
   14  09:00:49.851 !     at /Users/atanasster/data-bg/node_modules/esbuild/lib/main.js:718:38
   15  09:00:49.851 !     at responseCallbacks.<computed> (/Users/atanasster/data-bg/node_modules/esbuild/lib/main.js:603:9)
   16  09:00:49.851 !     at Socket.afterClose (/Users/atanasster/data-bg/node_modules/esbuild/lib/main.js:594:28)
   17  09:00:49.851 !     at Socket.emit (node:events:531:35)
   18  09:00:49.851 !     at endReadableNT (node:internal/streams/readable:1698:12)
   19  09:00:49.851 !     at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
   20  09:00:49.851 ! 
   21  09:00:49.851 ! Node.js v22.23.4
   22  09:00:49.929 ! [ELIFECYCLE] Command failed with exit code 1.
   23  
   24  # ended    2026-11-27T09:00:49.932Z · error · exit 1 · 1363 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/data_map/build_manifest.ts`
- Local imports: `scripts/bucket_sync_paths.ts`, `scripts/data_map/model.ts`, `scripts/data_map/tourText.ts`, `scripts/watch/sources/index.ts`, `scripts/watch/types.ts`, `src/screens/dev/sqlLibrary.ts`
- Tests: `scripts/bucket_sync_paths.test.ts`, `scripts/data_map/model.test.ts`, `scripts/data_map/tourText.test.ts`

## 6. What changed
Recent commits touching that code:
```
c2999c09ff 2026-11-24 data map: ЗДОИ platform source + dataset, Държавен вестник named annex and ПМС decrees, budget tables 208/209; derive AI edges from /api/db route literals (AI_DB_ROUTE_RULES)
125052cc75 2026-11-24 insait-gap P2: ЗДОИ arm in the chat mentions tool (zdoi_mentions + /api/db/zdoi-search), zdoi_pitay watcher, update-zdoi handler and runbook
24f3ee2d82 2026-11-23 vaccines T6: health hub band, prerender/sitemap/llms, vaccineUptake AI tool, /data map
85166dca7f 2026-11-23 vaccines T1: watchers for НЗИС/СЕСПА/НЦЗПБ/Eurostat + append-only snapshot writer + update-vaccines handler
089f0709db 2026-11-23 tr: announced-acts index (ГФО / доклад / декларация) — Phase 0 of tr-gfo-ingest
```
This step's last outcomes in earlier sessions:
- 2026-11-22T20:15 error 2s (20261122T195851Z-aedf)
- 2026-11-22T22:49 ok 5s (20261122T224518Z-66a2)
- 2026-11-23T02:08 ok 7s (20261123T020043Z-c698)
- 2026-11-23T22:56 ok 5s (20261123T224804Z-8290)
- 2026-11-26T21:11 ok 5s (20261126T194848Z-0f39)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- Post-step post:data-map did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run data:map` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
