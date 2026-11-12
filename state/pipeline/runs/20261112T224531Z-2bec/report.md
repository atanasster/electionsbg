# Pipeline ingest run — 20261112T224531Z-2bec
Started 2026-11-12T22:45:31.581Z · ended 2026-11-12T23:18:53.924Z · git 7f4a260945 → ec00ed2442

## Verdict
**FAILED** (exit 1) — 22 unit(s): 11 ok · 0 partial · 1 failed · 1 blocked · 6 needs operator · 3 skipped

## Failures
- **post:home › home:health** — error, exit 1 after 472ms; class `unknown`. Exit 1 with no recognisable error — read the full log.
  First error: `home: stale — opencalls: last moved 2026-09-24, 49d behind, ceiling 45d`
  Repair packet: `state/pipeline/runs/20261112T224531Z-2bec/failures/027-home_health.md` · log `logs/pipeline/20261112T224531Z-2bec/027-home_health.log`

## Needs operator
- **update-judiciary** (vss-annual-table-url): Add the new ВСС annual table PDF URL to VSS_ANNUAL_TABLES in scripts/judiciary/sources.ts. Then: `pnpm run pipeline:ack update-judiciary vss-annual-table-url`
- **update-judiciary** (ivss-diff-review): Read the diff of the integrity lists and spot-check the top bank_cash_lv values against the source PDFs before publishing. Then: `pnpm run pipeline:ack update-judiciary ivss-diff-review`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg Runbook: `.claude/skills/update-procurement/SKILL.md`
- **update-budget** (run-runbook): Run update-budget for ipop_mrrb. Planned steps: pnpm run ipop:fetch → pnpm exec tsx scripts/budget/ipop/ingest.ts --year 2026 → pnpm run db:load:budget:pg → pnpm run db:load:budget-muni:pg → pnpm run db:load:budget-hub:pg Runbook: `.claude/skills/update-budget/SKILL.md`
- **update-judiciary** (run-runbook): Run update-judiciary for vss_court_statistics, ivss_declarations. Planned steps: pnpm exec tsx scripts/judiciary/__write_declarations.ts → pnpm exec tsx scripts/judiciary/__write_magistrate_holdings.ts → pnpm run db:load:judiciary-payloads:pg → pnpm run db:load:court-load:pg → pnpm run db:load:magistrates:pg → pnpm run db:load:magistrate-filing-assets:pg → pnpm run db:load:judicial-bodies:pg Runbook: `.claude/skills/update-judiciary/SKILL.md`

## What ran
### update-rollcall — blocked
Why: egress:non-bg: exit IP country BG; parliament.bg, МО and ЦИК time out behind a Bulgarian exit
Sources: `parliament_votes`

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 7 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 7m 28s |  |
| 2 | tr:daily-refresh › db:pg:up | ok | 848ms |  |
| 3 | tr:daily-refresh › db:load:tr:pg | ok | 2m 30s |  |
| 4 | tr:daily-refresh › db:load:cr-founding:pg | ok | 598ms |  |
| 5 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 562ms |  |
| 6 | tr:daily-refresh › db:load:graph:pg | ok | 17s |  |
| 7 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 8s |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`

### update-budget — skipped
Why: delegated to the update-budget runbook (not yet a script)
Sources: `ipop_mrrb`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 8 | fetch_eurostat | ok | 2m 16s |  |
| 9 | fetch_cofog | ok | 2s |  |
| 10 | fetch_eu_peers | ok | 52s |  |
| 11 | fetch_food_pli | ok | 1s |  |
| 12 | admin:build-context | ok | 451ms |  |
| 13 | social:poverty_impact | ok | 1s |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-judiciary — skipped
Why: delegated to the update-judiciary runbook (not yet a script)
Sources: `vss_court_statistics`, `ivss_declarations`

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
| 14 | prices | ok | 8m 19s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | council:scrape | ok | 10m 41s |  |
| 16 | db:load:council:pg | ok | 3s |  |
| 17 | council:index_corpus.test | ok | 10s |  |
Files changed: `data/council/index.json`, `state/ingest/council_BGS01.json`, `state/ingest/council_DOB28.json`, `state/ingest/council_GAB05.json`, `state/ingest/council_HKV09.json`, `state/ingest/council_HKV34.json`, `state/ingest/council_PDV01.json`, `state/ingest/council_PER32.json`, `state/ingest/council_PVN01.json`, `state/ingest/council_RAZ26.json`, `state/ingest/council_RSE01.json`, `state/ingest/council_SLV01.json`, `state/ingest/council_SOF.json`, `state/ingest/council_SZR01.json`, `state/ingest/council_VAR01.json`, `state/ingest/council_VTR01.json`

### eurostat_rail — ok · marker stamped
Sources: `eurostat_rail`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | eurostat_rail | ok | 2s |  |
Files changed: `data/transport/rail_ridership.json`

### eurostat_env — ok · marker stamped
Sources: `eurostat_env`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | eurostat_env | ok | 4s |  |
Files changed: `data/environment/waste.json`

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
| 20 | myarea:alerts | ok | 9s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | data:map | ok | 4s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | db:gen-governance-hub-stats | ok | 568ms |  |

### post:home — failed
Why: home:health failed

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | db:gen-home-hub-stats | ok | 460ms |  |
| 24 | db:gen-home-flyover | ok | 5s |  |
| 25 | db:gen-home-price-events | ok | 2s |  |
| 26 | db:gen-home-feed | ok | 980ms |  |
| 27 | home:health | error | 472ms | home: stale — opencalls: last moved 2026-09-24, 49d behind, ceiling 45d |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | db:check-generated | ok | 932ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261112T224531Z-2bec/028-db_check-generated.log
- left uncommitted (written by a failed handler or post-step): data/home/feed.json, data/home/flyover.json, data/home/price_events.json

## Timings vs median
Sum of step durations: 33m 19s over 29 step(s).
- slower than usual: update-macro › fetch_eurostat 2m 16s vs median 10s
- slower than usual: update-macro › fetch_eu_peers 52s vs median 8s

## Publish decision
**HELD**
- held: post-step home: home:health failed

## Next commands
```bash
# fix, then re-run: see state/pipeline/runs/20261112T224531Z-2bec/failures/027-home_health.md
# publish held — fix the failures above, then: pnpm run pipeline:publish
pnpm run pipeline:report --session 20261112T224531Z-2bec
```
