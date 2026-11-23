# Pipeline ingest run — 20261123T020043Z-c698
Started 2026-11-23T02:00:44.299Z · ended 2026-11-23T02:22:58.607Z · git f71ec3f518 → d6ecb11b9c

## Verdict
**DEGRADED** (exit 0) — 16 unit(s): 13 ok · 0 partial · 0 failed · 0 blocked · 1 needs operator · 2 skipped

## Failures
_(none)_

## Needs operator
- **update-culture** (ncf-grant-results-url): Results on konkursi.ncf.bg are ingested automatically. Only if the post links a класиране PDF instead, add it to NCF_RESULTS in scripts/culture/ncf_grants.ts and re-run pnpm run culture:ncf-grants. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
- **update-culture** (run-runbook): Run update-culture for ncf_grant_results. Planned steps: pnpm run culture:ncf-grants → pnpm exec vitest run scripts/culture/ncf_konkursi.test.ts. Runbook: `.claude/skills/update-culture/SKILL.md`
- **update-transparency-lisi** (run-runbook): Run update-transparency-lisi for ti_bg_lisi. Planned steps: pnpm exec tsx scripts/transparency/build_lisi.ts. Runbook: `.claude/skills/update-transparency-lisi/SKILL.md`

## What ran
### update-funds — ok · marker stamped
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `keep_eu_interreg`, `isun_clean_delivery`
Summary: 17 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | funds:ingest | ok | 19s |  |
| 2 | funds:ingest-projects | ok | 1m 17s |  |
| 3 | build_geo_pins | ok | 1s |  |
| 4 | db:load:funds:pg | ok | 46s |  |
| 5 | db:load:grant-links:pg | ok | 2s |  |
| 6 | db:load:funds-fit:pg | ok | 2s |  |
| 7 | funds:parity | ok | 2m 08s |  |
| 8 | funds:interreg-auto | ok | 20s |  |
| 9 | db:load:place-dim:pg | ok | 1s |  |
| 10 | db:load:interreg:pg | ok | 9s |  |
| 11 | funds:clean-delivery | ok | 12s |  |
| 12 | db:load:clean-delivery:pg | ok | 1s |  |
| 13 | db:load:persons-browse:pg | ok | 14s |  |
| 14 | db:load:person-search:pg | ok | 20s |  |
| 15 | db:load:graph:pg | ok | 14s |  |
| 16 | db:load:agri-hub-stats:pg | ok | 35s |  |
| 17 | db:load:tr-company-place:pg | ok | 25s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/interreg/index.json`, `data/funds/projects/changes/index.json` … +4

### update-noi — ok · marker stamped
Sources: `nssi_yearbook`
Summary: 2 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | noi:write_pensions | ok | 5s |  |
| 19 | noi:pensioners-by-tp | ok | 21s |  |

### update-culture — skipped
Why: delegated to the update-culture runbook (not yet a script)
Sources: `ncf_grant_results`

### update-transparency-lisi — skipped
Why: delegated to the update-transparency-lisi runbook (not yet a script)
Sources: `ti_bg_lisi`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | db:gen-roads-hub-stats | ok | 4s |  |
Files changed: `data/roads/derived/hub_stats.json`

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | db:gen-water-flood | ok | 7s |  |
| 22 | db:gen-water-hub-stats | ok | 1s |  |

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | db:gen-transport-hub-stats | ok | 1s |  |
Files changed: `data/transport/derived/hub_stats.json`

### post:edu-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:gen-edu-hub-stats | ok | 1s |  |
Files changed: `data/education/derived/hub_stats.json`

### post:health-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 25 | db:gen-health-hub-stats | ok | 1s |  |
Files changed: `data/health/derived/hub_stats.json`

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 26 | myarea:alerts | ok | 14s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 27 | data:map | ok | 7s |  |

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 28 | db:gen-governance-hub-stats | ok | 614ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | db:gen-home-hub-stats | ok | 209ms |  |
| 30 | db:gen-home-flyover | ok | 7s |  |
| 31 | db:gen-home-price-events | ok | 4s |  |
| 32 | db:gen-home-feed | ok | 1s |  |
| 33 | home:health | ok | 447ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 34 | db:check-generated | ok | 885ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 35 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261123T020043Z-c698/034-db_check-generated.log

## Timings vs median
Sum of step durations: 8m 24s over 35 step(s).
- slower than usual: update-funds › funds:parity 2m 08s vs median 1m 17s
- slower than usual: update-funds › db:load:agri-hub-stats:pg 35s vs median 18s
- slower than usual: update-funds › db:load:tr-company-place:pg 25s vs median 10s

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261123T020915Z-fa51/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261123T020043Z-c698
```
