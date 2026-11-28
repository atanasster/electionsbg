# Pipeline ingest run — 20261128T054138Z-116f
Started 2026-11-28T05:48:19.550Z · ended 2026-11-28T07:16:10.056Z · git 03a9dad7d1 → 2a30dc6b62

## Verdict
**DEGRADED** (exit 0) — 14 unit(s): 10 ok · 1 partial · 0 failed · 0 blocked · 2 needs operator · 1 skipped

## Failures
_(none)_

## Needs operator
- **update-zdoi** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-zdoi --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-zdoi bootstrap`
- **update-vaccines** (bootstrap): No marker yet. Run it (`pnpm run pipeline:ingest --only update-vaccines --bootstrap run`) or seed it without running (`--bootstrap seed`). Then: `pnpm run pipeline:ack update-vaccines bootstrap`

## Needs agent
- **update-rollcall** (pin-rollcall-counts): Update the four pinned counts in scripts/db/tests/rollcall.data.test.ts from the loader output. Runbook: `.claude/skills/update-rollcall/SKILL.md (Step 5c)`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### watcher — partial
Why: standing problem(s): his_immunization_app failing 3 runs in a row
Summary: 8 changed, 1 error, 103 skipped, 31 unchanged

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | watch | ok | 6m 31s |  |

### update-rollcall — ok · marker stamped
Sources: `parliament_votes`
Summary: 4 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 2 | rollcall:scrape | ok | 4m 31s |  |
| 3 | parliament:bills | ok | 5m 01s |  |
| 4 | db:load:rollcall:pg | ok | 22s |  |
| 5 | db:load:rollcall-derived:pg | ok | 2m 01s |  |
Files changed: `data/parliament/bills/ns52.json`, `data/parliament/votes/derived/attendance.json`, `data/parliament/votes/derived/cohesion.json`, `data/parliament/votes/derived/dissents.json`, `data/parliament/votes/derived/embedding.json`, `data/parliament/votes/derived/hub_feed/44.json`, `data/parliament/votes/derived/hub_feed/45.json`, `data/parliament/votes/derived/hub_feed/46.json`, `data/parliament/votes/derived/hub_feed/47.json`, `data/parliament/votes/derived/hub_feed/48.json`, `data/parliament/votes/derived/hub_feed/49.json`, `data/parliament/votes/derived/hub_feed/50.json`, `data/parliament/votes/derived/hub_feed/51.json`, `data/parliament/votes/derived/hub_feed/52.json`, `data/parliament/votes/derived/hub_stats.json`, `data/parliament/votes/derived/important_votes/44.json`, `data/parliament/votes/derived/important_votes/45.json`, `data/parliament/votes/derived/important_votes/46.json`, `data/parliament/votes/derived/important_votes/47.json`, `data/parliament/votes/derived/important_votes/48.json` … +32

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`

### update-zdoi — needs-operator
Why: no marker yet — choose run or seed
Sources: `zdoi_pitay`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 6 | fetch_eurostat | ok | 15s |  |
| 7 | fetch_cofog | ok | 5s |  |
| 8 | fetch_eu_peers | ok | 20s |  |
| 9 | fetch_food_pli | ok | 2s |  |
| 10 | admin:build-context | ok | 468ms |  |
| 11 | social:poverty_impact | ok | 981ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-vaccines — needs-operator
Why: no marker yet — choose run or seed
Sources: `his_immunizations_daily`, `his_immunization_app`, `ial_shortage_list`, `ncipd_flu_weekly`, `eurostat_vaccine_trade`, `eurostat_flu_coverage`

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 12 | prices | ok | 6m 39s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 13 | council:scrape | ok | 24m 06s |  |
| 14 | db:load:council:pg | ok | 5s |  |
| 15 | council:index_corpus.test | ok | 34s |  |
Files changed: `data/council/VAR01/2026/VAR01-2026-prot42-r1319.json`, `data/council/VAR01/2026/VAR01-2026-prot42-r1320.json`, `data/council/index.json`, `state/ingest/council_BGS01.json`, `state/ingest/council_DOB28.json`, `state/ingest/council_HKV09.json`, `state/ingest/council_HKV34.json`, `state/ingest/council_PDV01.json`, `state/ingest/council_PER32.json`, `state/ingest/council_PVN01.json`, `state/ingest/council_RAZ26.json`, `state/ingest/council_RSE01.json`, `state/ingest/council_SLV01.json`, `state/ingest/council_SOF.json`, `state/ingest/council_SZR01.json`, `state/ingest/council_VAR01.json`, `state/ingest/council_VTR01.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | myarea:alerts | ok | 28s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 17 | data:map | ok | 8s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | db:gen-governance-hub-stats | ok | 614ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:gen-home-hub-stats | ok | 444ms |  |
| 20 | db:gen-home-flyover | ok | 7s |  |
| 21 | db:gen-home-price-events | ok | 3s |  |
| 22 | db:gen-home-feed | ok | 1s |  |
| 23 | home:health | ok | 411ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:check-generated | ok | 2s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 25 | db:check-cloud | ok | 2s |  |

## Findings
- watcher: his_immunization_app errored (3 run(s) in a row): his_infoapp: Sheet_1 row 111439 has an out-of-range string index null (retried: via BG proxy: his_infoapp: Sheet_1 row 111439 has an out-of-range string index null)
- watcher STANDING: his_immunization_app failing 3 runs in a row
- db:check-generated exited 1: it found something — read logs/pipeline/20261128T054138Z-116f/024-db_check-generated.log

## Timings vs median
Sum of step durations: 51m 25s over 25 step(s).
- slower than usual: watcher › watch 6m 31s vs median 2m 54s
- slower than usual: update-rollcall › rollcall:scrape 4m 31s vs median 2m 19s
- slower than usual: update-macro › fetch_eu_peers 20s vs median 13s
- slower than usual: update-council-minutes › council:scrape 24m 06s vs median 10m 45s
- slower than usual: update-council-minutes › council:index_corpus.test 34s vs median 12s
- slower than usual: post:myarea-alerts › myarea:alerts 28s vs median 17s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261128T063320Z-8130/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261128T054138Z-116f
```
