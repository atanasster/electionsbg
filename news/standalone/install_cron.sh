#!/usr/bin/env bash
# Idempotently install or remove the standalone bundle's hourly cron entry.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
BEGIN="# BEGIN naiasno-news-hourly"
END="# END naiasno-news-hourly"
MODE=install
case ${1:-} in
  "") ;;
  --print) MODE=print ;;
  --uninstall) MODE=uninstall ;;
  *) echo "usage: $0 [--print|--uninstall]" >&2; exit 2 ;;
esac
case "$ROOT" in
  *"'"*|*%*|*$'\n'*)
    echo "bundle path may not contain a quote, percent sign, or newline" >&2
    exit 2
    ;;
esac
if [ ! -f "$ROOT/config.env" ] && [ "$MODE" != "uninstall" ]; then
  echo "missing $ROOT/config.env — run setup.sh and configure it first" >&2
  exit 2
fi
if [ "$MODE" = "install" ] && grep -q 'REPLACE_ME' "$ROOT/config.env"; then
  echo "config.env still contains REPLACE_ME placeholders" >&2
  exit 2
fi

LINE="0 * * * * /bin/bash '$ROOT/run_hourly.sh' >> '$ROOT/var/cron.log' 2>&1"
if [ "$MODE" = "print" ]; then
  printf '%s\n%s\n%s\n' "$BEGIN" "$LINE" "$END"
  exit 0
fi

CURRENT=$(mktemp "${TMPDIR:-/tmp}/naiasno-cron-current.XXXXXX")
NEXT=$(mktemp "${TMPDIR:-/tmp}/naiasno-cron-next.XXXXXX")
trap 'rm -f "$CURRENT" "$NEXT"' EXIT
crontab -l > "$CURRENT" 2>/dev/null || :
awk -v begin="$BEGIN" -v end="$END" '
  $0 == begin {skip=1; next}
  $0 == end {skip=0; next}
  !skip {print}
' "$CURRENT" > "$NEXT"
if [ "$MODE" = "install" ]; then
  mkdir -p "$ROOT/var"
  printf '%s\n%s\n%s\n' "$BEGIN" "$LINE" "$END" >> "$NEXT"
fi
crontab "$NEXT"
if [ "$MODE" = "install" ]; then
  echo "installed hourly cron: $LINE"
else
  echo "removed naiasno-news-hourly cron block"
fi
