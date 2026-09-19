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
CHECK_LABEL=com.naiasno.news-staleness
AGENT_DIR=${NEWS_LAUNCHD_AGENT_DIR:-$HOME/Library/LaunchAgents}
PLIST="$AGENT_DIR/$LABEL.plist"
CHECK_PLIST="$AGENT_DIR/$CHECK_LABEL.plist"
# The staleness alarm (plan Phase 0 step 0.3) runs as its OWN agent: a
# scheduler that has stopped cannot report its own absence.
CHECK_INTERVAL_S=${NEWS_STALENESS_INTERVAL_S:-1800}
case "$CHECK_INTERVAL_S" in
  ""|*[!0-9]*) echo "NEWS_STALENESS_INTERVAL_S must be a positive integer" >&2; exit 2 ;;
esac
if [ "$((10#$CHECK_INTERVAL_S))" -le 0 ]; then
  echo "NEWS_STALENESS_INTERVAL_S must be a positive integer" >&2
  exit 2
fi
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
  if [ -f "$ROOT/scripts/check_staleness.py" ]; then
    CHECK_SCRIPT="$ROOT/scripts/check_staleness.py"
  elif [ -f "$ROOT/news/scripts/check_staleness.py" ]; then
    CHECK_SCRIPT="$ROOT/news/scripts/check_staleness.py"
  else
    echo "missing scripts/check_staleness.py under $ROOT — incomplete copy" >&2
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

# launchd's default PATH (/usr/bin:/bin:…) has only the system python3, which
# is 3.9 on macOS — check_staleness.py stays 3.9-compatible, and PATH puts a
# newer one first when the host has it.
render_check_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$CHECK_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>python3</string>
    <string>$CHECK_SCRIPT</string>
    <string>--root</string>
    <string>$ROOT</string>
    <string>--notify</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StartInterval</key>
  <integer>$CHECK_INTERVAL_S</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ROOT/var/staleness.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/var/staleness.log</string>
</dict>
</plist>
PLIST
}

if [ "$MODE" = "print" ]; then
  render_plist
  render_check_plist
  exit 0
fi

DOMAIN="gui/$(id -u)"
# `bootout` returns before the service is torn down, and a bootstrap straight
# after it commonly fails with "Bootstrap failed: 5". Wait for the label to go.
unload() {
  launchctl bootout "$DOMAIN/$1" >/dev/null 2>&1 || :
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    launchctl print "$DOMAIN/$1" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

bootstrap() {
  for attempt in 1 2 3; do
    if launchctl bootstrap "$DOMAIN" "$1"; then return 0; fi
    if [ "$attempt" = 3 ]; then
      echo "launchctl bootstrap failed 3 times; the plist is at $1 — retry this installer" >&2
      exit 1
    fi
    sleep 1
  done
}

if [ "$MODE" = "uninstall" ]; then
  unload "$LABEL"
  unload "$CHECK_LABEL"
  rm -f "$PLIST" "$CHECK_PLIST"
  echo "removed LaunchAgents $LABEL and $CHECK_LABEL"
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
NEXT_CHECK=$(mktemp "${TMPDIR:-/tmp}/naiasno-launchd-check.XXXXXX")
trap 'rm -f "$NEXT" "$NEXT_CHECK"' EXIT
render_plist > "$NEXT"
render_check_plist > "$NEXT_CHECK"
plutil -lint "$NEXT" >/dev/null
plutil -lint "$NEXT_CHECK" >/dev/null
unload "$LABEL"
unload "$CHECK_LABEL"
mv "$NEXT" "$PLIST"
mv "$NEXT_CHECK" "$CHECK_PLIST"
chmod 644 "$PLIST" "$CHECK_PLIST"
bootstrap "$PLIST"
bootstrap "$CHECK_PLIST"
echo "installed LaunchAgent $LABEL: $PLIST (hourly at :00, log $ROOT/var/cron.log)"
echo "installed LaunchAgent $CHECK_LABEL: $CHECK_PLIST (every ${CHECK_INTERVAL_S}s, log $ROOT/var/staleness.log)"
