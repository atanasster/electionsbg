#!/usr/bin/env bash
# Idempotently install or remove the hourly news job as a macOS LaunchAgent.
#
# ⚠️ WHY launchd AND NOT cron ON A MAC. cron does not wake a sleeping machine
# and silently DROPS every run whose minute passed while the Mac was asleep;
# `run_hourly.sh`'s `caffeinate -s` only holds the machine awake DURING a run.
# launchd's StartCalendarInterval runs a missed interval on wake instead —
# ONCE however many hours were missed, and not at all for time the Mac was
# powered off. install_cron.sh stays as the path for a Linux host.
#
# ⚠️ ONE SCHEDULER. Two schedulers are two writers of one release pointer
# (plan §0.1 R8), so this refuses while the install_cron.sh block is present,
# and install_cron.sh refuses while this agent's plist is present.
#
# Layouts: the standalone bundle (run_hourly.sh + config.env at its root) and
# the copied news/ folder, whose news/install_launchd.sh wrapper passes
# `--root news/` (run_hourly.sh + the five .env.* files). The root is an
# ARGUMENT, not an environment variable, so a stray export in an operator's
# shell cannot re-point a bundle's installer at another folder.
#
# The plist embeds absolute paths: after moving the folder, re-run this.
set -euo pipefail

usage() {
  echo "usage: $0 [--root DIR] [--print|--uninstall]" >&2
  exit 2
}

ROOT=$(cd "$(dirname "$0")" && pwd)
MODE=install
while [ $# -gt 0 ]; do
  case $1 in
    --root) [ $# -ge 2 ] || usage; ROOT=$(cd "$2" && pwd); shift 2 ;;
    --print) MODE=print; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    *) usage ;;
  esac
done

LABEL=com.naiasno.news-hourly
AGENT_DIR=${NEWS_LAUNCHD_AGENT_DIR:-$HOME/Library/LaunchAgents}
PLIST="$AGENT_DIR/$LABEL.plist"
CRON_BEGIN="# BEGIN naiasno-news-hourly"

if [ "$MODE" != "print" ]; then
  [ "$(uname -s)" = Darwin ] || {
    echo "install_launchd.sh is macOS-only; use install_cron.sh on this host" >&2
    exit 2
  }
  [ "$(id -u)" -ne 0 ] || {
    echo "run as the logged-in user, not root — a LaunchAgent lives in that user's gui domain" >&2
    exit 2
  }
fi
case "$ROOT" in
  *"<"*|*">"*|*"&"*|*$'\n'*)
    echo "news path may not contain <, >, & or a newline" >&2
    exit 2
    ;;
esac

if [ "$MODE" != "uninstall" ]; then
  [ -f "$ROOT/run_hourly.sh" ] || {
    echo "missing $ROOT/run_hourly.sh — wrong root" >&2
    exit 2
  }
  if [ -f "$ROOT/config.env" ]; then
    ENV_FILES=("$ROOT/config.env")
  else
    ENV_FILES=(
      "$ROOT/.env.api" "$ROOT/.env.model" "$ROOT/.env.upload"
      "$ROOT/.env.pipeline" "$ROOT/.env.evals"
    )
  fi
  for path in "${ENV_FILES[@]}"; do
    [ -f "$path" ] || {
      echo "missing $path — run setup.sh first" >&2
      exit 2
    }
  done
  if [ "$MODE" = "install" ] && grep -q 'REPLACE_ME' "${ENV_FILES[@]}"; then
    echo "environment files still contain REPLACE_ME placeholders" >&2
    exit 2
  fi
fi

# ProcessType is Standard, NOT Background: Background applies low CPU/IO
# priority and I/O throttling, and a run stretched past the hour makes the
# next one exit `already_running` on the PID lock — a silently halved cadence.
render_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/run_hourly.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$ROOT/var/cron.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/var/cron.log</string>
  <key>ProcessType</key>
  <string>Standard</string>
</dict>
</plist>
PLIST
}

if [ "$MODE" = "print" ]; then
  render_plist
  exit 0
fi

DOMAIN="gui/$(id -u)"
# `bootout` returns before the service is torn down, and a bootstrap straight
# after it commonly fails with "Bootstrap failed: 5". Wait for the label to go.
unload() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

if [ "$MODE" = "uninstall" ]; then
  unload
  rm -f "$PLIST"
  echo "removed LaunchAgent $LABEL"
  exit 0
fi

# Capture first, then match: `crontab -l | grep -q` under pipefail can SIGPIPE
# the writer on an early match and read as "not found" — skipping the refusal.
CRONTAB=$(crontab -l 2>/dev/null || :)
if grep -qxF "$CRON_BEGIN" <<<"$CRONTAB"; then
  echo "the install_cron.sh block is installed — run install_cron.sh --uninstall first (one scheduler only)" >&2
  exit 2
fi

mkdir -p "$ROOT/var" "$AGENT_DIR"
NEXT=$(mktemp "${TMPDIR:-/tmp}/naiasno-launchd.XXXXXX")
trap 'rm -f "$NEXT"' EXIT
render_plist > "$NEXT"
plutil -lint "$NEXT" >/dev/null
unload
mv "$NEXT" "$PLIST"
chmod 644 "$PLIST"
for attempt in 1 2 3; do
  if launchctl bootstrap "$DOMAIN" "$PLIST"; then break; fi
  if [ "$attempt" = 3 ]; then
    echo "launchctl bootstrap failed 3 times; the plist is at $PLIST — retry this installer" >&2
    exit 1
  fi
  sleep 1
done
echo "installed LaunchAgent $LABEL: $PLIST (hourly at :00, log $ROOT/var/cron.log)"
