// Retirement of a ONE-TIME step from a skill runbook, once the thing it exists to do is done.
//
// A one-shot against a finite backlog has a lifecycle problem: it has to be visible in the runbook
// so an operator actually runs it, and it has to STOP being visible afterwards or it becomes a
// permanent instruction to re-run something that is already a no-op. Every stale step in a runbook
// costs the next reader time deciding whether it still applies, and this repo has been bitten by
// exactly that — `dedup_legacy_twins.ts` still carries a "re-run normally unnecessary" caveat
// years after its cleanup, because nothing removed the step.
//
// So the script removes its own step. The block is delimited by HTML comments (invisible in
// rendered markdown), which makes the removal deterministic rather than a regex over prose.

export const oneTimeMarkers = (id: string): { start: string; end: string } => ({
  start: `<!-- ONE-TIME:${id}:START -->`,
  end: `<!-- ONE-TIME:${id}:END -->`,
});

export interface StripResult {
  text: string;
  /** False when the block was not present — already retired, or never added. Never an error: a
   *  second `--apply` on a clean corpus must not fail because it has nothing left to remove. */
  removed: boolean;
}

/** Remove the delimited block, and the blank line it leaves behind, from `text`.
 *
 *  Refuses (returns `removed: false`, text untouched) on anything it does not recognise: a missing
 *  marker, an end before its start, or — the one that actually bites — MORE THAN ONE of either.
 *
 *  A bare `indexOf` pair looks sufficient and is not. A second START anywhere in the file (a
 *  documented example of this mechanism, a fenced snippet showing the markers, a second one-time
 *  step that reused the id) makes it delete the whole span from the FIRST start to the FIRST end
 *  and report success — measured: it swallowed an intervening paragraph and left an unterminated
 *  code fence, while the console said "removed the ONE-TIME block". Counting is the difference
 *  between refusing and silently corrupting a committed runbook. */
export const stripOneTimeBlock = (text: string, id: string): StripResult => {
  const { start, end } = oneTimeMarkers(id);
  const count = (needle: string): number => text.split(needle).length - 1;
  if (count(start) !== 1 || count(end) !== 1) return { text, removed: false };
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (b < a) return { text, removed: false };
  const rest = text.slice(b + end.length);
  // Collapse the run of newlines the removal leaves between the neighbouring blocks down to the
  // single blank line markdown wants, so the file stays byte-clean for the next diff.
  return {
    text: text.slice(0, a).replace(/\n+$/, "\n\n") + rest.replace(/^\n+/, ""),
    removed: true,
  };
};
