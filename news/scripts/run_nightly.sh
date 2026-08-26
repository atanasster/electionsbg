#!/usr/bin/env bash
# The nightly run, end to end, on a machine nobody is watching.
#
# ⚠️ THE REPORT IS THE PRODUCT. Nobody is at the keyboard at 03:00, so a stage
# that quietly did nothing and a stage that worked must be distinguishable
# from the output alone. Every stage emits one JSON object; this script
# collects them into one line and writes it to news/data/_nightly/<date>.json.
#
# ⚠️ IT DOES NOT `set -e`. A failure in one stage must not abandon the
# others: a model server that is down should still leave the corpus harvested
# and the bundles rebuilt, and the report must say which stage failed rather
# than ending at the first one. Each stage records its own exit code instead.
#
# Usage:  news/scripts/run_nightly.sh [--limit N] [--model NAME] [--dry-run]
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 2
ROOT=$(pwd)
LIMIT=40
MODEL=${NEWS_LLM_MODEL:-local-model}
DRY=0
while [ $# -gt 0 ]; do
  case $1 in
    --limit) LIMIT=$2; shift 2 ;;
    --model) MODEL=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DAY=${STAMP%%T*}
OUT_DIR="$ROOT/news/data/_nightly"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/$DAY.json"
# ⚠️⚠️ NO `trap … EXIT` HERE, AND THAT IS NOT AN OVERSIGHT. In bash an EXIT
# trap fires when a COMMAND-SUBSTITUTION SUBSHELL exits, not only when the
# script does — so `trap 'rm -f "$STAGES"' EXIT` combined with
# `out=$("$@" 2>&1)` deleted the stages file after every single stage. Every
# stage ran, every stage printed its line, and the report came out saying
# `stages_run: 0`. A report that says nothing ran, after a run in which
# everything ran, is precisely the failure this script exists to prevent.
#
# The file lives beside the report instead and is worth keeping: it is the
# per-stage stream, and the report is the fold of it.
STAGES="$OUT_DIR/$DAY.stages.jsonl"
: > "$STAGES"

# ⚠️ NO HEREDOC INSIDE THIS FUNCTION. The first version used
# `python3 - args >> "$STAGES" <<'PY'` and the heredoc silently never ran —
# every stage executed, every stage printed its line to stderr, and the
# report came out with `stages_run: 0`. A report that says nothing ran, after
# a run in which everything ran, is the exact failure this script exists to
# prevent. The payload now goes in on stdin through a plain pipe.
stage() {
  local name=$1; shift
  local started out code secs payload
  started=$(date +%s)
  out=$("$@" 2>&1)
  code=$?
  secs=$(( $(date +%s) - started ))
  # The tail, and only if it parses. A stage that printed a traceback would
  # otherwise put a raw multi-line string into the report and make the whole
  # file unparseable — turning a stage failure into a report failure.
  payload=$(printf '%s' "$out" | tail -1)
  if ! printf '%s' "$payload" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
    # ⚠️ `errors="replace"`, because a stage's output is NOT guaranteed to be
    # UTF-8. A binary blob on stderr — a segfaulting model server, a mangled
    # locale — otherwise reaches the .jsonl as raw bytes and kills the report
    # reader for EVERY stage, turning one stage's failure into a run with no
    # report at all.
    payload=$(printf '%s' "$out" | tail -3 | python3 -c \
      'import json,sys; print(json.dumps({"unparsed": sys.stdin.buffer.read().decode("utf-8", "replace")[:600]}))')
  fi
  printf '%s' "$payload" | NAME="$name" CODE="$code" SECS="$secs" python3 -c '
import json, os, sys
print(json.dumps({"stage": os.environ["NAME"], "exit": int(os.environ["CODE"]),
                  "seconds": int(os.environ["SECS"]),
                  "result": json.load(sys.stdin)}, ensure_ascii=False))
' >> "$STAGES"
  echo "  [$name] exit=$code $(( $(date +%s) - started ))s" >&2
}

echo "== nightly $STAMP ==" >&2

# ── 1. Is there a model at all? ────────────────────────────────────────────
# ⚠️ FIRST, before an hour of harvesting. A run that collects 400 articles and
# then finds no model has wasted the window and the bandwidth.
stage probe_model python3 news/scripts/llm_client.py

# ── 2. Prompt assets in step with the schema ───────────────────────────────
# ⚠️ A grammar that permits a label the validator rejects yields records that
# are perfectly formed and refused 100% of the time — which reads as a model
# problem and is not one.
stage check_prompts python3 news/scripts/build_prompts.py --check

# ── 3. Gazetteer + dictionary pass inputs ──────────────────────────────────
# Deterministic, no model, so this stage never fails for LLM reasons.
stage common_words python3 news/scripts/build_gazetteer.py \
  --rebuild-common-words --json

# ── 4. Judge ───────────────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  stage analyze python3 news/scripts/analyze_local.py --dry-run --limit 1
else
  stage analyze python3 news/scripts/analyze_local.py \
    --limit "$LIMIT" --model "$MODEL"
fi

# ── 5. Reciprocal index ────────────────────────────────────────────────────
stage mention_index python3 news/scripts/build_mention_index.py --json

# ── 6. App bundles ─────────────────────────────────────────────────────────
stage bundles python3 news/scripts/build_app_data.py --quiet --json

# ── 7. Report ──────────────────────────────────────────────────────────────
# ⚠️ The stages come in by PATH, not on stdin. `python3 - < "$STAGES"
# <<'PYEOF'` applies both redirections and the LATER one wins — so the
# heredoc replaced the file as stdin, the reader saw the script text instead
# of the stages, and the report said `stages_run: 0` while a perfectly good
# stages file sat next to it.
STAMP="$STAMP" REPORT="$REPORT" STAGES="$STAGES" python3 - <<'PYEOF'
import json, os
stamp, dest = os.environ["STAMP"], os.environ["REPORT"]
with open(os.environ["STAGES"], encoding="utf-8") as fh:
    stages = [json.loads(line) for line in fh if line.strip()]
failed = [s["stage"] for s in stages if s["exit"] != 0]
report = {
    "generated_at": stamp,
    "stages": stages,
    "failed_stages": failed,
    # ⚠️ Counts, never a bare "ok". „6 of 6 stages" and „ok" look the same
    # until one stage is silently missing from the list.
    "stages_run": len(stages),
    "stages_ok": len(stages) - len(failed),
}
with open(dest, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=1)
print(json.dumps({k: report[k] for k in
                  ("generated_at", "stages_run", "stages_ok", "failed_stages")},
                 ensure_ascii=False))
PYEOF
REPORT_CODE=$?
echo "  report → $REPORT" >&2

# ⚠️⚠️ THE EXIT STATUS COMES FROM THIS RUN, not from a file on disk. The first
# version re-read "$REPORT" to decide — so a run whose report step FAILED
# exited 0 off the STALE same-day report left by an earlier run, which is the
# quiet-night lie this whole script exists to prevent. `CODE=$?` was captured
# and never used, which is what hid it.
if [ "$REPORT_CODE" -ne 0 ]; then
  echo "  the report step itself failed (exit $REPORT_CODE)" >&2
  exit 2
fi
if grep -q '"exit": [^0]' "$STAGES"; then
  exit 1
fi
exit 0
