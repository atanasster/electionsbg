#!/bin/bash
# Re-fetch one domain's FAILED article pages inside a cleared browser.
#
# ⚠️ THIS IS THE STEP THE PIPELINE NEVER HAD, and its absence is why the
# largest outlets stored nothing for weeks. The challenge is cleared and the
# links are harvested — then the article PAGES are fetched by a plain HTTP
# client and 403'd. `browser_then_rss` / `browser_then_sitemap` have no
# page-level browser step at all, and the direct tier (24chasa.bg) has none
# either (plan §3.2, §6.3).
#
# Routing is therefore PER ARTICLE and after the fact: try plain HTTP, and
# escalate only what it was refused. A wrong guess costs one retry instead of
# a whole sweep, which is what the single-link `--route` probe could not do —
# it measured the BROWSER's fingerprint and then handed the pages to a
# different client.
#
# Usage:  save result JSON on stdin | escalate_browser.sh <domain> <N>
# Emits one JSON line (mode `browser_escalation`), always exits 0: an
# escalation that fails leaves the run exactly as it found it.
#
# Budgets, and how they relate:
#   NEWS_ESCALATE_MAX_URLS (5)      pages tried per domain per run
#   NEWS_ESCALATE_MIN_FAILURES (5)  the direct sweep's threshold to call this
#     ⚠️ The direct tier only escalates a domain with at least MIN_FAILURES
#     failures and then tries at most MAX_URLS of them. With MIN < MAX a
#     domain qualifies on fewer failures than it may retry, which is fine;
#     with MAX raised well above MIN the pass grows in BOTH directions at
#     once — more domains, more pages each — inside an hourly job.
#   NEWS_ESCALATE_PAGE_TIMEOUT (45) / _ENTRY_TIMEOUT (300)  challenge waits
#   NEWS_ESCALATE_DEADLINE_S        what the CALLER has left; never exceeded
#   NEWS_ESCALATE_COOLDOWN_S (6 h)  after a REFUSAL — see below
#
# The cooldown records one thing only: this outlet refused us (its pages
# stayed challenged, or they were fetched and none survived the extractor).
# A crash, a timeout or a save failure on OUR side never writes it, because
# that would ice a recoverable outlet for six runs on our own bug.
set -uo pipefail

DOMAIN="${1:-}"
N="${2:-20}"
# ⚠️ PER PAGE, NOT PER SWEEP. The harvester waits out a challenge on EVERY
# page it fetches, so handing it the tier's 600 s budget would cost
# 600 s x N refused articles — hours for one domain, inside an hourly job.
# A page that has not cleared in ~45 s is one this client cannot have.
TIMEOUT_S="${NEWS_ESCALATE_PAGE_TIMEOUT:-45}"
# The ENTRY page's challenge is a different budget from an article's: this
# repo measures dnevnik.bg at ~5 min and capital.bg at ~10 on a cold context.
# 45 s there would fail every time and then earn a cooldown for it.
ENTRY_TIMEOUT_S="${NEWS_ESCALATE_ENTRY_TIMEOUT:-300}"
# And a cap on how many are tried at all, so a wholly-blocked outlet costs a
# bounded slice of the run rather than the whole window.
MAX_URLS="${NEWS_ESCALATE_MAX_URLS:-5}"
# ⚠️ A DOMAIN THAT CANNOT BE HAD MUST NOT BE RETRIED EVERY HOUR. Measured
# 2026-09-20: blitz.bg and dnevnik.bg challenge their ARTICLE pages for this
# client even in a real browser (headless and headed alike), so escalation
# yields nothing there — and 17 domains x a few minutes each would eat the
# hourly window. A zero-yield escalation puts that domain on ice for
# NEWS_ESCALATE_COOLDOWN_S; a yield of even one article clears it.
COOLDOWN_S="${NEWS_ESCALATE_COOLDOWN_S:-21600}"
if [ -z "$DOMAIN" ]; then
  echo '{"error": "usage", "detail": "escalate_browser.sh <domain> <N>"}' >&2
  exit 0
fi
case "$N" in *[!0-9]*|"") N=20 ;; esac
case "$TIMEOUT_S" in *[!0-9]*|"") TIMEOUT_S=45 ;; esac
case "$ENTRY_TIMEOUT_S" in *[!0-9]*|"") ENTRY_TIMEOUT_S=300 ;; esac
case "$MAX_URLS" in *[!0-9]*|"") MAX_URLS=5 ;; esac
case "$COOLDOWN_S" in *[!0-9]*|"") COOLDOWN_S=21600 ;; esac
cd "$(dirname "$0")/.."   # news/

URLS=$(mktemp "${TMPDIR:-/tmp}/escalate-urls.XXXXXX")
trap 'rm -f "$URLS"' EXIT

# The failed URLs come from the save result the caller just produced, not from
# the state file: the state's retry queue also carries entries from earlier
# runs that this sweep never attempted.
python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for row in (doc.get("failed") or []):
    url = row.get("url") if isinstance(row, dict) else row
    if isinstance(url, str) and url.startswith("http"):
        print(url)
' > "$URLS"

# ⚠️ NOT `grep -c ... || echo 0`. grep -c PRINTS 0 and EXITS 1 on no match, so
# the fallback ran too and COUNT became "0\n0" — every integer test then
# errored instead of exiting early, and the escalator wrote two lines of
# INVALID JSON into the sweep for every domain that had nothing to escalate
# (measured: 18 of 34 rows in the 2026-09-20 03:00 browser sweep).
COUNT=$(grep -c . "$URLS" 2>/dev/null)
case "$COUNT" in ""|*[!0-9]*) COUNT=0 ;; esac
if [ "$COUNT" -eq 0 ]; then
  exit 0
fi

LEDGER="data/_browser/$DOMAIN.escalation.json"
# ⚠️ ONE writer, called from both outcomes: the cooldown means "this outlet
# refuses us" and nothing else, so only an explicit refusal (every page stayed
# challenged, or pages were fetched and none survived) may write it.
write_ledger() {  # <saved> <reason>
  python3 -c '
import json, sys, time
try:
    json.dump({"at": time.time(), "saved": int(sys.argv[2]),
               "escalated": int(sys.argv[3]), "reason": sys.argv[4]},
              open(sys.argv[1], "w"))
except OSError:
    pass
' "$LEDGER" "$1" "$COUNT" "$2" 2>/dev/null
}
COOLING=$(python3 -c '
import json, sys, time
try:
    doc = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
if doc.get("saved"):
    sys.exit(0)
left = float(doc.get("at", 0)) + float(sys.argv[2]) - time.time()
if left > 0:
    print(int(left))
' "$LEDGER" "$COOLDOWN_S" 2>/dev/null)
if [ -n "$COOLING" ]; then
  printf '{"domain": "%s", "mode": "browser_escalation", "skipped": "cooldown", "seconds_left": %s}\n' \
    "$DOMAIN" "$COOLING"
  exit 0
fi
if [ "$COUNT" -gt "$MAX_URLS" ]; then
  head -n "$MAX_URLS" "$URLS" > "$URLS.capped" && mv "$URLS.capped" "$URLS"
  # Re-derived from the FILE: a failed head/mv would otherwise leave every URL
  # in place while COUNT claimed 5, and the budget below would kill the
  # harvest part-way through — losing pages it had already fetched.
  COUNT=$(grep -c . "$URLS" 2>/dev/null)
  case "$COUNT" in ""|*[!0-9]*) COUNT=0 ;; esac
fi
rm -f "$URLS.capped"

# The outer timeout is the real bound: per-page budget x pages, plus one
# challenge clearance on the entry page, plus slack.
BUDGET=$(( ENTRY_TIMEOUT_S + TIMEOUT_S * COUNT + 120 ))
# A caller mid-sweep passes what is LEFT of its own budget; never exceed it.
DEADLINE="${NEWS_ESCALATE_DEADLINE_S:-0}"
case "$DEADLINE" in *[!0-9]*|"") DEADLINE=0 ;; esac
if [ "$DEADLINE" -gt 0 ] && [ "$BUDGET" -gt "$DEADLINE" ]; then
  BUDGET="$DEADLINE"
fi
# `--n` is inert in prefetch mode (the URL set IS the file), so it is not
# passed: handing it the sweep's N suggested a relationship that does not
# exist.
HARVEST=$(timeout "$BUDGET" node scripts/harvest_browser.mjs \
            "$DOMAIN" --timeout="$ENTRY_TIMEOUT_S" \
            --page-timeout="$TIMEOUT_S" --prefetch-urls="$URLS" 2>/dev/null)
JSONL=$(printf '%s' "$HARVEST" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
except Exception:
    print("")
    sys.exit(0)
print((doc.get("jsonl_path") or "") if doc.get("prefetched") else "")
')
if [ -z "$JSONL" ] || [ ! -s "$JSONL" ]; then
  # ⚠️ A COOLDOWN MUST MEAN "THIS OUTLET REFUSES US", never "our side broke".
  # A harvest that timed out, crashed, or never produced JSON says nothing
  # about the outlet — icing it for six hours on that basis would hide a
  # recoverable domain. Only an explicit refusal (the browser reached the
  # pages and every one stayed on a challenge) counts.
  REFUSED=$(printf '%s' "${HARVEST:-}" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
print(1 if (doc.get("challenged") and not doc.get("prefetched")) else "")
' 2>/dev/null)
  if [ -n "$REFUSED" ]; then
    write_ledger 0 "every page stayed challenged"
  fi
  # The harvester's stdout is EMBEDDED, so it has to be valid JSON or become
  # a string: a crash message interpolated raw makes the sweep line unparsable.
  printf '%s' "${HARVEST:-}" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
try:
    harvest = json.loads(raw)
except Exception:
    harvest = raw[:400] or None
print(json.dumps({"domain": sys.argv[1], "mode": "browser_escalation",
                  "attempted": int(sys.argv[2]), "prefetched": 0,
                  "harvest": harvest}, ensure_ascii=False))
' "$DOMAIN" "$COUNT"
  exit 0
fi

# Scaled to the work: this save reads ≤ MAX_URLS prefetched pages from disk
# and makes NO network requests, so the whole-domain 1200 s ceiling would only
# ever hide a hang.
SAVED=$(timeout $(( 60 + COUNT * 30 )) python3 scripts/save_articles.py \
          "$DOMAIN" "$COUNT" --prefetched="$JSONL" 2>/dev/null)
if [ -z "$SAVED" ]; then
  SAVED='{"error": "timeout_or_crash", "stage": "escalation_save"}'
fi
LINE=$(printf '%s' "$SAVED" | python3 -c '
import json, sys
try:
    doc = json.loads(sys.stdin.read())
except Exception:
    doc = {"error": "unparsable_save_result"}
doc["mode"] = "browser_escalation"
doc["escalated"] = int(sys.argv[1])
print(json.dumps(doc, ensure_ascii=False))
' "$COUNT")
printf '%s\n' "$LINE"
write_ledger "$(printf '%s' "$LINE" | python3 -c '
import json, sys
try:
    print(int(json.loads(sys.stdin.read()).get("saved") or 0))
except Exception:
    print(0)
')" "saved from the browser"
exit 0
