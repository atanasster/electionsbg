#!/bin/bash
# Reusable read-only benchmark for electionsbg-pg. Run before and after the
# Enterprise Plus -> Enterprise edition switch and diff the two output files.
# Usage: ./pg_baseline_bench.sh <label>   (label e.g. "before" or "after")
set -euo pipefail
cd /Users/atanasster/data-bg
export PGPASSFILE=.pgpass
PGURL="postgres://postgres@127.0.0.1:5434/electionsbg"
LABEL="${1:-run}"
OUT="/private/tmp/claude-501/-Users-atanasster-data-bg/ad8d2ecc-2bc8-4ada-954c-82a126448873/scratchpad/pg_bench_${LABEL}.txt"

{
  echo "### electionsbg-pg benchmark — label=$LABEL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "--- instance edition/tier (from gcloud) ---"
  gcloud sql instances describe electionsbg-pg --project=elections-bg --format="value(settings.edition,settings.tier)" 2>/dev/null

  echo ""
  echo "--- server state ---"
  psql "$PGURL" -t -c "SELECT version();"
  psql "$PGURL" -t -c "SELECT pg_postmaster_start_time();"
  psql "$PGURL" -t -c "SELECT count(*) AS connections FROM pg_stat_activity;"
  psql "$PGURL" -t -c "SHOW shared_buffers;"
  psql "$PGURL" -t -c "SHOW effective_cache_size;"

  echo ""
  echo "--- cumulative cache hit ratio (since stats_reset, for reference only) ---"
  psql "$PGURL" -t -c "SELECT stats_reset, blks_hit, blks_read, round(100.0*blks_hit/nullif(blks_hit+blks_read,0),3) AS hit_ratio_pct FROM pg_stat_database WHERE datname='electionsbg';"

  echo ""
  echo "--- round-trip latency, SELECT 1 x5 ---"
  psql "$PGURL" -c "\timing on" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" -c "SELECT 1;" 2>&1 | grep -i time

  echo ""
  echo "=== Q1: count(*) contracts WHERE tag='contract' (idx_contracts_tag) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM contracts WHERE tag='contract';"

  echo ""
  echo "=== Q2: top-20 awarders by contract value (aggregate over idx_contracts_tag_amount) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT awarder_eik, count(*) AS n, sum(amount_eur) AS total FROM contracts WHERE tag='contract' GROUP BY awarder_eik ORDER BY total DESC NULLS LAST LIMIT 20;"

  echo ""
  echo "=== Q3: one awarder's contracts, recent-first (idx_contracts_awarder_date) — АПИ EIK 000695089 ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT key, date, contractor_name, amount_eur FROM contracts WHERE awarder_eik = '000695089' AND tag='contract' ORDER BY date DESC LIMIT 50;"

  echo ""
  echo "=== Q4: roll-call votes count for NS 51 (idx_vote_cast_ns_mp) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM vote_cast WHERE ns=51;"

  echo ""
  echo "=== Q5: per-MP vote counts for NS 51 (aggregate) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT mp_id, count(*) FROM vote_cast WHERE ns=51 GROUP BY mp_id ORDER BY count(*) DESC LIMIT 10;"

  echo ""
  echo "=== Q6: full count(*) tr_companies (1M+ row seq/index-only scan) ==="
  psql "$PGURL" -c "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM tr_companies;"

  echo ""
  echo "--- bgwriter/checkpointer counters (raw, for delta calc) ---"
  psql "$PGURL" -x -c "SELECT * FROM pg_stat_bgwriter;"

} > "$OUT" 2>&1

echo "Wrote $OUT"
