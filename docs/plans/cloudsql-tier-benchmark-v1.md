# Cloud SQL tier benchmark — cost vs. performance, ongoing

**Status: open, not yet settled.** We are comparing Cloud SQL editions/tiers for
`electionsbg-pg` across quiet-traffic windows over the coming days, on both recurring cost
and real query latency, before deciding what to run permanently. This file is the running
log — append a row to the results table and a raw-output file under
`cloudsql-tier-benchmark/` each time a new config is tried.

## Why this started

`electionsbg-pg` was upgraded 2026-08-20 from shared-core `db-g1-small` (~1.7GB RAM) to
`db-perf-optimized-N-2` on the **Enterprise Plus** edition (2 vCPU / 16 GiB) — this fixed the
`db-g1-small`-era `temp_file_limit`/`statement_timeout` failures documented elsewhere in this
repo, but raised the recurring Cloud SQL bill from ~$34/mo to ~$229/mo (compute+RAM+storage
only; see pricing table below). The console's own billing forecast underestimated this because
it blended pre- and post-upgrade days — see the cost writeup this benchmark grew out of.

Goal now: find the cheapest edition/tier that doesn't meaningfully regress the query patterns
this site actually runs, tested against the live production database during low-traffic
windows (Bulgaria night-time), never against a synthetic/local copy — the whole point is to
catch platform-level differences (e.g. per-core throughput, storage path) that only show up on
the real Cloud SQL infrastructure.

## Method

All queries are **read-only** (`EXPLAIN ANALYZE SELECT` / `SELECT`), run directly against
`electionsbg-pg` through the existing Cloud SQL proxy (`npm run db:proxy:cloud`, proxy on
`127.0.0.1:5434`, credentials in the repo-root `.pgpass`). Nothing here writes, creates, or
drops anything.

Reusable script — `cloudsql-tier-benchmark/bench.sh <label>`:

```bash
#!/bin/bash
set -euo pipefail
cd /Users/atanasster/data-bg
export PGPASSFILE=.pgpass
PGURL="postgres://postgres@127.0.0.1:5434/electionsbg"
LABEL="${1:-run}"
OUT="docs/plans/cloudsql-tier-benchmark/${LABEL}.txt"

{
  echo "### electionsbg-pg benchmark — label=$LABEL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "--- instance edition/tier ---"
  gcloud sql instances describe electionsbg-pg --project=elections-bg --format="value(settings.edition,settings.tier)"
  echo "--- server state ---"
  psql "$PGURL" -t -c "SELECT version();"
  psql "$PGURL" -t -c "SELECT pg_postmaster_start_time();"
  psql "$PGURL" -t -c "SELECT count(*) AS connections FROM pg_stat_activity;"
  psql "$PGURL" -t -c "SHOW shared_buffers;"
  psql "$PGURL" -t -c "SHOW effective_cache_size;"
  echo "--- cumulative cache hit ratio (reference only) ---"
  psql "$PGURL" -t -c "SELECT stats_reset, blks_hit, blks_read, round(100.0*blks_hit/nullif(blks_hit+blks_read,0),3) AS hit_ratio_pct FROM pg_stat_database WHERE datname='electionsbg';"
  echo "--- round-trip latency, SELECT 1 x5 ---"
  psql "$PGURL" -c "\timing on" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" 2>&1 | grep -i time

  echo "=== Q1: count(*) contracts WHERE tag='contract' (idx_contracts_tag) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM contracts WHERE tag='contract';"
  echo "=== Q2: top-20 awarders by contract value (idx_contracts_awarder_tag_cover) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT awarder_eik, count(*) AS n, sum(amount_eur) AS total FROM contracts WHERE tag='contract' GROUP BY awarder_eik ORDER BY total DESC NULLS LAST LIMIT 20;"
  echo "=== Q3: one awarder's contracts, recent-first (idx_contracts_awarder_date) — АПИ EIK 000695089 ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT key, date, contractor_name, amount_eur FROM contracts WHERE awarder_eik = '000695089' AND tag='contract' ORDER BY date DESC LIMIT 50;"
  echo "=== Q4: roll-call votes count for NS 51 (idx_vote_cast_ns_mp) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM vote_cast WHERE ns=51;"
  echo "=== Q5: per-MP vote counts for NS 51 (aggregate) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT mp_id, count(*) FROM vote_cast WHERE ns=51 GROUP BY mp_id ORDER BY count(*) DESC LIMIT 10;"
  echo "=== Q6: full count(*) tr_companies (1M+ rows) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM tr_companies;"

  echo "--- bgwriter/checkpointer counters ---"
  psql "$PGURL" -x -c "SELECT * FROM pg_stat_bgwriter;"
} > "$OUT" 2>&1
echo "Wrote $OUT"
```

**Protocol for a new tier:**
1. Flip the tier during a quiet-traffic window (see command log below).
2. Run `bench.sh <date>_<edition>-<vcpu>vcpu-<ram>gib_run1-cold` immediately after.
3. Re-run 2–3 more times (`_run2-warm`, `_run3-warm`, …) until buffer-hit counts in Q1/Q2/Q4/Q6
   stop changing — this rules out "cold cache after restart" as a confound, which fooled the
   first pass on 2026-08-27 (Q2 alone went from 99ms baseline to 8,372ms on a cold cache, before
   warming settled it at 171–197ms).
4. Only compare **buffer-matched** runs (same `Buffers: shared hit=N` on both sides) — that is
   what makes a before/after comparison apples-to-apples rather than an artifact of one side
   having to read from disk and the other not.
5. Append a row to the results table below, and commit the raw `.txt` output(s).

## Pricing reference

`europe-west3` (Frankfurt), from the public Cloud Billing Catalog API (service
`9662-B51E-5089`), checked 2026-08-25. Monthly = rate × qty × 730 hours (instance is always-on,
`activationPolicy: ALWAYS`).

| SKU | Rate |
| --- | --- |
| Zonal – Enterprise Plus N vCPU | $0.0644 / vCPU-hr |
| Zonal – Enterprise Plus N RAM | $0.0109 / GiB-hr |
| Zonal – Enterprise Plus Standard Storage | $0.204 / GiB-mo |
| Zonal – Enterprise N4 vCPU (non-Plus) | $0.04956 / vCPU-hr |
| Zonal – Enterprise N4 RAM (non-Plus) | $0.0084 / GiB-hr |
| Zonal – Standard Storage (non-Plus, same rate as Plus) | $0.204 / GiB-mo |
| Zonal – Small instance (`db-g1-small`, flat) | $0.042 / hr |

Enterprise (non-Plus) custom machine types are capped at **6.5 GiB RAM per vCPU** — this is
why 2 vCPU / 16 GiB (the original Enterprise Plus shape) could not be replicated directly on
Enterprise; max at 2 vCPU is 13 GiB. Enterprise Plus's `perf-optimized` shapes go up to 8
GiB/vCPU, which is a real capability difference between the editions, not just a pricing tier.

## Results log

| Tested | Edition / tier | vCPU | RAM | Storage | $/mo | Δ vs baseline | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-20 → 2026-08-27 | Enterprise Plus, `db-perf-optimized-N-2` | 2 | 16 GiB | 37 GiB | **$228.88** | baseline | Reference point. Fastest measured so far on CPU-bound aggregates. |
| 2026-08-27 → *(current)* | Enterprise, `db-custom-2-13312` | 2 | 13 GiB | 37 GiB | **$159.61** | **-$69.27 (-30%)** | 1.5–2× slower on parallel/aggregate queries at matched buffer counts (see below). Not yet decided whether that's acceptable. |
| *(next candidate — TBD)* | | | | | | | |

*Add a row here for every tier tried, oldest first, with a link to its raw output file(s) in
`cloudsql-tier-benchmark/`.*

## Detailed comparison: Enterprise Plus (2vCPU/16GiB) vs. Enterprise (2vCPU/13GiB)

Raw output:
- Baseline (Enterprise Plus): [`2026-08-25_enterprise-plus-2vcpu-16gib_baseline.txt`](cloudsql-tier-benchmark/2026-08-25_enterprise-plus-2vcpu-16gib_baseline.txt)
- After switch, cold cache: [`2026-08-27_enterprise-2vcpu-13gib_run1-cold.txt`](cloudsql-tier-benchmark/2026-08-27_enterprise-2vcpu-13gib_run1-cold.txt)
- After switch, warm (×2): [`2026-08-27_enterprise-2vcpu-13gib_run2-warm.txt`](cloudsql-tier-benchmark/2026-08-27_enterprise-2vcpu-13gib_run2-warm.txt), [`2026-08-27_enterprise-2vcpu-13gib_run3-warm.txt`](cloudsql-tier-benchmark/2026-08-27_enterprise-2vcpu-13gib_run3-warm.txt)
- Parallelism-disabled isolation test: [`2026-08-27_enterprise-2vcpu-13gib_parallel-disabled-isolation.txt`](cloudsql-tier-benchmark/2026-08-27_enterprise-2vcpu-13gib_parallel-disabled-isolation.txt)

| Query | Buffers touched | Enterprise Plus (before) | Enterprise (after, warm) | Δ |
| --- | --- | --- | --- | --- |
| Q2 — top-20 awarders by value, 2 workers | ~23.9k, all cached | 99 ms | 171–197 ms | 1.8–2.0× slower |
| Q2 — same query, parallelism forced off | ~22.3k, all cached | n/a | 139–150 ms | still slower single-threaded |
| Q4 — roll-call vote count, NS 51, 2 workers | ~4.1k | 223 ms (disk read) | 225–227 ms (all cached) | cache hit ≈ old disk read |
| Q5 — per-MP vote aggregate, NS 51 | ~4.1k, all cached | 152 ms | 237–288 ms | 1.6–1.9× slower |
| Q6 — count(\*) tr_companies (1M+ rows) | ~0.9k | 100 ms (disk read) | 146–170 ms (all cached) | cache hit slower than old disk read |
| Q3 — single awarder page, 50 rows, no parallelism | ~40, cached | 0.93 ms | 0.17 ms | **faster** |

**Reading this:** every row compares runs with matching buffer-hit counts, so the gap is not
cache warm-up (checked — see protocol step 3) and not pure parallel-coordination overhead
(checked — see the isolation-test file, single-threaded execution on the new tier is still
slower per buffer touched than the old tier's 2-worker parallel execution). The one query that
isn't parallel and touches few buffers (Q3) got *faster*, not slower. The regression tracks
specifically with queries that lean on parallel workers or scan thousands of buffers — i.e.
dashboard/leaderboard-style aggregates (procurement rankings, roll-call summaries), not simple
point lookups (a single company or awarder page).

**Working interpretation:** Enterprise Plus's `perf-optimized` machine family appears to
deliver genuinely faster vCPUs, not just more RAM headroom or optional features (Data Cache was
confirmed *not enabled* on this instance, so that specific Plus feature isn't in play here).
This revises an earlier assumption that the Plus premium was mostly paying for unused
near-zero-downtime/DR features.

## Open decision

Not settled. Current instance is running Enterprise / 2 vCPU / 13 GiB (the 30%-cheaper,
measured-slower option) while we test alternatives. Candidates still to try:

- **Enterprise at a higher vCPU count** (e.g. 4 vCPU) to see whether more cores compensate for
  the apparent per-core deficit — untested, and it narrows the savings the more vCPU is added.
- **Revert to Enterprise Plus, 2 vCPU / 16 GiB** if the latency regression turns out to matter
  on real traffic (watch Cloud Monitoring query/transaction latency percentiles for a few days
  before deciding, since this benchmark is synthetic/isolated, not live traffic).
- Committed Use Discount, once the edition/size question is settled — see the cost report this
  benchmark grew out of.

Revert command (kept here for reference, not yet executed as of the last results-log row):

```bash
gcloud sql instances patch electionsbg-pg --project=elections-bg \
  --edition=enterprise-plus --tier=db-perf-optimized-N-2 --quiet
```
