#!/bin/bash
# Runs the BROWSER tier headlessly, end to end: harvest with Playwright, then
# save through the same extractor and gates the direct tier uses.
#
# Until harvest_browser.mjs existed this whole tier was a Claude session
# driving a Browser tool by hand, so a cron job skipped all 17 domains — four
# of them in the top twenty (dir.bg #2, blitz.bg #3, offnews.bg #16,
# dnevnik.bg #18), plus bta.bg, the national agency, and capital.bg.
#
# Usage: save_all_browser.sh <N> [output.jsonl] [--timeout=SECONDS]
#
# One JSON line per domain, same shape the direct sweep emits. ALWAYS exits 0
# at bash level: per-domain failures live in the summaries.
#
# ⚠️ SEQUENTIAL, not parallel. Each domain runs a real Chromium, and the
# Cloudflare challenge is WAITED OUT rather than clicked — measured at ~12s
# for blitz.bg, ~5 min for dnevnik.bg and ~10 min for capital.bg. Six of those
# at once is six browsers competing for the same CPU, which makes every one of
# them slower and some of them time out. Budget an hour for the tier.
set -uo pipefail
# Flags are pulled OUT before the positionals are read: `save_all_browser.sh
# 100 --timeout=900` used to write the whole sweep to a file literally named
# "--timeout=900".
N=""
OUT=""
TIMEOUT_S=600
for arg in "$@"; do
  case "$arg" in
    --timeout=*) TIMEOUT_S="${arg#*=}" ;;
    --*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *) if [ -z "$N" ]; then N="$arg"; elif [ -z "$OUT" ]; then OUT="$arg"; fi ;;
  esac
done
N="${N:-100}"
OUT="${OUT:-/dev/stdout}"
case "$N" in *[!0-9]*|"") echo "N must be a non-negative integer" >&2; exit 1 ;; esac
case "$TIMEOUT_S" in *[!0-9]*|"") echo "--timeout needs seconds" >&2; exit 1 ;; esac
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac
cd "$(dirname "$0")/.."   # news/

domains=$(python3 -c "
import csv
for r in csv.DictReader(open('data/bg_news_sites.csv', newline='', encoding='utf-8')):
    method = next(r[h] for h in r if h.startswith('feed_method_'))
    policy = next((r[h] for h in r if h.startswith('bot_policy_')), '')
    # bot_refused sites are skipped entirely: they 403 an identified bot, and
    # respecting that is the point of having an honest identity.
    if method.startswith('browser_') and policy != 'bot_refused':
        print(r['domain'])
")

: > "$OUT"
for d in $domains; do
  harvest=$(timeout $((TIMEOUT_S + 900)) node scripts/harvest_browser.mjs \
              "$d" --n="$N" --timeout="$TIMEOUT_S" --route 2>/dev/null)
  if [ -z "$harvest" ]; then
    echo "{\"domain\": \"$d\", \"error\": \"timeout_or_crash\", \"stage\": \"harvest\"}" >> "$OUT"
    continue
  fi

  # The harvester says which of the three shapes this domain is and where it
  # put the scratch file; this reads that rather than re-deriving it.
  #
  # ⚠️ NUL-delimited, not whitespace. `read -r a b c` splits on IFS, so any
  # repo path containing a space shifted every field and turned every domain
  # into no_links_harvested.
  # ⚠️ Parsed by EVALUATING shell-quoted assignments, not by splitting on
  # whitespace. `read -r a b c` splits on IFS, so any repo path containing a
  # space shifted every field and turned every domain into
  # no_links_harvested — and `mapfile` is a bash-4 builtin that macOS's bash
  # 3.2 does not have, so the NUL-delimited fix for that did not run either.
  # shlex.quote makes the eval safe for any path.
  assignments=$(python3 -c "
import json, shlex, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    sys.exit(1)
for var, key in (('mode', 'mode'), ('kind', 'stdin_mode'), ('xml', 'xml_path'),
                 ('urls', 'urls_path'), ('jsonl', 'jsonl_path'),
                 ('route', 'route')):
    print(f'{var}={shlex.quote(str(d.get(key) or \"\"))}')
" <<< "$harvest") || { echo "$harvest" >> "$OUT"; continue; }
  mode=""; kind=""; xml=""; urls=""; jsonl=""; route=""
  eval "$assignments"
  mode="${mode:-error}"

  case "$mode" in
    browser_then_fetch)
      # A real feed exists; the browser only cleared the way to it. Pipe the
      # XML through the SAME tested parser the direct tier uses.
      if [ -z "$xml" ] || [ ! -s "$xml" ]; then
        out="{\"domain\": \"$d\", \"error\": \"fetch_failed\", \"detail\": \"the harvester reported browser_then_fetch with no XML\"}"
      else
        out=$(timeout 900 python3 scripts/save_articles.py \
                "$d" "$N" --stdin-list="$kind" < "$xml" 2>/dev/null)
      fi
      ;;
    browser_render_scrape)
      if [ "$route" = "browser_fetch" ] && [ -n "$jsonl" ] && [ -s "$jsonl" ]; then
        out=$(timeout 1200 python3 scripts/save_articles.py \
                "$d" "$N" --prefetched="$jsonl" 2>/dev/null)
      elif [ -n "$urls" ] && [ -s "$urls" ]; then
        out=$(timeout 1200 python3 scripts/save_articles.py \
                "$d" "$N" --urls-file="$urls" 2>/dev/null)
      else
        out="{\"domain\": \"$d\", \"error\": \"no_links_harvested\"}"
      fi
      ;;
    *)
      out="$harvest"   # a deliberate stop or a failure; report it verbatim
      ;;
  esac
  # Assigned separately rather than through ${out:-...}: a default containing
  # a closing brace leaks one into the expansion, and every line came out as
  # invalid JSON with a trailing "}".
  if [ -z "$out" ]; then
    out="{\"domain\": \"$d\", \"error\": \"timeout_or_crash\", \"stage\": \"save\"}"
  fi
  echo "$out" >> "$OUT"
done

# The sweep's own verdict, same as the direct tier's.
if ! python3 scripts/save_articles.py --intake-report >> "$OUT" 2>/dev/null; then
  echo '{"domain": null, "mode": "intake-report", "error": "report_failed"}' >> "$OUT"
fi
exit 0
