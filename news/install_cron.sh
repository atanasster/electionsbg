#!/usr/bin/env bash
# Idempotently install/remove the copied news folder's hourly cron entry.
set -euo pipefail

NEWS_ROOT=$(cd "$(dirname "$0")" && pwd)
BEGIN="# BEGIN naiasno-news-hourly"
END="# END naiasno-news-hourly"
MODE=install
case ${1:-} in
  "") ;;
  --print) MODE=print ;;
  --uninstall) MODE=uninstall ;;
  *) echo "usage: $0 [--print|--uninstall]" >&2; exit 2 ;;
esac
case "$NEWS_ROOT" in
  *"'"*|*%*|*$'\n'*)
    echo "news path may not contain a quote, percent sign, or newline" >&2
    exit 2
    ;;
esac

ENV_FILES=(
  "$NEWS_ROOT/.env.api"
  "$NEWS_ROOT/.env.model"
  "$NEWS_ROOT/.env.upload"
  "$NEWS_ROOT/.env.pipeline"
)
if [ "$MODE" != "uninstall" ]; then
  for path in "${ENV_FILES[@]}"; do
    [ -f "$path" ] || {
      echo "missing $path — run setup.sh first" >&2
      exit 2
    }
  done
fi
if [ "$MODE" = "install" ] && \
    grep -q 'REPLACE_ME' "${ENV_FILES[@]}"; then
  echo "environment files still contain REPLACE_ME placeholders" >&2
  exit 2
fi

LINE="0 * * * * /bin/bash '$NEWS_ROOT/run_hourly.sh' >> '$NEWS_ROOT/var/cron.log' 2>&1"
if [ "$MODE" = "print" ]; then
  printf '%s\n%s\n%s\n' "$BEGIN" "$LINE" "$END"
  exit 0
fi

CURRENT=$(mktemp "${TMPDIR:-/tmp}/naiasno-news-cron-current.XXXXXX")
NEXT=$(mktemp "${TMPDIR:-/tmp}/naiasno-news-cron-next.XXXXXX")
trap 'rm -f "$CURRENT" "$NEXT"' EXIT
crontab -l > "$CURRENT" 2>/dev/null || :
awk -v begin="$BEGIN" -v end="$END" '
  $0 == begin {skip=1; next}
  $0 == end {skip=0; next}
  !skip {print}
' "$CURRENT" > "$NEXT"
if [ "$MODE" = "install" ]; then
  mkdir -p "$NEWS_ROOT/var"
  printf '%s\n%s\n%s\n' "$BEGIN" "$LINE" "$END" >> "$NEXT"
fi
crontab "$NEXT"
if [ "$MODE" = "install" ]; then
  echo "installed hourly cron: $LINE"
else
  echo "removed naiasno-news-hourly cron block"
fi
