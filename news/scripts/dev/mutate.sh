#!/usr/bin/env bash
# Mutation harness — inject one defect, run a suite, restore, report.
#
# Usage:
#   mutate.sh <file> <suite-cmd> <name> <<'EOF'
#   <text to replace — must occur exactly once>
#   ---
#   <replacement>
#   EOF
#
# Exit: 0 killed · 1 SURVIVED · 2 harness refused (no-op, bad patch, bad file)
#       3 restore failed — the source may be damaged, read the message
#
# ⚠️ THREE THINGS HERE ARE EASY TO GET WRONG AND ALL THREE HAVE SHIPPED:
#
#   1. THE VERDICT COMES FROM THE SUITE'S EXIT CODE, NEVER FROM ITS TEXT.
#      The first version grepped stdout for /fail/i. `test_analyze_articles.py`
#      at verbosity=2 prints "test_wrong_shape_index_fails_loudly ... ok" on a
#      PASSING run, so a comment-only mutation reported KILLED against a green
#      suite — the harness certifying coverage that does not exist.
#   2. A MUTATION THAT DID NOT APPLY IS NOT A RESULT. A stale anchor, a
#      heredoc with no `---`, or a replacement equal to the original all make
#      the run a no-op, and a green suite then reads as "nothing to test here".
#      Each is refused with exit 2 and a message, never scored.
#   3. THE RESTORE MUST BE CHECKED, AND SO MUST THE BACKUP. `cp` was unchecked
#      with no `set -e`: a failed backup left an EMPTY file, `cp` back
#      truncated the source, and `cmp` compared empty to empty and passed.
#      The backup is now verified before anything is written, and the restore
#      against a recorded checksum.
set -uo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: mutate.sh <file> <suite-cmd> <name> < patch-on-stdin" >&2
  exit 2
fi
FILE=$1; SUITE=$2; NAME=$3
[ -f "$FILE" ] || { echo "  $NAME -> REFUSED: no such file: $FILE" >&2; exit 2; }
[ -s "$FILE" ] || { echo "  $NAME -> REFUSED: $FILE is empty" >&2; exit 2; }

BACKUP=$(mktemp) || { echo "  $NAME -> REFUSED: mktemp failed" >&2; exit 2; }
if ! cp "$FILE" "$BACKUP" || ! cmp -s "$FILE" "$BACKUP"; then
  echo "  $NAME -> REFUSED: could not back up $FILE — nothing was modified" >&2
  rm -f "$BACKUP"; exit 2
fi
SUM=$(cksum < "$BACKUP")

INTERRUPTED=0
restore() {
  local rc=$?
  cp "$BACKUP" "$FILE" 2>/dev/null
  if [ "$(cksum < "$FILE" 2>/dev/null)" != "$SUM" ]; then
    echo "  !! RESTORE FAILED for $FILE — original preserved at $BACKUP" >&2
    exit 3
  fi
  rm -f "$BACKUP"
  # ⚠️ An interrupted run has NO verdict. Saying so beats printing one, and
  # beats raising the restore alarm that must stay meaningful.
  [ "$INTERRUPTED" = 1 ] && { echo "  $NAME -> ABORTED (no verdict)" >&2; exit 2; }
  exit $rc
}
trap restore EXIT
trap 'INTERRUPTED=1; exit 130' INT TERM

PATCH=$(cat)
case $PATCH in
  *$'\n---\n'*) ;;
  *) echo "  $NAME -> REFUSED: patch has no '---' separator line" >&2; exit 2 ;;
esac
OLD=${PATCH%%$'\n'---$'\n'*}
NEW=${PATCH#*$'\n'---$'\n'}
[ "$OLD" = "$NEW" ] && {
  echo "  $NAME -> REFUSED: replacement is identical to the original" >&2; exit 2; }

python3 - "$FILE" "$OLD" "$NEW" <<'PY' || exit 2
import sys
from pathlib import Path
p, old, new = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
s = p.read_text()
n = s.count(old)
if n != 1:
    print(f"  REFUSED: anchor matched {n} times (need exactly 1) — "
          "nothing was modified", file=sys.stderr)
    sys.exit(1)
p.write_text(s.replace(old, new))
PY

# ⚠️ THE VERDICT. Exit code only — see note 1 above.
eval "$SUITE" >/dev/null 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "  $NAME -> KILLED"
  exit 0
fi
echo "  $NAME -> ⚠️ SURVIVED — no test covers this defect"
exit 1
