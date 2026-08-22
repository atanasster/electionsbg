#!/bin/bash
# Runs fetch_latest_articles.py in parallel over every domain in
# news/data/bg_news_sites.csv whose feed_method needs no browser
# (rss / sitemap / robots_sitemap / sitemap_news / homepage_link).
# Prints one JSON line per domain to stdout — success or the script's own
# error JSON (never a bash-level failure for one bad domain).
#
# Usage: fetch_all_direct.sh <N> [output_file]
set -uo pipefail
cd "$(dirname "$0")/.."   # news/
N="${1:-5}"
OUT="${2:-/dev/stdout}"

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
  timeout 90 python3 scripts/fetch_latest_articles.py "$d" "$n" 2>/dev/null || \
    echo "{\"domain\": \"$d\", \"error\": \"timeout_or_crash\"}"
}
export -f run_one

echo "$domains" | xargs -P 10 -I{} bash -c 'run_one "$@" '"$N"'' _ {} > "$OUT"
