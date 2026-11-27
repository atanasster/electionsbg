# Repair packet — update-prices › prices › via BG proxy
Session `20261127T084406Z-3b83`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `update-prices`
- Step: `prices › via BG proxy` (phase ingest)
- Command: `pnpm run prices`
- Result: error, exit 1, after 2m 27s
- Class: `missing-input` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm run prices
```

## 3. Evidence
First error line: `at emitErrorCloseNT (node:internal/streams/destroy:129:3)`
Line the classifier matched: `Error: ENOENT: no such file or directory, open '/Users/atanasster/data-bg/raw_data/prices/2026-11-26.zip'`
Log `logs/pipeline/20261127T084406Z-3b83/021-prices_via_BG_proxy.log` — showing lines 1–35 of 35; the first error line is line 24.
```
    1  # step     prices › via BG proxy
    2  # command  pnpm run prices
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  88.05135 min
    6  # egress   via BG proxy mac:8118
    7  # started  2026-11-27T08:57:45.140Z
    8  
    9  08:57:45.458 ! $ NODE_OPTIONS=--max-old-space-size=6144 tsx ./scripts/prices/ingest.ts
   10  08:57:45.526 ! (node:67925) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.
   11  08:57:45.526 ! (Use `node --trace-warnings ...` to show where the warning was created)
   12  08:57:45.680 ! (node:67958) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.
   13  08:57:45.680 ! (Use `node --trace-warnings ...` to show where the warning was created)
   14  08:57:45.789 ! (node:67958) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.
   15  08:57:45.789 ! (Use `node --trace-warnings ...` to show where the warning was created)
   16  08:59:56.401   [prices] 2026-11-25: 1,096,229 rows · 166 settlements · 62 chains · +15,552 facts, 14,994 closed · 143 legacy-code rows skipped
   17  09:00:12.369 ! node:events:497
   18  09:00:12.369 !       throw er; // Unhandled 'error' event
   19  09:00:12.369 !       ^
   20  09:00:12.369 ! 
   21  09:00:12.369 ! Error: ENOENT: no such file or directory, open '/Users/atanasster/data-bg/raw_data/prices/2026-11-26.zip'
   22  09:00:12.369 ! Emitted 'error' event on ReadStream instance at:
   23  09:00:12.369 !     at emitErrorNT (node:internal/streams/destroy:170:8)
   24  09:00:12.369 !     at emitErrorCloseNT (node:internal/streams/destroy:129:3)
   25  09:00:12.369 !     at process.processTicksAndRejections (node:internal/process/task_queues:89:21) {
   26  09:00:12.369 !   errno: -2,
   27  09:00:12.369 !   code: 'ENOENT',
   28  09:00:12.369 !   syscall: 'open',
   29  09:00:12.369 !   path: '/Users/atanasster/data-bg/raw_data/prices/2026-11-26.zip'
   30  09:00:12.369 ! }
   31  09:00:12.369 ! 
   32  09:00:12.369 ! Node.js v22.23.4
   33  09:00:12.447 ! [ELIFECYCLE] Command failed with exit code 1.
   34  
   35  # ended    2026-11-27T09:00:12.456Z · error · exit 1 · 147315 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/prices/ingest.ts`
- Local imports: `scripts/db/lib/pg.ts`, `scripts/lib/data-changes.ts`, `scripts/prices/build_payloads.ts`, `scripts/prices/build_product_days.ts`, `scripts/prices/export_slugs.ts`, `scripts/prices/lib/fetch.ts`, `scripts/prices/load_day.ts`, `scripts/prices/rebuild_catalog.ts`, `scripts/prices/seed_dict.ts`
- Tests: `scripts/db/lib/pg.test.ts`, `scripts/lib/data-changes.test.ts`, `scripts/prices/load_day.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
46abd19e7b 2026-10-24 prices: raw ZIPs move to the Storage drive; drop the Coldline archive path
b7c32578d1 2026-09-12 docs: consolidate completed implementation plans
32cc2c31ae 2026-09-01 home dashboard phase 5: prices, budget and debt events
fe3afcf863 2026-08-31 products search: the box could not see шльокавица, because the title had no fold
```
Watcher state of the source(s) that triggered this run:
- `kzp_prices`: latest 2026-11-25 · 14 days advertised
```json
{
  "latest": "2026-11-25",
  "dates": [
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
    "2026-11-23",
    "2026-11-24",
    "2026-11-25"
  ]
}
```
This step's last outcomes in earlier sessions:
_(no earlier runs of this step)_

## 7. Guidance
- Classifier hint (missing-input): An input file is missing — check the handler's operator step (a manual download?) before re-running.
- The runbook for this handler: .claude/skills/update-prices/SKILL.md (troubleshooting section).

## 8. State left behind
- Marker state/ingest/update-prices.json was NOT stamped — the handler re-queues on the next run.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run prices` exits 0 when re-run.
- Then `pnpm run pipeline:ingest --only update-prices` finishes with the handler ok and its marker stamped.
