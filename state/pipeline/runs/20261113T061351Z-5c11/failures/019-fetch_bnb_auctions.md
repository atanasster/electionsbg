# Repair packet — update-macro › fetch_bnb_auctions
Session `20261113T061351Z-5c11`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `update-macro`
- Step: `fetch_bnb_auctions` (phase ingest)
- Command: `pnpm exec tsx scripts/macro/fetch_bnb_auctions.ts`
- Result: error, exit 1, after 1s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5433/electionsbg pnpm exec tsx scripts/macro/fetch_bnb_auctions.ts
```

## 3. Evidence
First error line: `Error: BNB returned 500 for https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=2019`
Log `logs/pipeline/20261113T061351Z-5c11/019-fetch_bnb_auctions.log` — showing lines 1–15 of 15; the first error line is line 9.
```
    1  # step     fetch_bnb_auctions
    2  # command  pnpm exec tsx scripts/macro/fetch_bnb_auctions.ts
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-13T06:22:17.482Z
    7  
    8  06:22:18.536 ! failed: BNB returned 500 for https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=2019
    9  06:22:18.539 ! Error: BNB returned 500 for https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=2019
   10  06:22:18.539 !     at fetchText (/Users/atanasster/data-bg/scripts/macro/fetch_bnb_auctions.ts:79:11)
   11  06:22:18.539 !     at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
   12  06:22:18.539 !     at async main (/Users/atanasster/data-bg/scripts/macro/fetch_bnb_auctions.ts:351:17)
   13  06:22:18.551   Year 2019: fetching index... 
   14  
   15  # ended    2026-11-13T06:22:18.552Z · error · exit 1 · 1069 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/macro/fetch_bnb_auctions.ts`
- Tests: _(none found next to these files)_

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
7877d52a1e 2026-05-15 indicators: nominal fiscal series + sovereign debt emissions table
```
Watcher state of the source(s) that triggered this run:
- `bnb_auctions`: 26 auction(s) in 2025-2026 · latest 2026-11-09
```json
{
  "ids": [
    "FA_AR_20250120_A1_BG",
    "FA_AR_20250127_A1_BG",
    "FA_AR_20250210_A1_BG",
    "FA_AR_20250224_A1_BG",
    "FA_AR_20250310_A1_BG",
    "FA_AR_20250324_A1_BG",
    "FA_AR_20250407_A1_BG",
    "FA_AR_20250414_A1_BG",
    "FA_AR_20250616_A1_BG",
    "FA_AR_20250825_A1_BG",
    "FA_AR_20250915_A1_BG",
    "FA_AR_20251020_A1_BG",
    "FA_AR_20251117_A1_BG",
    "FA_AR_20260119_A1_BG",
    "FA_AR_20260126_A1_BG",
    "FA_AR_20260209_A1_BG",
    "FA_AR_20260223_A1_BG",
    "FA_AR_20260309_A1_BG",
    "FA_AR_20260323_A1_BG",
    "FA_AR_20260406_A1_BG",
    "FA_AR_20260420_A1_BG",
    "FA_AR_20260511_A1_BG",
    "FA_AR_20260727_A1_BG",
    "FA_AR_20260824_A1_BG",
    "FA_AR_20260928_A1_BG",
    "FA_AR_20261109_A1_BG"
  ],
  "latestDate": "2026-11-09",
  "count": 26
}
```
This step's last outcomes in earlier sessions:
- 2026-08-30T22:40 ok 43s (20260830T223459Z-6829)

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.
- The runbook for this handler: .claude/skills/update-macro/SKILL.md (troubleshooting section).

## 8. State left behind
- Marker state/ingest/update-macro.json was NOT stamped — the handler re-queues on the next run.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm exec tsx scripts/macro/fetch_bnb_auctions.ts` exits 0 when re-run.
- Then `pnpm run pipeline:ingest --only update-macro` finishes with the handler ok and its marker stamped.
