# Repair packet — update-prices › prices
Session `20261127T084406Z-3b83`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `update-prices`
- Step: `prices` (phase ingest)
- Command: `pnpm run prices`
- Result: error, exit 1, after 1m 57s
- Class: `egress` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm run prices
```

## 3. Evidence
First error line: `[errors]: [ [Error], [Error], [Error], [Error] ]`
Line the classifier matched: `code: 'ETIMEDOUT',`
Log `logs/pipeline/20261127T084406Z-3b83/020-prices.log` — showing lines 1–27 of 27; the first error line is line 22.
```
    1  # step     prices
    2  # command  pnpm run prices
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  90 min
    6  # started  2026-11-27T08:55:48.219Z
    7  
    8  08:55:48.607 ! $ NODE_OPTIONS=--max-old-space-size=6144 tsx ./scripts/prices/ingest.ts
    9  08:57:44.529   [prices] 2026-11-24: 1,095,810 rows · 166 settlements · 62 chains · +18,331 facts, 16,658 closed · 143 legacy-code rows skipped
   10  08:57:45.050 ! TypeError: fetch failed
   11  08:57:45.050 !     at node:internal/deps/undici/undici:15456:13
   12  08:57:45.050 !     at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
   13  08:57:45.050 !     at async downloadDay (/Users/atanasster/data-bg/scripts/prices/lib/fetch.ts:61:15)
   14  08:57:45.050 !     at async main (/Users/atanasster/data-bg/scripts/prices/ingest.ts:121:19) {
   15  08:57:45.050 !   [cause]: AggregateError [ETIMEDOUT]: 
   16  08:57:45.050 !       at internalConnectMultiple (node:net:1135:18)
   17  08:57:45.050 !       at internalConnectMultiple (node:net:1211:5)
   18  08:57:45.050 !       at Timeout.internalConnectMultipleTimeout (node:net:1743:5)
   19  08:57:45.050 !       at listOnTimeout (node:internal/timers:587:11)
   20  08:57:45.050 !       at process.processTimers (node:internal/timers:521:7) {
   21  08:57:45.050 !     code: 'ETIMEDOUT',
   22  08:57:45.050 !     [errors]: [ [Error], [Error], [Error], [Error] ]
   23  08:57:45.050 !   }
   24  08:57:45.050 ! }
   25  08:57:45.131 ! [ELIFECYCLE] Command failed with exit code 1.
   26  
   27  # ended    2026-11-27T08:57:45.137Z · error · exit 1 · 116916 ms
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
- 2026-11-18T07:46 ok 12m 20s (20261118T073436Z-2423)
- 2026-11-18T23:21 ok 12m 15s (20261118T224713Z-a15e)
- 2026-11-19T23:29 ok 6m 41s (20261119T224050Z-906c)
- 2026-11-22T17:16 ok 25m 03s (20261122T161415Z-2564)
- 2026-11-23T22:56 ok 6m 32s (20261123T224804Z-8290)

## 7. Guidance
- Classifier hint (egress): A connect timeout — usually the wrong exit country (parliament.bg/МО/ЦИК need non-BG, КЗК/АСП/ГИТ need BG); run `pnpm run pipeline:doctor`.
- The runbook for this handler: .claude/skills/update-prices/SKILL.md (troubleshooting section).

## 8. State left behind
- Marker state/ingest/update-prices.json was NOT stamped — the handler re-queues on the next run.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm run prices` exits 0 when re-run.
- Then `pnpm run pipeline:ingest --only update-prices` finishes with the handler ok and its marker stamped.
