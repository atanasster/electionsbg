# Pipeline ingest run — 20261123T224804Z-8290
Started 2026-11-23T22:48:05.182Z · ended 2026-11-23T23:23:09.990Z · git 2fcf2b0e93 → 1a0ab9c2b7

## Verdict
**DEGRADED** (exit 0) — 12 unit(s): 9 ok · 0 partial · 0 failed · 0 blocked · 1 needs operator · 2 skipped

## Failures
_(none)_

## Needs operator
- **update-vaccines** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-vaccines --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-vaccines bootstrap`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`
- **update-culture** (run-runbook): Run update-culture for nfc_film_register. Planned steps: pnpm exec tsx scripts/culture/ingest.ts. Runbook: `.claude/skills/update-culture/SKILL.md`

## What ran
### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`

### update-open-calls — ok · marker stamped
Sources: `isun_procedures`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | opencalls:isun | ok | 1m 00s |  |
| 2 | opencalls:az | ok | 16s |  |
| 3 | db:load:open-calls:pg | ok | 739ms |  |
| 4 | open_calls.data.test | ok | 22s |  |
Files changed: `data/opencalls/az.json`, `data/opencalls/isun.json`

### update-vaccines — needs-operator
Why: no marker yet — choose run or seed
Sources: `his_immunizations_daily`, `his_immunization_app`, `ial_shortage_list`, `ncipd_flu_weekly`, `eurostat_vaccine_trade`, `eurostat_flu_coverage`

### fiscal_council_bg — ok · marker stamped
Sources: `fiscal_council_bg`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 5 | fiscal-council:triage | ok | 14s |  |
Files changed: `state/fiscal_council/triage.json`

### update-culture — skipped
Why: delegated to the update-culture runbook (not yet a script)
Sources: `nfc_film_register`

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | prices | ok | 6m 32s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 7 | myarea:alerts | ok | 18s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | data:map | ok | 5s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | db:gen-governance-hub-stats | ok | 632ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 10 | db:gen-home-hub-stats | ok | 461ms |  |
| 11 | db:gen-home-flyover | ok | 6s |  |
| 12 | db:gen-home-price-events | ok | 2s |  |
| 13 | db:gen-home-feed | ok | 1s |  |
| 14 | home:health | ok | 458ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | db:check-generated | ok | 883ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261123T224804Z-8290/015-db_check-generated.log

## Timings vs median
Sum of step durations: 9m 02s over 16 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261123T225709Z-843e/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261123T224804Z-8290
```
