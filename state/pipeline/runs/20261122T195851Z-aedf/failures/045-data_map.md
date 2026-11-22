# Repair packet — post:data-map › data:map
Session `20261122T195851Z-aedf`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `post:data-map`
- Step: `data:map` (phase derive)
- Command: `pnpm run data:map`
- Result: error, exit 1, after 2s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm run data:map
```

## 3. Evidence
First error line: `Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole corpus with no node is a MISSING DATASET, not an UNCLAIMED entry.`
Log `logs/pipeline/20261122T195851Z-aedf/045-data_map.log` — showing lines 1–18 of 18; the first error line is line 14.
```
    1  # step     data:map
    2  # command  pnpm run data:map
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-22T20:15:10.363Z
    7  
    8  20:15:10.657 ! $ tsx ./scripts/data_map/build_manifest.ts
    9  20:15:11.892 ! 
   10  20:15:11.892 ! data_map: 2 Postgres relation(s) belong to no dataset node:
   11  20:15:11.892 !   ds_announcement
   12  20:15:11.892 !   ds_decision
   13  20:15:11.892 ! 
   14  20:15:11.892 ! Add each to the owning DatasetDef's tables[] in model.ts — or, if it is scratch, ingest plumbing or an operator override, to UNCLAIMED with the reason. A whole corpus with no node is a MISSING DATASET, not an UNCLAIMED entry.
   15  20:15:11.892 ! 
   16  20:15:11.900 ! [ELIFECYCLE] Command failed with exit code 1.
   17  
   18  # ended    2026-11-22T20:15:11.905Z · error · exit 1 · 1539 ms
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
f35dcad587 2026-11-22 comdos step 2: decision parser + committed data/comdos corpus (no recruiter names), excluded from bucket sync
b383ed4a6b 2026-11-16 watch: ask the host before skipping a non-bg source — a BG residential line reaches parliament.bg/ЦИК/МО; only the datacenter VPN timed out
d848a54c76 2026-11-12 pipeline tier5 step 11: watcher hardening — JSON report, health ledger, egress blocking, scope log
a21d9caaee 2026-11-05 news: remove the frozen news project, now in its own repo
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
```
This step's last outcomes in earlier sessions:
- 2026-11-18T07:47 ok 7s (20261118T073436Z-2423)
- 2026-11-18T23:32 ok 9s (20261118T224713Z-a15e)
- 2026-11-19T11:42 ok 7s (20261119T113147Z-ad3f)
- 2026-11-19T23:41 ok 7s (20261119T224050Z-906c)
- 2026-11-22T17:28 error 2s (20261122T161415Z-2564)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- Post-step post:data-map did not complete; the publish is held.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run data:map` exits 0 when re-run.
- Then the next `pnpm run pipeline:ingest` runs this post-step ok.
