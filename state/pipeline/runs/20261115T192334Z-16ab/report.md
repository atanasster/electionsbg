# Pipeline ingest run — 20261115T192334Z-16ab
Started 2026-11-15T19:23:35.417Z · ended 2026-11-15T19:59:46.444Z · git c10d57d09d → 425ff127a2

## Verdict
**DEGRADED** (exit 0) — 16 unit(s): 7 ok · 0 partial · 0 failed · 1 blocked · 7 needs operator · 1 skipped

## Failures
_(none)_

## Needs operator
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for egov_procurement, eop_procurement, cprs_register, ted_bg, adfi_inspections. Planned steps: pnpm run procurement:ingest-legacy --discover → pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run cprs:ingest --apply --refresh → pnpm run db:load:cprs:pg → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg → pnpm run adfi:ingest --apply → pnpm run db:load:adfi:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### update-rollcall — blocked
Why: egress:non-bg: exit IP country BG; parliament.bg, МО and ЦИК time out behind a Bulgarian exit
Sources: `parliament_votes`

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `egov_procurement`, `eop_procurement`, `cprs_register`, `ted_bg`, `adfi_inspections`

### update-budget — needs-operator
Why: Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts.
Sources: `capital_programs`

### update-defense — needs-operator
Why: pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.
Sources: `mod_defense_report`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — needs-operator
Why: Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.
Sources: `ti_bg_lisi`

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | prices | ok | 8m 06s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### oecd_family_leave — needs-operator
Why: OECD family-leave table moved: review the simulator anchors and edit the curated constants.
Sources: `oecd_family_leave`

### imf_weo_bg — needs-operator
Why: A new IMF WEO vintage: update the curated forecast rows.
Sources: `imf_weo_bg`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | myarea:alerts | ok | 17s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 3 | data:map | ok | 5s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 4 | db:gen-governance-hub-stats | ok | 615ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | db:gen-home-hub-stats | ok | 198ms |  |
| 6 | db:gen-home-flyover | ok | 7s |  |
| 7 | db:gen-home-price-events | ok | 4s |  |
| 8 | db:gen-home-feed | ok | 2s |  |
| 9 | home:health | ok | 588ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:check-generated | ok | 917ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 11 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261115T192334Z-16ab/010-db_check-generated.log

## Timings vs median
Sum of step durations: 8m 43s over 11 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261115T193221Z-4539/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261115T192334Z-16ab
```
