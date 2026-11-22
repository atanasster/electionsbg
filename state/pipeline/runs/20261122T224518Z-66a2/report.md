# Pipeline ingest run — 20261122T224518Z-66a2
Started 2026-11-22T22:45:19.385Z · ended 2026-11-22T22:59:22.261Z · git e0082b69d1 → f0a0300a71

## Verdict
**DEGRADED** (exit 0) — 16 unit(s): 11 ok · 1 partial · 0 failed · 0 blocked · 4 needs operator · 0 skipped

## Failures
_(none)_

## Needs operator
- **update-funds** (interreg-crawl): Probe with `pnpm run funds:crawl-interreg --index-only --max-pages 1`; if healthy run `pnpm run funds:crawl-interreg --full` (~2 h), then ack — the ingest and loads run on the next pipeline run. Then: `pnpm run pipeline:ack update-funds interreg-crawl`
- **update-noi** (noi-yearbook-and-kfn): Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`. Then: `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`
- **update-culture** (ncf-grant-results-url): Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts. Then: `pnpm run pipeline:ack update-culture ncf-grant-results-url`
- **update-transparency-lisi** (lisi-scores-paste): Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts. Source: https://lisi.transparency.bg/. Then: `pnpm run pipeline:ack update-transparency-lisi lisi-scores-paste`
- **fiscal_council_bg** (fiscal_council_bg-manual): A new Fiscal Council opinion: check whether any simulator lever is affected. Then: `pnpm run pipeline:ack fiscal_council_bg fiscal_council_bg-manual`

## Needs agent
_(none)_

## What ran
### update-funds — partial · marker NOT stamped
Why: marker not stamped: keep_eu_interreg deferred to an operator item
Sources: `isun_eu_funds`, `isun_eu_funds_projects`, `keep_eu_interreg`, `isun_clean_delivery`
Summary: 14 step(s) ok

| # | step | status | time | note |
|---|---|---|---|---|
| 1 | funds:ingest | ok | 15s |  |
| 2 | funds:ingest-projects | ok | 1m 02s |  |
| 3 | build_geo_pins | ok | 1s |  |
| 4 | db:load:funds:pg | ok | 17s |  |
| 5 | db:load:grant-links:pg | ok | 1s |  |
| 6 | db:load:funds-fit:pg | ok | 1s |  |
| 7 | funds:parity | ok | 51s |  |
| 8 | funds:clean-delivery | ok | 12s |  |
| 9 | db:load:clean-delivery:pg | ok | 1s |  |
| 10 | db:load:persons-browse:pg | ok | 13s |  |
| 11 | db:load:person-search:pg | ok | 18s |  |
| 12 | db:load:graph:pg | ok | 12s |  |
| 13 | db:load:agri-hub-stats:pg | ok | 13s |  |
| 14 | db:load:tr-company-place:pg | ok | 8s |  |
Files changed: `data/funds/beneficiaries/0.json`, `data/funds/beneficiaries/1.json`, `data/funds/beneficiaries/2.json`, `data/funds/beneficiaries/3.json`, `data/funds/beneficiaries/4.json`, `data/funds/beneficiaries/5.json`, `data/funds/beneficiaries/6.json`, `data/funds/beneficiaries/7.json`, `data/funds/beneficiaries/8.json`, `data/funds/beneficiaries/9.json`, `data/funds/beneficiaries/_x.json`, `data/funds/clean_delivery.json`, `data/funds/derived/absorption.json`, `data/funds/derived/integrity.json`, `data/funds/derived/mp_connected.json`, `data/funds/derived/political_links.json`, `data/funds/derived/sankey.json`, `data/funds/index.json`, `data/funds/projects/changes/index.json`, `data/funds/projects/index.json` … +3

### update-noi — needs-operator
Why: Fetch the new Yearbook_Pensions ZIP / locate the КФН statistics ZIP URL, run the matching scripts/budget/{noi,kfn}/__write_*.ts, then `pnpm run pipeline:ack update-noi noi-yearbook-and-kfn`.
Sources: `nssi_yearbook`

### update-culture — needs-operator
Why: Add the new НФК results PDF URL to NCF_RESULTS and run scripts/culture/ncf_grants.ts.
Sources: `ncf_grant_results`

### update-transparency-lisi — needs-operator
Why: Read the 27 scores and the average from lisi.transparency.bg and edit the LISI_<year> array in scripts/transparency/build_lisi.ts.
Sources: `ti_bg_lisi`

### fiscal_council_bg — needs-operator
Why: A new Fiscal Council opinion: check whether any simulator lever is affected.
Sources: `fiscal_council_bg`

### post:roads-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 15 | db:gen-roads-hub-stats | ok | 1s |  |

### post:water-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 16 | db:gen-water-flood | ok | 5s |  |
| 17 | db:gen-water-hub-stats | ok | 1s |  |

### post:transport-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 18 | db:gen-transport-hub-stats | ok | 1s |  |

### post:edu-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 19 | db:gen-edu-hub-stats | ok | 1s |  |

### post:health-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 20 | db:gen-health-hub-stats | ok | 980ms |  |

### post:myarea-alerts — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 21 | myarea:alerts | ok | 11s |  |

### post:data-map — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 22 | data:map | ok | 5s |  |
Files changed: `data/data_map.json`

### post:governance-hub-stats — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 23 | db:gen-governance-hub-stats | ok | 585ms |  |
Files changed: `data/governance/hub_stats.json`

### post:home — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 24 | db:gen-home-hub-stats | ok | 445ms |  |
| 25 | db:gen-home-flyover | ok | 4s |  |
| 26 | db:gen-home-price-events | ok | 3s |  |
| 27 | db:gen-home-feed | ok | 1s |  |
| 28 | home:health | ok | 439ms |  |

### post:check-generated — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 29 | db:check-generated | ok | 887ms |  |

### post:check-cloud — ok

| # | step | status | time | note |
|---|---|---|---|---|
| 30 | db:check-cloud | ok | 1s |  |

## Findings
- db:check-generated exited 1: it found something — read logs/pipeline/20261122T224518Z-66a2/029-db_check-generated.log

## Timings vs median
Sum of step durations: 4m 24s over 30 step(s).
No step ran more than 1.5× its median.

## Publish decision
**GO**
Published in this run: exit 0 (ok) · publish report `state/pipeline/runs/20261122T224948Z-3625/report.md`

## Next commands
```bash
pnpm run pipeline:report --session 20261122T224518Z-66a2
```
