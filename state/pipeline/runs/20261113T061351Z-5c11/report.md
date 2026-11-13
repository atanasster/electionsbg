# Pipeline ingest run — 20261113T061351Z-5c11
Started 2026-11-13T06:17:12.951Z · ended 2026-11-13T06:23:29.370Z · git 950252356c → a3e2929872

## Verdict
**FAILED** (exit 1) — 26 unit(s): 13 ok · 1 partial · 1 failed · 2 blocked · 6 needs operator · 3 skipped

## Failures
- **update-macro › fetch_bnb_auctions** — error, exit 1 after 1s; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `Error: BNB returned 500 for https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=2019`
  Repair packet: `state/pipeline/runs/20261113T061351Z-5c11/failures/019-fetch_bnb_auctions.md` · log `logs/pipeline/20261113T061351Z-5c11/019-fetch_bnb_auctions.log`

## Needs operator
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for egov_procurement, cprs_register, ted_bg, adfi_inspections. Planned steps: pnpm run procurement:ingest-legacy --discover → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run cprs:ingest --apply --refresh → pnpm run db:load:cprs:pg → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg → pnpm run adfi:ingest --apply → pnpm run db:load:adfi:pg Runbook: `.claude/skills/update-procurement/SKILL.md`
- **update-budget** (run-runbook): Run update-budget for capital_programs. Planned steps: pnpm run db:load:budget:pg → pnpm run db:load:budget-muni:pg → pnpm run db:load:budget-hub:pg Runbook: `.claude/skills/update-budget/SKILL.md`

## What ran
### watcher — partial
Why: standing problem(s): nfc_film_register failing 3 runs in a row; nfc_commissions failing 3 runs in a row; oecd_pit_params failing 3 runs in a row
Summary: 4 blocked, 15 changed, 4 error, 86 skipped, 27 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | watch | ok | 3m 17s |  |

### update-rollcall — blocked
Why: egress:non-bg: exit IP country BG; parliament.bg, МО and ЦИК time out behind a Bulgarian exit
Sources: `parliament_votes`

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `egov_procurement`, `cprs_register`, `ted_bg`, `adfi_inspections`

### kzk_appeals — ok · marker stamped
Sources: `kzk_appeals`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 3 | kzk_appeals | ok | 25s |  |
| 4 | kzk:gates | ok | 11s |  |
| 5 | kzk:summary | ok | 559ms |  |
Files changed: `data/procurement/derived/kzk_appeals_summary.json`

### kzk_decisions — ok · marker stamped
Sources: `kzk_decisions`
Summary: 5 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | kzk:decisions | ok | 11s |  |
| 7 | db:load:kzk-decisions:pg | ok | 1s |  |
| 8 | kzk:rejoin | ok | 42s |  |
| 9 | kzk:gates | ok | 11s |  |
| 10 | kzk:summary | ok | 535ms |  |
Files changed: `data/procurement/derived/kzk_appeals_summary.json`, `data/procurement/derived/kzk_baselines.json`

### update-funds — ok · marker stamped
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `isun_clean_delivery`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | funds:ingest | ok | 17s |  |
| 12 | funds:ingest-projects | ok | 1m 09s |  |
| 13 | build_geo_pins | ok | 1s |  |
| 14 | db:load:funds:pg | ok | 20s |  |
| 15 | db:load:funds-fit:pg | ok | 1s |  |
| 16 | funds:parity | ok | 1m 17s |  |
| 17 | funds:clean-delivery | ok | 13s |  |
| 18 | db:load:clean-delivery:pg | ok | 1s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/BGS01.json`, `data/funds/projects/changes/BGS04.json` … +211

### update-budget — skipped
Why: delegated to the update-budget runbook (not yet a script)
Sources: `capital_programs`

### update-macro — failed · marker NOT stamped
Why: fetch_bnb_auctions failed
Sources: `bnb_auctions`

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | fetch_bnb_auctions | error | 1s | Error: BNB returned 500 for https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm?forYear=2019 |
| 20 | fetch_eurostat | skipped | 0ms | not run: fetch_bnb_auctions failed |

### update-administration — blocked
Why: runs after update-budget, which did not complete in this run (skipped)
Sources: `iisda_services`

### update-financing — ok · marker stamped
Sources: `smetna_palata`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | financing:scrape_index | ok | 1s |  |
Files changed: `data/financing/index.json`

### update-defense — needs-operator
Why: pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.
Sources: `mod_defense_report`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — needs-operator
Why: Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.
Sources: `ti_bg_lisi`

### oecd_family_leave — needs-operator
Why: OECD family-leave table moved: review the simulator anchors and edit the curated constants.
Sources: `oecd_family_leave`

### imf_weo_bg — needs-operator
Why: A new IMF WEO vintage: update the curated forecast rows.
Sources: `imf_weo_bg`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:procurement-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | db:gen-hub-stats | ok | 17s |  |

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | db:gen-roads-hub-stats | ok | 1s |  |

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:gen-water-flood | ok | 5s |  |
| 25 | db:gen-water-hub-stats | ok | 1s |  |

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 26 | db:gen-transport-hub-stats | ok | 1s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | myarea:alerts | ok | 10s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | data:map | ok | 6s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | db:gen-governance-hub-stats | ok | 684ms |  |

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 30 | db:gen-home-hub-stats | ok | 309ms |  |
| 31 | db:gen-home-flyover | ok | 9s |  |
| 32 | db:gen-home-price-events | ok | 5s |  |
| 33 | db:gen-home-feed | ok | 1s |  |
| 34 | home:health | ok | 523ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 35 | db:check-generated | ok | 741ms |  |

### post:check-cloud — skipped

| # | step | status | time | note |
|---|---|---|---|---|
| 36 | db:check-cloud | skipped | 0ms | unmet need(s): proxy |

## Findings
- previous run 20261112T160550Z-2ef1 died without a report during ingest (step 8 fetch_eurostat); last sign of life 2026-11-12T16:21:38.287Z — its live log is logs/pipeline/20261112T160550Z-2ef1/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- previous run s died without a report during starting; last sign of life 2026-11-13T06:13:15.456Z — its live log is logs/pipeline/s/run.log, and its markers were not stamped for the unfinished work, so this run re-queues it
- preflight started local Postgres (ok); it was down at the start of the run
- watcher: nfc_film_register errored (3 run(s) in a row): HTTP 520 <none>
- watcher: nfc_commissions errored (3 run(s) in a row): HTTP 520 <none>
- watcher: oecd_pit_params errored (3 run(s) in a row): OECD SDMX unreachable after 6 tries: https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_CENT/all?startPeriod=2025&format=jsondata
- watcher: iaos_air_quality errored (1 run(s) in a row): The operation was aborted due to timeout
- watcher: 4 source(s) not probed from exit BG: parliament_votes, parliament_mps, cik_results, cik_presidential
- watcher STANDING: nfc_film_register failing 3 runs in a row
- watcher STANDING: nfc_commissions failing 3 runs in a row
- watcher STANDING: oecd_pit_params failing 3 runs in a row
- db:check-generated exited 1: it found something — read logs/pipeline/20261113T061351Z-5c11/035-db_check-generated.log

## Timings vs median
Sum of step durations: 9m 22s over 33 step(s).
- slower than usual: watcher › watch 3m 17s vs median 1m 39s

## Publish decision
**HELD**
- held: update-macro: fetch_bnb_auctions failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261113T061351Z-5c11/failures/019-fetch_bnb_auctions.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261113T061351Z-5c11
```
