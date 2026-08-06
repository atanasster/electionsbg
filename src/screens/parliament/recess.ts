// Days since the chamber last sat.
//
// Its own module so ParliamentWire stays a fast-refresh boundary, and so this can be tested
// without a clock. It exists at all because hub_stats carries an `inRecessDays` stamped when
// rebuildDerived ran, and /parliament is prerendered and bucket-cached — quoting that number
// would tell a reader on Friday what was true on Monday. The artifact supplies the last
// sitting's DATE, which does not age; the arithmetic happens at render.

const DAY_MS = 86_400_000;

/** Whole calendar days between two ISO days, floored at 0. Both are parsed as UTC midnight,
 *  so the result cannot drift with the viewer's zone. */
export const daysSince = (iso: string, todayIso: string): number =>
  Math.max(
    0,
    Math.round(
      (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) /
        DAY_MS,
    ),
  );
