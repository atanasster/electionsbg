// The marker-slice helper the source-scanning gates share, beside `stripJsxComments` because
// the two are always used together: strip the comments, then slice between two markers.
//
// Extracted rather than inlined per gate for the reason that file's own header gives — there
// were three copies of the stripper before it had a module, and this helper was on the same
// path: `src/screens/dashboard/electionsResultsFirst.gates.test.ts` had one copy and
// `src/data/elections/surfaceTypes.test.ts` was about to add a second, already missing the
// end guard.
//
// ⚠ BOTH indices are guarded, and the end one is the half that gets dropped. A missing START
// makes `indexOf` return -1, `slice(-1, …)` yields a short or empty string, and the caller's
// own assertion usually fails for the right reason by accident. A missing END is worse: with
// `endAt` at -1 the slice silently runs to the end of the file, so the gate scans everything
// after the marker and reports whatever it finds there — a false result rather than a failure.

/** Slice the text between two markers, failing loudly when either is absent.
 *
 *  Throws rather than returning a sentinel so a gate cannot proceed on a slice that does not
 *  mean what it says; the message names which marker went missing, which is the thing a
 *  reader needs when a source file has been renamed underneath a scan. */
export const sourceSection = (
  source: string,
  start: string,
  end: string,
): string => {
  const startAt = source.indexOf(start);
  if (startAt < 0) throw new Error(`missing section start ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  if (endAt < 0) throw new Error(`missing section end ${end} after ${start}`);
  return source.slice(startAt, endAt);
};
