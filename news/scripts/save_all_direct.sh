#!/bin/bash
# Runs save_articles.py in parallel over every domain in
# news/data/bg_news_sites.csv whose feed_method needs no browser
# (rss / sitemap / robots_sitemap / sitemap_news / homepage_link).
# Writes one JSON summary line per domain to stdout or the given file —
# success or the script's own error JSON. ALWAYS exits 0 at bash level:
# per-domain failures live in the summaries, and xargs's own exit code
# (1 if any invocation failed) must not masquerade as a batch failure.
#
# Usage: save_all_direct.sh <N> [output.jsonl]
#
# The LAST line of the output is an --intake-report object (mode:
# "intake-report") rather than a per-domain summary — that is the sweep's
# verdict, and `alerts` is the part worth reading.
#
# Measured: N=100 runs 3-6 min per domain (sequential fetches inside a
# domain, 0.4s delay between article pages), so the per-domain timeout is
# generous and parallelism is deliberately moderate: 6 domains at a time =
# 6 concurrent requests to 6 DIFFERENT hosts, one request per host.
set -uo pipefail
N="${1:-100}"
OUT="${2:-/dev/stdout}"
# Resolve a relative OUT against the CALLER's cwd — the cd below would
# otherwise reinterpret it relative to news/ (measured: a first sweep died
# instantly writing to news/news/data/...).
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac
cd "$(dirname "$0")/.."   # news/

DIRECT_METHODS="rss|sitemap|robots_sitemap|sitemap_news|homepage_link"

domains=$(python3 -c "
import csv, re
pat = re.compile(r'^($DIRECT_METHODS)\$')
for r in csv.DictReader(open('data/bg_news_sites.csv', newline='', encoding='utf-8')):
    col = next(h for h in r if h.startswith('feed_method_'))
    if pat.match(r[col]):
        print(r['domain'])
")

run_one() {
  d="$1"; n="$2"
  out=$(timeout 1200 python3 scripts/save_articles.py "$d" "$n" 2>/dev/null)
  rc=$?
  if [ -z "$out" ]; then
    # A shell-level kill: the saver never reached its own state write, so the
    # failure would go unrecorded and --intake-report would show the domain as
    # healthy. The saver promises one JSON object on every owned outcome, so
    # even exit 0 with empty stdout is a launcher/contract failure. Record all
    # empty-output exits here; non-empty saver-owned errors stay untouched.
    # This function is exported to `bash -c` workers. A heredoc inside an
    # exported function is reconstructed by Bash 3.2 as `PYEOF\n || true`,
    # which is a syntax error and prevents every worker from importing the
    # function. Keep the recovery payload in one `-c` argument instead.
    python3 -c '
import sys, pathlib
sys.path.insert(0, str(pathlib.Path("scripts").resolve()))
import save_articles as sa
domain, status = sys.argv[1:3]
st = sa.load_state(domain)
sa.record_domain_failure(domain, st, "timeout_or_crash",
                         f"sweep worker produced no summary (exit {status})")
' "$d" "$rc" 2>/dev/null || true
  fi
  if [ -n "$out" ]; then
    # the saver always prints exactly one JSON object — pass it through,
    # whatever its exit code (exit 4 = "nothing saved this run" is a valid,
    # reportable outcome, not a crash; measured: emitting a fallback line
    # on nonzero exits double-wrote those domains in the first full sweep)
    echo "$out"
  else
    echo "{\"domain\": \"$d\", \"error\": \"timeout_or_crash\"}"
  fi
}
export -f run_one

echo "$domains" | xargs -P 6 -I{} bash -c 'run_one "$@" '"$N"'' _ {} > "$OUT"

# The sweep's own verdict. Nobody is watching a nightly run, so it has to say
# what it did: which sources are failing, which have gone stale without being
# quarantined, and which have a retry queue that is not draining. Reads only
# the per-domain state files and the stored corpus — no network — so it cannot
# itself fail the sweep. One JSON object, appended as the last line so a
# consumer can take it with `tail -1`.
if ! python3 scripts/save_articles.py --intake-report >> "$OUT" 2>/dev/null; then
  # The verdict is the whole point of an unattended run; losing it silently
  # would leave the sweep looking complete with nothing to read.
  echo '{"domain": null, "mode": "intake-report", "error": "report_failed"}' >> "$OUT"
fi
exit 0
