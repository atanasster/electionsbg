# Pipeline ingest run — 20261118T224713Z-a15e
Started 2026-11-18T22:47:14.911Z · ended 2026-11-19T00:18:41.106Z · git 3a00edc733 → 8f1a35f2d6

## Verdict
**DEGRADED** (exit 0) — 21 unit(s): 9 ok · 1 partial · 0 failed · 1 blocked · 8 needs operator · 2 skipped

## Failures
_(none)_

## Needs operator
- **update-polls** (polls-accept-inbox): Review data/polls/_inbox drafts with no built extractor and `pnpm run polls:accept <id>` the ones the evidence supports. Then: `pnpm run pipeline:ack update-polls polls-accept-inbox`
- **update-persons** (curated-person-registers): Verify the change at the official source and edit data/person/{sanctions,ds,regulators}.json by hand (defamation rules apply). Then: `pnpm run pipeline:ack update-persons curated-person-registers`
- **update-budget** (capital-programmes): Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts. Then: `pnpm run pipeline:ack update-budget capital-programmes`
- **update-macro** (eurobarometer-paste): Read QA6 from the new Standard Eurobarometer and paste it into fetch_eurostat.ts. Then: `pnpm run pipeline:ack update-macro eurobarometer-paste`
- **update-defense** (defense-readiness-read): pdftotext the МО state-of-defence report and hand-edit data/defense/readiness.json. Then: `pnpm run pipeline:ack update-defense defense-readiness-read`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **oecd_family_leave** (oecd_family_leave-manual): OECD family-leave table moved: review the simulator anchors and edit the curated constants. Then: `pnpm run pipeline:ack oecd_family_leave oecd_family_leave-manual`
- **imf_weo_bg** (imf_weo_bg-manual): A new IMF WEO vintage: update the curated forecast rows. Then: `pnpm run pipeline:ack imf_weo_bg imf_weo_bg-manual`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-polls** (run-runbook): Run update-polls for polls_alpha_research. Planned steps: pnpm exec tsx scripts/polls/backlog.ts → pnpm run polls:fetch → pnpm run polls:extract → pnpm run polls:review --prepare → pnpm run polls:crosscheck → pnpm run polls:analyze → pnpm run polls:analyze --race presidential → pnpm run polls:presidential:coverage. Runbook: `.claude/skills/update-polls/SKILL.md`
- **update-procurement** (run-runbook): Run update-procurement for eop_procurement. Planned steps: pnpm exec tsx scripts/procurement/ingest_eop.ts --self-heal --apply → pnpm run procurement:ingest → pnpm exec tsx scripts/procurement/ingest_tenders.ts --apply → pnpm exec tsx scripts/procurement/eop_field_map.ts --apply → pnpm exec tsx scripts/procurement/by_id_shards.ts → pnpm exec tsx scripts/procurement/ingest_anexi.ts → pnpm exec tsx scripts/procurement/anexi_current_value.ts --apply → pnpm run proc:backfill-unp:apply → pnpm run proc:reconcile:apply → pnpm exec tsx scripts/procurement/rebuild_from_cache.ts → pnpm exec tsx scripts/procurement/contract_index.ts → pnpm exec tsx scripts/procurement/rebuild_derived.ts → pnpm run db:refresh. Runbook: `.claude/skills/update-procurement/SKILL.md`

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
| 1 | tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts | ok | 14m 12s |  |
| 2 | tr:daily-refresh › db:pg:up | ok | 786ms |  |
| 3 | tr:daily-refresh › db:load:tr:pg | ok | 6m 20s |  |
| 4 | tr:daily-refresh › db:load:cr-founding:pg | ok | 1s |  |
| 5 | tr:daily-refresh › db:load:cr-nkid:pg | ok | 2s |  |
| 6 | tr:daily-refresh › db:load:graph:pg | ok | 35s |  |
| 7 | tr:daily-refresh › db:load:tr-company-place:pg | ok | 30s |  |
| 8 | db:load:company-founded:pg | ok | 954ms |  |

### update-persons — needs-operator
Why: Verify the change at the official source and edit data/person/{sanctions,ds,regulators}.json by hand (defamation rules apply).
Sources: `comdos_ds`

### update-procurement — skipped
Why: delegated to the update-procurement runbook (not yet a script)
Sources: `eop_procurement`

### update-budget — needs-operator
Why: Download each changed município's capital programme and run its scripts/budget/capital_programs/<muni>.ts parser (OCR pre-step for scan sources), then scripts/budget/capital_programs/__shrink_for_tile.ts.
Sources: `capital_programs`

### update-macro — partial · marker NOT stamped
Why: marker not stamped: eurobarometer deferred to an operator item
Sources: `eurostat`, `eurobarometer`
Summary: 6 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 9 | fetch_eurostat | ok | 8s |  |
| 10 | fetch_cofog | ok | 3s |  |
| 11 | fetch_eu_peers | ok | 7s |  |
| 12 | fetch_food_pli | ok | 2s |  |
| 13 | admin:build-context | ok | 888ms |  |
| 14 | social:poverty_impact | ok | 1s |  |
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

### update-prices — ok · marker stamped
Sources: `kzp_prices`
Summary: 1 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | prices | ok | 12m 15s |  |
Files changed: `data/data-changes.json`, `data/prices/product_slugs.json`

### update-council-minutes — ok · marker stamped
Sources: `council_minutes`
Summary: 3 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | council:scrape | ok | 10m 07s |  |
| 17 | db:load:council:pg | ok | 3s |  |
| 18 | council:index_corpus.test | ok | 11s |  |
Files changed: `data/council/GAB05/2026/GAB05-2026-prot7-r105.json`, `data/council/GAB05/2026/GAB05-2026-prot7-r106.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r422.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r423.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r424.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r425.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r426.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r427.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r428.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r429.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r430.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r431.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r432.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r433.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r434.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r435.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r436.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r437.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r438.json`, `data/council/PDV01/2026/PDV01-2026-prot18-r439.json` … +42

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
| 19 | myarea:alerts | ok | 26s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | data:map | ok | 9s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | db:gen-governance-hub-stats | ok | 685ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | db:gen-home-hub-stats | ok | 620ms |  |
| 23 | db:gen-home-flyover | ok | 21s |  |
| 24 | db:gen-home-price-events | ok | 6s |  |
| 25 | db:gen-home-feed | ok | 1s |  |
| 26 | home:health | ok | 537ms |  |
Files changed: `data/home/feed.json`, `data/home/flyover.json`, `data/home/hub_stats.json`, `data/home/price_events.json`

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | db:check-generated | ok | 649ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261118T224713Z-a15e/027-db_check-generated.log

## Timings vs median
Sum of step durations: 45m 47s over 28 step(s).
- slower than usual: tr-daily-refresh › tr:daily-refresh › tsx ./scripts/declarations/tr/daily_refresh.ts 14m 12s vs median 7m 32s
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:tr:pg 6m 20s vs median 2m 52s
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:graph:pg 35s vs median 18s
- slower than usual: tr-daily-refresh › tr:daily-refresh › db:load:tr-company-place:pg 30s vs median 11s
- slower than usual: update-prices › prices 12m 15s vs median 7m 12s
- slower than usual: post:myarea-alerts › myarea:alerts 26s vs median 13s
- slower than usual: post:data-map › data:map 9s vs median 6s
- slower than usual: post:home › db:gen-home-flyover 21s vs median 8s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261118T233305Z-7645/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261118T224713Z-a15e
```
