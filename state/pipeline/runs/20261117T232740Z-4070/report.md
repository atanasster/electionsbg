# Pipeline ingest run — 20261117T232740Z-4070
Started 2026-11-17T23:27:41.244Z · ended 2026-11-18T00:46:18.177Z · git 503c6ca8f9 → 2cb6be7c6f

## Verdict
**DEGRADED** (exit 0) — 20 unit(s): 9 ok · 0 partial · 0 failed · 2 blocked · 7 needs operator · 2 skipped

## Failures
_(none)_

## Needs operator
- **update-polls** (polls-accept-inbox): Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports. Then: `pnpm run pipeline:ack update-polls polls-accept-inbox`
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-polls** (run-runbook): Run update-polls for polls_alpha_research. Planned steps: pnpm exec tsx scripts/polls/backlog.ts → pnpm run polls:fetch → pnpm run polls:extract → pnpm run polls:review --prepare → pnpm run polls:crosscheck → pnpm run polls:analyze → pnpm run polls:analyze --race presidential → pnpm run polls:presidential:coverage. Runbook: `.claude/skills/update-polls/SKILL.md`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement, ted_bg. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh → pnpm run ted:ingest --apply → pnpm run db:load:ted:pg. Runbook: `.claude/skills/update-procurement/SKILL.md`

## What ran
### update-rollcall — blocked
Why: egress:non-bg: exit IP country BG; parliament.bg, МО and ЦИК time out behind a Bulgarian exit
Sources: `parliament_votes`

### update-polls — skipped
Why: delegated to the update-polls runbook (not yet a script)
Sources: `polls_alpha_research`

### tr-daily-refresh — ok · marker stamped
Sources: `egov_commerce`
Summary: 8 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 8m 16s |  |
| 2 | tr:daily-refresh › db:pg:up | ok | 596ms |  |
| 3 | tr:daily-refresh › db:load:tr:pg | ok | 2m 53s |  |
| 4 | tr:daily-refresh › db:load:cr-founding:pg | ok | 613ms |  |
| 5 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 324ms |  |
| 6 | tr:daily-refresh › db:load:graph:pg | ok | 13s |  |
| 7 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 11s |  |
| 8 | db:load:company-founded:pg | ok | 542ms |  |

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`, `ted_bg`

### update-budget — needs-operator
Why: Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts.
Sources: `capital_programs`

### update-macro — ok · marker stamped
Sources: `eurostat`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | fetch_eurostat | ok | 4m 58s |  |
| 10 | fetch_cofog | ok | 3s |  |
| 11 | fetch_eu_peers | ok | 7m 11s |  |
| 12 | fetch_food_pli | ok | 1s |  |
| 13 | admin:build-context | ok | 489ms |  |
| 14 | social:poverty_impact | ok | 604ms |  |
Files changed: `data/administration/context.json`, `data/cofog.json`, `data/macro.json`, `data/macro_peers.json`, `data/social/poverty_impact.json`

### update-defense — needs-operator
Why: pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json.
Sources: `mod_defense_report`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — needs-operator
Why: Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.
Sources: `ti_bg_lisi`

### update-prices — blocked
Why: drive:prices: raw_data/prices → /Volumes/Storage/data-bg/raw_data/prices: the link's target is not reachable — mount the external drive
Sources: `kzp_prices`

### oecd_family_leave — needs-operator
Why: OECD family-leave table moved: review the simulator anchors and edit the curated constants.
Sources: `oecd_family_leave`

### imf_weo_bg — needs-operator
Why: A new IMF WEO vintage: update the curated forecast rows.
Sources: `imf_weo_bg`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:price-hub-payloads — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | prices:payloads | ok | 5m 49s |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | myarea:alerts | ok | 2m 15s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 17 | data:map | ok | 29s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | db:gen-governance-hub-stats | ok | 2s |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:gen-home-hub-stats | ok | 906ms |  |
| 20 | db:gen-home-flyover | ok | 51s |  |
| 21 | db:gen-home-price-events | ok | 11s |  |
| 22 | db:gen-home-feed | ok | 3s |  |
| 23 | home:health | ok | 614ms |  |
Files changed: `data/home/flyover.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:check-generated | ok | 1s |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 25 | db:check-cloud | ok | 2s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261117T232740Z-4070/024-db_check-generated.log

## Timings vs median
Sum of step durations: 33m 31s over 25 step(s).
- slower than usual: update-macro › fetch_eurostat 4m 58s vs median 19s
- slower than usual: update-macro › fetch_eu_peers 7m 11s vs median 27s
- slower than usual: post:price-hub-payloads › prices:payloads 5m 49s vs median 2m 22s
- slower than usual: post:myarea-alerts › myarea:alerts 2m 15s vs median 13s
- slower than usual: post:data-map › data:map 29s vs median 6s
- slower than usual: post:home › db:gen-home-flyover 51s vs median 7s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261118T000118Z-e9e1/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261117T232740Z-4070
```
