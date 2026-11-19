# Repair packet — ec_forecast_bg › check_policy_anchors
Session `20261119T224050Z-906c`. Read top to bottom; everything needed to reproduce and fix this failure is here.

## 1. What failed
- Unit: `ec_forecast_bg`
- Step: `check_policy_anchors` (phase verify)
- Command: `pnpm exec tsx scripts/budget/check_policy_anchors.ts --source ec_forecast_bg --stamp`
- Result: error, exit 1, after 1s
- Class: `unknown` (retryable: no)

## 2. Reproduce
```bash
DATABASE_URL=postgres://postgres:***@localhost:5433/electionsbg pnpm exec tsx scripts/budget/check_policy_anchors.ts --source ec_forecast_bg --stamp
```

## 3. Evidence
First error line: `1 anchor(s) drifted or failed to probe — manual edit required (see lines above), then re-run with --stamp.`
Log `logs/pipeline/20261119T224050Z-906c/036-check_policy_anchors.log` — showing lines 1–17 of 17; the first error line is line 15.
```
    1  # step     check_policy_anchors
    2  # command  pnpm exec tsx scripts/budget/check_policy_anchors.ts --source ec_forecast_bg --stamp
    3  # cwd      /Users/atanasster/data-bg
    4  # db pin   local (postgres://postgres:***@localhost:5433/electionsbg)
    5  # timeout  30 min
    6  # started  2026-11-19T23:20:46.940Z
    7  
    8  23:20:47.578   
    9  23:20:47.578   === country_profiles (offline invariants) ===
   10  23:20:47.578     PASS  8 country profiles consistent with per-lever options and within slider bounds
   11  23:20:47.578   
   12  23:20:47.578   === ec_forecast_bg ===
   13  23:20:48.082     DRIFT live edition "autumn 2026" != EC_FORECAST_EDITION "spring 2026" — update EC_BALANCE_PCT + MACRO_PATH + EC_FORECAST_EDITION in src/lib/bgFiscalProjection.ts from the new forecast, then re-run __smoke_fiscal_projection.ts AND __smoke_behavioral.ts (their EC-anchor invariants move in the same commit), and re-check the i18n strings naming the edition (budget_policy_hero_deficit* …[+37 chars]
   14  23:20:48.082   
   15  23:20:48.082   1 anchor(s) drifted or failed to probe — manual edit required (see lines above), then re-run with --stamp.
   16  
   17  # ended    2026-11-19T23:20:48.093Z · error · exit 1 · 1150 ms
```

## 4. Expected vs observed
_(no gate on this unit; the step's expectation is exit 0)_

## 5. Where the code is
- Entry: `scripts/budget/check_policy_anchors.ts`
- Local imports: `scripts/watch/sources/eu_policy_anchors.ts`, `src/lib/bgFiscalProjection.ts`, `src/lib/euPolicyPresets.ts`
- Tests: `scripts/watch/sources/eu_policy_anchors.test.ts`

## 6. What changed
Recent commits touching that code:
```
1592a49200 2026-10-31 chore: move from npm to pnpm 12.16.1
9e7b5b396f 2026-10-15 budget simulator: re-anchor fiscal projection to МФ Draft Budgetary Plan 2027
bc0f19ed35 2026-10-11 watch: fix OECD SDMX watcher dark since 2026-07-15; exempt polls review fixtures from skip gate
33f0616a16 2026-08-10 watch(nato_defence): discover compendium editions from the listing page
e34056fef8 2026-07-13 budget/simulator: refresh NATO 2026 defence anchors (LT 5.3%/EE 5.1%), raise def slider max to 6%
```
Watcher state of the source(s) that triggered this run:
- `ec_forecast_bg`: latest edition: autumn 2026
```json
{
  "edition": "autumn 2026"
}
```
This step's last outcomes in earlier sessions:
_(no earlier runs of this step)_

## 7. Guidance
- Classifier hint (unknown): Exit 1 with no recognisable error — read the full log.

## 8. State left behind
- Marker state/ingest/ec_forecast_bg.json was NOT stamped (restored to its pre-run copy) — the handler re-queues on the next run.
- It wrote no files under its outputs.

## 9. Done means
- `pnpm exec tsx scripts/budget/check_policy_anchors.ts --source ec_forecast_bg --stamp` exits 0 when re-run.
- Then `pnpm run pipeline:ingest --only ec_forecast_bg` finishes with the handler ok and its marker stamped.
